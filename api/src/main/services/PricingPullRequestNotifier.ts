import container from '../config/container';
import OrganizationMembershipRepository from '../repositories/mongoose/OrganizationMembershipRepository';
import OrganizationRepository from '../repositories/mongoose/OrganizationRepository';
import PricingPullRequestRepository from '../repositories/mongoose/PricingPullRequestRepository';
import UserRepository from '../repositories/mongoose/UserRepository';
import { PricingPullRequest } from '../types/models/PricingPullRequest';
import { LeanUser } from '../types/models/User';
import NotificationService from './NotificationService';
import PermissionService from './PermissionService';

/** At most this many maintainers are told about one pull request at a time. */
export const MAX_RECIPIENTS = 50;
const DAY_MS = 24 * 60 * 60 * 1000;
/** The owners first, then the admins, then the members. */
const ROLE_RANK: Record<string, number> = { OWNER: 0, ADMIN: 1, MEMBER: 2 };

/** The pricing (P) a pull request targets, as its notifications name it. */
export interface NotifiedPricing {
  pricingId: string;
  name: string;
  slug: string;
  organizationId: string;
  collectionSlug?: string;
}

/** A pull request was opened, or its proposal replaced from its fork. */
export type RoundKind = 'opened' | 'updated';

export type MaintainerCheck = (user: LeanUser) => Promise<boolean>;

/**
 * Tells people about pull requests, through the channels each recipient
 * enabled for `PricingPullRequest` (inbox and email, both on by default):
 * the maintainers of P when one is opened or updated from its fork, and its
 * author when someone else merges or rejects it.
 *
 * Maintainers are only members of P's organization or of its ancestors, never
 * global administrators who are not members. Titles carry no text a user wrote;
 * the pull request's title goes in the message, which the email escapes. A
 * version is only named to who may read it.
 */
class PricingPullRequestNotifier {
  private organizationRepository: OrganizationRepository;
  private organizationMembershipRepository: OrganizationMembershipRepository;
  private pricingPullRequestRepository: PricingPullRequestRepository;
  private userRepository: UserRepository;
  private notificationService: NotificationService;
  private permissionService: PermissionService;

  constructor() {
    this.organizationRepository = container.resolve('organizationRepository');
    this.organizationMembershipRepository = container.resolve('organizationMembershipRepository');
    this.pricingPullRequestRepository = container.resolve('pricingPullRequestRepository');
    this.userRepository = container.resolve('userRepository');
    this.notificationService = container.resolve('notificationService');
    this.permissionService = container.resolve('permissionService');
  }

  /**
   * Claims the round of notifications a change starts, recording it at `now`:
   * always when a pull request is opened, and for its updates only when the last
   * round is more than a day old. Of two callers at once, one gets true.
   */
  async claimRound(pullRequestId: string, kind: RoundKind, now = new Date()): Promise<boolean> {
    const since = kind === 'opened' ? now : new Date(now.getTime() - DAY_MS);
    return this.pricingPullRequestRepository.touchNotified(pullRequestId, since, now);
  }

  /**
   * Who is told about a pull request: the members (direct ones, of P's
   * organization or of one of its ancestors) who maintain P, without its author,
   * by role (their highest one) and then by id, at most `MAX_RECIPIENTS`.
   */
  async recipients(pricing: NotifiedPricing, authorId: string, isMaintainer: MaintainerCheck): Promise<LeanUser[]> {
    const organization = await this.organizationRepository.findById(pricing.organizationId);
    const organizationIds = [pricing.organizationId, ...((organization?.ancestors ?? []) as unknown[]).map(String)];
    const ranks = new Map<string, number>();
    for (const organizationId of organizationIds) {
      for (const membership of await this.organizationMembershipRepository.findDirectMemberships(organizationId)) {
        const userId = String(membership._userId);
        if (userId === authorId) continue;
        const rank = ROLE_RANK[String(membership.role)] ?? Object.keys(ROLE_RANK).length;
        ranks.set(userId, Math.min(ranks.get(userId) ?? rank, rank));
      }
    }
    const ordered = [...ranks]
      .sort(([idA, rankA], [idB, rankB]) => rankA - rankB || (idA < idB ? -1 : idA > idB ? 1 : 0))
      .map(([userId]) => userId);
    if (ordered.length === 0) return [];

    const users = new Map((await this.userRepository.findByIds(ordered)).map(user => [String(user.id), user]));
    const chosen: LeanUser[] = [];
    for (const userId of ordered) {
      if (chosen.length >= MAX_RECIPIENTS) break;
      const user = users.get(userId);
      if (user && (await isMaintainer({ ...user, id: userId }))) chosen.push({ ...user, id: userId });
    }
    return chosen;
  }

