import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  organizationRepository: { findById: vi.fn() },
  organizationMembershipRepository: { findDirectMemberships: vi.fn() },
  pricingPullRequestRepository: { touchNotified: vi.fn() },
  userRepository: { findByIds: vi.fn(), findById: vi.fn() },
  notificationService: { createNotification: vi.fn() },
  permissionService: { canReadPrivateVersions: vi.fn() },
}));

vi.mock('../../main/config/container', () => ({
  default: { resolve: vi.fn((name: string) => (mocks as Record<string, unknown>)[name]) },
}));

import PricingPullRequestNotifier, { MAX_RECIPIENTS } from '../../main/services/PricingPullRequestNotifier';
import { PricingPullRequest } from '../../main/types/models/PricingPullRequest';
import { LeanUser } from '../../main/types/models/User';

const HOUR = 60 * 60 * 1000;
const ORGANIZATION = 'org-p';
const PARENT = 'org-parent';
const pricing = { pricingId: 'pricing-p', name: 'Petclinic', slug: 'petclinic', organizationId: ORGANIZATION, collectionSlug: undefined };

/** A user id that sorts as its number does. */
const userId = (n: number) => `user-${String(n).padStart(3, '0')}`;
const user = (id: string, role = 'USER') => ({ id, username: `name-${id}`, role }) as unknown as LeanUser;

const pullRequest = (overrides: Partial<PricingPullRequest> = {}) =>
  ({ id: 'pr-1', number: 7, title: 'Raise <b>GOLD</b>', authorId: 'author', ...overrides }) as PricingPullRequest;

/** Direct memberships by organization. */
function memberships(byOrganization: Record<string, Array<[string, string]>>) {
  mocks.organizationMembershipRepository.findDirectMemberships.mockImplementation(async (organizationId: string) =>
    (byOrganization[organizationId] ?? []).map(([id, role]) => ({ _userId: id, role })));
}

const maintainers = (except: string[] = []) => vi.fn(async (candidate: LeanUser) => !except.includes(candidate.id));

describe('Who is told about a pull request', () => {
  let notifier: PricingPullRequestNotifier;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.organizationRepository.findById.mockResolvedValue({ id: ORGANIZATION, ancestors: [PARENT] });
    // Every user asked for exists; a global ADMIN only exists here, never in a membership.
    mocks.userRepository.findByIds.mockImplementation(async (ids: string[]) => ids.map(id => user(id)));
    notifier = new PricingPullRequestNotifier();
  });

  it('Takes the maintainers among the members of the organization and its ancestors, without the author, at most 50 in order (CA-78).', async () => {
    const members: Array<[string, string]> = Array.from({ length: 60 }, (_, index) => [userId(index), 'MEMBER']);
    memberships({ [ORGANIZATION]: [['author', 'OWNER'], ...members.slice(0, 40)], [PARENT]: members.slice(40) });
    // user-003 may not publish versions (or not read the private ones).
    const isMaintainer = maintainers([userId(3)]);

    const recipients = await notifier.recipients(pricing, 'author', isMaintainer);

    expect(recipients.map(recipient => recipient.id)).toEqual(
      Array.from({ length: 51 }, (_, index) => userId(index)).filter(id => id !== userId(3))
    );
    expect(recipients).toHaveLength(MAX_RECIPIENTS);
    // Nobody but members is ever asked for: no global administrator who is not one.
    expect(mocks.userRepository.findByIds.mock.calls.flat(2)).not.toContain('author');
    expect(mocks.userRepository.findByIds.mock.calls.flat(2)).toHaveLength(60);
    // Past the 50th maintainer nobody else is checked.
    expect(isMaintainer).toHaveBeenCalledTimes(51);
  });

  it('Puts the owners first, then the admins, then the members, each by id (L-002: role, then userId).', async () => {
    const members: Array<[string, string]> = Array.from({ length: 51 }, (_, index) => [userId(index), 'MEMBER']);
    memberships({ [ORGANIZATION]: [...members, [userId(999), 'OWNER'], [userId(998), 'ADMIN']] });

    const recipients = await notifier.recipients(pricing, 'author', maintainers());

    expect(recipients.map(recipient => recipient.id).slice(0, 3)).toEqual([userId(999), userId(998), userId(0)]);
    expect(recipients.map(recipient => recipient.id)).not.toContain(userId(50));
  });

  it('Ranks a member by their highest role in the organization or its ancestors.', async () => {
    memberships({ [ORGANIZATION]: [[userId(1), 'MEMBER'], [userId(2), 'ADMIN']], [PARENT]: [[userId(3), 'MEMBER'], [userId(1), 'OWNER']] });

    const recipients = await notifier.recipients(pricing, 'author', maintainers());

    expect(recipients.map(recipient => recipient.id)).toEqual([userId(1), userId(2), userId(3)]);
  });
});

