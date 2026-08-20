import { ApiKey, LeanUser, LeanUserWithApiKey, UserFilters, UserIdentity } from '../../types/models/User';
import RepositoryBase from '../RepositoryBase';
import UserMongoose from './models/UserMongoose';
import mongoose from 'mongoose';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { escapeRegex } from '../../utils/regex';

class UserRepository extends RepositoryBase {
  async find(
    filter: UserFilters,
    offset: number = 0,
    limit: number = 10,
    sortBy: string = 'username',
    sortOrder: 'asc' | 'desc' = 'asc',
    projection?: Record<string, 0 | 1>
  ): Promise<LeanUser[]> {
    try {
      const mongoFilter: any = {};

      // General query: search across username, firstName, and lastName
      if (filter.q) {
        const regex = { $regex: escapeRegex(filter.q), $options: 'i' };
        mongoFilter.$or = [
          { username: regex },
          { firstName: regex },
          { lastName: regex },
        ];
      } else {
        // Username transformation to allow partial and case-insensitive matches
        if (filter.username) {
          mongoFilter.username = {
            $regex: escapeRegex(filter.username),
            $options: 'i',
          };
        }

        // Email transformation to allow partial and case-insensitive matches
        if (filter.email) {
          mongoFilter.email = {
            $regex: escapeRegex(filter.email),
            $options: 'i',
          };
        }
      }

      if (filter.role) {
        mongoFilter.role = filter.role;
      }

      const query = UserMongoose.find(mongoFilter)
        .sort({ [sortBy]: sortOrder })
        .skip(offset)
        .limit(limit);

      if (projection) {
        query.select(projection);
      }

      const users = await query.exec();
      return users.map(user => user.toObject());
    } catch (err) {
      return [];
    }
  }

  async findOne(filter: any): Promise<LeanUser | null> {
    try {
      const user = await UserMongoose.findOne(filter).exec();
      return user ? user.toObject() : null;
    } catch (err) {
      return null;
    }
  }

  async findById(id: string): Promise<LeanUser | null> {
    try {
      const user = await UserMongoose.findOne({ _id: id }).exec();
      return user ? user.toObject() : null;
    } catch (err) {
      return null;
    }
  }

  async findByIds(ids: string[]): Promise<LeanUser[]> {
    const users = await UserMongoose.find({ _id: { $in: ids } }).exec();
    return users.map(user => user.toObject());
  }

  async findByIdWithPassword(id: string): Promise<LeanUser | null> {
    const user = await UserMongoose.findById(id).select('+password').exec();
    return user ? user.toObject() : null;
  }

  async updateById(id: string, data: any): Promise<LeanUser | null> {
    try {
      const updatedUser = await UserMongoose.findByIdAndUpdate({ _id: id }, data, {
        new: true,
        projection: { password: 0 },
      });
      return updatedUser ? updatedUser.toObject() : null;
    } catch (err) {
      return null;
    }
  }

  async findByToken(token: string): Promise<LeanUser | null> {
    return await UserMongoose.findOne({ token });
  }

  async findByEmail(email: string, selector: string = ''): Promise<LeanUser | null> {
    try {
      const user = await UserMongoose.findOne({ email: email.trim().toLowerCase() }).select(selector).exec();
      return user ? user.toObject() : null;
    } catch (err) {
      return null;
    }
  }

  async findByUsername(username: string, selector: string = ''): Promise<LeanUser | null> {
    try {
      const user = await UserMongoose.findOne({ username }).select(selector).exec();
      const userObj = user ? user.toObject() : null;
      return userObj;
    } catch (err) {
      return null;
    }
  }

  async findByApiKey(
    apiKey: string
  ): Promise<LeanUserWithApiKey | null> {
    let storedApiKey: string;

    if (apiKey.startsWith('sk-')) {
      storedApiKey = crypto.createHash('sha256').update(apiKey).digest('hex');
    } else if (apiKey.startsWith('usr_') || apiKey.startsWith('org_')) {
      storedApiKey = apiKey;
    } else {
      return null;
    }

    const user = await UserMongoose.aggregate([
      {
        $match: {
          apiKeys: {
            $elemMatch: {
              key: storedApiKey,
              revoked: false,
              $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
            },
          },
        },
      },
      {
        $set: {
          apiKey: {
            $first: {
              $filter: {
                input: '$apiKeys',
                as: 'key',
                cond: { $eq: ['$$key.key', storedApiKey] },
              },
            },
          },
        },
      },
      {
        $set: {
          'apiKey.scopes': {
            $map: {
              input: '$apiKey.scopes',
              as: 'scope',
              in: {
                organizationId: {
                  $toString: '$$scope.organizationId',
                },
                scope: '$$scope.scope',
              },
            },
          },
        },
      },
      {
        $project: {
          password: 0,
          apiKeys: 0,
        },
      },
      {
        $limit: 1,
      },
    ]);

    const rawUser = user[0] ?? null;

    if (!rawUser) {
      return null;
    }

    const hydratedUser = UserMongoose.hydrate(rawUser);

    return hydratedUser.toObject() as unknown as LeanUserWithApiKey;
  }

