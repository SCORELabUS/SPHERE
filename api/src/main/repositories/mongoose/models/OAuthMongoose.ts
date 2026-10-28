import mongoose, { Schema } from 'mongoose';

const clientSchema = new Schema({
  client_id: { type: String, required: true, unique: true },
  metadata: { type: Schema.Types.Mixed, required: true },
}, { timestamps: true });

const grantSchema = new Schema({
  userId: { type: String, required: true, index: true },
  clientId: { type: String, required: true },
  clientName: { type: String, required: true },
  resource: { type: String, required: true },
  scopes: [{ organizationId: { type: String, required: true }, scope: { type: String, enum: ['VIEW', 'MANAGEMENT', 'ALL'], required: true }, _id: false }],
  refreshHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  lastUsedAt: Date,
  revoked: { type: Boolean, default: false },
}, { timestamps: true });

// Keep spent refresh hashes until expiry so replay revokes the entire connection.
const tokenSchema = new Schema({
  hash: { type: String, required: true, unique: true },
  grantId: { type: String, required: true, index: true },
  kind: { type: String, required: true, enum: ['access', 'refresh'] },
  resource: { type: String, required: true },
  expiresAt: { type: Date, required: true, expires: 0 },
});

export const OAuthClient = mongoose.model('OAuthClient', clientSchema, 'oauthClients');
export const OAuthGrant = mongoose.model('OAuthGrant', grantSchema, 'oauthGrants');
export const OAuthToken = mongoose.model('OAuthToken', tokenSchema, 'oauthTokens');
