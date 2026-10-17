import container from '../../config/container';
import OrbitPlanRepository from '../../repositories/mongoose/OrbitPlanRepository';
import OrbitAuditLogRepository from '../../repositories/mongoose/OrbitAuditLogRepository';
import OrganizationService from '../OrganizationService';
import PermissionService from '../PermissionService';
import { SetEntityPermissionInput } from '../../types/models/EntityPermission';
import {
  LeanOrbitPlan,
  OrbitOperation,
  OrbitOrgReference,
  OrbitPlanStatus,
  OrbitPlanStep,
  OrbitStepStatus,
} from '../../types/models/Orbit';
import { canManage, OrbitActor, resolveOrgRole, slugForOrganization } from './orbitAccess';
import { findPermissionRecord } from './OrbitPlanService';

export type OrbitProgressEvent =
  | { type: 'started'; planId: string; total: number }
  | {
      type: 'step';
      stepId: string;
      index: number;
      status: OrbitStepStatus;
      result?: Record<string, any> | null;
      error?: string | null;
    }
  | { type: 'done'; plan: LeanOrbitPlan };

// The bulk endpoint takes at most this many members per request; the executor
// keeps to the same size.
const MEMBERS_PER_BATCH = 100;

/**
 * A step made of several changes in which some went through and some did not:
 * it is reported as failed, with what was done kept in its result.
 */
class PartialStepError extends Error {
  constructor(message: string, readonly partialResult: Record<string, any>) {
    super(message);
  }
}

/** Fails the step when any change in it failed, keeping what was applied. */
function settle(result: Record<string, any>, failed: Array<{ username: string; error: string }>, done: number) {
  if (failed.length === 0) return result;
  const detail = failed.slice(0, 5).map(item => `@${item.username}: ${item.error}`).join('; ');
  const more = failed.length > 5 ? ` and ${failed.length - 5} more` : '';
  if (done === 0) throw new PartialStepError(`Nothing was applied. ${detail}${more}`, { ...result, failed });
  throw new PartialStepError(`${failed.length} of ${failed.length + done} changes failed: ${detail}${more}`, { ...result, failed });
}

/**
 * Applies a confirmed plan exactly as it was confirmed. There is no model here:
 * each step maps to an existing OrganizationService call, made with the user's
 * own permissions, which are checked again at this point because they may have
 * changed since the plan was proposed.
 *
 * A step that fails does not stop the run. What depended on it (the children
 * of an organization that could not be created, the members meant for it) is
 * skipped, and everything else carries on, so the final report says precisely
 * what was done and what was not.
 */
class OrbitExecutorService {
  private orbitPlanRepository: OrbitPlanRepository;
  private orbitAuditLogRepository: OrbitAuditLogRepository;
  private organizationService: OrganizationService;
  private permissionService: PermissionService;

  constructor() {
    this.orbitPlanRepository = container.resolve('orbitPlanRepository');
    this.orbitAuditLogRepository = container.resolve('orbitAuditLogRepository');
    this.organizationService = container.resolve('organizationService');
    this.permissionService = container.resolve('permissionService');
  }

