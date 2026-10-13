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

export type OrbitPlanSource = 'chat' | 'file';

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
    };

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
  status: OrbitPlanStatus;
  steps: OrbitPlanStep[];
  warnings: string[];
  ignoredRows: OrbitIgnoredRow[];
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
