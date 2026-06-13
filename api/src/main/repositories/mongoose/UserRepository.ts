import { ApiKey, LeanUser, LeanUserWithApiKey, UserFilters } from '../../types/models/User';
import RepositoryBase from '../RepositoryBase';
import UserMongoose from './models/UserMongoose';
import mongoose from 'mongoose';

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
        const regex = { $regex: filter.q, $options: 'i' };
        mongoFilter.$or = [
          { username: regex },
          { firstName: regex },
          { lastName: regex },
        ];
      } else {
        // Username transformation to allow partial and case-insensitive matches
        if (filter.username) {
          mongoFilter.username = {
            $regex: filter.username,
            $options: 'i',
          };
        }

        // Email transformation to allow partial and case-insensitive matches
        if (filter.email) {
          mongoFilter.email = {
            $regex: filter.email,
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
      const user = await UserMongoose.findOne({ email }).select(selector).exec();
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
    const user = await UserMongoose.aggregate([
      {
        $match: {
          apiKeys: {
            $elemMatch: {
              key: apiKey,
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
                cond: { $eq: ['$$key.key', apiKey] },
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
