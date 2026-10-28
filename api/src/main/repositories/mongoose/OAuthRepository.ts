import { OAuthClient, OAuthGrant, OAuthToken } from './models/OAuthMongoose';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { ApiKey } from '../../types/models/User';

export default class OAuthRepository {
  findClient(clientId: string) { return OAuthClient.findOne({ client_id: clientId }).lean(); }
  createClient(metadata: OAuthClientInformationFull) { return OAuthClient.create({ client_id: metadata.client_id, metadata }); }

  createGrant(data: { userId: string; clientId: string; clientName: string; resource: string; scopes: ApiKey['scopes']; refreshHash: string; expiresAt: Date }) {
    return OAuthGrant.create(data);
  }
  rotateGrant(grantId: string, refreshHash: string, expiresAt: Date) {
    return OAuthGrant.findOneAndUpdate({ _id: grantId, revoked: false },
      { $set: { refreshHash, expiresAt, lastUsedAt: new Date() } }, { new: true }).lean();
  }
  findGrantForClient(grantId: string, clientId: string) { return OAuthGrant.findOne({ _id: grantId, clientId }).lean(); }
  findActiveGrant(grantId: string, resource: string) {
    return OAuthGrant.findOne({ _id: grantId, revoked: false, expiresAt: { $gt: new Date() }, resource }).lean();
  }
  claimRefresh(grantId: string, currentHash: string, consumedHash: string) {
    return OAuthGrant.findOneAndUpdate({ _id: grantId, revoked: false, refreshHash: currentHash }, { $set: { refreshHash: consumedHash } }).lean();
  }
  revoke(grantId: string) { return OAuthGrant.updateOne({ _id: grantId }, { $set: { revoked: true } }); }
  revokeForClient(grantId: string, clientId: string) { return OAuthGrant.updateOne({ _id: grantId, clientId }, { $set: { revoked: true } }); }
  revokeForUser(grantId: string, userId: string) { return OAuthGrant.findOneAndUpdate({ _id: grantId, userId }, { $set: { revoked: true } }); }
  touchGrant(grantId: string) { return OAuthGrant.updateOne({ _id: grantId }, { $set: { lastUsedAt: new Date() } }); }
  listGrants(userId: string) {
    return OAuthGrant.find({ userId, revoked: false, expiresAt: { $gt: new Date() } })
      .select('clientName scopes lastUsedAt createdAt expiresAt').lean();
  }
  findToken(hash: string, kind: 'access' | 'refresh', resource?: string) {
    return OAuthToken.findOne({ hash, kind, expiresAt: { $gt: new Date() }, ...(resource ? { resource } : {}) }).lean();
  }
  findAnyToken(hash: string) { return OAuthToken.findOne({ hash }).lean(); }
  createTokens(tokens: { hash: string; grantId: string; kind: 'access' | 'refresh'; resource: string; expiresAt: Date }[]) {
    return OAuthToken.insertMany(tokens);
  }
}
