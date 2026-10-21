import type { OrbitAccess, OrbitOperation, OrbitOrgReference, OrbitPlan, OrbitStepStatus } from '../types/orbit';

/** One change to the people, access or place of an existing organization. */
export interface PlanChange {
  text: string;
  /** Removals, revocations and handovers are shown as what they are: things taken away. */
  tone: 'normal' | 'danger';
  status: OrbitStepStatus;
}

export interface PlanTreeNode {
  key: string;
  label: string;
  /** Created by this plan, as opposed to an organization that already exists. */
  isNew: boolean;
  /** The user's own account rather than an organization: notifications and public profile. */
  account: boolean;
  status: OrbitStepStatus | null;
  error: string | null;
  description: string | null;
  edits: Array<{ displayName?: string; description?: string | null; status: OrbitStepStatus; error: string | null }>;
  members: Array<{ username: string; role: 'ADMIN' | 'MEMBER'; status: OrbitStepStatus }>;
  invited: Array<{ username: string; status: OrbitStepStatus }>;
  links: Array<{ expiresInDays: number; maxUses: number | null; code: string | null; status: OrbitStepStatus; error: string | null }>;
  changes: PlanChange[];
  /** Status of the steps that add members or invite people here, when one failed or was skipped. */
  problems: string[];
  children: PlanTreeNode[];
}

const ACCOUNT_KEY = 'account';

const keyOf = (reference: OrbitOrgReference) => ('id' in reference ? `id:${reference.id}` : `ref:${reference.ref}`);

/**
 * Lays a plan out as the tree it will produce: the existing organizations it
 * touches at the top, with what it creates nested under them, and the members,
 * invitations, edits and links of each organization attached to its node.
 */
