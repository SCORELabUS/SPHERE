import { type Connection } from 'mongoose';
import OrbitConversationMongoose from '../../repositories/mongoose/models/OrbitConversationMongoose';
import OrbitPlanMongoose from '../../repositories/mongoose/models/OrbitPlanMongoose';
import OrbitAuditLogMongoose from '../../repositories/mongoose/models/OrbitAuditLogMongoose';

export async function up(connection: Connection): Promise<void> {
  const OrbitConversation = connection.models.OrbitConversation ||
    connection.model('OrbitConversation', OrbitConversationMongoose.schema, 'orbitConversations');
  const OrbitPlan = connection.models.OrbitPlan ||
    connection.model('OrbitPlan', OrbitPlanMongoose.schema, 'orbitPlans');
  const OrbitAuditLog = connection.models.OrbitAuditLog ||
    connection.model('OrbitAuditLog', OrbitAuditLogMongoose.schema, 'orbitAuditLogs');

  await OrbitConversation.collection.createIndex({ _userId: 1, updatedAt: -1 });
  await OrbitPlan.collection.createIndex({ _conversationId: 1, createdAt: 1 });
  await OrbitPlan.collection.createIndex({ _userId: 1, status: 1 });
  await OrbitAuditLog.collection.createIndex({ _userId: 1, createdAt: -1 });
  await OrbitAuditLog.collection.createIndex({ _planId: 1 });
}

export async function down(connection: Connection): Promise<void> {
  for (const name of ['orbitConversations', 'orbitPlans', 'orbitAuditLogs']) {
    await connection.db?.collection(name).drop().catch(() => undefined);
  }
}
