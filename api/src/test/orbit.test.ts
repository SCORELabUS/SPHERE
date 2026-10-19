import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { shutdownApp, TestApp } from './utils/testApp';
import { BASE_PATH } from './utils/config/variables';
import testContainer from './utils/config/testContainer';
import { createAndLoginUser, deleteTestUser } from './utils/users/userTestUtils';
import {
  cleanupOrganization,
  createEntityScopedPermission,
  createMembership,
  createTestInvitation,
  createTestOrganization,
} from './utils/organizations/organizationTestUtils';
import { createTestCollection } from './utils/collections/collectionTestUtils';
import { createPricingForOrganization } from './utils/pricings/pricingTestUtils';
import PricingMongoose from '../main/repositories/mongoose/models/PricingMongoose';
import { randomSuffix } from './utils/helpers';
import {
  answer,
  cleanupOrbitData,
  installFakeLlm,
  parseSse,
  restoreLlm,
  toolCall,
  toolResultsIn,
} from './utils/orbit/orbitTestUtils';
import OrganizationMongoose from '../main/repositories/mongoose/models/OrganizationMongoose';
import OrganizationMembershipMongoose from '../main/repositories/mongoose/models/OrganizationMembershipMongoose';
import OrganizationInvitationMongoose from '../main/repositories/mongoose/models/OrganizationInvitationMongoose';
import OrbitAuditLogMongoose from '../main/repositories/mongoose/models/OrbitAuditLogMongoose';
import OrbitPlanMongoose from '../main/repositories/mongoose/models/OrbitPlanMongoose';
import OrbitConversationMongoose from '../main/repositories/mongoose/models/OrbitConversationMongoose';
import EntityPermissionMongoose from '../main/repositories/mongoose/models/EntityPermissionMongoose';
import PricingCollectionMongoose from '../main/repositories/mongoose/models/PricingCollectionMongoose';
import NotificationMongoose from '../main/repositories/mongoose/models/NotificationMongoose';
import UserMongoose from '../main/repositories/mongoose/models/UserMongoose';
import mongoose from 'mongoose';
import { ORBIT_PLAN_LIMITS } from '../main/services/orbit/OrbitPlanService';

dotenv.config();