  async execute(
    actor: OrbitActor,
    planId: string,
    onEvent: (event: OrbitProgressEvent) => void = () => {}
  ): Promise<LeanOrbitPlan> {
    const plan = await this.orbitPlanRepository.claimForExecution(planId, actor.id);
    if (!plan) {
      const existing = await this.orbitPlanRepository.findByIdForUser(planId, actor.id);
      if (!existing) throw new Error('NOT FOUND: Plan not found');
      throw new Error(`CONFLICT: This plan is ${existing.status.toLowerCase()} and cannot be confirmed again`);
    }

    onEvent({ type: 'started', planId: plan.id, total: plan.steps.length });

    const run = new PlanRun(actor, this.organizationService, this.permissionService);
    let done = 0;

    let finished: LeanOrbitPlan;
    try {
      for (const [index, step] of plan.steps.entries()) {
        const outcome = await run.apply(step);
        if (outcome.status === 'DONE') done++;

        await this.orbitPlanRepository.updateStep(plan.id, step.id, outcome);
        await this.recordAudit(actor, plan, step, outcome);
        onEvent({ type: 'step', stepId: step.id, index, ...outcome });
      }

      const status: OrbitPlanStatus =
        done === plan.steps.length ? 'COMPLETED' : done === 0 ? 'FAILED' : 'PARTIAL';
      finished = (await this.orbitPlanRepository.finish(plan.id, status)) as LeanOrbitPlan;
    } catch (err) {
      // Something around the steps broke, most likely the database. The plan is
      // closed with what is known rather than left running for ever.
      await this.orbitPlanRepository.closeInterrupted(plan.id).catch(() => null);
      throw err;
    }

    onEvent({ type: 'done', plan: finished });
    return finished;
  }

  private async recordAudit(
    actor: OrbitActor,
    plan: LeanOrbitPlan,
    step: OrbitPlanStep,
    outcome: { status: OrbitStepStatus; result?: Record<string, any> | null; error?: string | null }
  ) {
    try {
      await this.orbitAuditLogRepository.create({
        userId: actor.id,
        planId: plan.id,
        conversationId: plan.conversationId,
        stepId: step.id,
        action: step.operation.type,
        params: step.operation as unknown as Record<string, any>,
        outcome: outcome.status === 'DONE' ? 'SUCCESS' : outcome.status === 'SKIPPED' ? 'SKIPPED' : 'FAILURE',
        result: outcome.result ?? null,
        error: outcome.error ?? null,
      });
    } catch (err) {
      // The change itself has been made; losing its audit line is not a reason to
      // report it as failed.
      console.error('ORBIT: could not write audit log entry', err);
    }
  }
}

type StepOutcome = { status: OrbitStepStatus; result?: Record<string, any> | null; error?: string | null };

/** The state of one execution: which new organizations exist so far, and which never will. */
class PlanRun {
  private createdIds = new Map<string, string>();
  private unavailableRefs = new Set<string>();

  constructor(
    private actor: OrbitActor,
    private organizationService: OrganizationService,
    private permissionService: PermissionService
  ) {}

  async apply(step: OrbitPlanStep): Promise<StepOutcome> {
    const operation = step.operation;
    const missing = this.missingDependency(operation);
    if (missing) {
      if (operation.type === 'create_organization') this.unavailableRefs.add(operation.ref);
      return { status: 'SKIPPED', error: `Skipped because "${missing.label}" was not created` };
    }

    try {
      const result = await this.run(operation);
      return { status: 'DONE', result, error: null };
    } catch (err: any) {
      if (operation.type === 'create_organization') this.unavailableRefs.add(operation.ref);
      return { status: 'FAILED', result: err?.partialResult ?? null, error: String(err?.message ?? err) };
    }
  }

  private missingDependency(operation: OrbitOperation): OrbitOrgReference | null {
    const reference: OrbitOrgReference | null = operation.type === 'create_organization' ? operation.parent : operation.organization;
    if (reference && 'ref' in reference && this.unavailableRefs.has(reference.ref)) return reference;
    return null;
  }

