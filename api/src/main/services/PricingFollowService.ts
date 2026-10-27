import container from '../config/container';
import PricingFollowRepository from '../repositories/mongoose/PricingFollowRepository';
import PricingRepository from '../repositories/mongoose/PricingRepository';
import UserRepository from '../repositories/mongoose/UserRepository';
import { LeanUser } from '../types/models/User';
import NotificationService from './NotificationService';
import PermissionService from './PermissionService';

class PricingFollowService {
  private pricingFollowRepository: PricingFollowRepository;
  private pricingRepository: PricingRepository;
  private userRepository: UserRepository;
  private permissionService: PermissionService;
  private notificationService: NotificationService;

  constructor() {
    this.pricingFollowRepository = container.resolve('pricingFollowRepository');
    this.pricingRepository = container.resolve('pricingRepository');
    this.userRepository = container.resolve('userRepository');
    this.permissionService = container.resolve('permissionService');
    this.notificationService = container.resolve('notificationService');
  }

  // Same visibility rule as PricingService.show(): private versions are only visible to
  // members of the pricing's organization and to global admins.
  private async canSeePrivate(userId: string, role: string | undefined, organizationId: string) {
    if (role === 'ADMIN') return true;
    return (await this.permissionService.resolveOrgRole(userId, organizationId)) !== null;
  }

  private async resolvePricingId(organizationId: string, pricingSlug: string, reqUser: LeanUser) {
    const includePrivate = await this.canSeePrivate(reqUser.id, reqUser.role, organizationId);
    const pricing: any = await this.pricingRepository.findOne(pricingSlug, organizationId, { includePrivate });
    if (!pricing || !pricing.versions?.length || !pricing.pricingId) {
      throw new Error('NOT FOUND: Pricing not found');
    }
    return String(pricing.pricingId);
  }

  async follow(organizationId: string, pricingSlug: string, reqUser: LeanUser) {
    const pricingId = await this.resolvePricingId(organizationId, pricingSlug, reqUser);
    await this.pricingFollowRepository.follow(reqUser.id, pricingId);
    return { following: true };
  }

  async unfollow(organizationId: string, pricingSlug: string, reqUser: LeanUser) {
    const pricingId = await this.resolvePricingId(organizationId, pricingSlug, reqUser);
    await this.pricingFollowRepository.unfollow(reqUser.id, pricingId);
    return { following: false };
  }

  async status(organizationId: string, pricingSlug: string, reqUser: LeanUser) {
    const pricingId = await this.resolvePricingId(organizationId, pricingSlug, reqUser);
    return { following: await this.pricingFollowRepository.isFollowing(reqUser.id, pricingId) };
  }

  /**
   * Tells every follower of a pricing that a new version was published, through the channels
   * each one enabled for "PricingUpdated". The author is skipped, and a private version only
   * reaches followers who can see it.
   */
  async notifyNewVersion(
    version: { pricingId?: unknown; name: string; slug: string; version: string; private?: boolean; _organizationId: unknown },
    author: LeanUser
  ) {
    if (!version.pricingId) return;
    const organizationId = String(version._organizationId);
    const followerIds = await this.pricingFollowRepository.findFollowerIds(String(version.pricingId));

    for (const followerId of followerIds) {
      if (followerId === author.id) continue;
      try {
        if (version.private) {
          const follower = await this.userRepository.findById(followerId);
          if (!follower || !(await this.canSeePrivate(followerId, follower.role, organizationId))) continue;
        }
        await this.notificationService.createNotification({
          userId: followerId,
          kind: 'PricingUpdated',
          title: `New version of ${version.name}`,
          message: `@${author.username} published version ${version.version} of "${version.name}".`,
          data: { organizationId, pricingSlug: version.slug, version: version.version },
        });
      } catch (error) {
        console.error('[Pricing follow] Could not notify follower:', error);
      }
    }
  }
}

export default PricingFollowService;
