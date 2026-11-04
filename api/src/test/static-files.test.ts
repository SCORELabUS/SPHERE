/**
 * Integration tests for the files served under /static.
 *
 * Pricing YAML files live under public/static and used to be served to anyone
 * who knew their path. A version's file must only be served to callers who may
 * see that version; public versions, avatars and the seeded datasets keep
 * being served exactly as before.
 */

import dotenv from 'dotenv';
import { promises as fs } from 'fs';
import http, { IncomingHttpHeaders, Server } from 'http';
import { AddressInfo } from 'net';
import path from 'path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { shutdownApp, TestApp } from './utils/testApp';
import testContainer from './utils/config/testContainer';
import { BASE_PATH } from './utils/config/variables';
import { createAndLoginUser, createTestUser, deleteTestUser } from './utils/users/userTestUtils';
import { createPricingForOrganization, createValidPricingYaml } from './utils/pricings/pricingTestUtils';
import { createMembership } from './utils/organizations';
import { createEntityScopedPermission } from './utils/organizations/organizationTestUtils';
import { LeanUser } from '../main/types/models/User';
import PricingMongoose from '../main/repositories/mongoose/models/PricingMongoose';

dotenv.config();

describe('Static files', { timeout: 20000 }, () => {
  let app: TestApp;
  const adminUser: LeanUser = testContainer.resolve('adminUser');
  const usersToDelete: Set<string> = testContainer.resolve('usersToDelete');
  const pricingsToDelete: Set<string> = testContainer.resolve('pricingsToDelete');
  const generatedFilesToDelete: Set<string> = testContainer.resolve('generatedFilesToDelete');

  beforeAll(async () => {
    app = testContainer.resolve('app');
  });

  afterEach(async () => {
    for (const username of usersToDelete) {
      await deleteTestUser(username);
    }
    usersToDelete.clear();

    for (const pricingId of pricingsToDelete) {
      await PricingMongoose.deleteOne({ _id: pricingId });
    }
    pricingsToDelete.clear();

    for (const filePath of generatedFilesToDelete) {
      await fs.rm(filePath, { force: true });
    }
    generatedFilesToDelete.clear();
  });

  afterAll(async () => {
    await shutdownApp();
  });

  /** The URL path a version's YAML is published under, e.g. `/static/pricings/uploaded/...`. */
  const staticPathOf = async (pricingVersionId: string) => {
    const doc = await PricingMongoose.findById(pricingVersionId).lean();
    return '/' + doc!.yaml.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
  };

  /**
   * Sends `rawPath` to the server byte for byte. supertest/superagent resolve
   * `.` and `..` segments and encoded dots before sending, so they cannot
   * exercise how the server handles non-canonical paths.
   */
  const rawRequest = (
    rawPath: string,
    options: { method?: string; headers?: Record<string, string> } = {}
  ) =>
    new Promise<{ status: number; headers: IncomingHttpHeaders; text: string }>((resolve, reject) => {
      const { port } = (app as unknown as Server).address() as AddressInfo;
      const req = http.request(
        { host: '127.0.0.1', port, path: rawPath, method: options.method ?? 'GET', headers: options.headers },
        res => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', chunk => (text += chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text }));
        }
      );
      req.on('error', reject);
      req.end();
    });

  /**
   * A file the caller may not read must be indistinguishable from a file that
   * does not exist: same status, and never the YAML content.
   */
  const expectHidden = async (response: { status: number; text?: string }, label?: string) => {
    const missing = await rawRequest('/static/pricings/uploaded/does-not-exist.yml');
    expect(missing.status, 'status of a missing file').not.toBe(200);
    expect(response.status, label).toBe(missing.status);
    expect(response.text ?? '', label).not.toContain('saasName');
  };

  const createVersion = async (organizationId: string, isPrivate: boolean) => {
    const { id, serviceName } = await createPricingForOrganization({ organizationId, isPrivate });
    const doc = await PricingMongoose.findById(id).lean();
    return { id, serviceName, slug: doc!.slug as string, url: await staticPathOf(id) };
  };

  describe('GET /static/pricings/** (pricing YAML)', () => {
    it('Return 200 and the YAML of a public version without authentication.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { url, serviceName } = await createVersion(organizationId, false);

      const response = await request(app).get(url);

      expect(response.status).toBe(200);
      expect(response.text).toContain(`saasName: ${serviceName}`);
    });

    it('Hide the YAML of a private version without authentication.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { url } = await createVersion(organizationId, true);

      await expectHidden(await request(app).get(url));
    });

    it('Hide the YAML of a private version requested with a non-canonical raw path.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { url } = await createVersion(organizationId, true);
      const segments = url.split('/');
      const last = segments.pop()!;
      const variants = [
        // `..` segments that stay inside the static root (send resolves them).
        url.replace('/static/pricings/', '/static/pricings/../pricings/'),
        url.replace('/static/', '/static/x/../'),
        url.replace('/static/', '/static/../static/'),
        [...segments, '..', segments[segments.length - 1], last].join('/'),
        // The same with encoded dots and slashes.
        url.replace('/static/', '/static/x/%2e%2e/'),
        url.replace('/static/', '/static/x/%2E%2E/'),
        url.replace('/static/pricings/', '/static/pricings%2f..%2fpricings/'),
        url.replace('/static/pricings/uploaded/', '/static/pricings%2Fuploaded/'),
        // `.` segments, empty segments and encoded letters or dots.
        url.replace('/static/', '/static/./'),
        url.replace('/static/', '/static/%2e/'),
        url.replace('/static/', '/static//'),
        url.replace('/static/pricings/', '/static/%70ricings/'),
        [...segments, last.replace('.', '%2E')].join('/'),
        // Escaping the root, NUL bytes, backslashes and query strings.
        '/..' + url,
        url + '%00',
        url.replace('/static/pricings/', '/static/pricings/..%5cpricings/'),
        url + '?download=1',
      ];

      const missing = await rawRequest('/static/pricings/uploaded/does-not-exist.yml');
      const leaked = [];
      for (const variant of variants) {
        const response = await rawRequest(variant);
        if (response.status !== missing.status || response.text.includes('saasName')) {
          leaked.push(`${response.status} ${variant}`);
        }
      }
      // Every variant must be answered exactly like a missing file.
      expect(leaked).toEqual([]);
    });

    it('Serve a public file requested with a non-canonical raw path, as before.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { url, serviceName } = await createVersion(organizationId, false);

      for (const variant of [
        url.replace('/static/pricings/', '/static/pricings/../pricings/'),
        url.replace('/static/', '/static/x/%2e%2e/'),
        '/static/pricings/templates/../templates/petclinic.yml',
      ]) {
        const response = await rawRequest(variant);
        expect(response.status, variant).toBe(200);
        expect(response.text, variant).toContain('saasName');
      }
      expect((await rawRequest(url.replace('/static/', '/static/./'))).text).toContain(`saasName: ${serviceName}`);
    });

    it('Serve a private version requested with a non-canonical raw path only to an authorized caller.', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { url, serviceName } = await createVersion(organizationId, true);
      const variant = url.replace('/static/pricings/', '/static/pricings/../pricings/');

      await expectHidden(await rawRequest(variant), variant);

      const response = await rawRequest(variant, { headers: { Authorization: `Bearer ${owner.token}` } });
      expect(response.status).toBe(200);
      expect(response.text).toContain(`saasName: ${serviceName}`);
      expect(response.headers['cache-control']).toBe('private, no-store');
    });

    it('Hide the YAML of a private version requested with HEAD.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { url } = await createVersion(organizationId, true);
      const missing = await rawRequest('/static/pricings/uploaded/does-not-exist.yml', { method: 'HEAD' });

      for (const variant of [url, url.replace('/static/pricings/', '/static/pricings/../pricings/')]) {
        const response = await rawRequest(variant, { method: 'HEAD' });
        expect(response.status, variant).toBe(missing.status);
        expect(response.headers['content-type'], variant).toBe(missing.headers['content-type']);
      }
    });

    it('Hide the YAML of a private version from a user outside its organization.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { user: outsider } = await createAndLoginUser('USER');
      const { url } = await createVersion(organizationId, true);

      await expectHidden(await request(app).get(url).set('Authorization', `Bearer ${outsider.token}`));
    });

    it('Hide the YAML of a private version from a MEMBER without GET permission on the pricing.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');
      const { url } = await createVersion(organizationId, true);

      await expectHidden(await request(app).get(url).set('Authorization', `Bearer ${member.token}`));
    });

    it('Return 200 and the YAML of a private version to the OWNER of its organization.', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { url, serviceName } = await createVersion(organizationId, true);

      const response = await request(app).get(url).set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      expect(response.text).toContain(`saasName: ${serviceName}`);
      expect(response.headers['cache-control']).toBe('private, no-store');
    });

    it('Return 200 and the YAML of a private version to a MEMBER with GET permission on the pricing.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');
      const { url, slug } = await createVersion(organizationId, true);
      await createEntityScopedPermission(member.id, organizationId, slug, 'pricing', {
        GET: true, PUT: false, DELETE: false, CREATE: false,
      });

      const response = await request(app).get(url).set('Authorization', `Bearer ${member.token}`);

      expect(response.status).toBe(200);
    });

    it('Return 200 and the YAML of a private version to a global ADMIN.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { url } = await createVersion(organizationId, true);

      const response = await request(app).get(url).set('Authorization', `Bearer ${adminUser.token}`);

      expect(response.status).toBe(200);
    });

    it('Serve the YAML of a private version to API keys under the same scope rules as the rest of the API.', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { organizationId: otherOrganizationId } = await createTestUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');
      const { url, slug } = await createVersion(organizationId, true);
      await createEntityScopedPermission(member.id, organizationId, slug, 'pricing', {
        GET: true, PUT: false, DELETE: false, CREATE: false,
      });

      const createKey = async (user: any, scopeOrganizationId: string, scope: 'ALL' | 'MANAGEMENT' | 'VIEW') => {
        const response = await request(app)
          .post(`${BASE_PATH}/users/${user.username}/api-keys`)
          .set('Authorization', `Bearer ${user.token}`)
          .send({ name: 'static', scopes: [{ organizationId: scopeOrganizationId, scope }] });
        expect(response.status).toBe(201);
        return response.body.plainKey as string;
      };

      // The OWNER's ALL key keeps the OWNER role.
      const ownerKey = await createKey(owner, organizationId, 'ALL');
      const allowed = await request(app).get(url).set('x-api-key', ownerKey);
      expect(allowed.status).toBe(200);
      expect(allowed.headers['cache-control']).toBe('private, no-store');

      // A VIEW key reads as MEMBER: enough when the user holds GET on the pricing.
      const memberKey = await createKey(member, organizationId, 'VIEW');
      expect((await request(app).get(url).set('x-api-key', memberKey)).status).toBe(200);

      // A key scoped to another organization is never enough.
      const otherKey = await createKey(owner, otherOrganizationId, 'ALL');
      await expectHidden(await request(app).get(url).set('x-api-key', otherKey));
    });

    it('Hide the YAML of a version made private after publication, and serve it again once made public.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { id, url } = await createVersion(organizationId, false);

      expect((await request(app).get(url)).status).toBe(200);

      await PricingMongoose.updateOne({ _id: id }, { $set: { private: true } });
      await expectHidden(await request(app).get(url));

      await PricingMongoose.updateOne({ _id: id }, { $set: { private: false } });
      expect((await request(app).get(url)).status).toBe(200);
    });

    it('Hide an uploaded YAML that no pricing version references.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { id } = await createVersion(organizationId, false);
      const doc = await PricingMongoose.findById(id).lean();
      const orphan = path.resolve(process.env.SERVER_STATICS_FOLDER || 'public/', path.dirname(doc!.yaml), 'orphan-draft.yml');
      const fixture = await createValidPricingYaml();
      await fs.copyFile(fixture.filePath, orphan);
      generatedFilesToDelete.add(orphan);

      await expectHidden(await request(app).get('/' + path.posix.join(path.dirname(doc!.yaml), 'orphan-draft.yml')));
    });

    it('Hide a private version next to a public version of another pricing.', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const publicVersion = await createVersion(organizationId, false);
      const privateVersion = await createVersion(organizationId, true);

      expect((await request(app).get(publicVersion.url)).status).toBe(200);
      await expectHidden(await request(app).get(privateVersion.url));
      expect(
        (await request(app).get(privateVersion.url).set('Authorization', `Bearer ${owner.token}`)).status
      ).toBe(200);
    });

    it('Return 200 for a public file of the seeded datasets and the PetClinic template.', async () => {
      const response = await request(app).get('/static/pricings/templates/petclinic.yml');

      expect(response.status).toBe(200);
      expect(response.text).toContain('saasName');
    });
  });

  describe('GET /static/** (other files)', () => {
    it('Return 200 for the predefined avatars without authentication.', async () => {
      const response = await request(app).get('/static/avatars/users/default-avatar.png');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('image/png');
    });

    it('Hide a copy of a private YAML in the shared upload folder that no version references.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { id } = await createVersion(organizationId, true);
      const doc = await PricingMongoose.findById(id).lean();
      const draft = path.resolve(process.cwd(), 'public', 'static', 'pricings', 'uploaded', `draft-${id}.yml`);
      await fs.copyFile(path.resolve(process.env.SERVER_STATICS_FOLDER || 'public/', doc!.yaml), draft);
      generatedFilesToDelete.add(draft);

      await expectHidden(await request(app).get(`/static/pricings/uploaded/draft-${id}.yml`));
    });
  });
});
