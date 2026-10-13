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
