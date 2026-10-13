import dotenv from 'dotenv';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { shutdownApp, TestApp } from './utils/testApp';
import { BASE_PATH } from './utils/config/variables';
import testContainer from './utils/config/testContainer';
import { createAndLoginUser, deleteTestUser } from './utils/users/userTestUtils';
import { cleanupOrganization, createMembership, createTestOrganization } from './utils/organizations/organizationTestUtils';
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
import { ORBIT_PLAN_LIMITS } from '../main/services/orbit/OrbitPlanService';

dotenv.config();

describe('ORBIT assistant API integration', () => {
  let app: TestApp;
  const usersToDelete: Set<string> = testContainer.resolve('usersToDelete');
  const orgsToDelete: Set<string> = testContainer.resolve('orgsToDelete');
  const orbitUserIds = new Set<string>();

  beforeAll(async () => {
    app = testContainer.resolve('app');
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
