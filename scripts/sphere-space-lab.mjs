import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import net from 'node:net';

const run = promisify(execFile);
const sphere = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const space = resolve(process.env.SPACE_REPOSITORY || resolve(sphere, '../space-api'));
const stateDir = resolve(tmpdir(), 'sphere-space-identity-lab');
const compose = ['compose', '-p', 'sphere-space-identity-lab', '-f', resolve(sphere, 'docker/identity-lab/compose.yml')];
const pidFile = resolve(stateDir, 'processes.json');
await mkdir(stateDir, { recursive: true, mode: 0o700 });
async function savedPids() { try { return JSON.parse(await readFile(pidFile, 'utf8')); } catch { return []; } }
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
if (process.argv[2] === 'stop') {
  for (const { pid } of await savedPids()) { if (alive(pid)) process.kill(-pid, 'SIGTERM'); }
  await writeFile(pidFile, '[]');
  await run('docker', [...compose, 'stop']);
  console.log('Identity lab stopped; databases preserved.');
  process.exit(0);
}
if (process.argv[2] === 'status') {
  for (const item of await savedPids()) console.log(`${item.name}: ${alive(item.pid) ? 'running' : 'stopped'} (${item.pid})`);
  console.log(`Logs and private configuration: ${stateDir}`);
  process.exit(0);
}
if ((await savedPids()).some(item => alive(item.pid))) throw new Error('Identity lab is already running. Use status or stop first.');
for (const port of [5183, 5184, 8183, 8184]) {
  await new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error(`Port ${port} is occupied; no existing process was stopped.`)));
    server.listen(port, '127.0.0.1', () => server.close(resolvePort));
  });
}
console.log('Starting isolated MongoDB/Redis (27018/6378)…');
await run('docker', [...compose, 'up', '-d', '--wait'], { timeout: 60000 });
let secrets;
const configPath = resolve(stateDir, 'private.json');
try { secrets = JSON.parse(await readFile(configPath, 'utf8')); }
catch {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  secrets = { privateKey, clientSecret: randomBytes(32).toString('hex'), jwtSecret: randomBytes(32).toString('hex') };
  await writeFile(configPath, JSON.stringify(secrets), { mode: 0o600 });
}
const sphereEnv = { ...process.env, ENVIRONMENT: 'development', DATABASE_TECHNOLOGY: 'mongoDB', DATABASE_NAME: 'sphere_identity_lab',
  MONGO_PROTOCOL: 'mongodb', MONGO_HOST: '127.0.0.1', MONGO_PORT: '27018', DATABASE_USERNAME: '', DATABASE_PASSWORD: '', MONGO_AUTH_SOURCE: 'admin',
  REDIS_URL: 'redis://127.0.0.1:6378', REDIS_KEY_PREFIX: 'sphere-identity-lab:', SERVER_PORT: '8183', BASE_URL_PATH: '',
  JWT_SECRET: secrets.jwtSecret, FRONTEND_URL: 'http://127.0.0.1:5183', OAUTH_ISSUER_URL: 'http://127.0.0.1:5183',
  OIDC_SIGNING_PRIVATE_KEY: secrets.privateKey, OIDC_SPACE_CLIENT_ID: 'space-local-lab', OIDC_SPACE_CLIENT_SECRET: secrets.clientSecret,
  OIDC_SPACE_REDIRECT_URI: 'http://127.0.0.1:5184/api/v1/auth/sphere/callback',
  RATE_LIMIT_MAX_REQUESTS: '0', AUTH_RATE_LIMIT_MAX_REQUESTS: '0' };
