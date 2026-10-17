export type OrbitPlanStatus =
  | 'PENDING'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'PARTIAL'
  | 'FAILED'
  | 'CANCELLED'
  | 'SUPERSEDED';

export type OrbitStepStatus = 'PENDING' | 'DONE' | 'FAILED' | 'SKIPPED';

export type OrbitOrgReference = { id: string; label: string } | { ref: string; label: string };

export type OrbitAccess = 'GET' | 'PUT' | 'DELETE' | 'CREATE';

type OrbitPerson = { userId: string; username: string; identifier: string };

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
      members: Array<{ userId: string; username: string; identifier: string; role: 'ADMIN' | 'MEMBER' }>;
    }
  | {
      type: 'invite_users';
      organization: OrbitOrgReference;
      users: Array<{ userId: string; username: string; identifier: string }>;
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
      changes: Array<OrbitPerson & { from: 'ADMIN' | 'MEMBER'; to: 'ADMIN' | 'MEMBER' }>;
    }
  | {
      type: 'remove_members';
      organization: { id: string; label: string };
      members: Array<OrbitPerson & { role: 'ADMIN' | 'MEMBER' }>;
    }
  | {
      type: 'revoke_invitations';
      organization: { id: string; label: string };
      invitations: Array<{ id: string; code: string }>;
    }
  | {
      type: 'move_organization';
      organization: { id: string; label: string };
      from: { id: string; label: string } | null;
      to: { id: string; label: string } | null;
    }
  | {
      type: 'transfer_ownership';
      organization: { id: string; label: string };
      newOwner: OrbitPerson;
      subOrganizations: number;
    }
  | {
      type: 'set_permissions';
      organization: { id: string; label: string };
      changes: Array<
        OrbitPerson & {
          resourceType: 'pricing' | 'collection';
          resourceSlug: string | null;
          resourceLabel: string;
          access: OrbitAccess[];
          previous: OrbitAccess[] | null;
        }
      >;
    }
  | {
      type: 'publish_pricing';
      organization: { id: string; label: string };
      attachment: { id: string; filename: string };
      pricingName: string;
      version: string;
      existing: { slug: string } | null;
      private: boolean;
      collection: { id: string; slug: string; label: string } | null;
    }
  | {
      type: 'set_pricing_visibility';
      organization: { id: string; label: string };
      changes: Array<{ slug: string; label: string; version: string | null; private: boolean }>;
    }
  | {
      type: 'fork_pricing';
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
    };

export interface OrbitPlanStep {
  id: string;
  description: string;
  operation: OrbitOperation;
  status: OrbitStepStatus;
  result?: Record<string, any> | null;
  error?: string | null;
}

export interface OrbitPlan {
  id: string;
  conversationId: string;
  summary: string;
  source: 'chat' | 'file';
  status: OrbitPlanStatus;
  steps: OrbitPlanStep[];
  warnings: string[];
  ignoredRows: Array<{ row: number; reason: string }>;
  /** Set on plans that are hard to undo: the text to type before confirming. */
  confirmationPhrase?: string | null;
  confirmedAt?: string | null;
  completedAt?: string | null;
  createdAt?: string;
}

export interface OrbitMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  planId: string | null;
  attachment: { id: string; filename: string; size: number } | null;
  createdAt: string;
}

export interface OrbitConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrbitConversation extends OrbitConversationSummary {
  messages: OrbitMessage[];
  plans: OrbitPlan[];
}

export interface OrbitAttachmentInput {
  filename: string;
  content: string;
}

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
  | { type: 'done'; plan: OrbitPlan }
  | { type: 'error'; error: string };

/** What the server reports while ORBIT works on a message. */
export type OrbitTurnEvent =
  | { type: 'accepted'; message: OrbitMessage; title: string }
  | { type: 'status'; label: string; tool?: string }
  | { type: 'delta'; text: string }
  | { type: 'reset' }
  | { type: 'done'; messages: OrbitMessage[]; plan: OrbitPlan | null }
  | { type: 'error'; error: string };
