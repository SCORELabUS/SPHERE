import mongoose from 'mongoose';
import UserMongoose from '../repositories/mongoose/models/UserMongoose';
import OrganizationMongoose from '../repositories/mongoose/models/OrganizationMongoose';
import OrganizationMembershipMongoose from '../repositories/mongoose/models/OrganizationMembershipMongoose';
import EntityPermissionMongoose from '../repositories/mongoose/models/EntityPermissionMongoose';
import NotificationMongoose from '../repositories/mongoose/models/NotificationMongoose';
import OrganizationInvitationMongoose from '../repositories/mongoose/models/OrganizationInvitationMongoose';
import PricingMongoose from '../repositories/mongoose/models/PricingMongoose';
import PricingCollectionMongoose, { generateSlug } from '../repositories/mongoose/models/PricingCollectionMongoose';

const ROLE_WEIGHT: Record<string, number> = { MEMBER: 1, ADMIN: 2, OWNER: 3 };
const documentId = (value: any) => value?._id ?? value?.id ?? value;
const rawDocumentId = (document: any, path: string) => document.get(path, null, { getters: false });

class AccountMergeService {
  async preview(targetUserId: string, sourceUserId: string) {
    if (targetUserId === sourceUserId) throw new Error('CONFLICT: An account cannot be merged into itself');

    const [target, source] = await Promise.all([
      UserMongoose.findById(targetUserId).lean(),
      UserMongoose.findById(sourceUserId).lean(),
    ]);
    if (!target || !source || source.disabledAt) throw new Error('NOT FOUND: Account merge source not found');
    if (source.role === 'ADMIN') {
      throw new Error('PERMISSION ERROR: Administrator accounts require a manual merge');
    }

    const sourceMemberships = await OrganizationMembershipMongoose.find({ _userId: source._id })
      .populate('_organizationId')
      .lean();
    const personalMembership = sourceMemberships.find((membership: any) => membership._organizationId?.isPersonal);
    const personalOrganizationId = documentId((personalMembership as any)?._organizationId);

    const [pricingCount, collectionCount, permissionCount, notificationCount] = await Promise.all([
      personalOrganizationId ? PricingMongoose.countDocuments({ _organizationId: personalOrganizationId }) : 0,
      personalOrganizationId ? PricingCollectionMongoose.countDocuments({ _organizationId: personalOrganizationId }) : 0,
      EntityPermissionMongoose.countDocuments({ _userId: source._id }),
      NotificationMongoose.countDocuments({ _userId: source._id }),
    ]);

    return {
      target: { username: target.username, email: target.email },
      source: { username: source.username, email: source.email },
      transfer: {
        identities: source.identities.length,
        organizations: sourceMemberships.filter((membership: any) => !membership._organizationId?.isPersonal).length,
        pricings: pricingCount,
        collections: collectionCount,
        permissions: permissionCount,
        notifications: notificationCount,
      },
      warnings: [
        'The current account keeps its username, primary email, password and profile.',
        'API keys and active sessions from the secondary account will stop working.',
        'Conflicting personal pricing and collection names will receive a source-account suffix.',
      ],
    };
  }