const spaceEnv = { ...process.env, ENVIRONMENT: 'development', DATABASE_TECHNOLOGY: 'mongoDB', DATABASE_NAME: 'space_identity_lab',
  MONGO_URI: 'mongodb://127.0.0.1:27018/space_identity_lab', REDIS_URL: 'redis://127.0.0.1:6378', REDIS_KEY_PREFIX: 'space-identity-lab:',
  SERVER_PORT: '8184', SEED_ON_STARTUP: 'false', ALLOWED_ORIGINS: 'http://127.0.0.1:5184', SPHERE_SYNC_ENABLED: 'false',
  SPHERE_OIDC_ISSUER: 'http://127.0.0.1:5183', SPHERE_OIDC_CLIENT_ID: 'space-local-lab', SPHERE_OIDC_CLIENT_SECRET: secrets.clientSecret,
  SPHERE_OIDC_REDIRECT_URI: sphereEnv.OIDC_SPACE_REDIRECT_URI, SPACE_FRONTEND_URL: 'http://127.0.0.1:5184/', SPHERE_PUBLIC_URL: 'http://127.0.0.1:5183' };
const processes = [];
async function launch(name, cwd, args, env) {
  const log = await open(resolve(stateDir, name + '.log'), 'a', 0o600);
  const child = spawn(process.execPath, args, { cwd, env, detached: true, stdio: ['ignore', log.fd, log.fd] });
  await new Promise((resolveSpawn, reject) => { child.once('spawn', resolveSpawn); child.once('error', reject); });
  child.unref();
  await log.close();
  processes.push({ name, pid: child.pid });
  await writeFile(pidFile, JSON.stringify(processes), { mode: 0o600 });
}
async function ready(url) {
  for (let attempt = 0; attempt < 150; attempt++) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* startup */ }
    await new Promise(resolveWait => setTimeout(resolveWait, 200));
  }
  throw new Error(`Timed out waiting for ${url}; inspect ${stateDir}`);
}
try {
  await run(process.execPath, ['node_modules/tsx/dist/cli.mjs', '--tsconfig', 'tsconfig.json', 'scripts/seed-identity-lab.ts'], { cwd: resolve(sphere, 'api'), env: sphereEnv, timeout: 30000 });
  await launch('sphere-api', resolve(sphere, 'api'), ['node_modules/tsx/dist/cli.mjs', '--tsconfig', 'tsconfig.json', 'src/main/backend.ts'], sphereEnv);
  await launch('space-api', resolve(space, 'api'), ['node_modules/tsx/dist/cli.mjs', 'src/main/index.ts'], spaceEnv);
  await ready('http://127.0.0.1:8183/api/v1/oidc/jwks');
  await ready('http://127.0.0.1:8184/api/v1/auth/sphere/status');
  for (const username of ['space_local', 'sphere_demo']) {
    const response = await fetch('http://127.0.0.1:8184/api/v1/users/authenticate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'Lab-Sphere-Space-2026!' }) });
    if (response.status === 401) {
      const created = await fetch('http://127.0.0.1:8184/api/v1/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'Lab-Sphere-Space-2026!' }) });
      if (!created.ok) throw new Error(`Cannot seed SPACE lab user ${username}: ${created.status}`);
    } else if (!response.ok) throw new Error('Cannot inspect SPACE lab accounts');
  }
  await launch('sphere-ui', resolve(sphere, 'frontend'), ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5183', '--strictPort'], {
    ...sphereEnv, VITE_API_URL: '/api/v1', VITE_API_PROXY_TARGET: 'http://127.0.0.1:8183', VITE_SECRET_KEY: secrets.jwtSecret,
  });
  await launch('space-ui', resolve(space, 'frontend'), ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5184', '--strictPort'], {
    ...spaceEnv, VITE_SPACE_BASE_URL: '/api/v1', VITE_API_PROXY_TARGET: 'http://127.0.0.1:8184', VITE_ENVIRONMENT: 'identity-lab',
  });
  await ready('http://127.0.0.1:5183');
  await ready('http://127.0.0.1:5184');
  console.log(`SPHERE: http://127.0.0.1:5183\nSPACE: http://127.0.0.1:5184\nSPHERE users: sphere_demo, sphere_link\nSPACE users: space_local, sphere_demo (deliberate collision)\nPassword: Lab-Sphere-Space-2026!\nLogs: ${stateDir}\nStop: node scripts/sphere-space-lab.mjs stop`);
} catch (error) {
  for (const { pid } of processes) { if (alive(pid)) process.kill(-pid, 'SIGTERM'); }
  await writeFile(pidFile, '[]');
  throw error;
}