  private async run(operation: OrbitOperation): Promise<Record<string, any>> {
    switch (operation.type) {
      case 'create_organization': {
        const parentId = operation.parent ? await this.targetId(operation.parent, 'create organizations under') : null;
        const organization: any = await this.organizationService.createWithOwner(
          {
            name: slugForOrganization(operation.displayName),
            displayName: operation.displayName,
            description: operation.description,
            isPersonal: false,
            ...(parentId ? { _parentId: parentId } : {}),
          },
          this.actor.id
        );
        const organizationId = organization.id ?? organization._id?.toString();
        this.createdIds.set(operation.ref, organizationId);
        return { organizationId, name: organization.name, displayName: organization.displayName };
      }

      case 'update_organization': {
        const organizationId = await this.targetId(operation.organization, 'edit');
        const changes: Record<string, any> = {};
        if (operation.displayName !== undefined) changes.displayName = operation.displayName;
        if (operation.description !== undefined) changes.description = operation.description;
        const organization: any = await this.organizationService.update(organizationId, changes);
        return {
          organizationId,
          name: organization.name,
          displayName: organization.displayName,
          description: organization.description ?? null,
        };
      }

      case 'add_members': {
        const organizationId = await this.targetId(operation.organization, 'add members to');
        const { fresh, alreadyIn } = await this.splitByMembership(organizationId, operation.members);
        for (let start = 0; start < fresh.length; start += MEMBERS_PER_BATCH) {
          const batch = fresh.slice(start, start + MEMBERS_PER_BATCH);
          await this.organizationService.addMembersBulk(
            organizationId,
            batch.map(member => ({ userId: member.userId, role: member.role }))
          );
        }
        return {
          organizationId,
          added: fresh.map(member => ({ username: member.username, role: member.role })),
          alreadyMembers: alreadyIn.map(member => member.username),
        };
      }

      case 'invite_users': {
        const organizationId = await this.targetId(operation.organization, 'invite users to');
        const { fresh, alreadyIn } = await this.splitByMembership(organizationId, operation.users);
        if (fresh.length === 0) {
          return { organizationId, invited: [], alreadyMembers: alreadyIn.map(user => user.username) };
        }
        const invitation: any = await this.organizationService.inviteUsersToOrganization(
          organizationId,
          fresh.map(user => user.userId),
          this.actor.id
        );
        return {
          organizationId,
          invitationCode: invitation.code,
          invited: fresh.map(user => user.username),
          alreadyMembers: alreadyIn.map(user => user.username),
        };
      }

      case 'create_invitation_link': {
        const organizationId = await this.targetId(operation.organization, 'create invitation links for');
        const invitation: any = await this.organizationService.createInvitation(organizationId, this.actor.id, {
          expiresInDays: operation.expiresInDays,
          maxUses: operation.maxUses ?? undefined,
        });
        return {
          organizationId,
          code: invitation.code,
          expiresAt: invitation.expiresAt,
          maxUses: invitation.maxUses ?? null,
        };
      }

      case 'change_member_roles': {
        const organizationId = await this.targetId(operation.organization, 'change roles in');
        const changed: Array<{ username: string; from: string; to: string }> = [];
        const failed: Array<{ username: string; error: string }> = [];
        for (const change of operation.changes) {
          try {
            await this.organizationService.updateMemberRole(change.userId, organizationId, change.to, await this.requester(organizationId));
            changed.push({ username: change.username, from: change.from, to: change.to });
          } catch (err: any) {
            failed.push({ username: change.username, error: String(err?.message ?? err) });
          }
        }
        return settle({ organizationId, changed }, failed, changed.length);
      }

      case 'remove_members': {
        const organizationId = await this.targetId(operation.organization, 'remove members from');
        const removed: string[] = [];
        const notMembers: string[] = [];
        const failed: Array<{ username: string; error: string }> = [];
        for (const member of operation.members) {
          try {
            await this.organizationService.removeMember(member.userId, organizationId, await this.requester(organizationId));
            removed.push(member.username);
          } catch (err: any) {
            const message = String(err?.message ?? err);
            // Someone who already left is where the plan wanted them.
            if (message.startsWith('NOT FOUND')) notMembers.push(member.username);
            else failed.push({ username: member.username, error: message });
          }
        }
        return settle({ organizationId, removed, notMembers }, failed, removed.length + notMembers.length);
      }

      case 'revoke_invitations': {
        const organizationId = await this.targetId(operation.organization, 'revoke invitations of');
        // Only invitations of this organization: the service would revoke any id it is given.
        const pending: any[] = await this.organizationService.listInvitations(organizationId);
        const pendingIds = new Set(pending.map(invitation => String(invitation.id ?? invitation._id)));
        const revoked: string[] = [];
        const alreadyGone: string[] = [];
        for (const invitation of operation.invitations) {
          if (!pendingIds.has(invitation.id)) {
            alreadyGone.push(invitation.code);
            continue;
          }
          await this.organizationService.revokeInvitation(invitation.id);
          revoked.push(invitation.code);
        }
        return { organizationId, revoked, alreadyGone };
      }

      case 'move_organization': {
        // Moving checks by itself that the user owns both ends.
        const organization: any = await this.organizationService.moveToParent(
          operation.organization.id,
          operation.to?.id ?? null,
          { id: this.actor.id, role: this.actor.role }
        );
        return { organizationId: operation.organization.id, parentId: organization?._parentId ? String(organization._parentId) : null };
      }

      case 'transfer_ownership': {
        // Handing over checks by itself that the user's own seat is the owner's.
        await this.organizationService.transferOwnership(operation.organization.id, operation.newOwner.userId, {
          id: this.actor.id,
          username: this.actor.username,
          role: this.actor.role,
        } as any);
        return { organizationId: operation.organization.id, newOwner: operation.newOwner.username };
      }

      case 'set_permissions': {
        const organizationId = await this.targetId(operation.organization, 'manage permissions in');
        const role = await resolveOrgRole(this.organizationService, this.actor, organizationId);
        const inputs: SetEntityPermissionInput[] = [];
        const removals: string[] = [];
        let alreadyWithout = 0;
        for (const change of operation.changes) {
          if (change.access.length > 0) {
            inputs.push({
              userId: change.userId,
              entityType: change.resourceType,
              entitySlug: change.resourceSlug,
              permissions: Object.fromEntries(change.access.map(access => [access, true])),
            });
            continue;
          }
          // Taking access away deletes the record as it is now, not as it was planned.
          const record = await findPermissionRecord(change.userId, organizationId, change.resourceType, change.resourceSlug);
          if (record) removals.push(String(record.id));
          else alreadyWithout++;
        }
        const result = await this.permissionService.setPermissionsBulk(
          organizationId,
          inputs,
          removals,
          this.actor.id,
          role,
          this.actor.role === 'ADMIN'
        );
        return {
          organizationId,
          granted: inputs.length,
          revoked: result.deleted,
          alreadyWithout,
        };
      }
    }
  }