export function buildPlanTree(plan: OrbitPlan): PlanTreeNode[] {
  const nodes = new Map<string, PlanTreeNode>();
  const parentOf = new Map<string, string | null>();
  const order: string[] = [];

  const ensure = (key: string, label: string, isNew: boolean) => {
    if (!nodes.has(key)) {
      nodes.set(key, {
        key,
        label,
        isNew,
        account: key === ACCOUNT_KEY,
        status: null,
        error: null,
        description: null,
        edits: [],
        members: [],
        invited: [],
        links: [],
        changes: [],
        problems: [],
        children: [],
      });
      order.push(key);
      if (!parentOf.has(key)) parentOf.set(key, null);
    }
    return nodes.get(key)!;
  };

  for (const step of plan.steps) {
    const operation = step.operation;
    if (operation.type === 'create_organization') {
      const key = `ref:${operation.ref}`;
      if (operation.parent) {
        ensure(keyOf(operation.parent), operation.parent.label, 'ref' in operation.parent);
        parentOf.set(key, keyOf(operation.parent));
      }
      const node = ensure(key, operation.displayName, true);
      node.status = step.status;
      node.error = step.error ?? null;
      node.description = operation.description;
      continue;
    }

    if (
      operation.type === 'mark_notifications_read' ||
      operation.type === 'update_notification_preferences' ||
      operation.type === 'update_profile'
    ) {
      const account = ensure(ACCOUNT_KEY, 'Your account', false);
      if (step.status === 'FAILED' || step.status === 'SKIPPED') {
        account.problems.push(`${step.description}: ${step.error ?? step.status.toLowerCase()}`);
      }
      account.changes.push(...accountChanges(operation).map(text => ({ text, tone: 'normal' as const, status: step.status })));
      continue;
    }

    const target = ensure(keyOf(operation.organization), operation.organization.label, 'ref' in operation.organization);
    if (step.status === 'FAILED' || step.status === 'SKIPPED') {
      if (operation.type !== 'update_organization' && operation.type !== 'create_invitation_link') {
        target.problems.push(`${step.description}: ${step.error ?? step.status.toLowerCase()}`);
      }
    }

    switch (operation.type) {
      case 'update_organization':
        target.edits.push({
          displayName: operation.displayName,
          description: operation.description,
          status: step.status,
          error: step.error ?? null,
        });
        break;
      case 'add_members':
        target.members.push(...operation.members.map(member => ({ username: member.username, role: member.role, status: step.status })));
        break;
      case 'invite_users':
        target.invited.push(...operation.users.map(user => ({ username: user.username, status: step.status })));
        break;
      case 'create_invitation_link':
        target.links.push({
          expiresInDays: operation.expiresInDays,
          maxUses: operation.maxUses,
          code: (step.result?.code as string | undefined) ?? null,
          status: step.status,
          error: step.error ?? null,
        });
        break;
      case 'change_member_roles':
        target.changes.push(
          ...operation.changes.map(change => ({
            text: `@${change.username}: ${change.from} → ${change.to}`,
            tone: 'normal' as const,
            status: step.status,
          }))
        );
        break;
      case 'remove_members':
        target.changes.push(
          ...operation.members.map(member => ({
            text: `Remove @${member.username} (${member.role}), also from its sub-organizations`,
            tone: 'danger' as const,
            status: step.status,
          }))
        );
        break;
      case 'revoke_invitations':
        target.changes.push(
          ...operation.invitations.map(invitation => ({
            text: `Revoke the invitation link ${invitation.code}`,
            tone: 'danger' as const,
            status: step.status,
          }))
        );
        break;
      case 'move_organization':
        target.changes.push({
          text: `${operation.to ? `Move under “${operation.to.label}”` : 'Move to the top level'}${operation.from ? `, out of “${operation.from.label}”` : ''}, with everything below it`,
          tone: 'normal',
          status: step.status,
        });
        break;
      case 'transfer_ownership':
        target.changes.push({
          text: `Hand over to @${operation.newOwner.username}${operation.subOrganizations ? `, with its ${operation.subOrganizations} sub-organization${operation.subOrganizations === 1 ? '' : 's'}` : ''}. You stay as ADMIN`,
          tone: 'danger',
          status: step.status,
        });
        break;
      case 'publish_pricing':
        target.changes.push({
          text: `${operation.existing ? `New version ${operation.version} of` : 'Publish'} “${operation.pricingName}”${operation.existing ? '' : ` ${operation.version}`} from ${operation.attachment.filename}, ${operation.private ? 'private' : 'public'}${operation.collection ? `, in the collection “${operation.collection.label}”` : ''}`,
          tone: 'normal',
          status: step.status,
        });
        break;
      case 'set_pricing_visibility':
        target.changes.push(
          ...operation.changes.map(change => ({
            text: `Make “${change.label}”${change.version ? ` ${change.version}` : ', every version,'} ${change.private ? 'private' : 'public'}`,
            tone: 'normal' as const,
            status: step.status,
          }))
        );
        break;
      case 'fork_pricing':
        target.changes.push({
          text: `Fork “${operation.source.label}” ${operation.source.version} from “${operation.source.organizationLabel}” as “${operation.name}”`,
          tone: 'normal',
          status: step.status,
        });
        break;
      case 'create_collection':
        target.changes.push({
          text: `New ${operation.private ? 'private' : 'public'} collection “${operation.name}”${operation.pricings.length ? ` with ${operation.pricings.map(pricing => pricing.label).join(', ')}` : ''}`,
          tone: 'normal',
          status: step.status,
        });
        break;
      case 'update_collection_pricings':
        target.changes.push(
          ...operation.add.map(pricing => ({
            text: `Add “${pricing.label}” to the collection “${operation.collection.label}”`,
            tone: 'normal' as const,
            status: step.status,
          })),
          ...operation.remove.map(pricing => ({
            text: `Take “${pricing.label}” out of the collection “${operation.collection.label}”`,
            tone: 'danger' as const,
            status: step.status,
          }))
        );
        break;
      case 'delete_pricing_versions':
        target.changes.push({
          text: `Delete ${operation.versions.length === 1 ? 'version' : 'versions'} ${operation.versions.join(', ')} of “${operation.pricing.label}” (${count(operation.remaining, 'version')} left)`,
          tone: 'danger',
          status: step.status,
        });
        break;
      case 'delete_pricing':
        target.changes.push({
          text: [
            `Delete the pricing “${operation.pricing.label}” and its ${count(operation.versions, 'version')}`,
            operation.collection ? `, out of the collection “${operation.collection}”` : '',
            operation.followers ? `. ${count(operation.followers, 'follower')} stop getting its updates` : '',
          ].join(''),
          tone: 'danger',
          status: step.status,
        });
        break;
      case 'delete_collection':
        target.changes.push({
          text: operation.withPricings
            ? `Delete the collection “${operation.collection.label}” and its ${count(operation.pricings.length, 'pricing')}${operation.pricings.length ? `: ${operation.pricings.map(pricing => pricing.label).join(', ')}` : ''}`
            : `Delete the collection “${operation.collection.label}”. Its ${count(operation.pricings.length, 'pricing')} stay in the organization`,
          tone: 'danger',
          status: step.status,
        });
        break;
      case 'delete_organization': {
        const goes = [
          operation.subOrganizations.length
            ? `${count(operation.subOrganizations.length, 'sub-organization')} (${operation.subOrganizations.map(organization => organization.label).join(', ')})`
            : '',
          count(operation.pricings, 'pricing'),
          count(operation.collections, 'collection'),
          operation.invitations ? count(operation.invitations, 'pending invitation') : '',
        ].filter(Boolean);
        target.changes.push({
          text: `Delete this organization with ${goes.join(', ')}${operation.members ? `. ${count(operation.members, 'member')} lose access` : ''}`,
          tone: 'danger',
          status: step.status,
        });
        break;
      }
      case 'set_permissions':
        target.changes.push(
          ...operation.changes.map(change => {
            const what = change.resourceSlug ? `${change.resourceType} “${change.resourceLabel}”` : change.resourceLabel;
            const now = change.access.length ? describeAccess(change.access, !change.resourceSlug) : 'no access';
            const before = change.previous ? describeAccess(change.previous, !change.resourceSlug) : 'nothing of their own';
            return {
              text: `@${change.username} · ${what}: ${now} (was ${before})`,
              tone: change.access.length ? ('normal' as const) : ('danger' as const),
              status: step.status,
            };
          })
        );
        break;
    }
  }

  const roots: PlanTreeNode[] = [];
  for (const key of order) {
    const node = nodes.get(key)!;
    const parentKey = parentOf.get(key);
    if (parentKey && nodes.has(parentKey)) nodes.get(parentKey)!.children.push(node);
    else roots.push(node);
  }
  return roots;
}

