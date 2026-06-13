import crypto from 'crypto';
import container from '../config/container';
import UserRepository from '../repositories/mongoose/UserRepository';
import { ApiKey, ApiKeySummary, LeanUser } from '../types/models/User';

class ApiKeyService {
  private userRepository: UserRepository;

  constructor() {
    this.userRepository = container.resolve('userRepository');
  }

  async createApiKey(
    reqUser: LeanUser,
    targetUsername: string,
    data: {
      name: string;
      scopes: {
        organizationId: string;
        scope: 'ALL' | 'MANAGEMENT' | 'VIEW';
      }[];
      expiresAt?: Date;
    }
  ): Promise<{ apiKey: ApiKey; plainKey: string }> {
    if (reqUser.username !== targetUsername && reqUser.role !== 'ADMIN') {
      throw new Error('PERMISSION ERROR: You can only create API keys for yourself');
    }

    const targetUser = await this.userRepository.findByUsername(targetUsername);
    if (!targetUser) throw new Error('NOT FOUND: User not found');

    const plainKey = `sk-${crypto.randomBytes(32).toString('hex')}`;
    const hashedKey = crypto.createHash('sha256').update(plainKey).digest('hex');

    const apiKeyData = {
      key: hashedKey,
      name: data.name,
      scopes: data.scopes,
      expiresAt: data.expiresAt || null,
      revoked: false,
    };

    const savedApiKey = await this.userRepository.addApiKey(targetUsername, apiKeyData);
    if (!savedApiKey) throw new Error('ERROR: Failed to save API key');

    const apiKey: ApiKey = {
      _id: savedApiKey._id.toString(),
      key: savedApiKey.key,
      name: savedApiKey.name,
      scopes: savedApiKey.scopes.map((s: any) => ({
        organizationId: s.organizationId.toString(),
        scope: s.scope,
      })),
      expiresAt: savedApiKey.expiresAt || null,
      revoked: savedApiKey.revoked,
    };

    return { apiKey, plainKey };
  }

  async getApiKeys(reqUser: LeanUser, targetUsername: string): Promise<ApiKeySummary[]> {
    if (reqUser.username !== targetUsername && reqUser.role !== 'ADMIN') {
      throw new Error('PERMISSION ERROR: You can only view your own API keys');
    }

    const user = await this.userRepository.findByUsernameWithApiKeys(targetUsername);
    if (!user) throw new Error('NOT FOUND: User not found');

    return (user.apiKeys || []).map((key) => ({
      id: key._id,
      name: key.name,
      keyPreview: `sk-...${key.key.slice(-6)}`,
      scopes: key.scopes,
      expiresAt: key.expiresAt || null,
      revoked: key.revoked,
    }));
  }

  async revokeApiKey(reqUser: LeanUser, targetUsername: string, keyId: string): Promise<void> {
    if (reqUser.username !== targetUsername && reqUser.role !== 'ADMIN') {
      throw new Error('PERMISSION ERROR: You can only revoke your own API keys');
    }

    const updated = await this.userRepository.revokeApiKey(targetUsername, keyId);
    if (!updated) throw new Error('NOT FOUND: API key not found');
  }

  async deleteApiKey(reqUser: LeanUser, targetUsername: string, keyId: string): Promise<void> {
    if (reqUser.username !== targetUsername && reqUser.role !== 'ADMIN') {
      throw new Error('PERMISSION ERROR: You can only delete your own API keys');
    }

    const updated = await this.userRepository.deleteApiKey(targetUsername, keyId);
    if (!updated) throw new Error('NOT FOUND: API key not found');
  }
}

export default ApiKeyService;