  async create(businessEntity: any): Promise<LeanUser> {
    const user = await new UserMongoose(businessEntity).save();

    return user.toObject();
  }

  async addIdentity(
    userId: string,
    identity: UserIdentity
  ): Promise<LeanUser | null> {
    const user = await UserMongoose.findOneAndUpdate(
      {
        _id: userId,
        identities: { $not: { $elemMatch: { provider: identity.provider } } },
      },
      { $push: { identities: identity } },
      { new: true, runValidators: true }
    ).exec();
    return user ? user.toObject() : null;
  }

  async removeIdentity(userId: string, provider: 'us-sso' | 'google'): Promise<LeanUser | null> {
    const user = await UserMongoose.findOneAndUpdate(
      {
        _id: userId,
        'identities.provider': provider,
        $or: [
          { password: { $exists: true, $ne: '' } },
          { 'identities.1': { $exists: true } },
        ],
      },
      { $pull: { identities: { provider } } },
      { new: true, runValidators: true }
    ).exec();
    return user ? user.toObject() : null;
  }

  async setInitialPassword(userId: string, password: string): Promise<void> {
    const user = await UserMongoose.findById(userId).select('+password').exec();
    if (!user) throw new Error('NOT FOUND: User not found');
    if (user.password) throw new Error('CONFLICT: This account already has a password');
    user.password = password;
    await user.save();
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await UserMongoose.findById(userId).select('+password').exec();
    if (!user) throw new Error('NOT FOUND: User not found');
    if (!user.password) throw new Error('CONFLICT: This account does not have a password yet');

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) throw new Error('INVALID DATA: Current password is incorrect');

    user.password = newPassword;
    await user.save();
  }

  async update(username: string, businessEntity: any): Promise<LeanUser | null> {
    const updatedUser = await UserMongoose.findOneAndUpdate({ username }, businessEntity, {
      new: true,
      projection: { password: 0 },
    });

    if (!updatedUser) {
      throw new Error('ERROR: Error while updating user. User not found.');
    }

    return updatedUser?.toObject() || null;
  }

  async updateToken(
    username: string,
    tokenDTO: { token: string; tokenExpiration: Date }
  ): Promise<LeanUser | null> {
    return await this.update(username, tokenDTO);
  }

  async setEmailVerificationToken(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
    sentAt: Date
  ): Promise<LeanUser | null> {
    const user = await UserMongoose.findByIdAndUpdate(
      userId,
      {
        $set: {
          emailVerificationTokenHash: tokenHash,
          emailVerificationExpiresAt: expiresAt,
          emailVerificationSentAt: sentAt,
        },
      },
      { new: true }
    ).exec();

    return user ? user.toObject() : null;
  }

  async verifyEmailByTokenHash(tokenHash: string, now: Date): Promise<LeanUser | null> {
    const user = await UserMongoose.findOneAndUpdate(
      {
        emailVerified: false,
        emailVerificationTokenHash: tokenHash,
        emailVerificationExpiresAt: { $gt: now },
      },
      {
        $set: { emailVerified: true, emailVerifiedAt: now },
        $unset: {
          emailVerificationTokenHash: 1,
          emailVerificationExpiresAt: 1,
          emailVerificationSentAt: 1,
        },
      },
      { new: true }
    ).exec();

    return user ? user.toObject() : null;
  }

  async destroy(username: string): Promise<boolean> {
    const result = await UserMongoose.deleteOne({ username }).exec();
    return result?.deletedCount === 1;
  }

  async findByUsernameWithApiKeys(username: string): Promise<LeanUser | null> {
    try {
      const user = await UserMongoose.findOne({ username }).select('+apiKeys').exec();
      return user ? user.toObject() : null;
    } catch (err) {
      return null;
    }
  }

  async addApiKey(username: string, apiKey: any): Promise<any> {
    try {
      const result = await UserMongoose.findOneAndUpdate(
        { username },
        { $push: { apiKeys: apiKey } },
        { new: true }
      ).select('+apiKeys');
      if (!result) return null;
      const apiKeys = result.apiKeys as any[];
      return apiKeys[apiKeys.length - 1];
    } catch (err) {
      return null;
    }
  }

  async revokeApiKey(username: string, keyId: string): Promise<boolean> {
    try {
      const result = await UserMongoose.findOneAndUpdate(
        { username, 'apiKeys._id': new mongoose.Types.ObjectId(keyId) },
        { $set: { 'apiKeys.$.revoked': true } },
        { new: true }
      );
      return !!result;
    } catch (err) {
      return false;
    }
  }

  async deleteApiKey(username: string, keyId: string): Promise<boolean> {
    try {
      const result = await UserMongoose.findOneAndUpdate(
        { username },
        { $pull: { apiKeys: { _id: new mongoose.Types.ObjectId(keyId) } } },
        { new: true }
      );
      return !!result;
    } catch (err) {
      return false;
    }
  }
}

export default UserRepository;