describe('ORBIT assistant API integration', () => {
  let app: TestApp;
  const usersToDelete: Set<string> = testContainer.resolve('usersToDelete');
  const orgsToDelete: Set<string> = testContainer.resolve('orgsToDelete');
  const orbitUserIds = new Set<string>();

  beforeAll(async () => {
    app = testContainer.resolve('app');
    // The suite sends far more messages a minute than the cap that protects HARVEY's shared key.
    process.env.ORBIT_MAX_MESSAGES_PER_MINUTE = '1000';
  });

  afterEach(async () => {
    restoreLlm();
    await cleanupOrbitData([...orbitUserIds]);
    orbitUserIds.clear();
    for (const username of usersToDelete) await deleteTestUser(username);
    usersToDelete.clear();
    for (const orgId of orgsToDelete) await cleanupOrganization(orgId);
    orgsToDelete.clear();
  });

  afterAll(async () => {
    await shutdownApp();
  });

  const newUser = async () => {
    const { user, organizationId } = await createAndLoginUser('USER', `orbit_user_${randomSuffix()}`);
    orbitUserIds.add(user.id);
    return { user, organizationId };
  };

  const startConversation = async (token: string): Promise<string> => {
    const response = await request(app)
      .post(`${BASE_PATH}/orbit/conversations`)
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(201);
    return response.body.id;
  };

  const sendMessage = (token: string, conversationId: string, body: Record<string, unknown>) =>
    request(app)
      .post(`${BASE_PATH}/orbit/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const confirm = (token: string, planId: string) =>
    request(app)
      .post(`${BASE_PATH}/orbit/plans/${planId}/confirm`)
      .set('Authorization', `Bearer ${token}`);

  /** Organizations ORBIT created are found by name and queued for cleanup. */
  const findOrganization = async (displayName: string) => {
    const organization: any = await OrganizationMongoose.findOne({ displayName }).lean();
    if (organization) orgsToDelete.add(organization._id.toString());
    return organization;
  };

  const roleOf = async (userId: string, organizationId: string) => {
    const membership: any = await OrganizationMembershipMongoose.findOne({
      _userId: userId,
      _organizationId: organizationId,
    }).lean();
    return membership?.role ?? null;
  };

  /** Proposes through the fake model, with the file attached when given, and returns what the model saw. */
  const propose = async (
    token: string,
    args: Record<string, unknown> | ((attachmentId: string | null) => Record<string, unknown>),
    attachment?: { filename: string; content: string }
  ) => {
    const conversationId = await startConversation(token);
    const llm = installFakeLlm([
      request => {
        const attachmentId = String(request.messages[0].content).match(/attachmentId "([^"]+)"/)?.[1] ?? null;
        const draft = typeof args === 'function' ? args(attachmentId) : args;
        return toolCall('propose_plan', { summary: 'Cambios', ...draft });
      },
      answer('Revísalo.'),
    ]);
    const response = await sendMessage(token, conversationId, { content: 'Hazlo', ...(attachment ? { attachment } : {}) });
    expect(response.status).toBe(201);
    return { plan: response.body.plan, result: toolResultsIn(llm.calls[1])[0] };
  };

  const ask = async (token: string, calls: Array<[string, Record<string, unknown>]>) => {
    const conversationId = await startConversation(token);
    const llm = installFakeLlm([...calls.map(([name, args]) => toolCall(name, args)), answer('Hecho.')]);
    await sendMessage(token, conversationId, { content: 'Consulta' });
    return calls.map((_, index) => toolResultsIn(llm.calls[index + 1])[index]);
  };

  const applied = async (token: string, planId: string) =>
    parseSse((await confirm(token, planId)).text).at(-1)!.data.plan;

  // =========================================================================
  // Conversations
  // =========================================================================
  describe('conversations', () => {
    it('requires authentication', async () => {
      const response = await request(app).get(`${BASE_PATH}/orbit/conversations`);
      expect(response.status).toBe(401);
    });

    it('creates, lists and shows the user conversations, and hides them from anyone else', async () => {
      const { user } = await newUser();
      const { user: stranger } = await newUser();
      const conversationId = await startConversation(user.token);

      const list = await request(app)
        .get(`${BASE_PATH}/orbit/conversations`)
        .set('Authorization', `Bearer ${user.token}`);
      expect(list.status).toBe(200);
      expect(list.body.map((conversation: any) => conversation.id)).toContain(conversationId);

      const show = await request(app)
        .get(`${BASE_PATH}/orbit/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${user.token}`);
      expect(show.status).toBe(200);
      expect(show.body).toMatchObject({ id: conversationId, messages: [], plans: [] });

      const foreign = await request(app)
        .get(`${BASE_PATH}/orbit/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${stranger.token}`);
      expect(foreign.status).toBe(404);
    });

    it('rejects empty messages and unsupported files', async () => {
      const { user } = await newUser();
      const conversationId = await startConversation(user.token);
      installFakeLlm([]);

      const empty = await sendMessage(user.token, conversationId, { content: '   ' });
      expect(empty.status).toBe(422);

      const spreadsheet = await sendMessage(user.token, conversationId, {
        content: 'Import this',
        attachment: { filename: 'team.xlsx', content: 'binary' },
      });
      expect(spreadsheet.status).toBe(422);
      expect(spreadsheet.body.error).toMatch(/CSV/);
    });

    it('answers 503 when no language model is configured', async () => {
      const { user } = await newUser();
      const conversationId = await startConversation(user.token);
      installFakeLlm([], false);

      const status = await request(app)
        .get(`${BASE_PATH}/orbit/status`)
        .set('Authorization', `Bearer ${user.token}`);
      expect(status.body).toEqual({ available: false });

      const response = await sendMessage(user.token, conversationId, { content: 'Hola' });
      expect(response.status).toBe(503);
    });

    it('streams the turn as it happens when the client accepts server-sent events', async () => {
      const { user } = await newUser();
      const conversationId = await startConversation(user.token);
      installFakeLlm(
        [
          { content: 'Let me check. ', toolCalls: toolCall('list_my_organizations', {}).toolCalls },
          answer('You belong to one organization.'),
        ],
        true,
        { stream: true }
      );

      const response = await request(app)
        .post(`${BASE_PATH}/orbit/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${user.token}`)
        .set('Accept', 'text/event-stream')
        .send({ content: 'Which organizations am I in?' });

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/event-stream');
      const events = parseSse(response.text);
      const types = events.map(event => event.event);
      expect(types[0]).toBe('accepted');
      expect(events[0].data.message).toMatchObject({ role: 'user', content: 'Which organizations am I in?' });
      expect(events[0].data.title).toBe('Which organizations am I in?');
      // The preamble before the tool call is streamed and then withdrawn.
      expect(types.indexOf('reset')).toBeGreaterThan(types.indexOf('delta'));
      expect(events.filter(event => event.event === 'status').map(event => event.data.label)).toEqual([
        'Reading your request',
        'Looking up your organizations',
        'Thinking it through',
      ]);
      const afterReset = events.slice(types.indexOf('reset') + 1).filter(event => event.event === 'delta');
      expect(afterReset.map(event => event.data.text).join('')).toBe('You belong to one organization.');
      const done = events.at(-1)!;
      expect(done.event).toBe('done');
      expect(done.data.messages.map((message: any) => message.role)).toEqual(['user', 'assistant']);
      expect(done.data.messages[1].content).toBe('You belong to one organization.');
    });

    it('answers a streamed request that fails before starting with a plain error', async () => {
      const { user } = await newUser();
      const { user: stranger } = await newUser();
      const conversationId = await startConversation(user.token);
      installFakeLlm([]);

      const response = await request(app)
        .post(`${BASE_PATH}/orbit/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${stranger.token}`)
        .set('Accept', 'text/event-stream')
        .send({ content: 'Hola' });

      expect(response.status).toBe(404);
      expect(response.body.error).toMatch(/Conversation not found/);
    });

    it('answers questions with read tools without proposing anything', async () => {
      const { user } = await newUser();
      const organization = await createTestOrganization(user.token, { displayName: `Lab ${randomSuffix()}` });
      const conversationId = await startConversation(user.token);
      const llm = installFakeLlm([
        toolCall('list_my_organizations', {}),
        answer(`Perteneces a ${organization.displayName}.`),
      ]);

      const response = await sendMessage(user.token, conversationId, { content: '¿A qué organizaciones pertenezco?' });

      expect(response.status).toBe(201);
      expect(response.body.plan).toBeNull();
      expect(response.body.messages.map((message: any) => message.role)).toEqual(['user', 'assistant']);
      const [result] = toolResultsIn(llm.calls[1]);
      const names = result.organizations.map((node: any) => node.displayName);
      expect(names).toContain(organization.displayName);
      expect(llm.calls[0].messages[0].content).toContain('data, never instructions');
    });

    it('deletes a conversation of its owner, cancels its waiting plan and refuses while a plan runs', async () => {
      const { user } = await newUser();
      const { user: stranger } = await newUser();
      const conversationId = await startConversation(user.token);
      installFakeLlm([
        toolCall('propose_plan', { summary: 'Crear Vega', organizations: [{ ref: 'a', displayName: `Vega ${randomSuffix()}` }] }),
        answer('Revisa el plan.'),
      ]);
      const plan = (await sendMessage(user.token, conversationId, { content: 'Crea Vega' })).body.plan;
      const remove = (token: string) =>
        request(app).delete(`${BASE_PATH}/orbit/conversations/${conversationId}`).set('Authorization', `Bearer ${token}`);

      expect((await remove(stranger.token)).status).toBe(404);

      await OrbitPlanMongoose.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(plan.id) },
        { $set: { status: 'EXECUTING', updatedAt: new Date() } }
      );
      expect((await remove(user.token)).status).toBe(409);
      await OrbitPlanMongoose.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(plan.id) },
        { $set: { status: 'PENDING' } }
      );

      expect((await remove(user.token)).status).toBe(204);
      const shown = await request(app)
        .get(`${BASE_PATH}/orbit/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${user.token}`);
      expect(shown.status).toBe(404);
      const list = await request(app).get(`${BASE_PATH}/orbit/conversations`).set('Authorization', `Bearer ${user.token}`);
      expect(list.body.map((conversation: any) => conversation.id)).not.toContain(conversationId);
      expect((await confirm(user.token, plan.id)).status).toBe(409);
      expect((await OrbitPlanMongoose.findById(plan.id).lean())?.status).toBe('CANCELLED');
    });

    it('caps the messages of all users together, to leave room for HARVEY on the shared key', async () => {
      const { user } = await newUser();
      const conversationId = await startConversation(user.token);
      installFakeLlm([answer('Hola'), answer('Hola'), answer('Hola')]);
      process.env.ORBIT_MAX_MESSAGES_PER_MINUTE = '1';
      try {
        // The first message may already be over the cap, given the earlier tests.
        await sendMessage(user.token, conversationId, { content: 'Hola' });
        const response = await sendMessage(user.token, conversationId, { content: 'Hola' });
        expect(response.status).toBe(429);
        expect(response.body.error).toMatch(/ORBIT is very busy right now/);
      } finally {
        process.env.ORBIT_MAX_MESSAGES_PER_MINUTE = '1000';
      }
      expect((await sendMessage(user.token, conversationId, { content: 'Hola' })).status).toBe(201);
    });

    it('refuses new messages once a conversation nears the size limit of a MongoDB document', async () => {
      const { user } = await newUser();
      const conversationId = await startConversation(user.token);
      const file = (name: string) => ({ filename: name, content: 'x'.repeat(500 * 1024) });
      // Eight files of 500 KB already in the conversation, as earlier turns would have left them.
      await OrbitConversationMongoose.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(conversationId) },
        {
          $push: {
            attachments: {
              $each: Array.from({ length: 8 }, (_, index) => ({
                id: `file-${index}`,
                ...file(`old-${index}.csv`),
                size: 500 * 1024,
                createdAt: new Date(),
              })),
            },
          },
        } as any
      );
      const llm = installFakeLlm([answer('Hola')]);

      const tooManyFiles = await sendMessage(user.token, conversationId, { content: 'Uno más', attachment: file('new.csv') });
      expect(tooManyFiles.status).toBe(409);
      expect(tooManyFiles.body.error).toMatch(/already holds 3\.9 MB of files.*Start a new conversation/);

      // Text alone still fits, until the document itself is close to full.
      expect((await sendMessage(user.token, conversationId, { content: 'Hola' })).status).toBe(201);
      await OrbitConversationMongoose.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(conversationId) },
        { $set: { padding: 'x'.repeat(9 * 1024 * 1024) } }
      );
      const full = await sendMessage(user.token, conversationId, { content: 'Otra' });
      expect(full.status).toBe(409);
      expect(full.body.error).toMatch(/This conversation is full\. Start a new conversation/);
      expect(llm.remaining()).toBe(0);
      // Nothing of the refused messages was stored.
      const stored: any = await OrbitConversationMongoose.findById(conversationId).lean();
      expect(stored.messages.map((message: any) => message.content)).toEqual(['Hola', 'Hola']);
    });

    it('lists the members of several organizations in one call', async () => {
      const { user } = await newUser();
      const first = await createTestOrganization(user.token, { displayName: `Uno ${randomSuffix()}` });
      const second = await createTestOrganization(user.token, { displayName: `Dos ${randomSuffix()}` });
      const conversationId = await startConversation(user.token);
      const llm = installFakeLlm([
        toolCall('list_members', { organizationIds: [first.id, second.id, 'not-an-id'] }),
        answer('Listo.'),
      ]);

      await sendMessage(user.token, conversationId, { content: '¿Quién está en cada una?' });

      const [result] = toolResultsIn(llm.calls[1]);
      expect(result.organizations).toHaveLength(3);
      expect(result.organizations[0]).toMatchObject({ organizationId: first.id, members: [{ username: user.username, role: 'OWNER' }] });
      expect(result.organizations[1].organizationId).toBe(second.id);
      expect(result.organizations[2].error).toMatch(/not found/i);
    });

    it('ends a turn that runs out of tool rounds with an answer, even if the model keeps calling tools', async () => {
      const { user } = await newUser();
      const conversationId = await startConversation(user.token);
      const llm = installFakeLlm(Array.from({ length: 9 }, () => toolCall('list_my_organizations', {})));

      const response = await sendMessage(user.token, conversationId, { content: 'Mira todo' });

      expect(response.status).toBe(201);
      expect(response.body.messages.at(-1).content).toMatch(/narrow it down/);
      const last = llm.calls.at(-1)!;
      expect(last.tools).toBeUndefined();
      expect(last.messages.at(-1)).toMatchObject({ role: 'system', content: expect.stringContaining('Do not call any tool') });
    });

    it('ends the turn with an answer when the provider rejects a tool call in the last round', async () => {
      const { user } = await newUser();
      const conversationId = await startConversation(user.token);
      installFakeLlm([
        ...Array.from({ length: 8 }, () => toolCall('list_my_organizations', {})),
        () => {
          throw Object.assign(
            new Error('ORBIT UNAVAILABLE: The language model returned an error (Tool choice is none, but model called a tool)'),
            { providerStatus: 400, providerDetail: 'Tool choice is none, but model called a tool' }
          );
        },
      ]);

      const response = await sendMessage(user.token, conversationId, { content: 'Mira todo' });

      expect(response.status).toBe(201);
      expect(response.body.messages.at(-1).content).toMatch(/narrow it down/);
    });

    it('takes back a turn that failed without a plan, so trying again does not repeat the message', async () => {
      const { user } = await newUser();
      const conversationId = await startConversation(user.token);
      installFakeLlm([
        toolCall('list_my_organizations', {}),
        () => {
          throw new Error('ORBIT UNAVAILABLE: The AI provider is receiving too many requests right now. Try again in about 90 seconds.');
        },
        answer('Perteneces a una organización.'),
      ]);

      const failed = await sendMessage(user.token, conversationId, {
        content: '¿Dónde estoy?',
        attachment: { filename: 'equipos.csv', content: 'nombre\nVentas\n' },
      });
      expect(failed.status).toBe(503);
      const afterFailure = await request(app)
        .get(`${BASE_PATH}/orbit/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${user.token}`);
      expect(afterFailure.body.messages).toEqual([]);
      const stored: any = await OrbitConversationMongoose.findById(conversationId).lean();
      expect(stored.messages).toHaveLength(0);
      expect(stored.attachments).toHaveLength(0);

      const retried = await sendMessage(user.token, conversationId, { content: '¿Dónde estoy?' });
      expect(retried.status).toBe(201);
      const conversation = await request(app)
        .get(`${BASE_PATH}/orbit/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${user.token}`);
      expect(conversation.body.messages.map((message: any) => message.content)).toEqual([
        '¿Dónde estoy?',
        'Perteneces a una organización.',
      ]);
    });
  });

  // =========================================================================
  // Plans from the chat
  // =========================================================================
  describe('plans proposed in the chat', () => {
    it('proposes a tree with members without changing anything, then applies it once confirmed', async () => {
      const { user: owner } = await newUser();
      const { user: colleague } = await newUser();
      const tag = randomSuffix();
      const conversationId = await startConversation(owner.token);

      const llm = installFakeLlm([
        toolCall('propose_plan', {
          summary: 'Crear ACME con Ventas e IT',
          organizations: [
            { ref: 'acme', displayName: `ACME ${tag}`, description: 'Holding' },
            { ref: 'ventas', displayName: `Ventas ${tag}`, parentRef: 'acme' },
            { ref: 'it', displayName: `IT ${tag}`, parentRef: 'acme' },
          ],
          members: [
            { organizationRef: 'ventas', user: colleague.username, role: 'ADMIN' },
            { organizationRef: 'it', user: 'nobody@nowhere.test', role: 'MEMBER' },
          ],
        }),
        answer('He preparado el plan. Revísalo y confírmalo.'),
      ]);

      const response = await sendMessage(owner.token, conversationId, {
        content: 'Crea ACME con Ventas e IT y mete a mi compañero en Ventas como admin',
      });

      expect(response.status).toBe(201);
      const plan = response.body.plan;
      expect(plan.status).toBe('PENDING');
      expect(plan.steps.map((step: any) => step.operation.type)).toEqual([
        'create_organization',
        'create_organization',
        'create_organization',
        'add_members',
      ]);
      expect(plan.warnings.join(' ')).toContain('nobody@nowhere.test');
      expect(response.body.messages[1]).toMatchObject({ role: 'assistant', planId: plan.id });
      expect(toolResultsIn(llm.calls[1])[0].ok).toBe(true);

      // Nothing exists until the user confirms.
      expect(await OrganizationMongoose.countDocuments({ displayName: `ACME ${tag}` })).toBe(0);

      const confirmation = await confirm(owner.token, plan.id);
      expect(confirmation.status).toBe(200);
      expect(confirmation.headers['content-type']).toContain('text/event-stream');
      const events = parseSse(confirmation.text);
      expect(events.map(event => event.event)).toEqual(['started', 'step', 'step', 'step', 'step', 'done']);
      expect(events.at(-1)!.data.plan.status).toBe('COMPLETED');

      const acme = await findOrganization(`ACME ${tag}`);
      const ventas = await findOrganization(`Ventas ${tag}`);
      const it = await findOrganization(`IT ${tag}`);
      expect(acme._parentId).toBeNull();
      expect(acme.description).toBe('Holding');
      expect(ventas._parentId.toString()).toBe(acme._id.toString());
      expect(it._parentId.toString()).toBe(acme._id.toString());
      expect(await roleOf(owner.id, acme._id.toString())).toBe('OWNER');
      expect(await roleOf(colleague.id, ventas._id.toString())).toBe('ADMIN');

      expect(await OrbitAuditLogMongoose.countDocuments({ _planId: plan.id, outcome: 'SUCCESS' })).toBe(4);

      const stored = await request(app)
        .get(`${BASE_PATH}/orbit/plans/${plan.id}`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(stored.body.status).toBe('COMPLETED');
      expect(stored.body.steps[0].result.organizationId).toBe(acme._id.toString());

      // A plan runs once.
      const again = await confirm(owner.token, plan.id);
      expect(again.status).toBe(409);
    });

    it('refuses to plan changes in organizations the user does not manage', async () => {
      const { user } = await newUser();
      const { user: other } = await newUser();
      const foreign = await createTestOrganization(other.token, { displayName: `Foreign ${randomSuffix()}` });
      const conversationId = await startConversation(user.token);

      const llm = installFakeLlm([
        toolCall('propose_plan', {
          summary: 'Crear un equipo',
          organizations: [{ ref: 'team', displayName: 'Equipo', parentId: foreign.id }],
          members: [{ organizationId: foreign.id, user: other.username, role: 'MEMBER' }],
        }),
        answer('No tienes permisos sobre esa organización.'),
      ]);

      const response = await sendMessage(user.token, conversationId, { content: 'Crea Equipo dentro de Foreign' });

      expect(response.status).toBe(201);
      expect(response.body.plan).toBeNull();
      const [result] = toolResultsIn(llm.calls[1]);
      expect(result.ok).toBe(false);
      expect(result.errors.join(' ')).toMatch(/OWNER or ADMIN/);
      expect(await OrbitPlanMongoose.countDocuments({ _conversationId: conversationId })).toBe(0);
    });

    it('returns the problems of an inconsistent tree to the model', async () => {
      const { user } = await newUser();
      const conversationId = await startConversation(user.token);
      const llm = installFakeLlm([
        toolCall('propose_plan', {
          summary: 'Ciclo',
          organizations: [
            { ref: 'a', displayName: 'Alpha', parentRef: 'b' },
            { ref: 'b', displayName: 'Beta', parentRef: 'a' },
            { ref: 'c', displayName: 'Gamma', parentRef: 'missing' },
          ],
        }),
        answer('Hay un problema con la estructura.'),
      ]);

      await sendMessage(user.token, conversationId, { content: 'Crea esto' });

      const [result] = toolResultsIn(llm.calls[1]);
      expect(result.ok).toBe(false);
      expect(result.errors.join(' ')).toMatch(/"missing"/);
    });

    it('rejects plans that give an organization too many children or go too deep', async () => {
      const { user } = await newUser();
      const conversationId = await startConversation(user.token);
      const tooManyChildren = [
        { ref: 'root', displayName: `Root ${randomSuffix()}` },
        ...Array.from({ length: ORBIT_PLAN_LIMITS.childrenPerOrganization + 1 }, (_, index) => ({
          ref: `c${index}`,
          displayName: `Child ${index}`,
          parentRef: 'root',
        })),
      ];
      const tooDeep = Array.from({ length: ORBIT_PLAN_LIMITS.depth + 1 }, (_, index) => ({
        ref: `l${index}`,
        displayName: `Level ${index}`,
        ...(index > 0 ? { parentRef: `l${index - 1}` } : {}),
      }));

      const llm = installFakeLlm([
        toolCall('propose_plan', { summary: 'Muchos hijos', organizations: tooManyChildren }),
        answer('Demasiados hijos.'),
        toolCall('propose_plan', { summary: 'Muy profundo', organizations: tooDeep }),
        answer('Demasiado profundo.'),
      ]);

      const wide = await sendMessage(user.token, conversationId, { content: 'Crea muchos hijos' });
      expect(wide.body.plan).toBeNull();
      expect(toolResultsIn(llm.calls[1])[0].errors.join(' ')).toMatch(/at most 50/);

      const deep = await sendMessage(user.token, conversationId, { content: 'Crea muchos niveles' });
      expect(deep.body.plan).toBeNull();
      expect(toolResultsIn(llm.calls[3]).at(-1).errors.join(' ')).toMatch(/at most 6 levels deep/);
      expect(llm.calls[0].messages[0].content).toContain(`at most ${ORBIT_PLAN_LIMITS.childrenPerOrganization} direct sub-organizations`);
    });

    it('counts sub-organizations that already exist and the depth of existing parents', async () => {
      const { user } = await newUser();
      let parentId = (await createTestOrganization(user.token, { displayName: `Top ${randomSuffix()}` })).id;
      // Five levels already exist, so a child of the deepest one would be the seventh.
      for (let level = 2; level <= ORBIT_PLAN_LIMITS.depth - 1; level++) {
        parentId = (await createTestOrganization(user.token, { displayName: `Level ${level}`, _parentId: parentId })).id;
      }
      const fifthLevel = parentId;
      const conversationId = await startConversation(user.token);

      const llm = installFakeLlm([
        toolCall('propose_plan', {
          summary: 'Dos niveles más',
          organizations: [
            { ref: 'sixth', displayName: 'Sixth', parentId: fifthLevel },
            { ref: 'seventh', displayName: 'Seventh', parentRef: 'sixth' },
          ],
        }),
        answer('Demasiado profundo.'),
      ]);

      await sendMessage(user.token, conversationId, { content: 'Añade dos niveles' });
      const [result] = toolResultsIn(llm.calls[1]);
      expect(result.ok).toBe(false);
      expect(result.errors.join(' ')).toMatch(/"Seventh" would go deeper/);
      expect(result.errors.join(' ')).not.toMatch(/"Sixth"/);
    });

    it('enforces the daily allowance of organizations when proposing and when confirming', async () => {
      const { user } = await newUser();
      const conversationId = await startConversation(user.token);
      installFakeLlm([
        toolCall('propose_plan', { summary: 'Dos', organizations: [{ ref: 'a', displayName: `A ${randomSuffix()}` }, { ref: 'b', displayName: `B ${randomSuffix()}` }] }),
        answer('Plan listo.'),
        toolCall('propose_plan', { summary: 'Una', organizations: [{ ref: 'c', displayName: `C ${randomSuffix()}` }] }),
        answer('Sin cupo.'),
      ]);
      const plan = (await sendMessage(user.token, conversationId, { content: 'Crea A y B' })).body.plan;
      expect(plan.status).toBe('PENDING');

      // Other plans use up the day's allowance, all but one.
      const now = new Date();
      await OrbitAuditLogMongoose.insertMany(
        Array.from({ length: ORBIT_PLAN_LIMITS.organizationsPerDay - 1 }, (_, index) => ({
          _userId: user.id,
          _planId: plan.id,
          _conversationId: conversationId,
          stepId: `x${index}`,
          action: 'create_organization',
          outcome: 'SUCCESS',
          createdAt: now,
        }))
      );

      const confirmation = await confirm(user.token, plan.id);
      expect(confirmation.status).toBe(429);
      expect(confirmation.body.error).toMatch(/only create 1 more/);
      expect((await OrbitPlanMongoose.findById(plan.id).lean())!.status).toBe('PENDING');

      await OrbitAuditLogMongoose.create({
        _userId: user.id,
        _planId: plan.id,
        _conversationId: conversationId,
        stepId: 'last',
        action: 'create_organization',
        outcome: 'SUCCESS',
      });
      const second = await sendMessage(user.token, conversationId, { content: 'Crea C' });
      expect(second.body.plan).toBeNull();
    });

    it('edits an organization and creates an invitation link', async () => {
      const { user } = await newUser();
      const organization = await createTestOrganization(user.token, { displayName: `Old ${randomSuffix()}` });
      const renamed = `Renamed ${randomSuffix()}`;
      const conversationId = await startConversation(user.token);

      installFakeLlm([
        toolCall('propose_plan', {
          summary: 'Renombrar y crear enlace',
          updates: [{ organizationId: organization.id, displayName: renamed, description: 'Nueva descripción' }],
          invitationLinks: [{ organizationId: organization.id, expiresInDays: 3, maxUses: 5 }],
        }),
        answer('Listo para confirmar.'),
      ]);

      const response = await sendMessage(user.token, conversationId, { content: 'Renombra y crea un enlace' });
      const plan = response.body.plan;
      expect(plan.steps.map((step: any) => step.operation.type)).toEqual(['update_organization', 'create_invitation_link']);

      const events = parseSse((await confirm(user.token, plan.id)).text);
      const done = events.at(-1)!.data.plan;
      expect(done.status).toBe('COMPLETED');

      const updated: any = await OrganizationMongoose.findById(organization.id).lean();
      expect(updated.displayName).toBe(renamed);
      expect(updated.description).toBe('Nueva descripción');

      const code = done.steps[1].result.code;
      const invitation: any = await OrganizationInvitationMongoose.findOne({ code }).lean();
      expect(invitation.maxUses).toBe(5);
      expect(String(invitation._organizationId)).toBe(organization.id);
    });

    it('makes the model propose a plan it only wrote out as text', async () => {
      const { user } = await newUser();
      const organization = await createTestOrganization(user.token, { displayName: `Linked ${randomSuffix()}` });
      const conversationId = await startConversation(user.token);
      const llm = installFakeLlm([
        answer('**Plan preview**: create an invitation link. Please review the plan card and confirm it.'),
        toolCall('propose_plan', { summary: 'Crear enlace', invitationLinks: [{ organizationId: organization.id }] }),
        answer('Revisa el plan y confírmalo en la tarjeta.'),
      ]);

      const response = await sendMessage(user.token, conversationId, { content: 'Crea un enlace de invitación' });

      expect(response.status).toBe(201);
      expect(response.body.plan?.steps[0].operation.type).toBe('create_invitation_link');
      expect(llm.calls[1].messages.at(-1)).toMatchObject({ role: 'system', content: expect.stringContaining('did not call propose_plan') });
      const answers = response.body.messages.filter((message: any) => message.role === 'assistant');
      expect(answers.map((message: any) => message.content)).toEqual(['Revisa el plan y confírmalo en la tarjeta.']);
      expect(answers[0].planId).toBe(response.body.plan.id);
    });

    it('reminds the model only once and keeps a plain question as the answer', async () => {
      const { user } = await newUser();
      const conversationId = await startConversation(user.token);
      const llm = installFakeLlm([
        answer('Can you confirm which organization you mean?'),
        answer('Which organization do you mean?'),
      ]);

      const response = await sendMessage(user.token, conversationId, { content: 'Crea un enlace' });

      expect(response.body.plan).toBeNull();
      expect(llm.remaining()).toBe(0);
      expect(response.body.messages.at(-1).content).toBe('Which organization do you mean?');
    });

    it('replaces the pending plan with a new proposal and lets the user cancel', async () => {
      const { user } = await newUser();
      const { user: stranger } = await newUser();
      const conversationId = await startConversation(user.token);

      installFakeLlm([
        toolCall('propose_plan', { summary: 'Primero', organizations: [{ ref: 'a', displayName: `First ${randomSuffix()}` }] }),
        answer('Plan 1'),
        toolCall('propose_plan', { summary: 'Segundo', organizations: [{ ref: 'a', displayName: `Second ${randomSuffix()}` }] }),
        answer('Plan 2'),
      ]);

      const first = (await sendMessage(user.token, conversationId, { content: 'Crea First' })).body.plan;
      const second = (await sendMessage(user.token, conversationId, { content: 'Mejor Second' })).body.plan;

      const superseded = await confirm(user.token, first.id);
      expect(superseded.status).toBe(409);

      const foreignCancel = await request(app)
        .post(`${BASE_PATH}/orbit/plans/${second.id}/cancel`)
        .set('Authorization', `Bearer ${stranger.token}`);
      expect(foreignCancel.status).toBe(404);

      const cancel = await request(app)
        .post(`${BASE_PATH}/orbit/plans/${second.id}/cancel`)
        .set('Authorization', `Bearer ${user.token}`);
      expect(cancel.status).toBe(200);
      expect(cancel.body.status).toBe('CANCELLED');
      expect((await confirm(user.token, second.id)).status).toBe(409);

      const conversation = await request(app)
        .get(`${BASE_PATH}/orbit/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${user.token}`);
      expect(conversation.body.plans.map((plan: any) => plan.status)).toEqual(['SUPERSEDED', 'CANCELLED']);
    });

    it('keeps a plan proposed before the model failed and shows it with a note', async () => {
      const { user } = await newUser();
      const conversationId = await startConversation(user.token);
      installFakeLlm([
        toolCall('propose_plan', { summary: 'Crear Atlas', organizations: [{ ref: 'a', displayName: `Atlas ${randomSuffix()}` }] }),
        () => {
          throw new Error('ORBIT UNAVAILABLE: Could not reach the language model (the request timed out)');
        },
      ]);

      const response = await sendMessage(user.token, conversationId, { content: 'Crea Atlas' });

      expect(response.status).toBe(201);
      expect(response.body.plan.status).toBe('PENDING');
      const note = response.body.messages.at(-1);
      expect(note.role).toBe('assistant');
      expect(note.planId).toBe(response.body.plan.id);
      expect(note.content).toContain('could not finish my answer (Could not reach the language model (the request timed out))');
    });

    it('closes a plan whose run was cut off instead of leaving it running', async () => {
      const { user } = await newUser();
      const conversationId = await startConversation(user.token);
      installFakeLlm([
        toolCall('propose_plan', {
          summary: 'Dos equipos',
          organizations: [
            { ref: 'a', displayName: `Norte ${randomSuffix()}` },
            { ref: 'b', displayName: `Sur ${randomSuffix()}` },
          ],
        }),
        answer('Revisa el plan.'),
      ]);
      const plan = (await sendMessage(user.token, conversationId, { content: 'Crea dos equipos' })).body.plan;
      const [first, second] = plan.steps;

      // A run that applied the first step and then stopped, a while ago.
      const longAgo = new Date(Date.now() - 10 * 60 * 1000);
      await OrbitPlanMongoose.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(plan.id) },
        { $set: { status: 'EXECUTING', updatedAt: longAgo, 'steps.0.status': 'DONE' } }
      );
      const shown = await request(app)
        .get(`${BASE_PATH}/orbit/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${user.token}`);
      const closed = shown.body.plans[0];
      expect(closed.status).toBe('PARTIAL');
      expect(closed.steps.find((step: any) => step.id === first.id).status).toBe('DONE');
      const interrupted = closed.steps.find((step: any) => step.id === second.id);
      expect(interrupted.status).toBe('FAILED');
      expect(interrupted.error).toMatch(/interrupted during this step/);
      expect((await confirm(user.token, plan.id)).status).toBe(409);

      // A run that is still making progress is left alone.
      await OrbitPlanMongoose.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(plan.id) },
        { $set: { status: 'EXECUTING', updatedAt: new Date() } }
      );
      const live = await request(app).get(`${BASE_PATH}/orbit/plans/${plan.id}`).set('Authorization', `Bearer ${user.token}`);
      expect(live.body.status).toBe('EXECUTING');
    });

    it('checks permissions again when the plan runs and skips what depended on a failed step', async () => {
      const { user: owner } = await newUser();
      const { user: manager } = await newUser();
      const organization = await createTestOrganization(owner.token, { displayName: `Corp ${randomSuffix()}` });
      await createMembership(manager.id, organization.id, 'ADMIN');
      const conversationId = await startConversation(manager.token);
      const tag = randomSuffix();

      installFakeLlm([
        toolCall('propose_plan', {
          summary: 'Crear área y equipo',
          organizations: [
            { ref: 'area', displayName: `Area ${tag}`, parentId: organization.id },
            { ref: 'team', displayName: `Team ${tag}`, parentRef: 'area' },
          ],
        }),
        answer('Confirma cuando quieras.'),
      ]);
      const plan = (await sendMessage(manager.token, conversationId, { content: 'Crea área y equipo' })).body.plan;
      expect(plan.status).toBe('PENDING');

      // The manager loses their seat before confirming.
      await OrganizationMembershipMongoose.deleteOne({ _userId: manager.id, _organizationId: organization.id });

      const events = parseSse((await confirm(manager.token, plan.id)).text);
      const done = events.at(-1)!.data.plan;
      expect(done.status).toBe('FAILED');
      expect(done.steps[0].status).toBe('FAILED');
      expect(done.steps[0].error).toMatch(/PERMISSION ERROR/);
      expect(done.steps[1].status).toBe('SKIPPED');
      expect(await OrganizationMongoose.countDocuments({ displayName: `Area ${tag}` })).toBe(0);
    });
  });

  // =========================================================================
  // Teams and permissions
  // =========================================================================
  describe('teams and permissions', () => {
    afterEach(async () => {
      const organizationIds = [...orgsToDelete].map(id => new mongoose.Types.ObjectId(id));
      await PricingCollectionMongoose.deleteMany({ _organizationId: { $in: organizationIds } });
      await EntityPermissionMongoose.deleteMany({ _organizationId: { $in: organizationIds } });
    });

    const confirmWith = (token: string, planId: string, confirmation?: string) =>
      request(app)
        .post(`${BASE_PATH}/orbit/plans/${planId}/confirm`)
        .set('Authorization', `Bearer ${token}`)
        .send(confirmation === undefined ? {} : { confirmation });

    /** Proposes a plan through the fake model and returns it with the result the model saw. */
    const propose = async (token: string, args: Record<string, unknown>) => {
      const conversationId = await startConversation(token);
      const llm = installFakeLlm([toolCall('propose_plan', { summary: 'Cambios', ...args }), answer('Revísalo.')]);
      const response = await sendMessage(token, conversationId, { content: 'Hazlo' });
      expect(response.status).toBe(201);
      const [result] = toolResultsIn(llm.calls[1]);
      return { plan: response.body.plan, result };
    };

    it('changes roles and removes members in bulk, leaving out who is not a member', async () => {
      const { user: owner } = await newUser();
      const [promoted, demoted, leaving, stranger] = await Promise.all([newUser(), newUser(), newUser(), newUser()]);
      const organization = await createTestOrganization(owner.token, { displayName: `Team ${randomSuffix()}` });
      const child = await createTestOrganization(owner.token, { displayName: `Sub ${randomSuffix()}`, _parentId: organization.id });
      await createMembership(promoted.user.id, organization.id, 'MEMBER');
      await createMembership(demoted.user.id, organization.id, 'ADMIN');
      await createMembership(leaving.user.id, organization.id, 'MEMBER');
      await createMembership(leaving.user.id, child.id, 'MEMBER');

      const { plan } = await propose(owner.token, {
        roleChanges: [
          { organizationId: organization.id, user: promoted.user.username, role: 'ADMIN' },
          { organizationId: organization.id, user: demoted.user.username, role: 'MEMBER' },
          { organizationId: organization.id, user: stranger.user.username, role: 'ADMIN' },
        ],
        removals: [{ organizationId: organization.id, user: leaving.user.username }],
      });

      expect(plan.steps.map((step: any) => step.operation.type)).toEqual(['change_member_roles', 'remove_members']);
      expect(plan.steps[0].operation.changes).toHaveLength(2);
      expect(plan.warnings.join(' ')).toContain(`@${stranger.user.username} is not a member`);
      expect(await roleOf(promoted.user.id, organization.id)).toBe('MEMBER');

      const done = parseSse((await confirm(owner.token, plan.id)).text).at(-1)!.data.plan;
      expect(done.status).toBe('COMPLETED');
      expect(await roleOf(promoted.user.id, organization.id)).toBe('ADMIN');
      expect(await roleOf(demoted.user.id, organization.id)).toBe('MEMBER');
      expect(await roleOf(leaving.user.id, organization.id)).toBeNull();
      expect(await roleOf(leaving.user.id, child.id)).toBeNull();
    });

    it('never changes the role of the owner or of the user, and never makes anyone owner', async () => {
      const { user: owner } = await newUser();
      const { user: manager } = await newUser();
      const { user: member } = await newUser();
      const organization = await createTestOrganization(owner.token, { displayName: `Guarded ${randomSuffix()}` });
      await createMembership(manager.id, organization.id, 'ADMIN');
      await createMembership(member.id, organization.id, 'MEMBER');

      const { plan, result } = await propose(manager.token, {
        roleChanges: [
          { organizationId: organization.id, user: owner.username, role: 'MEMBER' },
          { organizationId: organization.id, user: manager.username, role: 'MEMBER' },
          { organizationId: organization.id, user: member.username, role: 'OWNER' },
        ],
        removals: [{ organizationId: organization.id, user: owner.username }],
      });

      expect(plan).toBeNull();
      const errors = result.errors.join(' ');
      expect(errors).toContain(`@${owner.username} owns`);
      expect(errors).toContain('your own role');
      expect(errors).toContain('single owner');
      expect(errors).toContain('cannot be removed');
      expect(await roleOf(owner.id, organization.id)).toBe('OWNER');
    });

    it('revokes invitations of the organization and rejects codes from any other one', async () => {
      const { user: owner } = await newUser();
      const { user: other } = await newUser();
      const organization = await createTestOrganization(owner.token, { displayName: `Invites ${randomSuffix()}` });
      const foreign = await createTestOrganization(other.token, { displayName: `Elsewhere ${randomSuffix()}` });
      const ours = await createTestInvitation(organization.id, owner.id);
      const theirs = await createTestInvitation(foreign.id, other.id);

      const rejected = await propose(owner.token, {
        invitationRevocations: [
          { organizationId: organization.id, code: ours.code },
          { organizationId: organization.id, code: theirs.code },
        ],
      });
      expect(rejected.plan).toBeNull();
      expect(rejected.result.errors.join(' ')).toContain(`no pending invitation with the code "${theirs.code}"`);

      const { plan } = await propose(owner.token, {
        invitationRevocations: [{ organizationId: organization.id, code: `https://sphere.example/orgs/join/${ours.code}` }],
      });
      expect(plan.steps[0].operation).toMatchObject({ type: 'revoke_invitations', invitations: [{ id: ours.id, code: ours.code }] });

      const done = parseSse((await confirm(owner.token, plan.id)).text).at(-1)!.data.plan;
      expect(done.status).toBe('COMPLETED');
      expect(await OrganizationInvitationMongoose.countDocuments({ code: ours.code })).toBe(0);
      expect(await OrganizationInvitationMongoose.countDocuments({ code: theirs.code })).toBe(1);
    });

    it('moves an organization only when the user owns both ends, and never inside itself', async () => {
      const { user: owner } = await newUser();
      const { user: other } = await newUser();
      const left = await createTestOrganization(owner.token, { displayName: `Left ${randomSuffix()}` });
      const right = await createTestOrganization(owner.token, { displayName: `Right ${randomSuffix()}` });
      const team = await createTestOrganization(owner.token, { displayName: `Team ${randomSuffix()}`, _parentId: left.id });
      const squad = await createTestOrganization(owner.token, { displayName: `Squad ${randomSuffix()}`, _parentId: team.id });
      const foreign = await createTestOrganization(other.token, { displayName: `Foreign ${randomSuffix()}` });

      const refused = await propose(owner.token, {
        moves: [{ organizationId: team.id, parentId: foreign.id }],
      });
      expect(refused.plan).toBeNull();
      expect(refused.result.errors.join(' ')).toContain('OWNER of');

      const inside = await propose(owner.token, { moves: [{ organizationId: team.id, parentId: squad.id }] });
      expect(inside.result.errors.join(' ')).toContain('sits inside it');

      const { plan } = await propose(owner.token, { moves: [{ organizationId: team.id, parentId: right.id }] });
      expect(plan.steps[0].operation).toMatchObject({
        type: 'move_organization',
        from: { id: left.id },
        to: { id: right.id },
      });

      const done = parseSse((await confirm(owner.token, plan.id)).text).at(-1)!.data.plan;
      expect(done.status).toBe('COMPLETED');
      const moved: any = await OrganizationMongoose.findById(team.id).lean();
      expect(String(moved._parentId)).toBe(right.id);
      const below: any = await OrganizationMongoose.findById(squad.id).lean();
      expect(below.ancestors.map(String)).toEqual([right.id, team.id]);
    });

    it('hands an organization over in a plan of its own, confirmed by typing its name', async () => {
      const { user: owner } = await newUser();
      const { user: heir } = await newUser();
      const name = `Legacy ${randomSuffix()}`;
      const organization = await createTestOrganization(owner.token, { displayName: name });
      await createMembership(heir.id, organization.id, 'MEMBER');

      const mixed = await propose(owner.token, {
        ownershipTransfer: { organizationId: organization.id, user: heir.username },
        updates: [{ organizationId: organization.id, description: 'Otra' }],
      });
      expect(mixed.result.errors.join(' ')).toContain('plan of its own');

      const { plan } = await propose(owner.token, {
        ownershipTransfer: { organizationId: organization.id, user: heir.email ?? heir.username },
      });
      expect(plan.confirmationPhrase).toBe(name);
      expect(plan.steps[0].operation).toMatchObject({ type: 'transfer_ownership', newOwner: { userId: heir.id } });

      const missing = await confirmWith(owner.token, plan.id);
      expect(missing.status).toBe(422);
      const wrong = await confirmWith(owner.token, plan.id, 'Something else');
      expect(wrong.status).toBe(422);
      expect(wrong.body.error).toContain(name);
      expect(await roleOf(owner.id, organization.id)).toBe('OWNER');

      const done = parseSse((await confirmWith(owner.token, plan.id, `  ${name.toLowerCase()} `)).text).at(-1)!.data.plan;
      expect(done.status).toBe('COMPLETED');
      expect(await roleOf(heir.id, organization.id)).toBe('OWNER');
      expect(await roleOf(owner.id, organization.id)).toBe('ADMIN');
    });

    it('grants, changes and takes away access to collections and to creating pricings', async () => {
      const { user: owner } = await newUser();
      const { user: member } = await newUser();
      const { user: manager } = await newUser();
      const organization = await createTestOrganization(owner.token, { displayName: `Access ${randomSuffix()}` });
      await createMembership(member.id, organization.id, 'MEMBER');
      await createMembership(manager.id, organization.id, 'ADMIN');
      const collection = await createTestCollection({ _organizationId: organization.id, private: true, name: `Secret ${randomSuffix()}` });

      const wide = await propose(owner.token, {
        permissions: [{ organizationId: organization.id, user: member.username, resourceType: 'pricing', access: ['GET'] }],
      });
      expect(wide.result.errors.join(' ')).toContain('can only allow CREATE');

      const granted = await propose(owner.token, {
        permissions: [
          { organizationId: organization.id, user: member.username, resourceType: 'collection', resource: collection.name, access: ['PUT'] },
          { organizationId: organization.id, user: member.username, resourceType: 'pricing', access: ['CREATE'] },
          { organizationId: organization.id, user: manager.username, resourceType: 'collection', resource: collection.slug, access: ['GET'] },
        ],
      });
      const changes = granted.plan.steps[0].operation.changes;
      expect(changes).toHaveLength(2);
      expect(changes[0]).toMatchObject({ resourceSlug: collection.slug, access: ['GET', 'PUT'], previous: null });
      expect(changes[1]).toMatchObject({ resourceSlug: null, access: ['CREATE'] });
      expect(granted.plan.warnings.join(' ')).toContain('also gets GET');
      expect(granted.plan.warnings.join(' ')).toContain('already has full access');

      expect(parseSse((await confirm(owner.token, granted.plan.id)).text).at(-1)!.data.plan.status).toBe('COMPLETED');
      const record: any = await EntityPermissionMongoose.findOne({ _userId: member.id, entitySlug: collection.slug }).lean();
      expect(record.permissions).toEqual({ GET: true, PUT: true, DELETE: false, CREATE: false });
      expect(await EntityPermissionMongoose.countDocuments({ _userId: member.id, entityType: 'pricing', entitySlug: null })).toBe(1);

      const changed = await propose(owner.token, {
        permissions: [
          { organizationId: organization.id, user: member.username, resourceType: 'collection', resource: collection.name, access: ['GET'] },
          { organizationId: organization.id, user: member.username, resourceType: 'pricing', access: [] },
        ],
      });
      expect(changed.plan.steps[0].operation.changes[0]).toMatchObject({ access: ['GET'], previous: ['GET', 'PUT'] });

      expect(parseSse((await confirm(owner.token, changed.plan.id)).text).at(-1)!.data.plan.status).toBe('COMPLETED');
      const after: any = await EntityPermissionMongoose.findOne({ _userId: member.id, entitySlug: collection.slug }).lean();
      expect(after.permissions).toEqual({ GET: true, PUT: false, DELETE: false, CREATE: false });
      expect(await EntityPermissionMongoose.countDocuments({ _userId: member.id, entityType: 'pricing', entitySlug: null })).toBe(0);
    });

    it('reviews who can access a private collection and what a member can do', async () => {
      const { user: owner } = await newUser();
      const { user: reader } = await newUser();
      const { user: outsider } = await newUser();
      const organization = await createTestOrganization(owner.token, { displayName: `Review ${randomSuffix()}` });
      await createMembership(reader.id, organization.id, 'MEMBER');
      await createMembership(outsider.id, organization.id, 'MEMBER');
      const collection = await createTestCollection({ _organizationId: organization.id, private: true, name: `Hidden ${randomSuffix()}` });
      await createEntityScopedPermission(reader.id, organization.id, collection.slug, 'collection', {
        GET: true, PUT: false, DELETE: false, CREATE: false,
      });

      const conversationId = await startConversation(owner.token);
      const llm = installFakeLlm([
        toolCall('who_can_access', { organizationId: organization.id, resourceType: 'collection', resource: collection.name }),
        toolCall('get_member_access', { organizationId: organization.id, user: reader.username }),
        toolCall('list_resources', { organizationId: organization.id, type: 'collection' }),
        answer('Hecho.'),
      ]);
      await sendMessage(owner.token, conversationId, { content: '¿Quién puede ver la colección?' });

      const who = toolResultsIn(llm.calls[1])[0];
      expect(who.resource).toMatchObject({ type: 'collection', private: true });
      expect(who.people.map((person: any) => person.username).sort()).toEqual([owner.username, reader.username].sort());
      expect(who.people.find((person: any) => person.username === reader.username)).toMatchObject({ access: ['GET'] });

      const access = toolResultsIn(llm.calls[2])[1];
      expect(access).toMatchObject({ role: 'MEMBER', permissions: [{ type: 'collection', access: ['GET'] }] });

      const listed = toolResultsIn(llm.calls[3])[2];
      expect(listed.collections.map((item: any) => item.slug)).toContain(collection.slug);

      // A plain member sees only what they may, and cannot review others.
      const memberConversation = await startConversation(outsider.token);
      const memberLlm = installFakeLlm([
        toolCall('list_resources', { organizationId: organization.id }),
        toolCall('who_can_access', { organizationId: organization.id, resourceType: 'collection', resource: collection.slug }),
        answer('Hecho.'),
      ]);
      await sendMessage(outsider.token, memberConversation, { content: '¿Qué hay?' });
      expect(toolResultsIn(memberLlm.calls[1])[0].collections).toEqual([]);
      expect(toolResultsIn(memberLlm.calls[2])[1].error).toMatch(/PERMISSION ERROR/);
    });
  });

  // =========================================================================
  // Pricings and collections
  // =========================================================================
  describe('pricings and collections', () => {
    const template = fs
      .readFileSync(path.resolve(process.cwd(), 'public', 'static', 'pricings', 'templates', 'petclinic.yml'), 'utf8')
      .replace(/\r\n/g, '\n');
    const pricingYaml = (saasName: string, version: string) =>
      template.replace(/^saasName:.*$/m, `saasName: ${saasName}`).replace(/^version:.*$/m, `version: "${version}"`);

    afterEach(async () => {
      const organizationIds = [...orgsToDelete];
      const objectIds = organizationIds.map(id => new mongoose.Types.ObjectId(id));
      await PricingMongoose.deleteMany({ _organizationId: { $in: objectIds } });
      await PricingCollectionMongoose.deleteMany({ _organizationId: { $in: objectIds } });
      await EntityPermissionMongoose.deleteMany({ _organizationId: { $in: objectIds } });
      for (const organizationId of organizationIds) {
        fs.rmSync(path.resolve(process.cwd(), 'public', 'static', 'pricings', 'uploaded', organizationId), { recursive: true, force: true });
      }
    });

    it('searches pricings, reads their versions and compares two of them, hiding private ones from outsiders', async () => {
      const { user: owner } = await newUser();
      const { user: outsider } = await newUser();
      const organization = await createTestOrganization(owner.token, { displayName: `Catalog ${randomSuffix()}` });
      const name = `Orbit_Pricing_${randomSuffix()}`;
      await createPricingForOrganization({ organizationId: organization.id, serviceName: name, version: '1.0.0', isPrivate: true });
      await createPricingForOrganization({ organizationId: organization.id, serviceName: name, version: '2.0.0', isPrivate: true });

      const [search, pricing, diff] = await ask(owner.token, [
        ['search_pricings', { organizationId: organization.id, query: name }],
        ['get_pricing', { organizationId: organization.id, pricing: name }],
        ['compare_pricing_versions', { organizationId: organization.id, pricing: name, from: '1.0.0', to: '2.0.0' }],
      ]);
      expect(search.pricings.map((item: any) => item.name)).toContain(name);
      expect(pricing.versions.map((version: any) => version.version).sort()).toEqual(['1.0.0', '2.0.0']);
      expect(pricing.versions.every((version: any) => version.private)).toBe(true);
      expect(diff).toMatchObject({ pricing: name, unchanged: true });

      const [hidden] = await ask(outsider.token, [['get_pricing', { organizationId: organization.id, pricing: name }]]);
      expect(hidden.error).toMatch(/NOT FOUND/);
    });

    it('publishes a pricing from an attached YAML file, then a new version of it', async () => {
      const { user: owner } = await newUser();
      const organization = await createTestOrganization(owner.token, { displayName: `Publisher ${randomSuffix()}` });
      const name = `Orbit_Published_${randomSuffix()}`;

      const first = await propose(
        owner.token,
        attachmentId => ({ pricingPublications: [{ attachmentId, organizationId: organization.id, private: true }] }),
        { filename: 'pricing.yml', content: pricingYaml(name, '1.0.0') }
      );
      expect(first.plan.steps[0].operation).toMatchObject({ type: 'publish_pricing', pricingName: name, version: '1.0.0', existing: null, private: true });
      expect(await PricingMongoose.countDocuments({ name })).toBe(0);
      expect((await applied(owner.token, first.plan.id)).status).toBe('COMPLETED');
      const stored: any = await PricingMongoose.findOne({ name, _organizationId: organization.id }).lean();
      expect(stored.private).toBe(true);

      const second = await propose(
        owner.token,
        attachmentId => ({ pricingPublications: [{ attachmentId, organizationId: organization.id }] }),
        { filename: 'pricing-v2.yaml', content: pricingYaml(name, '2.0.0') }
      );
      expect(second.plan.steps[0].operation.existing).toEqual({ slug: stored.slug });
      expect((await applied(owner.token, second.plan.id)).status).toBe('COMPLETED');
      expect(await PricingMongoose.countDocuments({ slug: stored.slug, _organizationId: organization.id })).toBe(2);

      const again = await propose(
        owner.token,
        attachmentId => ({ pricingPublications: [{ attachmentId, organizationId: organization.id }] }),
        { filename: 'pricing-v2.yaml', content: pricingYaml(name, '2.0.0') }
      );
      expect(again.plan).toBeNull();
      expect(again.result.errors.join(' ')).toContain('already has a version');
    });

    it('rejects invalid pricing files and members who cannot create pricings', async () => {
      const { user: owner } = await newUser();
      const { user: member } = await newUser();
      const organization = await createTestOrganization(owner.token, { displayName: `Strict ${randomSuffix()}` });
      await createMembership(member.id, organization.id, 'MEMBER');

      const broken = await propose(
        owner.token,
        attachmentId => ({ pricingPublications: [{ attachmentId, organizationId: organization.id }] }),
        { filename: 'broken.yml', content: 'saasName: Broken\nplans: [' }
      );
      expect(broken.result.errors.join(' ')).toContain('is not a valid pricing');

      const denied = await propose(
        member.token,
        attachmentId => ({ pricingPublications: [{ attachmentId, organizationId: organization.id }] }),
        { filename: 'pricing.yml', content: pricingYaml(`Orbit_Denied_${randomSuffix()}`, '1.0.0') }
      );
      expect(denied.result.errors.join(' ')).toContain('cannot create pricings');
    });

    it('changes the visibility of a whole pricing or of one version', async () => {
      const { user: owner } = await newUser();
      const organization = await createTestOrganization(owner.token, { displayName: `Visible ${randomSuffix()}` });
      const name = `Orbit_Visibility_${randomSuffix()}`;
      await createPricingForOrganization({ organizationId: organization.id, serviceName: name, version: '1.0.0' });
      await createPricingForOrganization({ organizationId: organization.id, serviceName: name, version: '2.0.0' });

      const hide = await propose(owner.token, { visibilityChanges: [{ organizationId: organization.id, pricing: name, private: true }] });
      expect((await applied(owner.token, hide.plan.id)).status).toBe('COMPLETED');
      expect(await PricingMongoose.countDocuments({ name, private: true })).toBe(2);

      const show = await propose(owner.token, {
        visibilityChanges: [
          { organizationId: organization.id, pricing: name, version: '2.0.0', private: false },
          { organizationId: organization.id, pricing: name, version: '1.0.0', private: true },
        ],
      });
      expect(show.plan.steps[0].operation.changes).toHaveLength(1);
      expect(show.plan.warnings.join(' ')).toContain('already private');
      expect((await applied(owner.token, show.plan.id)).status).toBe('COMPLETED');
      const latest: any = await PricingMongoose.findOne({ name, version: '2.0.0' }).lean();
      expect(latest.private).toBe(false);
    });

    it('forks a pricing into another organization and refuses a name already taken there', async () => {
      const { user: owner } = await newUser();
      const source = await createTestOrganization(owner.token, { displayName: `Source ${randomSuffix()}` });
      const target = await createTestOrganization(owner.token, { displayName: `Target ${randomSuffix()}` });
      const name = `Orbit_Fork_${randomSuffix()}`;
      await createPricingForOrganization({ organizationId: source.id, serviceName: name, version: '1.0.0' });

      const { plan } = await propose(owner.token, {
        forks: [{ sourceOrganizationId: source.id, pricing: name, targetOrganizationId: target.id }],
      });
      expect(plan.steps[0].operation).toMatchObject({ type: 'fork_pricing', name, source: { version: '1.0.0' } });
      expect((await applied(owner.token, plan.id)).status).toBe('COMPLETED');
      const fork: any = await PricingMongoose.findOne({ name, _organizationId: target.id }).lean();
      expect(String(fork.forkedFrom.organizationId)).toBe(source.id);

      const again = await propose(owner.token, {
        forks: [{ sourceOrganizationId: source.id, pricing: name, targetOrganizationId: target.id }],
      });
      expect(again.result.errors.join(' ')).toContain('give it another name');
    });

    it('creates a collection with pricings and moves pricings in and out of it', async () => {
      const { user: owner } = await newUser();
      const organization = await createTestOrganization(owner.token, { displayName: `Shelves ${randomSuffix()}` });
      const first = `Orbit_First_${randomSuffix()}`;
      const second = `Orbit_Second_${randomSuffix()}`;
      await createPricingForOrganization({ organizationId: organization.id, serviceName: first, version: '1.0.0' });
      await createPricingForOrganization({ organizationId: organization.id, serviceName: second, version: '1.0.0' });
      const collectionName = `Shelf ${randomSuffix()}`;

      const created = await propose(owner.token, {
        newCollections: [{ organizationId: organization.id, name: collectionName, pricings: [first, 'ghost'] }],
      });
      expect(created.plan.steps[0].operation.pricings).toHaveLength(1);
      expect(created.plan.warnings.join(' ')).toContain('"ghost"');
      expect((await applied(owner.token, created.plan.id)).status).toBe('COMPLETED');
      const collection: any = await PricingCollectionMongoose.findOne({ name: collectionName, _organizationId: organization.id }).lean();
      expect(String((await PricingMongoose.findOne({ name: first }).lean() as any)._collectionId)).toBe(collection._id.toString());

      const changed = await propose(owner.token, {
        collectionChanges: [{ organizationId: organization.id, collection: collectionName, add: [second], remove: [first] }],
      });
      expect((await applied(owner.token, changed.plan.id)).status).toBe('COMPLETED');
      expect((await PricingMongoose.findOne({ name: first }).lean() as any)._collectionId ?? null).toBeNull();
      expect(String((await PricingMongoose.findOne({ name: second }).lean() as any)._collectionId)).toBe(collection._id.toString());

      const [read] = await ask(owner.token, [['get_collection', { organizationId: organization.id, collection: collectionName }]]);
      expect(read).toMatchObject({ name: collectionName, pricings: [second] });
    });
  });

  // =========================================================================
  // Account and notifications
  // =========================================================================
  describe('account and notifications', () => {
    afterEach(async () => {
      await NotificationMongoose.deleteMany({ _userId: { $in: [...orbitUserIds].map(id => new mongoose.Types.ObjectId(id)) } });
    });

    const notify = async (userId: string, title: string) =>
      (await NotificationMongoose.create({ _userId: userId, kind: 'System', title, message: `${title} message` })).id as string;

    const settingsOf = async (userId: string) => ((await UserMongoose.findById(userId).lean()) as any).settings;

    it('reads the notifications and marks some or all of them as read, only ever the user\'s own', async () => {
      const { user } = await newUser();
      const { user: other } = await newUser();
      const first = await notify(user.id, 'First');
      await notify(user.id, 'Second');
      await notify(user.id, 'Third');
      const foreign = await notify(other.id, 'Not yours');

      const [read] = await ask(user.token, [['get_notifications', { unreadOnly: true }]]);
      expect(read.unread).toBe(3);
      expect(read.notifications.map((notification: any) => notification.title)).toEqual(['Third', 'Second', 'First']);
      expect(read.notifications[0].kind).toBe('System notices');

      const some = await propose(user.token, { notificationsRead: { ids: [first, foreign, 'not-an-id'] } });
      expect(some.plan.steps[0].operation).toMatchObject({ type: 'mark_notifications_read', all: false, count: 1 });
      expect(some.plan.warnings.join(' ')).toContain('not among yours');
      expect((await applied(user.token, some.plan.id)).status).toBe('COMPLETED');
      expect(((await NotificationMongoose.findById(first).lean()) as any).read).toBe(true);
      expect(((await NotificationMongoose.findById(foreign).lean()) as any).read).toBe(false);

      const all = await propose(user.token, { notificationsRead: { all: true } });
      expect(all.plan.steps[0].description).toBe('Mark all 2 unread notifications as read');
      expect((await applied(user.token, all.plan.id)).status).toBe('COMPLETED');
      expect(await NotificationMongoose.countDocuments({ _userId: user.id, read: false })).toBe(0);

      const nothing = await propose(user.token, { notificationsRead: { all: true } });
      expect(nothing.plan).toBeNull();
      expect(nothing.result.warnings.join(' ')).toContain('no unread notifications');
    });

    it('turns notification channels on and off and rejects kinds that do not exist', async () => {
      const { user } = await newUser();

      const { plan } = await propose(user.token, {
        notificationPreferences: [
          { kind: 'PricingUpdated', email: false },
          { kind: 'System', inbox: true },
        ],
      });
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].operation.changes).toEqual([
        expect.objectContaining({ kind: 'PricingUpdated', from: { email: true, inbox: true }, to: { email: false, inbox: true } }),
      ]);
      expect(plan.warnings.join(' ')).toContain('System notices already reach you');
      expect((await applied(user.token, plan.id)).status).toBe('COMPLETED');
      expect((await settingsOf(user.id)).notificationPrefs.PricingUpdated).toMatchObject({ email: false, inbox: true });

      const [profile] = await ask(user.token, [['get_my_profile', {}]]);
      expect(profile.notificationPreferences).toContainEqual(expect.objectContaining({ kind: 'PricingUpdated', email: false, inbox: true }));

      const wrong = await propose(user.token, { notificationPreferences: [{ kind: 'Spam', email: false }] });
      expect(wrong.result.errors.join(' ')).toContain('is not a kind of notification');
    });

    it('updates the public profile, checking social links as the settings page does', async () => {
      const { user } = await newUser();

      const { plan } = await propose(user.token, {
        profile: { displayName: 'Ana Orbit', bio: 'Pricing nerd', linkedin: 'https://www.linkedin.com/in/ana-orbit' },
      });
      expect(plan.steps[0].description).toBe('Update your public profile: display name, bio, LinkedIn');
      expect((await applied(user.token, plan.id)).status).toBe('COMPLETED');
      let settings = await settingsOf(user.id);
      expect(settings.profile).toMatchObject({ displayName: 'Ana Orbit', bio: 'Pricing nerd' });
      expect(settings.socialLinks.linkedin).toBe('https://www.linkedin.com/in/ana-orbit');

      const cleared = await propose(user.token, { profile: { displayName: 'Ana Orbit', bio: '' } });
      expect(cleared.plan.steps[0].description).toBe('Clear your bio');
      expect(cleared.plan.warnings.join(' ')).toContain('display name is already "Ana Orbit"');
      expect((await applied(user.token, cleared.plan.id)).status).toBe('COMPLETED');
      settings = await settingsOf(user.id);
      expect(settings.profile.bio).toBe('');

      const badLink = await propose(user.token, { profile: { x: 'https://example.com/ana' } });
      expect(badLink.result.errors.join(' ')).toContain('is not a valid X profile link');
      const longBio = await propose(user.token, { profile: { bio: 'a'.repeat(201) } });
      expect(longBio.result.errors.join(' ')).toContain('at most 200 characters');
    });
  });

  // =========================================================================
  // Plans from files
  // =========================================================================
  describe('plans imported from files', () => {
    it('applies the rule the model chose to every row, reuses existing organizations and reports ignored rows', async () => {
      const { user: owner } = await newUser();
      const { user: lead } = await newUser();
      const { user: engineer } = await newUser();
      const holding = await createTestOrganization(owner.token, { displayName: `Holding ${randomSuffix()}` });
      const sales = await createTestOrganization(owner.token, { displayName: 'Ventas', _parentId: holding.id });
      const conversationId = await startConversation(owner.token);
      const csv = [
        'ruta,email,rol',
        `Ventas/Norte,${lead.email},jefe`,
        'Ventas/Sur,,',
        `IT,${engineer.username},empleado`,
        ',ghost@nowhere.test,jefe',
      ].join('\n');

      const llm = installFakeLlm([
        request => {
          const attachmentId = String(request.messages[0].content).match(/attachmentId "([^"]+)"/)![1];
          return toolCall('import_attachment', { attachmentId, parentOrganizationId: holding.id });
        },
        request => {
          expect(request.json).toBe(true);
          expect(String(request.messages[1].content)).toContain('<file_sample>');
          return answer(
            JSON.stringify({
              hasHeader: true,
              structure: 'path',
              pathColumn: 0,
              pathSeparator: '/',
              memberColumn: 1,
              roleColumn: 2,
              roleMapping: { jefe: 'ADMIN', empleado: 'MEMBER' },
              defaultRole: 'MEMBER',
            })
          );
        },
        answer('He interpretado el fichero. Revisa el plan.'),
      ]);

      const response = await sendMessage(owner.token, conversationId, {
        content: 'Importa este equipo dentro de Holding',
        attachment: { filename: 'equipo.csv', content: csv },
      });

      expect(response.status).toBe(201);
      expect(response.body.messages[0].attachment).toMatchObject({ filename: 'equipo.csv' });
      const plan = response.body.plan;
      expect(plan.source).toBe('file');
      expect(plan.ignoredRows).toEqual([{ row: 5, reason: 'No organization is given for ghost@nowhere.test' }]);
      expect(plan.warnings.join(' ')).toMatch(/already exists and will be reused: "Ventas"/);

      const creates = plan.steps.filter((step: any) => step.operation.type === 'create_organization');
      // Level by level from the top: IT sits right under Holding, Norte and Sur under Ventas.
      expect(creates.map((step: any) => [step.operation.displayName, step.operation.parent])).toEqual([
        ['IT', { id: holding.id, label: holding.displayName }],
        ['Norte', { id: sales.id, label: 'Ventas' }],
        ['Sur', { id: sales.id, label: 'Ventas' }],
      ]);
      const memberSteps = plan.steps.filter((step: any) => step.operation.type === 'add_members');
      expect(memberSteps.map((step: any) => step.operation.members.map((member: any) => [member.username, member.role]))).toEqual([
        [[lead.username, 'ADMIN']],
        [[engineer.username, 'MEMBER']],
      ]);
      expect(toolResultsIn(llm.calls[2])[0].interpretation).toMatchObject({ mode: 'rule', usedRows: 3, ignoredRows: 1 });

      const events = parseSse((await confirm(owner.token, plan.id)).text);
      expect(events.at(-1)!.data.plan.status).toBe('COMPLETED');

      const norte: any = await OrganizationMongoose.findOne({ displayName: 'Norte', _parentId: sales.id }).lean();
      const itOrg: any = await OrganizationMongoose.findOne({ displayName: 'IT', _parentId: holding.id }).lean();
      orgsToDelete.add(norte._id.toString());
      orgsToDelete.add(itOrg._id.toString());
      const sur: any = await OrganizationMongoose.findOne({ displayName: 'Sur', _parentId: sales.id }).lean();
      orgsToDelete.add(sur._id.toString());
      expect(itOrg.name).toMatch(/^it-org/);
      expect(await roleOf(lead.id, norte._id.toString())).toBe('ADMIN');
      expect(await roleOf(engineer.id, itOrg._id.toString())).toBe('MEMBER');
    });
  });
});
