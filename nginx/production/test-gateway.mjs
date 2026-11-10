// Isolated Docker regression: no real users, credentials, SMTP or GitHub calls.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import https from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const identity = process.env.SCORETECH_IDENTITY_REPOSITORY || path.resolve(here, '../../../SCORETech-identity');
const temporary = mkdtempSync(path.join(tmpdir(), 'sphere-gateway-test-'));
const project = `sphere-gateway-test-${process.pid}`;
const file = path.join(temporary, 'compose.json');
const run = (args, options = {}) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
const compose = (...args) => run(['compose', '-p', project, '-f', file, ...args]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let port;

function request(uri, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get({ hostname: '127.0.0.1', port, path: uri, rejectUnauthorized: false,
      headers: { Host: 'sphere.score.us.es', ...headers } }, (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
    }).on('error', reject);
  });
}

try {
  mkdirSync(path.join(temporary, 'ssl'));
  mkdirSync(path.join(temporary, 'web'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=sphere.score.us.es', '-keyout', path.join(temporary, 'ssl/privkey.pem'),
    '-out', path.join(temporary, 'ssl/fullchain.pem')], { stdio: 'ignore' });
  writeFileSync(path.join(temporary, 'web/account.js'), 'window.__GATEWAY_TEST__="account";');
  writeFileSync(path.join(temporary, 'web/admin.js'), 'window.__GATEWAY_TEST__="admin";');
  // Use the installed lab tooling image for Node without building either application.
  writeFileSync(path.join(temporary, 'stub.mjs'), `import http from 'node:http';
for (const port of [8080, 5173, 8086, 8081]) http.createServer((req,res)=>{
res.setHeader('content-type','application/json');
res.end(JSON.stringify({port,uri:req.url,headers:req.headers}));
}).listen(port,'0.0.0.0');\n`);
  const model = {
    services: {
      stub: { image: process.env.SCORETECH_GATEWAY_TEST_NODE_IMAGE || 'node:24.14.0-bookworm-slim',
        command: ['node', '/stub.mjs'], volumes: [`${temporary}/stub.mjs:/stub.mjs:ro`],
        networks: { default: { aliases: ['server', 'client', 'harvey', 'mongo-express', 'account-api', 'admin-api', 'keycloak'] } } },
      identity: { image: 'nginx:1.28.0-alpine',
        volumes: [`${identity}/deploy/production/nginx.conf:/etc/nginx/conf.d/default.conf:ro`, `${temporary}/web:/runtime/web:ro`],
        networks: { default: { aliases: ['scoretech-identity-gateway'] } }, depends_on: ['stub'] },
      gateway: { build: { context: here }, image: `${project}:test`,
        environment: { AUTH_PROVIDER: 'local', SCORETECH_IDENTITY_PREVIEW: 'false', SCORETECH_IDENTITY_UPSTREAM: 'scoretech-identity-gateway:8080' },
        ports: ['127.0.0.1::443'], volumes: [`${temporary}/ssl:/etc/nginx/ssl:ro`], depends_on: ['stub', 'identity'] }
    }
  };
  const save = () => writeFileSync(file, JSON.stringify(model));
  save();
  compose('up', '-d', '--build');
  async function ready() {
    port = Number(compose('port', 'gateway', '443').trim().split(':').at(-1));
    let last;
    for (let attempt = 0; attempt < 40; attempt++) {
      try { const res = await request('/'); if (res.status === 200) return; last = res.status; } catch (error) { last = error.message; }
      await sleep(250);
    }
    throw Error(`Gateway not ready: ${last}`);
  }
  await ready();
  assert.equal(JSON.parse((await request('/identity/account/')).body).port, 5173);
  assert.equal(JSON.parse((await request('/api/v1/users/auth/sso/us/callback?ticket=local')).body).port, 8080);
  console.log('PASS local mode retains original handlers');

  model.services.gateway.environment.SCORETECH_IDENTITY_PREVIEW = 'true';
  save(); compose('up', '-d', 'gateway'); await ready();
  assert.equal((await request('/identity')).headers.location, '/identity/account/');
  assert.equal(JSON.parse((await request('/api/v1/users/auth/sso/us/callback?ticket=preview')).body).port, 8080);
  console.log('PASS preview enables setup without handing over the US callback');

  model.services.gateway.environment.AUTH_PROVIDER = 'scoretech';
  model.services.gateway.environment.SCORETECH_IDENTITY_PREVIEW = 'false';
  save(); compose('up', '-d', 'gateway'); await ready();
  for (const uri of ['/identity', '/identity/', '/identity/account', '/identity/admin']) {
    const result = await request(uri);
    assert.ok([302, 308].includes(result.status));
    assert.match(result.headers.location, /^\/identity\/(account|admin)\/$/);
  }
  for (const app of ['account', 'admin']) {
    assert.equal((await request(`/identity/${app}/config.js`)).body, `window.__GATEWAY_TEST__="${app}";`);
  }
  const broker = await request('/identity/auth/realms/score/broker/google/endpoint?state=a%2Bb&code=test', { 'X-Forwarded-For': '203.0.113.77', 'X-Forwarded-Proto': 'http' });
  assert.equal(broker.status, 200);
  const forwarded = JSON.parse(broker.body);
  assert.equal(forwarded.uri, '/identity/auth/realms/score/broker/google/endpoint?state=a%2Bb&code=test');
  assert.equal(forwarded.headers.host, 'sphere.score.us.es');
  assert.equal(forwarded.headers['x-forwarded-proto'], 'https');
  assert.equal(forwarded.headers['x-forwarded-port'], '443');
  assert.ok(forwarded.headers['x-forwarded-for']);
  assert.ok(!forwarded.headers['x-forwarded-for'].includes('203.0.113.77'));
  const us = await request('/api/v1/users/auth/sso/us/callback?state=a%2Bb&ticket=ST-test');
  assert.equal(us.status, 302);
  assert.equal(us.headers.location, '/identity/auth/realms/score/broker/us-sso/endpoint?state=a%2Bb&ticket=ST-test');
  assert.equal(us.headers['cache-control'], 'no-store');
  const oidc = await request('/api/v1/auth/identity/callback?state=sphere&code=test');
  assert.equal(JSON.parse(oidc.body).uri, '/api/v1/auth/identity/callback?state=sphere&code=test');
  const api = JSON.parse((await request('/identity/api/account/v1/account?test=1')).body);
  assert.equal(api.uri, '/v1/account?test=1');
  for (const suffix of ['account', 'account/credentials', 'score-identities', 'score-applications', 'tentu-user-mutations']) {
    assert.equal((await request(`/identity/auth/realms/score/${suffix}`)).status, 404);
  }
  assert.equal((await request('/identity/auth/admin/')).status, 404);
  console.log('PASS callback ownership, query encoding, forwarding and private route boundaries');

  compose('up', '-d', '--force-recreate', 'identity');
  let recovered = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if ((await request('/identity')).status === 302) { recovered = true; break; }
    await sleep(250);
  }
  assert.ok(recovered, 'Docker DNS recovers after Identity container replacement');
  for (const [key, value] of [['AUTH_PROVIDER', 'invalid'], ['SCORETECH_IDENTITY_PREVIEW', 'invalid'], ['SCORETECH_IDENTITY_UPSTREAM', 'bad;return 200;'], ['SCORETECH_IDENTITY_UPSTREAM', 'gateway:99999']]) {
    assert.throws(() => compose('run', '--rm', '--no-deps', '-e', `${key}=${value}`, 'gateway', 'nginx', '-t'));
  }
  console.log('PASS container replacement and invalid configuration rejection');
} catch (error) {
  console.error(error.message);
  if (error.stderr) console.error(String(error.stderr));
  try { console.error(compose('logs', '--tail=30')); } catch {}
  process.exitCode = 1;
} finally {
  try { compose('down', '--remove-orphans'); } catch (error) { console.error(error.message); process.exitCode = 1; }
  rmSync(temporary, { recursive: true, force: true });
}
