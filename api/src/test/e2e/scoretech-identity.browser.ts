import { beforeAll, afterAll, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { expect as browserExpect } from 'playwright/test';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import request from 'supertest';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
if (
  process.env.DATABASE_NAME !== 'sphere_scratch' ||
  process.env.MONGO_PORT !== '27018' ||
  process.env.REDIS_URL !== 'redis://127.0.0.1:6378'
)
  throw Error(
    'Identity browser tests require the isolated sphere_scratch, Mongo 27018 and Redis 6378 environment'
  );
const origin = 'http://localhost:5177';
const run = Date.now();
const clientId = 'e2e-sphere-' + run;
const email = `identity_e2e_${run}@example.com`;
const identityRoot = new URL('../../../../../SCORETech-identity/', import.meta.url).pathname;
const screenshots = 'test-results/scoretech-identity';
const spaceClientId = 'fixture-space-' + run;
const spaceSecret = 'fixture-space-secret-' + run;
const spaceCallback = origin + '/fixture-space/callback';
const oidcSigning = generateKeyPairSync('rsa', { modulusLength: 2048 });
Object.assign(process.env, {
  AUTH_PROVIDER: 'local',
  FRONTEND_URL: origin,
  SERVER_PORT: '0',
  SCORETECH_IDENTITY_ISSUER: 'http://localhost:18000/identity/auth/realms/score',
  SCORETECH_IDENTITY_CLIENT_ID: clientId,
  SCORETECH_IDENTITY_CLIENT_SECRET: 'fixture-sphere-only-' + run,
  OAUTH_ISSUER_URL: origin,
  OIDC_SPACE_CLIENT_ID: spaceClientId,
  OIDC_SPACE_CLIENT_SECRET: spaceSecret,
  OIDC_SPACE_REDIRECT_URI: spaceCallback,
  OIDC_SIGNING_PRIVATE_KEY: oidcSigning.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
});
delete process.env.SCORETECH_IDENTITY_TRANSPORT_URL;
delete process.env.SCORETECH_IDENTITY_CALLBACK_URL;
const { default: testContainer } = await import('../utils/config/testContainer');
const { createAndLoginUser } = await import('../utils/users/userTestUtils');
const { shutdownApp } = await import('../utils/testApp');
const { TEST_PASSWORD } = await import('../utils/config/variables');
const { default: services } = await import('../../main/config/container');
const { default: User } = await import('../../main/repositories/mongoose/models/UserMongoose');
const { verifyJwtToken } = await import('../../main/utils/users/helpers');
const app = testContainer.resolve('app');
const apiOrigin = `http://127.0.0.1:${((app as Server).address() as AddressInfo).port}`;
let browser: Browser;
let vite: ChildProcess;
let page: Page;
let originalId: string;
let legacyToken: string;
function fixture(action: 'create' | 'delete') {
  const code = `const base='http://keycloak:8080/identity/auth';const login=await fetch(base+'/realms/master/protocol/openid-connect/token',{method:'POST',body:new URLSearchParams({grant_type:'password',client_id:'admin-cli',username:'fixture-admin',password:'fixture-local-only'})});if(!login.ok)throw Error('Fixture login failed');const {access_token}=await login.json();const headers={Authorization:'Bearer '+access_token,'Content-Type':'application/json'};const url=base+'/admin/realms/score';const email=${JSON.stringify(email)};const clientId=${JSON.stringify(clientId)};const call=async(path,method='GET',body)=>{const r=await fetch(url+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw Error('Fixture operation '+r.status);return r.status===204?null:r.json();};if(${JSON.stringify(action)}==='create'){let r=await fetch(url+'/clients',{method:'POST',headers,body:JSON.stringify({clientId,enabled:true,protocol:'openid-connect',publicClient:false,secret:${JSON.stringify('fixture-sphere-only-' + run)},standardFlowEnabled:true,directAccessGrantsEnabled:false,redirectUris:[${JSON.stringify(origin + '/api/v1/auth/identity/callback')}],webOrigins:[${JSON.stringify(origin)}],defaultClientScopes:['profile','email','roles','basic'],fullScopeAllowed:false,protocolMappers:[{name:'score-application-subject',protocol:'openid-connect',protocolMapper:'oidc-sub-mapper',config:{'access.token.claim':'true','introspection.token.claim':'true'}}],attributes:{'pkce.code.challenge.method':'S256'}})});if(r.status!==201)throw Error('Fixture client creation '+r.status);r=await fetch(url+'/users',{method:'POST',headers,body:JSON.stringify({username:email,email,emailVerified:true,firstName:'John',lastName:'Doe',enabled:true})});if(r.status!==201)throw Error('Fixture user creation '+r.status);}else{for(const user of await call('/users?email='+encodeURIComponent(email)+'&exact=true')){if(user.email!==email)throw Error('Unsafe fixture cleanup');await call('/users/'+user.id,'DELETE');}for(const client of await call('/clients?clientId='+encodeURIComponent(clientId))){if(client.clientId!==clientId)throw Error('Unsafe client cleanup');await call('/clients/'+client.id,'DELETE');}}`;
  execFileSync(
    'docker',
    [
      'compose',
      '--project-directory',
      identityRoot,
      '-f',
      identityRoot + 'deploy/local/compose.yaml',
      'exec',
      '-T',
      'account-api',
      'node',
      '--input-type=module',
      '-e',
      code,
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] }
  );
}
beforeAll(async () => {
  fixture('create');
  const result = await createAndLoginUser('USER', 'identity_e2e_' + run);
  originalId = result.user.id;
  legacyToken = result.user.token;
  vite = spawn(
    process.execPath,
    [
      '../frontend/node_modules/vite/bin/vite.js',
      '--host',
      'localhost',
      '--port',
      '5177',
      '--strictPort',
    ],
    {
      cwd: '../frontend',
      env: {
        ...process.env,
        VITE_API_URL: '/api/v1',
        VITE_API_PROXY_TARGET: apiOrigin,
        VITE_SECRET_KEY: 'sphere-identity-e2e-only',
      },
      stdio: 'pipe',
    }
  );
  let output = '';
  vite.stdout?.on('data', data => {
    output += data;
  });
  vite.stderr?.on('data', data => {
    output += data;
  });
  for (let attempt = 0; attempt < 120; attempt++) {
    if (vite.exitCode !== null) throw Error(output);
    try {
      if ((await fetch(origin)).ok) break;
    } catch {
      /* Startup. */
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  browser = await chromium.launch({
    headless: true,
    ...(process.env.SPHERE_E2E_BROWSER_CHANNEL
      ? { channel: process.env.SPHERE_E2E_BROWSER_CHANNEL }
      : {}),
  });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await mkdir(screenshots, { recursive: true });
}, 90000);
afterAll(async () => {
  process.env.AUTH_PROVIDER = 'local';
  await browser?.close();
  if (vite && vite.exitCode === null) {
    const done = once(vite, 'exit');
    vite.kill();
    await done;
  }
  fixture('delete');
  await shutdownApp();
});
it('preserves a linked SPHERE account, switches login/registration to native Identity and adapts Settings', async () => {
  try {
    await page.goto(origin + '/authentication');
    await page.getByLabel('Username or Email', { exact: true }).fill('identity_e2e_' + run);
    await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL(origin + '/');
    await page.goto(origin + '/me/settings');
    await browserExpect(
      page.getByRole('heading', { name: 'Account Details', exact: true })
    ).toBeVisible();
    await browserExpect(
      page.getByRole('button', { name: 'Sign-in & Security', exact: true })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Connect SCORETech Identity', exact: true }).click();
    await page.locator('#email').fill(email);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    let code: string | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      const data = (await fetch('http://localhost:18025/api/v1/messages').then(r =>
        r.json()
      )) as any;
      const message = data.messages?.find((m: any) => m.To.some((to: any) => to.Address === email));
      if (message) {
        const detail = (await fetch('http://localhost:18025/api/v1/message/' + message.ID).then(r =>
          r.json()
        )) as any;
        code = detail.Text?.match(/\b[0-9]{6}\b/)?.[0];
        if (code) break;
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!code) throw Error('No fixture email code');
    await page.locator('#code').fill(code);
    await page.waitForURL(origin + '/me/settings?identity_linked=scoretech');
    const linked = await User.findById(originalId);
    expect(linked?.identities.find(value => value.provider === 'scoretech')).toBeTruthy();
    const beforeCount = await User.countDocuments({ email });
    process.env.AUTH_PROVIDER = 'scoretech';
    await page.goto(origin + '/authentication');
    await page.waitForURL(origin + '/');
    const token = await page.evaluate(async () => {
      const r = await fetch('/api/v1/auth/identity/session', { method: 'POST' });
      return ((await r.json()) as { token: string }).token;
    });
    expect(verifyJwtToken(token).id).toBe(originalId);
    expect(await User.countDocuments({ email })).toBe(beforeCount);
    // A downstream app still trusts SPHERE. Give a new browser only the native
    // Identity cookies, so the complete SPHERE -> Identity -> consent chain runs.
    const downstream = await browser.newContext();
    try {
      await downstream.addCookies((await page.context().cookies()).filter(cookie =>
        cookie.path.startsWith('/identity/auth/')));
      const consumer = await downstream.newPage();
      await consumer.route(spaceCallback + '?*', route => route.fulfill({ status: 200, body: 'SPACE callback fixture' }));
      let centralAuthorizations = 0;
      consumer.on('request', incoming => {
        if (incoming.url().startsWith('http://localhost:18000/identity/auth/realms/score/protocol/openid-connect/auth?')) centralAuthorizations++;
      });
      const verifier = randomBytes(32).toString('base64url');
      const state = randomBytes(24).toString('hex');
      const nonce = randomBytes(24).toString('hex');
      const parameters = new URLSearchParams({ client_id: spaceClientId, redirect_uri: spaceCallback,
        response_type: 'code', scope: 'openid profile email', state, nonce,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
      await consumer.goto(origin + '/api/v1/oidc/authorize?' + parameters);
      await browserExpect(consumer.getByRole('heading', { name: 'Continue to SPACE', exact: true })).toBeVisible({ timeout: 30000 });
      await browserExpect(consumer.getByRole('button', { name: 'Continue to SPACE', exact: true })).toBeVisible();
      expect(centralAuthorizations).toBeGreaterThan(0);
      await consumer.getByRole('button', { name: 'Continue to SPACE', exact: true }).click();
      await consumer.waitForURL(spaceCallback + '?**');
      const returned = new URL(consumer.url());
      expect(returned.searchParams.get('state')).toBe(state);
      const exchanged = await request(app).post('/api/v1/oidc/token').type('form').send({
        grant_type: 'authorization_code', client_id: spaceClientId, client_secret: spaceSecret,
        redirect_uri: spaceCallback, code_verifier: verifier, code: returned.searchParams.get('code'),
      }).expect(200);
      const claims = jwt.verify(exchanged.body.id_token, oidcSigning.publicKey,
        { algorithms: ['RS256'], issuer: origin, audience: spaceClientId }) as jwt.JwtPayload;
      expect(claims.sub).toBe(originalId);
      expect(claims.nonce).toBe(nonce);
      const info = await request(app).get('/api/v1/oidc/userinfo')
        .set('Authorization', 'Bearer ' + exchanged.body.access_token).expect(200);
      expect(info.body.sub).toBe(originalId);
    } catch (error) {
      for (const consumer of downstream.pages()) {
        const location = new URL(consumer.url());
        console.error('Downstream OIDC flow:', location.origin + location.pathname, (await consumer.locator('body').innerText()).slice(0, 1800));
        await consumer.screenshot({ path: screenshots + '/downstream-failure.png', fullPage: true });
      }
      throw error;
    } finally {
      await downstream.close();
    }
    await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', 'Bearer ' + legacyToken)
      .expect(401);
    await page.goto(origin + '/me/settings?section=profile');
    await browserExpect(
      page.getByRole('heading', { name: 'Your SCORETech account', exact: true })
    ).toBeVisible();
    for (const name of ['Public Profile', 'Social Links', 'Sign-in & Security'])
      await browserExpect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    for (const name of [
      'Connected applications',
      'Notifications',
      'Payments',
      'Beta features',
      'Danger Zone',
    ])
      await browserExpect(
        page.locator('aside nav').getByRole('button', { name, exact: true })
      ).toBeVisible();
    const profile = page.getByRole('link', { name: /Open my SCORETech profile/ });
    await browserExpect(profile).toHaveAttribute('target', '_blank');
    await browserExpect(profile).toHaveAttribute('rel', 'noopener noreferrer');
    const opened = page.waitForEvent('popup');
    await profile.click();
    const popup = await opened;
    await popup.waitForURL('http://localhost:18000/identity/account/#public-profile');
    await popup.close();
    await page.evaluate('scrollTo(0, 0)');
    await page.waitForFunction("Array.from(document.querySelectorAll('[style*=\"opacity\"]')).every(element => getComputedStyle(element).opacity === '1')");
    await page.screenshot({ path: screenshots + '/identity-account.png', fullPage: true });
    await request(app)
      .put('/api/v1/users/me/settings/profile')
      .set('Authorization', 'Bearer ' + token)
      .send({ bio: 'Local override' })
      .expect(409);
    const sessionId = verifyJwtToken(token).identitySessionId!;
    const cache = services.resolve('cacheService');
    const key = 'sso:scoretech:session:' + sessionId;
    const session = await cache.get(key);
    session.accessExpiresAt = 0;
    await cache.replacePrivate(key, session, 3600);
    await page.goto(origin + '/me/settings?section=notifications');
    await browserExpect(
      page.getByRole('heading', { name: 'Notifications', exact: true })
    ).toBeVisible();
    expect((await cache.get(key)).accessExpiresAt).toBeGreaterThan(Date.now());
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(origin + '/me/settings');
    await browserExpect(
      page.getByRole('heading', { name: 'Your SCORETech account', exact: true })
    ).toBeVisible();
    await page.evaluate("document.documentElement.classList.add('dark'); scrollTo(0, 0)");
    await page.waitForFunction("Array.from(document.querySelectorAll('[style*=\"opacity\"]')).every(element => getComputedStyle(element).opacity === '1')");
    await page.screenshot({ path: screenshots + '/identity-account-mobile.png', fullPage: true });
    expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
    const anonymous = await browser.newContext();
    const register = await anonymous.newPage();
    await register.goto(origin + '/authentication?view=register');
    await register.waitForURL(/localhost:18000.*\/registrations/);
    await browserExpect(register.getByLabel('Username or Email', { exact: true })).toHaveCount(0);
    await anonymous.close();
    await page.evaluate(async () => {
      await fetch('/api/v1/auth/identity/logout', { method: 'POST' });
    });
    await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', 'Bearer ' + token)
      .expect(401);
    process.env.AUTH_PROVIDER = 'local';
    await page.goto(origin + '/authentication');
    await browserExpect(page.getByLabel('Username or Email', { exact: true })).toBeVisible();
    expect((await User.findById(originalId))?.role).toBe('USER');
  } catch (error) {
    await page.screenshot({ path: screenshots + '/failure.png', fullPage: true });
    throw error;
  }
}, 120000);
