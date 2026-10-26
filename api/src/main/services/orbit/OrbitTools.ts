import mongoose from 'mongoose';
import container from '../../config/container';
import OrganizationService from '../OrganizationService';
import UserRepository from '../../repositories/mongoose/UserRepository';
import EntityPermissionRepository from '../../repositories/mongoose/EntityPermissionRepository';
import PricingRepository from '../../repositories/mongoose/PricingRepository';
import PricingCollectionRepository from '../../repositories/mongoose/PricingCollectionRepository';
import { LeanOrbitConversation, LeanOrbitPlan, OrbitAccess } from '../../types/models/Orbit';
import { LlmTool } from './OrbitLlmClient';
import OrbitPlanService, { accessOf, matchResource } from './OrbitPlanService';
import OrbitImportService from './OrbitImportService';
import { canManage, OrbitActor, resolveOrgRole } from './orbitAccess';
import { PRICING_TOOL_LABELS, PRICING_TOOLS, runPricingTool } from './orbitPricingTools';
import { ACCOUNT_TOOL_LABELS, ACCOUNT_TOOLS, runAccountTool } from './orbitAccountTools';

const MAX_TOOL_RESULT_CHARS = 12_000;
const MAX_LOOKUP_IDENTIFIERS = 50;
// One call covers a whole tree, rather than a round of the conversation per organization.
const MAX_MEMBER_LISTS = 25;
const MAX_RESOURCES_LISTED = 100;
const FULL_ACCESS: OrbitAccess[] = ['GET', 'PUT', 'DELETE', 'CREATE'];

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
      description: 'Pending invitation links of an organization, with the code used to revoke them. The user must be an OWNER or ADMIN of it.',
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
      name: 'list_resources',
      description: 'The pricings and collections of an organization the user can see, with whether each is private and the collection a pricing belongs to.',
      parameters: {
        type: 'object',
        properties: {
          organizationId: { type: 'string' },
          type: { type: 'string', enum: ['pricing', 'collection'], description: 'Omit for both.' },
          query: { type: 'string', description: 'Text to look for in the name.' },
        },
        required: ['organizationId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'who_can_access',
      description: 'Who can view, edit, delete or add versions to a pricing or collection, and why (role, own permission, its collection, or being public). The user must be an OWNER or ADMIN of the organization.',
      parameters: {
        type: 'object',
        properties: {
          organizationId: { type: 'string' },
          resourceType: { type: 'string', enum: ['pricing', 'collection'] },
          resource: { type: 'string', description: 'Name or slug of the pricing or collection.' },
        },
        required: ['organizationId', 'resourceType', 'resource'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_member_access',
      description: "What one person can do in an organization: their role and every pricing or collection permission they hold. The user must be an OWNER or ADMIN of it, or be asking about themselves.",
      parameters: {
        type: 'object',
        properties: {
          organizationId: { type: 'string' },
          user: { type: 'string', description: 'Email or username.' },
        },
        required: ['organizationId', 'user'],
        additionalProperties: false,
      },
    },
  },
  ...PRICING_TOOLS,
  ...ACCOUNT_TOOLS,
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
          roleChanges: {
            type: 'array',
            description: 'New roles for existing members. One entry per person and organization.',
            items: {
              type: 'object',
              properties: {
                organizationId: { type: 'string' },
                user: { type: 'string', description: 'Email or username.' },
                role: { type: 'string', enum: ['ADMIN', 'MEMBER'] },
              },
              required: ['organizationId', 'user', 'role'],
              additionalProperties: false,
            },
          },
          removals: {
            type: 'array',
            description: 'Members to remove from an organization (they also leave its sub-organizations).',
            items: {
              type: 'object',
              properties: {
                organizationId: { type: 'string' },
                user: { type: 'string', description: 'Email or username.' },
              },
              required: ['organizationId', 'user'],
              additionalProperties: false,
            },
          },
          invitationRevocations: {
            type: 'array',
            description: 'Pending invitation links to revoke, by the code list_invitations returns.',
            items: {
              type: 'object',
              properties: { organizationId: { type: 'string' }, code: { type: 'string' } },
              required: ['organizationId', 'code'],
              additionalProperties: false,
            },
          },
          moves: {
            type: 'array',
            description: 'Organizations to move, with their whole branch. parentId is the new parent; omit it to move to the top level.',
            items: {
              type: 'object',
              properties: { organizationId: { type: 'string' }, parentId: { type: 'string' } },
              required: ['organizationId'],
              additionalProperties: false,
            },
          },
          ownershipTransfer: {
            type: 'object',
            description: 'Hand an organization over to one of its members. Must be the only change in the plan.',
            properties: {
              organizationId: { type: 'string' },
              user: { type: 'string', description: 'Email or username of the new owner.' },
            },
            required: ['organizationId', 'user'],
            additionalProperties: false,
          },
          permissions: {
            type: 'array',
            description: 'What a MEMBER ends up being able to do with a pricing or collection. Omit resource for organization-wide CREATE.',
            items: {
              type: 'object',
              properties: {
                organizationId: { type: 'string' },
                user: { type: 'string', description: 'Email or username.' },
                resourceType: { type: 'string', enum: ['pricing', 'collection'] },
                resource: { type: 'string', description: 'Name or slug of the pricing or collection.' },
                access: {
                  type: 'array',
                  items: { type: 'string', enum: ['GET', 'PUT', 'DELETE', 'CREATE'] },
                  description: 'The full access to end up with; an empty list takes it all away.',
                },
              },
              required: ['organizationId', 'user', 'resourceType', 'access'],
              additionalProperties: false,
            },
          },
          pricingPublications: {
            type: 'array',
            description: 'Pricing YAML files attached to this conversation to publish. A file whose pricing already exists in the organization becomes a new version of it.',
            items: {
              type: 'object',
              properties: {
                attachmentId: { type: 'string' },
                organizationId: { type: 'string' },
                private: { type: 'boolean', description: 'Default false (public).' },
                collection: { type: 'string', description: 'Name or slug of an existing collection to put it in.' },
                name: { type: 'string', description: 'Name to publish it under, if not the saasName of the file.' },
              },
              required: ['attachmentId', 'organizationId'],
              additionalProperties: false,
            },
          },
          visibilityChanges: {
            type: 'array',
            description: 'Make pricings public or private: one version, or every version when version is omitted.',
            items: {
              type: 'object',
              properties: {
                organizationId: { type: 'string' },
                pricing: { type: 'string', description: 'Name or slug of the pricing.' },
                version: { type: 'string' },
                private: { type: 'boolean' },
              },
              required: ['organizationId', 'pricing', 'private'],
              additionalProperties: false,
            },
          },
          forks: {
            type: 'array',
            description: 'Copy a version of a pricing into another organization as a new pricing.',
            items: {
              type: 'object',
              properties: {
                sourceOrganizationId: { type: 'string' },
                pricing: { type: 'string', description: 'Name or slug of the pricing to fork.' },
                version: { type: 'string', description: 'Omit for the latest one.' },
                targetOrganizationId: { type: 'string' },
                name: { type: 'string', description: 'Name for the fork, if not the original one.' },
              },
              required: ['sourceOrganizationId', 'pricing', 'targetOrganizationId'],
              additionalProperties: false,
            },
          },
          newCollections: {
            type: 'array',
            description: 'Collections to create, optionally with existing pricings of the organization in them.',
            items: {
              type: 'object',
              properties: {
                organizationId: { type: 'string' },
                name: { type: 'string' },
                description: { type: 'string' },
                private: { type: 'boolean' },
                pricings: { type: 'array', items: { type: 'string' }, description: 'Names or slugs of pricings.' },
              },
              required: ['organizationId', 'name'],
              additionalProperties: false,
            },
          },
          collectionChanges: {
            type: 'array',
            description: 'Pricings to add to or remove from an existing collection.',
            items: {
              type: 'object',
              properties: {
                organizationId: { type: 'string' },
                collection: { type: 'string', description: 'Name or slug of the collection.' },
                add: { type: 'array', items: { type: 'string' } },
                remove: { type: 'array', items: { type: 'string' } },
              },
              required: ['organizationId', 'collection'],
              additionalProperties: false,
            },
          },
          notificationsRead: {
            type: 'object',
            description: "Mark the user's notifications as read: all unread ones, or the ids from get_notifications.",
            properties: { all: { type: 'boolean' }, ids: { type: 'array', items: { type: 'string' } } },
            additionalProperties: false,
          },
          notificationPreferences: {
            type: 'array',
            description: 'Turn email and/or in-app delivery on or off per kind of notification; a channel left out stays as it is.',
            items: {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: ['OrganizationInvitation', 'System', 'PricingUpdated'] },
                email: { type: 'boolean' },
                inbox: { type: 'boolean', description: 'In-app notifications.' },
              },
              required: ['kind'],
              additionalProperties: false,
            },
          },
          profile: {
            type: 'object',
            description: "The user's public profile; give only the fields to change, an empty string clears one. Social fields take full profile URLs.",
            properties: {
              displayName: { type: 'string' },
              bio: { type: 'string' },
              linkedin: { type: 'string' },
              instagram: { type: 'string' },
              facebook: { type: 'string' },
              x: { type: 'string' },
            },
            additionalProperties: false,
          },
          organizationDeletions: {
            type: 'array',
            description: 'Organizations to delete, each with all its sub-organizations, pricings, collections, members and invitations. Only alone in a plan.',
            items: {
              type: 'object',
              properties: { organizationId: { type: 'string' } },
              required: ['organizationId'],
              additionalProperties: false,
            },
          },
          pricingDeletions: {
            type: 'array',
            description: 'Pricings to delete: every version, or only the versions listed. Only alone in a plan.',
            items: {
              type: 'object',
              properties: {
                organizationId: { type: 'string' },
                pricing: { type: 'string', description: 'Name or slug of the pricing.' },
                versions: { type: 'array', items: { type: 'string' } },
              },
              required: ['organizationId', 'pricing'],
              additionalProperties: false,
            },
          },
          collectionDeletions: {
            type: 'array',
            description: 'Collections to delete; withPricings also deletes the pricings in them, otherwise they stay. Only alone in a plan.',
            items: {
              type: 'object',
              properties: {
                organizationId: { type: 'string' },
                collection: { type: 'string', description: 'Name or slug of the collection.' },
                withPricings: { type: 'boolean' },
              },
              required: ['organizationId', 'collection'],
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
        'Not for pricing YAML files: publish those with pricingPublications in propose_plan. ' +
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
  /** Where a proposed plan comes from: the chat, or an assistant through MCP. */
  planSource?: 'chat' | 'mcp';
}

const TOOL_LABELS: Record<string, string> = {
  list_my_organizations: 'Looking up your organizations',
  get_organization: 'Reading the organization',
  get_organization_hierarchy: 'Exploring the hierarchy',
  list_members: 'Checking the members',
  list_invitations: 'Checking pending invitations',
  search_public_organizations: 'Searching public organizations',
  find_users: 'Looking up people',
  list_resources: 'Looking up pricings and collections',
  who_can_access: 'Reviewing who has access',
  get_member_access: "Reviewing the member's access",
  ...PRICING_TOOL_LABELS,
  ...ACCOUNT_TOOL_LABELS,
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

  private get entityPermissionRepository(): EntityPermissionRepository {
    return container.resolve('entityPermissionRepository');
  }

  private get pricingRepository(): PricingRepository {
    return container.resolve('pricingRepository');
  }

  private get pricingCollectionRepository(): PricingCollectionRepository {
    return container.resolve('pricingCollectionRepository');
  }

  /** Runs one tool call. Failures come back as data for the model, never as a thrown error. */
  async run(name: string, rawArguments: string, context: OrbitToolContext): Promise<string> {
    let args: any;
    try {
      args = rawArguments ? JSON.parse(rawArguments) : {};
    } catch {
      return toResult({ ok: false, error: 'The tool arguments were not valid JSON.' });
    }

    return toResult(await this.runParsed(name, args ?? {}, context));
  }

  /** Runs one tool call with its arguments already parsed, and returns the result as data. */
  async runParsed(name: string, args: any, context: OrbitToolContext): Promise<unknown> {
    try {
      return await this.dispatch(name, args ?? {}, context);
    } catch (err: any) {
      const message = String(err?.message ?? err);
      // The model being unreachable is the request failing, not the tool.
      if (message.toLowerCase().startsWith('orbit unavailable')) throw err;
      return { ok: false, error: message };
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

      case 'list_resources': {
        const organizationId = requireId(args.organizationId);
        const role = await resolveOrgRole(this.organizationService, actor, organizationId);
        if (!role) throw new Error('PERMISSION ERROR: You do not belong to this organization');
        const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
        const matches = (resource: { name: string; slug: string }) =>
          !query || resource.name.toLowerCase().includes(query) || resource.slug.includes(query);

        const collections = await this.pricingCollectionRepository.findSummariesByOrganization(organizationId);
        const own = canManage(role) ? [] : await this.entityPermissionRepository.findByUserAndOrganization(actor.id, organizationId);
        const hasOwnGet = (type: 'pricing' | 'collection', slug: string) =>
          own.some(record => record.entityType === type && record.entitySlug === slug && record.permissions.GET);
        const canView = (type: 'pricing' | 'collection', slug: string, isPrivate: boolean) =>
          canManage(role) || !isPrivate || hasOwnGet(type, slug);
        const visibleCollections = collections.filter(collection => canView('collection', collection.slug, collection.private));

        const result: Record<string, unknown> = {};
        if (args.type !== 'collection') {
          const pricings = (await this.pricingRepository.findSummariesByOrganization(organizationId)).filter(pricing => {
            // Seeing a collection by permission lets a member see the pricings in it.
            const collection = collections.find(item => item.id === pricing.collectionId);
            const throughCollection = !!collection && hasOwnGet('collection', collection.slug);
            return matches(pricing) && (canView('pricing', pricing.slug, pricing.private) || throughCollection);
          });
          result.pricings = pricings.slice(0, MAX_RESOURCES_LISTED).map(pricing => ({
            name: pricing.name,
            slug: pricing.slug,
            private: pricing.private,
            versions: pricing.versions,
            collection: collections.find(item => item.id === pricing.collectionId)?.name ?? null,
          }));
          result.totalPricings = pricings.length;
        }
        if (args.type !== 'pricing') {
          const listed = visibleCollections.filter(matches);
          result.collections = listed.slice(0, MAX_RESOURCES_LISTED).map(collection => ({
            name: collection.name,
            slug: collection.slug,
            private: collection.private,
          }));
          result.totalCollections = listed.length;
        }
        return result;
      }

      case 'who_can_access':
        return this.whoCanAccess(actor, args);

      case 'get_member_access':
        return this.memberAccess(actor, args);

      case 'propose_plan': {
        const result = await this.planService.propose(actor, context.conversation.id, args, {
          source: context.planSource ?? 'chat',
          attachments: context.conversation.attachments,
        });
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

      default: {
        const result = (await runPricingTool(name, args, actor)) ?? (await runAccountTool(name, args, actor));
        return result === undefined ? { ok: false, error: `Unknown tool "${name}".` } : result;
      }
    }
  }

  /**
   * Who can do what with one pricing or collection, by the rules the web app
   * applies: owners and admins can do everything, anyone can view a public one,
   * and a plain member needs a permission of their own (or, to view a pricing,
   * one on its collection). Editing a private one also takes viewing it.
   */
  private async whoCanAccess(actor: OrbitActor, args: any) {
    const organizationId = requireId(args.organizationId);
    if (!canManage(await resolveOrgRole(this.organizationService, actor, organizationId))) {
      throw new Error('PERMISSION ERROR: Only an OWNER or ADMIN can review who has access in this organization');
    }
    const type = args.resourceType === 'pricing' || args.resourceType === 'collection' ? args.resourceType : null;
    if (!type) throw new Error('INVALID DATA: resourceType must be pricing or collection');
    const raw = typeof args.resource === 'string' ? args.resource : '';

    const collections = await this.pricingCollectionRepository.findSummariesByOrganization(organizationId);
    const pricing = type === 'pricing'
      ? matchResource(await this.pricingRepository.findSummariesByOrganization(organizationId), raw)
      : null;
    const resource = type === 'pricing' ? pricing : matchResource(collections, raw);
    if (!resource) throw new Error(`NOT FOUND: There is no ${type} called "${raw}" in this organization`);
    const collection = pricing ? collections.find(item => item.id === pricing.collectionId) ?? null : null;

    const members: any[] = await this.organizationService.listMembers(organizationId);
    const own = await this.entityPermissionRepository.findByEntity(type, resource.slug, organizationId);
    const viaCollection = collection
      ? await this.entityPermissionRepository.findByEntity('collection', collection.slug, organizationId)
      : [];

    const people: Array<{ username: string; role: string; access: OrbitAccess[]; why: string }> = [];
    let viewOnlyBecausePublic = 0;
    for (const member of members) {
      const userId = String(member._userId);
      const username = member.user?.username ?? userId;
      if (member.role === 'OWNER' || member.role === 'ADMIN') {
        people.push({ username, role: member.role, access: [...FULL_ACCESS], why: `${member.role} of the organization` });
        continue;
      }
      const record = own.find(item => String(item._userId) === userId);
      const access = new Set<OrbitAccess>(accessOf(record?.permissions));
      const why: string[] = access.size ? ['own permission'] : [];
      if (resource.private && !record?.permissions.GET) access.delete('PUT');
      if (!access.has('GET')) {
        if (collection && viaCollection.some(item => String(item._userId) === userId && item.permissions.GET)) {
          access.add('GET');
          why.push(`can view its collection "${collection.name}"`);
        } else if (!resource.private) {
          access.add('GET');
          why.push('it is public');
        }
      }
      if (access.size === 0) continue;
      if (access.size === 1 && why.length === 1 && why[0] === 'it is public') {
        viewOnlyBecausePublic++;
        continue;
      }
      people.push({ username, role: member.role, access: FULL_ACCESS.filter(item => access.has(item)), why: why.join(', ') });
    }

    return {
      resource: { type, name: resource.name, private: resource.private, collection: collection?.name ?? null },
      anyoneSignedInCanView: !resource.private,
      people: people.slice(0, 200),
      totalPeople: people.length,
      otherMembersWhoCanOnlyView: viewOnlyBecausePublic,
      note: 'Platform administrators can access everything.',
    };
  }

  /** Someone's role in an organization and every permission they hold in it. */
  private async memberAccess(actor: OrbitActor, args: any) {
    const organizationId = requireId(args.organizationId);
    const raw = typeof args.user === 'string' ? args.user.trim() : '';
    const user = !raw
      ? null
      : raw.includes('@') && !raw.startsWith('@')
        ? await this.userRepository.findByEmail(raw)
        : await this.userRepository.findByUsername(raw.replace(/^@/, ''));
    if (!user) throw new Error(`NOT FOUND: No SPHERE account matches "${raw}"`);
    if (user.id !== actor.id && !canManage(await resolveOrgRole(this.organizationService, actor, organizationId))) {
      throw new Error("PERMISSION ERROR: Only an OWNER or ADMIN can review other people's access in this organization");
    }

    const role = await this.organizationService.getUserOrgRole(user.id, organizationId);
    if (!role) return { username: user.username, member: false };
    if (role === 'OWNER' || role === 'ADMIN') {
      return {
        username: user.username,
        member: true,
        role,
        canDo: [
          'view, edit and delete every pricing and collection, and create new ones',
          'manage members, invitations and permissions',
          ...(role === 'OWNER' ? ['move the organization and hand it over to another member'] : []),
        ],
      };
    }

    const records = await this.entityPermissionRepository.findByUserAndOrganization(user.id, organizationId);
    const createsNew = (type: 'pricing' | 'collection') =>
      records.some(record => record.entityType === type && record.entitySlug === null && record.permissions.CREATE);
    return {
      username: user.username,
      member: true,
      role,
      canViewPublicPricingsAndCollections: true,
      canCreateNewPricings: createsNew('pricing'),
      canCreateNewCollections: createsNew('collection'),
      permissions: records
        .filter(record => record.entitySlug !== null && accessOf(record.permissions).length > 0)
        .slice(0, 200)
        .map(record => ({
          type: record.entityType,
          name: (record as any).entityName ?? record.entitySlug,
          access: accessOf(record.permissions),
        })),
    };
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
export function describePlan(plan: LeanOrbitPlan) {
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
