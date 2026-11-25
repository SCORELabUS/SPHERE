import type { OrgMemberWithUser, OrgRole } from '../api/organizationsApi';

/**
 * `?view=member` (any plain member), `?view=member&as=<userId>` (that member) and
 * `?view=visitor` ask an organization's page to show it as one of its members,
 * or as someone outside it, sees it.
 */
export const VIEW_PARAM = 'view';
export const AS_PARAM = 'as';
/** How the API's member views name any plain member, in place of a member's id. */
export const ANY_MEMBER = 'any';

/** A member request with no `userId` is for any plain member. */
export type ViewAsRequest = { kind: 'member'; userId: string | null } | { kind: 'visitor' } | null;

export function readViewAsRequest(params: URLSearchParams): ViewAsRequest {
  const view = params.get(VIEW_PARAM);
  if (view === 'visitor') return { kind: 'visitor' };
  if (view === 'member') {
    const as = params.get(AS_PARAM);
    return { kind: 'member', userId: as && as !== ANY_MEMBER ? as : null };
  }
  return null;
}

/** The same search parameters asking for `request` instead; the others are kept. */
export function withViewAs(params: URLSearchParams, request: ViewAsRequest): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete(VIEW_PARAM);
  next.delete(AS_PARAM);
  if (request?.kind === 'visitor') next.set(VIEW_PARAM, 'visitor');
  if (request?.kind === 'member') {
    next.set(VIEW_PARAM, 'member');
    if (request.userId) next.set(AS_PARAM, request.userId);
  }
  return next;
}

/** One string per request, so that an effect reruns when the request changes. */
export function viewAsKey(request: ViewAsRequest): string {
  if (!request) return '';
  return request.kind === 'member' ? `member:${request.userId ?? ANY_MEMBER}` : 'visitor';
}

/** Only who manages the organization decides what it shows, so only they preview it. */
export function canPreviewOrganization(role: OrgRole | null): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

/** The members the organization can be previewed as one by one: its plain members, by username. */
export function previewMembers(members: OrgMemberWithUser[]): OrgMemberWithUser[] {
  return members
    .filter(member => member.role === 'MEMBER')
    .sort((a, b) => a.user.username.localeCompare(b.user.username));
}

/**
 * How the page shows the organization: as the signed-in member sees it
 * (`self`), to someone outside it (`visitor`), or, for an owner or admin who
 * asks, previewed as a member (any plain member, or one of them) or as a visitor.
 */
export type OrgViewMode = 'self' | 'visitor' | 'member-preview' | 'visitor-preview';

export interface OrgView {
  mode: OrgViewMode;
  /** In `member-preview`, the member previewed as; null for any plain member. */
  asMember: OrgMemberWithUser | null;
}

/**
 * The request changes nothing for someone outside the organization, nor for a
 * plain member. A member preview needs no member to exist: it is of any plain
 * member unless it names one of the organization's plain members.
 */
export function resolveOrgView(
  role: OrgRole | null,
  request: ViewAsRequest,
  members: OrgMemberWithUser[]
): OrgView {
  if (!role) return { mode: 'visitor', asMember: null };
  if (!request || !canPreviewOrganization(role)) return { mode: 'self', asMember: null };
  if (request.kind === 'visitor') return { mode: 'visitor-preview', asMember: null };
  const asMember = request.userId
    ? (previewMembers(members).find(member => member.user.id === request.userId) ?? null)
    : null;
  return { mode: 'member-preview', asMember };
}

/** Who the API's member views read the organization as: that member, or any plain member. */
export function memberViewTarget(asMember: OrgMemberWithUser | null): string {
  return asMember?.user.id ?? ANY_MEMBER;
}