type AccountOperation = Extract<
  OrbitOperation,
  { type: 'mark_notifications_read' | 'update_notification_preferences' | 'update_profile' }
>;

function accountChanges(operation: AccountOperation): string[] {
  switch (operation.type) {
    case 'mark_notifications_read':
      if (operation.all) return [`Mark all ${operation.count} unread notification${operation.count === 1 ? '' : 's'} as read`];
      return operation.notifications.map(notification => `Mark “${notification.title}” as read`);
    case 'update_notification_preferences':
      return operation.changes.map(
        change => `${change.label}: email ${change.to.email ? 'on' : 'off'}, in-app ${change.to.inbox ? 'on' : 'off'}`
      );
    case 'update_profile':
      return operation.changes.map(change =>
        change.to
          ? `${capitalize(change.label)}: “${change.to}”${change.from ? ` (was “${change.from}”)` : ''}`
          : `Clear your ${change.label}`
      );
  }
}

const count = (value: number, noun: string) => `${value} ${noun}${value === 1 ? '' : 's'}`;

/** Whether a plan deletes anything, which the card confirms differently. */
export const deletesSomething = (plan: OrbitPlan) => plan.steps.some(step => step.operation.type.startsWith('delete_'));

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const ACCESS_LABELS: Record<OrbitAccess, string> = { GET: 'view', PUT: 'edit', DELETE: 'delete', CREATE: 'add versions' };

function describeAccess(access: OrbitAccess[], organizationWide: boolean): string {
  return access.map(item => (organizationWide && item === 'CREATE' ? 'create' : ACCESS_LABELS[item])).join(', ');
}

export function countSteps(plan: OrbitPlan) {
  return {
    total: plan.steps.length,
    done: plan.steps.filter(step => step.status === 'DONE').length,
    failed: plan.steps.filter(step => step.status === 'FAILED').length,
    skipped: plan.steps.filter(step => step.status === 'SKIPPED').length,
  };
}
