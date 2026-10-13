import type { OrbitOrgReference, OrbitPlan, OrbitStepStatus } from '../types/orbit';

export interface PlanTreeNode {
  key: string;
  label: string;
  /** Created by this plan, as opposed to an organization that already exists. */
  isNew: boolean;
  status: OrbitStepStatus | null;
  error: string | null;
  description: string | null;
  edits: Array<{ displayName?: string; description?: string | null; status: OrbitStepStatus; error: string | null }>;
  members: Array<{ username: string; role: 'ADMIN' | 'MEMBER'; status: OrbitStepStatus }>;
  invited: Array<{ username: string; status: OrbitStepStatus }>;
  links: Array<{ expiresInDays: number; maxUses: number | null; code: string | null; status: OrbitStepStatus; error: string | null }>;
  /** Status of the steps that add members or invite people here, when one failed or was skipped. */
  problems: string[];
  children: PlanTreeNode[];
}

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
        status: null,
        error: null,
        description: null,
        edits: [],
        members: [],
        invited: [],
        links: [],
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

export function countSteps(plan: OrbitPlan) {
  return {
    total: plan.steps.length,
    done: plan.steps.filter(step => step.status === 'DONE').length,
    failed: plan.steps.filter(step => step.status === 'FAILED').length,
    skipped: plan.steps.filter(step => step.status === 'SKIPPED').length,
  };
}