describe('Pull request notifications', () => {
  let notifier: PricingPullRequestNotifier;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.organizationRepository.findById.mockResolvedValue({ id: ORGANIZATION, ancestors: [] });
    mocks.userRepository.findByIds.mockImplementation(async (ids: string[]) => ids.map(id => user(id)));
    mocks.notificationService.createNotification.mockResolvedValue({ id: 'notification' });
    notifier = new PricingPullRequestNotifier();
  });

  const sent = () => mocks.notificationService.createNotification.mock.calls.map(([notification]) => notification);
  const DATA = { pricingId: 'pricing-p', pullRequestId: 'pr-1', number: 7, organizationId: ORGANIZATION, pricingSlug: 'petclinic' };

  it('Tells each maintainer of a new pull request, with its title in the message only (CA-56).', async () => {
    memberships({ [ORGANIZATION]: [[userId(1), 'OWNER'], [userId(2), 'MEMBER'], ['author', 'MEMBER']] });

    await notifier.notifyMaintainers('opened', pullRequest(), pricing, user('author'), maintainers());

    expect(sent()).toEqual([userId(1), userId(2)].map(id => ({
      userId: id,
      kind: 'PricingPullRequest',
      title: 'New pull request #7 on Petclinic',
      message: '@name-author proposed changes to "Petclinic": Raise <b>GOLD</b>',
      data: DATA,
    })));
  });

  it('Says when the proposal of a pull request was updated, and keeps telling the others when one cannot be told.', async () => {
    memberships({ [ORGANIZATION]: [[userId(1), 'OWNER'], [userId(2), 'MEMBER']] });
    mocks.notificationService.createNotification.mockRejectedValueOnce(new Error('inbox down'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await notifier.notifyMaintainers('updated', pullRequest(), pricing, user('author'), maintainers());
    } finally {
      error.mockRestore();
    }

    expect(sent().map(notification => [notification.userId, notification.title])).toEqual([
      [userId(1), 'Pull request #7 on Petclinic was updated'],
      [userId(2), 'Pull request #7 on Petclinic was updated'],
    ]);
  });

  it('Claims a round when a pull request opens, and for its updates once a day (CA-104).', async () => {
    let lastNotifiedAt: Date | undefined;
    mocks.pricingPullRequestRepository.touchNotified.mockImplementation(async (_id: string, since: Date, now: Date) => {
      if (lastNotifiedAt && lastNotifiedAt.getTime() > since.getTime()) return false;
      lastNotifiedAt = now;
      return true;
    });
    const at = (hours: number) => new Date(Date.UTC(2026, 0, 1) + hours * HOUR);

    const rounds = [
      await notifier.claimRound('pr-1', 'opened', at(0)),
      await notifier.claimRound('pr-1', 'updated', at(1)),
      await notifier.claimRound('pr-1', 'updated', at(2)),
      await notifier.claimRound('pr-1', 'updated', at(23)),
      await notifier.claimRound('pr-1', 'updated', at(25)),
      await notifier.claimRound('pr-1', 'updated', at(26)),
    ];

    expect(rounds).toEqual([true, false, false, false, true, false]);
    expect(mocks.pricingPullRequestRepository.touchNotified.mock.calls[0]).toEqual(['pr-1', at(0), at(0)]);
    expect(mocks.pricingPullRequestRepository.touchNotified.mock.calls[1]).toEqual(['pr-1', at(-23), at(1)]);
  });

  it('Names the merged version to the author only if they may read it (CA-57).', async () => {
    mocks.userRepository.findById.mockResolvedValue(user('author'));
    mocks.permissionService.canReadPrivateVersions.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const merger = user('owner');

    await notifier.notifyMerged(pullRequest(), pricing, merger, { version: '9.0.0-secret', private: true });
    await notifier.notifyMerged(pullRequest(), pricing, merger, { version: '9.1.0-readable', private: true });
    await notifier.notifyMerged(pullRequest(), pricing, merger, { version: '9.2.0', private: false });

    expect(sent().map(notification => notification.message)).toEqual([
      '@name-owner merged your pull request: Raise <b>GOLD</b>',
      '@name-owner merged your pull request as version 9.1.0-readable: Raise <b>GOLD</b>',
      '@name-owner merged your pull request as version 9.2.0: Raise <b>GOLD</b>',
    ]);
    expect(sent().every(notification => notification.title === 'Pull request #7 on Petclinic was merged' && notification.userId === 'author')).toBe(true);
    expect(sent().every(notification => JSON.stringify(notification.data) === JSON.stringify(DATA))).toBe(true);
    expect(mocks.permissionService.canReadPrivateVersions).toHaveBeenCalledTimes(2);
    expect(mocks.permissionService.canReadPrivateVersions.mock.calls[0]).toEqual([
      expect.objectContaining({ id: 'author' }), { organizationId: ORGANIZATION, slug: 'petclinic', collectionSlug: undefined }, 'token',
    ]);
  });

  it('Tells nobody when the author merged or closed it, or is gone (CA-57).', async () => {
    mocks.userRepository.findById.mockResolvedValue(null);

    await notifier.notifyMerged(pullRequest(), pricing, user('author'), { version: '9.0.0', private: false });
    await notifier.notifyClosed(pullRequest(), pricing, user('author'));
    await notifier.notifyMerged(pullRequest(), pricing, user('owner'), { version: '9.0.0', private: false });

    expect(sent()).toEqual([]);
  });

  it('Tells the author someone else closed it, with the reason (CA-57).', async () => {
    const closed = pullRequest({ closed: { byId: 'owner', at: new Date(), kind: 'rejected', reason: 'Not now' } });

    await notifier.notifyClosed(closed, pricing, user('owner'));

    expect(sent()).toEqual([{
      userId: 'author',
      kind: 'PricingPullRequest',
      title: 'Pull request #7 on Petclinic was closed',
      message: '@name-owner closed your pull request: Raise <b>GOLD</b>\nReason: Not now',
      data: DATA,
    }]);
  });
});
