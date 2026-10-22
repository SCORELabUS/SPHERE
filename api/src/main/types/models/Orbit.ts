/**
 * ORBIT, the assistant that runs SPHERE operations on the user's behalf.
 *
 * The model never writes data itself: it reads through query tools and, for any
 * change, leaves a plan behind. The user confirms the plan and a plain executor
 * applies it step by step, with the user's own permissions.
 */

export type OrbitAssignableRole = 'ADMIN' | 'MEMBER';

export type OrbitPlanStatus =
  | 'PENDING'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'PARTIAL'
  | 'FAILED'
  | 'CANCELLED'
  | 'SUPERSEDED';

export type OrbitStepStatus = 'PENDING' | 'DONE' | 'FAILED' | 'SKIPPED';

export type OrbitPlanSource = 'chat' | 'file' | 'mcp';

/**
 * An organization a step works on: one that already exists, or one created by an
 * earlier step of the same plan, named by the reference that step was given.
 */
export type OrbitOrgReference = { id: string; label: string } | { ref: string; label: string };

export interface OrbitPlanMember {
  userId: string;
  username: string;
  /** What the user or the file called them: an email or a username. */
  identifier: string;
  role: OrbitAssignableRole;
}

export interface OrbitPlanInvitee {
  userId: string;
  username: string;
  identifier: string;
}

/** What a permission lets a MEMBER do with a pricing or collection: view, edit, delete, create. */
export type OrbitAccess = 'GET' | 'PUT' | 'DELETE' | 'CREATE';

export type OrbitResourceType = 'pricing' | 'collection';

export interface OrbitPermissionChange {
  userId: string;
  username: string;
  identifier: string;
  resourceType: OrbitResourceType;
  /** Slug of the pricing or collection; null for organization-wide access (creating new ones). */
  resourceSlug: string | null;
  resourceLabel: string;
  /** The access the member ends up with; empty takes it away. */
  access: OrbitAccess[];
  /** The access they had when the plan was made, or null if they had none. */
  previous: OrbitAccess[] | null;
}

export type OrbitOperation =
  | {
      type: 'create_organization';
      ref: string;
      displayName: string;
      description: string | null;
      parent: OrbitOrgReference | null;
    }
  | {
      type: 'update_organization';
      organization: { id: string; label: string };
      displayName?: string;
      description?: string | null;
    }
  | {
      type: 'add_members';
      organization: OrbitOrgReference;
      members: OrbitPlanMember[];
    }
  | {
      type: 'invite_users';
      organization: OrbitOrgReference;
      users: OrbitPlanInvitee[];
    }
  | {
      type: 'create_invitation_link';
      organization: OrbitOrgReference;
      expiresInDays: number;
      maxUses: number | null;
    }
  | {
      type: 'change_member_roles';
      organization: { id: string; label: string };
      changes: Array<{ userId: string; username: string; identifier: string; from: OrbitAssignableRole; to: OrbitAssignableRole }>;
    }
  | {
      type: 'remove_members';
      organization: { id: string; label: string };
      members: Array<{ userId: string; username: string; identifier: string; role: OrbitAssignableRole }>;
    }
  | {
      type: 'revoke_invitations';
      organization: { id: string; label: string };
      invitations: Array<{ id: string; code: string }>;
    }
  | {
      type: 'move_organization';
      organization: { id: string; label: string };
      /** Where it hangs now and where it will; null is the top level. */
      from: { id: string; label: string } | null;
      to: { id: string; label: string } | null;
    }
  | {
      type: 'transfer_ownership';
      organization: { id: string; label: string };
      newOwner: { userId: string; username: string; identifier: string };
      /** Sub-organizations that change hands with it. */
      subOrganizations: number;
    }
  | {
      type: 'set_permissions';
      organization: { id: string; label: string };
      changes: OrbitPermissionChange[];
    }
  | {
      type: 'publish_pricing';
      organization: { id: string; label: string };
      attachment: { id: string; filename: string };
      /** The name the pricing is stored under, and its version as the file states it. */
      pricingName: string;
      version: string;
      /** The pricing it becomes a new version of, or null for a new pricing. */
      existing: { slug: string } | null;
      private: boolean;
      collection: { id: string; slug: string; label: string } | null;
    }
  | {
      type: 'set_pricing_visibility';
      organization: { id: string; label: string };
      changes: OrbitVisibilityChange[];
    }
  | {
      type: 'fork_pricing';
      /** Where the fork is created. */
      organization: { id: string; label: string };
      source: { organizationId: string; organizationLabel: string; slug: string; label: string; version: string };
      name: string;
    }
  | {
      type: 'create_collection';
      organization: { id: string; label: string };
      name: string;
      description: string | null;
      private: boolean;
      pricings: Array<{ slug: string; label: string }>;
    }
  | {
      type: 'update_collection_pricings';
      organization: { id: string; label: string };
      collection: { slug: string; label: string };
      add: Array<{ slug: string; label: string }>;
      remove: Array<{ slug: string; label: string }>;
    }
  | {
      type: 'mark_notifications_read';
      /** Every unread notification, or only the ones listed. */
      all: boolean;
      count: number;
      notifications: Array<{ id: string; title: string }>;
    }
  | {
      type: 'update_notification_preferences';
      changes: OrbitNotificationPreferenceChange[];
    }
  | {
      type: 'update_profile';
      changes: OrbitProfileChange[];
    }
  | {
      type: 'delete_pricing_versions';
      organization: { id: string; label: string };
      pricing: { slug: string; label: string };
      versions: string[];
      /** Versions the pricing keeps. */
      remaining: number;
    }
  | {
      type: 'delete_pricing';
      organization: { id: string; label: string };
      pricing: { slug: string; label: string };
      versions: number;
      followers: number;
      collection: string | null;
    }
  | {
      type: 'delete_collection';
      organization: { id: string; label: string };
      collection: { slug: string; label: string };
      /** Whether its pricings go too; otherwise they stay in the organization, out of any collection. */
      withPricings: boolean;
      pricings: Array<{ slug: string; label: string }>;
    }
  | {
      type: 'delete_organization';
      organization: { id: string; label: string };
      /** Everything below it, which goes with it. */
      subOrganizations: Array<{ id: string; label: string }>;
      pricings: number;
      collections: number;
      members: number;
      invitations: number;
    };