  async merge(targetUserId: string, sourceUserId: string) {
    await this.preview(targetUserId, sourceUserId);
    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        const target: any = await UserMongoose.findById(targetUserId).select('+apiKeys +password +mergedInto +mergedAt').session(session);
        const source: any = await UserMongoose.findById(sourceUserId).select('+apiKeys +password +mergedInto +mergedAt').session(session);
        if (!target || !source || source.disabledAt) throw new Error('NOT FOUND: Account merge source not found');
        if (source.role === 'ADMIN') throw new Error('PERMISSION ERROR: Administrator accounts require a manual merge');

        const duplicateIdentity = source.identities.find((sourceIdentity: any) =>
          target.identities.some((targetIdentity: any) =>
            targetIdentity.provider === sourceIdentity.provider &&
            targetIdentity.providerId !== sourceIdentity.providerId
          )
        );
        if (duplicateIdentity) {
          throw new Error(`CONFLICT: Both accounts use different ${duplicateIdentity.provider} identities`);
        }

        await this.transferOrganizations(target, source, session);
        await this.transferPermissions(target._id, source._id, session);
        await NotificationMongoose.updateMany({ _userId: source._id }, { $set: { _userId: target._id } }, { session });
        await OrganizationInvitationMongoose.updateMany({ createdBy: source._id }, { $set: { createdBy: target._id } }, { session });
        await EntityPermissionMongoose.updateMany({ grantedBy: source._id }, { $set: { grantedBy: target._id } }, { session });

        const identitiesToTransfer = source.identities.filter((sourceIdentity: any) =>
          !target.identities.some((targetIdentity: any) =>
            targetIdentity.provider === sourceIdentity.provider &&
            targetIdentity.providerId === sourceIdentity.providerId
          )
        ).map((identity: any) => identity.toObject ? identity.toObject() : identity);

        // Release the global unique identity index before attaching the identities
        // to the canonical account. Both writes remain invisible until commit.
        source.identities = [];
        source.disabledAt = new Date();
        source.mergedAt = new Date();
        source.mergedInto = target._id;
        source.apiKeys = source.apiKeys.map((key: any) => ({ ...(key.toObject?.() ?? key), revoked: true }));
        await source.save({ session, validateBeforeSave: false });

        target.identities.push(...identitiesToTransfer);
        await target.save({ session });
      });

      return { merged: true, targetUserId, sourceUserId };
    } finally {
      await session.endSession();
    }
  }

  private async transferOrganizations(target: any, source: any, session: mongoose.ClientSession) {
    const sourceMemberships: any[] = await OrganizationMembershipMongoose.find({ _userId: source._id })
      .session(session);
    const targetMemberships: any[] = await OrganizationMembershipMongoose.find({ _userId: target._id }).session(session);
    const targetByOrganization = new Map(
      targetMemberships.map(membership => [rawDocumentId(membership, '_organizationId').toString(), membership])
    );
    const membershipOrganizationIds = [...sourceMemberships, ...targetMemberships]
      .map(membership => rawDocumentId(membership, '_organizationId'));
    const personalOrganizations = await OrganizationMongoose.find({
      _id: { $in: membershipOrganizationIds },
      isPersonal: true,
    }).select('_id').session(session);
    const personalOrganizationIds = new Set(personalOrganizations.map(organization => organization._id.toString()));
    const sourcePersonal = sourceMemberships.find(membership =>
      personalOrganizationIds.has(rawDocumentId(membership, '_organizationId').toString())
    );
    const targetPersonal = targetMemberships.find(membership =>
      personalOrganizationIds.has(rawDocumentId(membership, '_organizationId').toString())
    );

    for (const membership of sourceMemberships) {
      const organizationId = rawDocumentId(membership, '_organizationId');
      if (personalOrganizationIds.has(organizationId.toString())) continue;
      const existing = targetByOrganization.get(organizationId.toString());
      if (existing) {
        if ((ROLE_WEIGHT[membership.role] ?? 0) > (ROLE_WEIGHT[existing.role] ?? 0)) {
          existing.role = membership.role;
          await existing.save({ session });
        }
        await membership.deleteOne({ session });
      } else {
        membership._userId = target._id;
        await membership.save({ session });
      }
    }

    if (!sourcePersonal) return;
    if (!targetPersonal) throw new Error('CONFLICT: Canonical account has no personal organization');

    const sourceOrgId = rawDocumentId(sourcePersonal, '_organizationId');
    const targetOrgId = rawDocumentId(targetPersonal, '_organizationId');
    const otherPersonalMembers = await OrganizationMembershipMongoose.countDocuments({
      _organizationId: sourceOrgId,
      _userId: { $ne: source._id },
    }).session(session);
    if (otherPersonalMembers > 0) throw new Error('CONFLICT: Secondary personal organization has additional members');

    await this.transferPersonalContent(sourceOrgId, targetOrgId, source.username, session);
    await EntityPermissionMongoose.deleteMany({ _organizationId: sourceOrgId }, { session });
    await OrganizationInvitationMongoose.deleteMany({ _organizationId: sourceOrgId }, { session });
    await sourcePersonal.deleteOne({ session });
    await OrganizationMongoose.deleteOne({ _id: sourceOrgId }, { session });
  }

  private async transferPersonalContent(sourceOrgId: any, targetOrgId: any, sourceUsername: string, session: mongoose.ClientSession) {
    const suffix = `from-${generateSlug(sourceUsername)}`;
    const collections: any[] = await PricingCollectionMongoose.find({ _organizationId: sourceOrgId }).session(session);
    for (const collection of collections) {
      const originalName = collection.name;
      const originalSlug = collection.slug;
      let attempt = 0;
      while (await PricingCollectionMongoose.exists({
          _organizationId: targetOrgId,
          $or: [{ name: collection.name }, { slug: collection.slug }],
        }).session(session)) {
        attempt += 1;
        const discriminator = attempt === 1 ? suffix : `${suffix}-${attempt}`;
        collection.name = `${originalName} (${discriminator})`;
        collection.slug = `${originalSlug}-${discriminator}`;
      }
      collection._organizationId = targetOrgId;
      await collection.save({ session });
    }

    const pricings: any[] = await PricingMongoose.find({ _organizationId: sourceOrgId }).session(session);
    for (const pricing of pricings) {
      const collectionId = pricing._collectionId ?? null;
      const originalName = pricing.name;
      const originalSlug = pricing.slug;
      let attempt = 0;
      while (await PricingMongoose.exists({
          _organizationId: targetOrgId,
          version: pricing.version,
          _collectionId: collectionId,
          $or: [{ name: pricing.name }, { slug: pricing.slug }],
        }).session(session)) {
        attempt += 1;
        const discriminator = attempt === 1 ? suffix : `${suffix}-${attempt}`;
        pricing.name = `${originalName} (${discriminator})`;
        pricing.slug = `${originalSlug}-${discriminator}`;
      }
      pricing._organizationId = targetOrgId;
      await pricing.save({ session });
    }
  }

  private async transferPermissions(targetUserId: any, sourceUserId: any, session: mongoose.ClientSession) {
    const permissions: any[] = await EntityPermissionMongoose.find({ _userId: sourceUserId }).session(session);
    for (const permission of permissions) {
      const existing: any = await EntityPermissionMongoose.findOne({
        _userId: targetUserId,
        _organizationId: permission._organizationId,
        entityType: permission.entityType,
        entitySlug: permission.entitySlug ?? null,
      }).session(session);
      if (existing) {
        for (const operation of ['GET', 'PUT', 'DELETE', 'CREATE']) {
          existing.permissions[operation] = Boolean(existing.permissions[operation] || permission.permissions[operation]);
        }
        await existing.save({ session });
        await permission.deleteOne({ session });
      } else {
        permission._userId = targetUserId;
        await permission.save({ session });
      }
    }
  }
}

export default AccountMergeService;