  /** The user as the organization services expect the caller of a member change. */
  private async requester(organizationId: string): Promise<any> {
    return {
      id: this.actor.id,
      username: this.actor.username,
      role: this.actor.role,
      orgRole: await resolveOrgRole(this.organizationService, this.actor, organizationId),
    };
  }

  /**
   * The id of the organization a step acts on. One this run created is the
   * user's to manage by construction; an existing one is checked again now.
   */
  private async targetId(reference: OrbitOrgReference, action: string): Promise<string> {
    if ('ref' in reference) {
      const id = this.createdIds.get(reference.ref);
      if (!id) throw new Error(`NOT FOUND: "${reference.label}" was not created`);
      return id;
    }
    const role = await resolveOrgRole(this.organizationService, this.actor, reference.id);
    if (!canManage(role)) {
      throw new Error(`PERMISSION ERROR: You must be an OWNER or ADMIN of "${reference.label}" to ${action} it`);
    }
    return reference.id;
  }

  /**
   * People already in the organization are left alone, rather than failing the
   * whole batch: joining a new sub-organization brings its parent's managers
   * with it, and someone may have joined since the plan was made.
   */
  private async splitByMembership<T extends { userId: string }>(organizationId: string, users: T[]) {
    const fresh: T[] = [];
    const alreadyIn: T[] = [];
    for (const user of users) {
      const role = await this.organizationService.getUserOrgRole(user.userId, organizationId);
      (role === null ? fresh : alreadyIn).push(user);
    }
    return { fresh, alreadyIn };
  }
}

export default OrbitExecutorService;
