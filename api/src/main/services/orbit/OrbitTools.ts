import mongoose from 'mongoose';
import container from '../../config/container';
import OrganizationService from '../OrganizationService';
import UserRepository from '../../repositories/mongoose/UserRepository';
import { LeanOrbitConversation, LeanOrbitPlan } from '../../types/models/Orbit';
import { LlmTool } from './OrbitLlmClient';
import OrbitPlanService from './OrbitPlanService';
import OrbitImportService from './OrbitImportService';
import { canManage, OrbitActor, resolveOrgRole } from './orbitAccess';

const MAX_TOOL_RESULT_CHARS = 12_000;
const MAX_LOOKUP_IDENTIFIERS = 50;
// One call covers a whole tree, rather than a round of the conversation per organization.
const MAX_MEMBER_LISTS = 25;

const orgTarget = {
  organizationId: { type: 'string', description: 'Id of an organization that already exists.' },
  organizationRef: { type: 'string', description: 'ref of an organization created earlier in this same plan.' },
};

/**
 * What the model may call. Read tools answer at once, with the same visibility
 * the user has in the web app. The two write tools never change SPHERE: they
 * only leave a pending plan for the user to confirm.
 */
export const ORBIT_TOOLS: LlmTool[] = [
  {
    type: 'function',
    function: {
      name: 'list_my_organizations',
      description: "The organizations the user belongs to, as a tree, with the user's role in each.",
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_organization',
      description: "Details of one organization (name, description, parent) and the user's role in it.",
      parameters: {
        type: 'object',
        properties: { organizationId: { type: 'string' } },
        required: ['organizationId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_organization_hierarchy',
      description: 'The whole branch an organization belongs to: ancestors, siblings and descendants, flat, with parent ids. The user must belong to the organization.',
      parameters: {
        type: 'object',
        properties: { organizationId: { type: 'string' } },
        required: ['organizationId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_members',
      description: `The direct members of one or more organizations with their roles. Ask for all the organizations you need in one call (up to ${MAX_MEMBER_LISTS}).`,
      parameters: {
        type: 'object',
        properties: {
          organizationIds: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: MAX_MEMBER_LISTS },
        },
        required: ['organizationIds'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_invitations',
      description: 'Pending invitation links of an organization. The user must be an OWNER or ADMIN of it.',
      parameters: {
        type: 'object',
        properties: { organizationId: { type: 'string' } },
        required: ['organizationId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_public_organizations',
      description: 'Search the public directory of top-level organizations by name or description.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Text to search for; omit to list the first ones.' } },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_users',
      description: 'Checks which of the given emails or usernames belong to a SPHERE account. Exact matches only.',
      parameters: {
        type: 'object',
        properties: {
          identifiers: { type: 'array', items: { type: 'string' }, maxItems: MAX_LOOKUP_IDENTIFIERS },
        },
        required: ['identifiers'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_plan',
      description:
        'Proposes changes to SPHERE as a plan for the user to review and confirm. Nothing changes until the user confirms. ' +
        'A new plan replaces the pending one of this conversation. Returns the plan, or errors to fix.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'One sentence describing the plan, in the language of the user.' },
          organizations: {
            type: 'array',
            description: 'Organizations to create. Use parentRef for a parent created in this plan, parentId for an existing one, neither for a top-level organization.',
            items: {
              type: 'object',
              properties: {
                ref: { type: 'string', description: 'Short unique handle within this plan, e.g. "sales".' },
                displayName: { type: 'string' },
                description: { type: 'string' },
                parentId: { type: 'string' },
                parentRef: { type: 'string' },
              },
              required: ['ref', 'displayName'],
              additionalProperties: false,
            },
          },
          updates: {
            type: 'array',
            description: 'Edits to existing organizations: new display name and/or description (empty string clears it).',
            items: {
              type: 'object',
              properties: {
                organizationId: { type: 'string' },
                displayName: { type: 'string' },
                description: { type: 'string' },
              },
              required: ['organizationId'],
              additionalProperties: false,
            },
          },
          members: {
            type: 'array',
            description: 'People to add as members. One entry per person and organization.',
            items: {
              type: 'object',
              properties: {
                ...orgTarget,
                user: { type: 'string', description: 'Email or username.' },
                role: { type: 'string', enum: ['ADMIN', 'MEMBER'] },
              },
              required: ['user', 'role'],
              additionalProperties: false,
            },
          },
          invitations: {
            type: 'array',
            description: 'Users to invite (they receive a notification and join if they accept).',
            items: {
              type: 'object',
              properties: {
                ...orgTarget,
                users: { type: 'array', items: { type: 'string' }, description: 'Emails or usernames.' },
              },
              required: ['users'],
              additionalProperties: false,
            },
          },
          invitationLinks: {
            type: 'array',
            description: 'Shareable invitation links to create.',
            items: {
              type: 'object',
              properties: {
                ...orgTarget,
                expiresInDays: { type: 'integer', description: 'Days until it expires (default 7).' },
                maxUses: { type: 'integer', description: 'Omit for unlimited uses.' },
              },
              additionalProperties: false,
            },
          },
        },
        required: ['summary'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'import_attachment',
      description:
        'Reads a file the user attached (CSV, TSV or text) describing organizations and/or members, and proposes a plan from it. ' +
        'Code interprets every row and reports ignored ones. Call it again with instructions to redo the interpretation.',
      parameters: {
        type: 'object',
        properties: {
          attachmentId: { type: 'string' },
          parentOrganizationId: {
            type: 'string',
            description: 'Existing organization to place the imported tree under. Omit to create top-level organizations.',
          },
          instructions: {
            type: 'string',
            description: 'What the user said about the file: role meanings, rows to skip, how to read it...',
          },
        },
        required: ['attachmentId'],
        additionalProperties: false,
      },
    },
  },
];

export interface OrbitToolContext {
  actor: OrbitActor;
  conversation: LeanOrbitConversation;
  /** Called with every plan a write tool stores, so the turn can return it. */
  onPlan: (plan: LeanOrbitPlan) => void;
  /** Progress of a long tool, such as reading a file, for the user to see. */
  onStatus?: (label: string) => void;
}

const TOOL_LABELS: Record<string, string> = {
  list_my_organizations: 'Looking up your organizations',
  get_organization: 'Reading the organization',
  get_organization_hierarchy: 'Exploring the hierarchy',
  list_members: 'Checking the members',
  list_invitations: 'Checking pending invitations',
  search_public_organizations: 'Searching public organizations',
  find_users: 'Looking up people',
  propose_plan: 'Drafting the plan',
  import_attachment: 'Reading your file',
};

/** What the user is told ORBIT is doing while a tool runs. */
export function describeToolCall(name: string | undefined): string {
  return (name && TOOL_LABELS[name]) || 'Working on it';
}

class OrbitToolRunner {
  private get organizationService(): OrganizationService {
    return container.resolve('organizationService');
  }

  private get userRepository(): UserRepository {
    return container.resolve('userRepository');
  }

  private get planService(): OrbitPlanService {
    return container.resolve('orbitPlanService');
  }

  private get importService(): OrbitImportService {
    return container.resolve('orbitImportService');
  }

  /** Runs one tool call. Failures come back as data for the model, never as a thrown error. */
  async run(name: string, rawArguments: string, context: OrbitToolContext): Promise<string> {
    let args: any;
    try {
      args = rawArguments ? JSON.parse(rawArguments) : {};
    } catch {
      return toResult({ ok: false, error: 'The tool arguments were not valid JSON.' });
    }

    try {
      return toResult(await this.dispatch(name, args ?? {}, context));
    } catch (err: any) {
      const message = String(err?.message ?? err);
      // The model being unreachable is the request failing, not the tool.
      if (message.toLowerCase().startsWith('orbit unavailable')) throw err;
      return toResult({ ok: false, error: message });
    }
  }

  private async dispatch(name: string, args: any, context: OrbitToolContext): Promise<unknown> {
    const { actor } = context;
    switch (name) {
      case 'list_my_organizations': {
        const tree: any = await this.organizationService.indexByUser(actor.id, { treeFormat: true });
        const items = Array.isArray(tree) ? tree : tree?.items ?? [];
        return { organizations: items.map(simplifyTreeNode) };
      }

      case 'get_organization': {
        const organization: any = await this.organizationService.show(requireId(args.organizationId));
        return {
          id: organization.id,
          name: organization.name,
          displayName: organization.displayName,
          description: organization.description ?? null,
          isPersonal: organization.isPersonal,
          parentId: organization._parentId ?? null,
          subOrganizations: (organization.subOrganizations ?? []).map((child: any) => ({
            id: child.id ?? child._id?.toString(),
            displayName: child.displayName,
          })),
          yourRole: await resolveOrgRole(this.organizationService, actor, organization.id),
        };
      }

      case 'get_organization_hierarchy': {
        const organizationId = requireId(args.organizationId);
        const role = await resolveOrgRole(this.organizationService, actor, organizationId);
        if (!role) throw new Error('PERMISSION ERROR: You do not belong to this organization');
        const nodes = await this.organizationService.getHierarchy(organizationId, actor);
        return {
          organizations: nodes.map((node: any) => ({
            id: node.id,
            name: node.name,
            displayName: node.displayName,
            parentId: node._parentId,
            isPersonal: node.isPersonal,
            youCanOpen: node.hasAccess,
          })),
        };
      }

      case 'list_members': {
        // A single organizationId is still taken, as models sometimes send one.
        const requested: unknown[] = Array.isArray(args.organizationIds)
          ? args.organizationIds
          : args.organizationId !== undefined
            ? [args.organizationId]
            : [];
        if (requested.length === 0) throw new Error('INVALID DATA: Give at least one organizationId');
        const organizations = await Promise.all(
          requested.slice(0, MAX_MEMBER_LISTS).map(async raw => {
            try {
              const organizationId = requireId(raw);
              const members: any[] = await this.organizationService.listMembers(organizationId);
              return {
                organizationId,
                members: members.map(member => ({ username: member.user?.username, role: member.role })),
              };
            } catch (err: any) {
              return { organizationId: String(raw), error: String(err?.message ?? err) };
            }
          })
        );
        return { organizations };
      }

      case 'list_invitations': {
        const organizationId = requireId(args.organizationId);
        if (!canManage(await resolveOrgRole(this.organizationService, actor, organizationId))) {
          throw new Error('PERMISSION ERROR: Only an OWNER or ADMIN can see the invitations of this organization');
        }
        const invitations: any[] = await this.organizationService.listInvitations(organizationId);
        return {
          invitations: invitations.map(invitation => ({
            code: invitation.code,
            link: `/orgs/join/${invitation.code}`,
            expiresAt: invitation.expiresAt ?? null,
            maxUses: invitation.maxUses ?? null,
            useCount: invitation.useCount ?? 0,
          })),
        };
      }

      case 'search_public_organizations': {
        const query = typeof args.query === 'string' ? args.query.trim().slice(0, 100) : undefined;
        const result: any = await this.organizationService.indexPublicRoots({ q: query || undefined, limit: 20, offset: 0 });
        return {
          total: result.total,
          organizations: result.items.map((organization: any) => ({
            id: organization.id,
            name: organization.name,
            displayName: organization.displayName,
            description: organization.description ?? null,
          })),
        };
      }

      case 'find_users': {
        const identifiers: string[] = Array.isArray(args.identifiers) ? args.identifiers.slice(0, MAX_LOOKUP_IDENTIFIERS) : [];
        const results = [];
        for (const identifier of identifiers) {
          const raw = String(identifier ?? '').trim();
          const user = !raw
            ? null
            : raw.includes('@') && !raw.startsWith('@')
              ? await this.userRepository.findByEmail(raw)
              : await this.userRepository.findByUsername(raw.replace(/^@/, ''));
          results.push(user ? { identifier: raw, found: true, username: user.username } : { identifier: raw, found: false });
        }
        return { users: results };
      }

      case 'propose_plan': {
        const result = await this.planService.propose(actor, context.conversation.id, args, { source: 'chat' });
        if (!result.ok) return { ok: false, errors: result.errors, warnings: result.warnings };
        context.onPlan(result.plan);
        return { ok: true, plan: describePlan(result.plan) };
      }

      case 'import_attachment': {
        const attachment = context.conversation.attachments.find(item => item.id === args.attachmentId);
        if (!attachment) {
          return { ok: false, error: `There is no attachment "${args.attachmentId}" in this conversation.` };
        }
        const imported = await this.importService.interpret(attachment, {
          parentOrganizationId: typeof args.parentOrganizationId === 'string' ? args.parentOrganizationId : null,
          instructions: typeof args.instructions === 'string' ? args.instructions : null,
          onProgress: context.onStatus,
        });
        context.onStatus?.('Checking the plan against your permissions');
        const result = await this.planService.propose(actor, context.conversation.id, imported.draft, {
          source: 'file',
          ignoredRows: imported.ignoredRows,
          warnings: imported.notes,
        });
        if (!result.ok) {
          return { ok: false, errors: result.errors, warnings: result.warnings, interpretation: imported.stats };
        }
        context.onPlan(result.plan);
        return {
          ok: true,
          interpretation: imported.stats,
          ignoredRows: imported.ignoredRows.slice(0, 20),
          plan: describePlan(result.plan),
        };
      }

      default:
        return { ok: false, error: `Unknown tool "${name}".` };
    }
  }
}

function requireId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!mongoose.isValidObjectId(id)) throw new Error('NOT FOUND: Organization not found');
  return id;
}

function simplifyTreeNode(node: any): any {
  return {
    id: node.id,
    name: node.name,
    displayName: node.displayName,
    role: node.role ?? null,
    isPersonal: node.isPersonal ?? false,
    subOrganizations: (node.subOrganizations ?? []).map(simplifyTreeNode),
  };
}

/** The plan as the model needs it to talk about it: what each step does, not how. */
function describePlan(plan: LeanOrbitPlan) {
  return {
    id: plan.id,
    status: plan.status,
    summary: plan.summary,
    steps: plan.steps.slice(0, 40).map(step => step.description),
    totalSteps: plan.steps.length,
    warnings: plan.warnings.slice(0, 20),
    ignoredRows: plan.ignoredRows.length,
  };
}

function toResult(value: unknown): string {
  const text = JSON.stringify(value);
  return text.length > MAX_TOOL_RESULT_CHARS
    ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}… (truncated)`
    : text;
}

export default OrbitToolRunner;