  /** Tells the maintainers of P that a pull request was opened, or that its proposal changed. */
  async notifyMaintainers(
    kind: RoundKind,
    pullRequest: PricingPullRequest,
    pricing: NotifiedPricing,
    author: LeanUser,
    isMaintainer: MaintainerCheck
  ): Promise<void> {
    const title = kind === 'opened'
      ? `New pull request #${pullRequest.number} on ${pricing.name}`
      : `Pull request #${pullRequest.number} on ${pricing.name} was updated`;
    const message = kind === 'opened'
      ? `@${author.username} proposed changes to "${pricing.name}": ${pullRequest.title}`
      : `@${author.username} updated the proposal of pull request #${pullRequest.number}: ${pullRequest.title}`;
    for (const recipient of await this.recipients(pricing, pullRequest.authorId, isMaintainer)) {
      await this.send(recipient.id, title, message, pullRequest, pricing);
    }
  }

  /**
   * Tells the author that someone else merged their pull request. The version
   * it became is named only if the author may read it.
   */
  async notifyMerged(
    pullRequest: PricingPullRequest,
    pricing: NotifiedPricing,
    mergedBy: LeanUser,
    version: { version: string; private: boolean }
  ): Promise<void> {
    if (pullRequest.authorId === mergedBy.id) return;
    const author = await this.userRepository.findById(pullRequest.authorId);
    if (!author) return;
    const readable = !version.private || (await this.permissionService.canReadPrivateVersions(
      { ...author, id: pullRequest.authorId },
      { organizationId: pricing.organizationId, slug: pricing.slug, collectionSlug: pricing.collectionSlug },
      'token'
    ));
    const message = readable
      ? `@${mergedBy.username} merged your pull request as version ${version.version}: ${pullRequest.title}`
      : `@${mergedBy.username} merged your pull request: ${pullRequest.title}`;
    await this.send(pullRequest.authorId, `Pull request #${pullRequest.number} on ${pricing.name} was merged`, message, pullRequest, pricing);
  }

  /** Tells the author that someone else closed their pull request, with the reason given. */
  async notifyClosed(pullRequest: PricingPullRequest, pricing: NotifiedPricing, closedBy: LeanUser): Promise<void> {
    if (pullRequest.authorId === closedBy.id) return;
    const reason = pullRequest.closed?.reason;
    const message = `@${closedBy.username} closed your pull request: ${pullRequest.title}${reason ? `\nReason: ${reason}` : ''}`;
    await this.send(pullRequest.authorId, `Pull request #${pullRequest.number} on ${pricing.name} was closed`, message, pullRequest, pricing);
  }

  /** One notification; a recipient who cannot be told does not stop the others. */
  private async send(userId: string, title: string, message: string, pullRequest: PricingPullRequest, pricing: NotifiedPricing) {
    try {
      await this.notificationService.createNotification({
        userId,
        kind: 'PricingPullRequest',
        title,
        message,
        data: {
          pricingId: pricing.pricingId,
          pullRequestId: pullRequest.id,
          number: pullRequest.number,
          organizationId: pricing.organizationId,
          pricingSlug: pricing.slug,
        },
      });
    } catch (error) {
      console.error('[Pricing pull request] Could not notify a user:', error);
    }
  }
}

export default PricingPullRequestNotifier;