export interface OrbitNotificationChannels {
  email: boolean;
  inbox: boolean;
}

export interface OrbitNotificationPreferenceChange {
  kind: string;
  label: string;
  from: OrbitNotificationChannels;
  to: OrbitNotificationChannels;
}

export type OrbitProfileField = 'displayName' | 'bio' | 'linkedin' | 'instagram' | 'facebook' | 'x';

export interface OrbitProfileChange {
  field: OrbitProfileField;
  label: string;
  /** Empty when the field was not set, or is being cleared. */
  from: string;
  to: string;
}

export interface OrbitVisibilityChange {
  slug: string;
  label: string;
  /** One version, or null for every version of the pricing. */
  version: string | null;
  private: boolean;
}

export type OrbitOperationType = OrbitOperation['type'];

export interface OrbitPlanStep {
  id: string;
  description: string;
  operation: OrbitOperation;
  status: OrbitStepStatus;
  result?: Record<string, any> | null;
  error?: string | null;
}

export interface OrbitIgnoredRow {
  row: number;
  reason: string;
}

export interface LeanOrbitPlan {
  id: string;
  userId: string;
  conversationId: string;
  summary: string;
  source: OrbitPlanSource;
  /** The API key an assistant proposed it with through MCP: only that key may confirm it there. */
  apiKeyId?: string | null;
  status: OrbitPlanStatus;
  steps: OrbitPlanStep[];
  warnings: string[];
  ignoredRows: OrbitIgnoredRow[];
  /**
   * For plans that are hard to undo, such as handing an organization over: the
   * text the user has to type to confirm, so it cannot be confirmed by a slip.
   */
  confirmationPhrase?: string | null;
  confirmedAt?: Date | null;
  completedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * What the model, or the file importer, proposes. Nothing here is trusted: the
 * plan builder resolves every user and organization, checks permissions and the
 * shape of the tree, and only then turns it into steps.
 */
export interface OrbitPlanDraft {
  summary: string;
  organizations?: Array<{
    ref: string;
    displayName: string;
    description?: string | null;
    parentId?: string | null;
    parentRef?: string | null;
  }>;
  updates?: Array<{
    organizationId: string;
    displayName?: string;
    description?: string | null;
  }>;
  members?: Array<{
    organizationId?: string | null;
    organizationRef?: string | null;
    user: string;
    role: string;
  }>;
  invitations?: Array<{
    organizationId?: string | null;
    organizationRef?: string | null;
    users: string[];
  }>;
  invitationLinks?: Array<{
    organizationId?: string | null;
    organizationRef?: string | null;
    expiresInDays?: number | null;
    maxUses?: number | null;
  }>;
  roleChanges?: Array<{ organizationId: string; user: string; role: string }>;
  removals?: Array<{ organizationId: string; user: string }>;
  invitationRevocations?: Array<{ organizationId: string; code: string }>;
  /** parentId null, or left out, moves the organization to the top level. */
  moves?: Array<{ organizationId: string; parentId?: string | null }>;
  ownershipTransfer?: { organizationId: string; user: string } | null;
  permissions?: Array<{
    organizationId: string;
    user: string;
    resourceType: string;
    /** Slug or name of the pricing or collection; left out for organization-wide access. */
    resource?: string | null;
    /** The access to end up with; an empty list takes it all away. */
    access: string[];
  }>;
  /** Pricing YAML files attached to the conversation, to publish as a pricing or a new version. */
  pricingPublications?: Array<{
    attachmentId: string;
    organizationId: string;
    private?: boolean | null;
    collection?: string | null;
    name?: string | null;
  }>;
  visibilityChanges?: Array<{ organizationId: string; pricing: string; version?: string | null; private: boolean }>;
  forks?: Array<{
    sourceOrganizationId: string;
    pricing: string;
    version?: string | null;
    targetOrganizationId: string;
    name?: string | null;
  }>;
  newCollections?: Array<{
    organizationId: string;
    name: string;
    description?: string | null;
    private?: boolean | null;
    pricings?: string[];
  }>;
  collectionChanges?: Array<{ organizationId: string; collection: string; add?: string[]; remove?: string[] }>;
  /** The user's own notifications to mark as read: every unread one, or those ids. */
  notificationsRead?: { all?: boolean | null; ids?: string[] | null } | null;
  /** Channels to turn on or off per kind of notification; a channel left out stays as it is. */
  notificationPreferences?: Array<{ kind: string; email?: boolean | null; inbox?: boolean | null }>;
  /** Public profile fields to change; an empty string clears one. */
  profile?: Partial<Record<OrbitProfileField, string | null>> | null;
  /** Organizations to delete, each with everything below it. */
  organizationDeletions?: Array<{ organizationId: string }>;
  /** Pricings to delete: every version, or only the versions listed. */
  pricingDeletions?: Array<{ organizationId: string; pricing: string; versions?: string[] | null }>;
  collectionDeletions?: Array<{ organizationId: string; collection: string; withPricings?: boolean | null }>;
}

export type OrbitMessageRole = 'user' | 'assistant' | 'tool';

export interface OrbitToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface OrbitStoredMessage {
  id: string;
  role: OrbitMessageRole;
  content: string | null;
  toolCalls?: OrbitToolCall[];
  toolCallId?: string | null;
  planId?: string | null;
  attachmentId?: string | null;
  createdAt: Date;
}

export interface OrbitAttachment {
  id: string;
  filename: string;
  size: number;
  content: string;
  createdAt: Date;
}

export interface LeanOrbitConversation {
  id: string;
  userId: string;
  title: string;
  /** Where its messages come from: the chat, or assistants that reach ORBIT through MCP. */
  channel?: 'web' | 'mcp';
  messages: OrbitStoredMessage[];
  attachments: OrbitAttachment[];
  createdAt?: Date;
  updatedAt?: Date;
}

/** A message as the chat shows it: tool traffic and empty tool-call turns left out. */
export interface OrbitDisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  planId: string | null;
  attachment: { id: string; filename: string; size: number } | null;
  createdAt: Date;
}

export interface OrbitAuditEntry {
  userId: string;
  planId: string;
  conversationId: string;
  stepId: string;
  action: OrbitOperationType;
  params: Record<string, any>;
  outcome: 'SUCCESS' | 'FAILURE' | 'SKIPPED';
  result?: Record<string, any> | null;
  error?: string | null;
}
