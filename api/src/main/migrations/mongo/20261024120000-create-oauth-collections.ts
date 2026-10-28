import type { Connection } from 'mongoose';
import { OAuthClient, OAuthGrant, OAuthToken } from '../../repositories/mongoose/models/OAuthMongoose';

export async function up(connection: Connection): Promise<void> {
  for (const [name, schema] of [['oauthClients', OAuthClient.schema], ['oauthGrants', OAuthGrant.schema], ['oauthTokens', OAuthToken.schema]] as const) {
    const model = connection.model(name, schema, name);
    await model.createIndexes();
  }
}

export async function down(connection: Connection): Promise<void> {
  for (const name of ['oauthClients', 'oauthGrants', 'oauthTokens']) await connection.db?.collection(name).drop();
}
