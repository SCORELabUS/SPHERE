import type { Notification } from '../api/notificationsApi';

/**
 * Where opening a notification takes its reader, or null when it leads nowhere.
 * A pull request opens by its pricing's id through the permanent link, which
 * survives renames and collection moves and passes the tab and the pull request on.
 */
export function notificationLink(notification: Pick<Notification, 'kind' | 'data'>): string | null {
  const data = notification.data ?? {};
  switch (notification.kind) {
    case 'OrganizationInvitation':
      return data.invitationCode ? `/orgs/join/${data.invitationCode}` : null;
    case 'PricingUpdated':
      return data.organizationId && data.pricingSlug ? `/pricings/${data.organizationId}/${data.pricingSlug}` : null;
    case 'PricingPullRequest': {
      if (typeof data.pricingId !== 'string' || typeof data.pullRequestId !== 'string') return null;
      const query = new URLSearchParams({ tab: 'pull-requests', pr: data.pullRequestId });
      return `/p/${encodeURIComponent(data.pricingId)}?${query.toString()}`;
    }
    default:
      return null;
  }
}
