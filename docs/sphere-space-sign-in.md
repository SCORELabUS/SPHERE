# Sign in to SPACE with SPHERE

SPHERE exposes a separate, deliberately small OIDC authorization-code provider for the registered SPACE backend. The existing `/oauth/**` provider, `orbit` scope, OAuth grant records, DCR, refresh rotation and MCP credentials are unchanged. OIDC uses `/oidc/**`, its own Redis namespace, signing key, codes and userinfo-only `sph_oid_` access tokens. It issues no refresh token and asks for consent on each sign-in. This is the supported SPACE flow, not a claim of full OIDC provider certification or support for arbitrary clients.

SPACE asks for `openid profile`; it does not receive SPHERE organization access. Optional `email` support discloses the stored verification state but is not needed by SPACE. Identity tokens expire after five minutes, use RS256 and contain a stable SPHERE account ID as `sub`. SPACE verifies issuer, audience, signature, algorithm, nonce, issuance and expiry. Identity tokens cannot authenticate requests to MCP or general SPHERE APIs, and MCP tokens cannot authenticate userinfo.

## Accounts and collisions

- The local identity is the unique `(issuer, subject)` pair, never username or email.
- First access opens a username selection form. The suggested SPHERE name is editable. SPACE accepts 3–30 ASCII letters, digits, underscores or hyphens. Its existing case-sensitive username uniqueness remains in effect. A collision returns 409 and leaves the browser transaction available to choose another name.
- Concurrent registration is protected by MongoDB's username index and a unique partial identity index. A new identity creates a `USER` and its normal personal organization, with no local password. API keys are generated independently of password hashing.
- Returning sign-ins retain the SPACE username even after a SPHERE rename. No SPHERE roles or organization memberships are imported.
- Existing users sign in using their current SPACE method, go to **Settings → Connect SPHERE**, authorize in SPHERE and confirm in SPACE. Both the start and confirmation require that same SPACE account. A provider identity owned by another SPACE account cannot be claimed. Existing local passwords continue to work.
- This version does not expose disconnect, automatic merges, shared logout, SPHERE token refresh or organization synchronization. Signing out clears the existing SPACE browser session. Revoking SPHERE access does not revoke an already issued local SPACE API key.

## Server configuration

SPHERE:

```dotenv
OAUTH_ISSUER_URL=https://sphere.example.com
OIDC_SPACE_CLIENT_ID=space
OIDC_SPACE_CLIENT_SECRET=<random-shared-secret>
OIDC_SPACE_REDIRECT_URI=https://space.example.com/api/v1/auth/sphere/callback
OIDC_SIGNING_PRIVATE_KEY=<PKCS8 RSA PEM, at least 2048 bits; literal \\n or real newlines>
```

SPACE:

```dotenv
SPHERE_OIDC_ISSUER=https://sphere.example.com
SPHERE_OIDC_CLIENT_ID=space
SPHERE_OIDC_CLIENT_SECRET=<same-shared-secret>
SPHERE_OIDC_REDIRECT_URI=https://space.example.com/api/v1/auth/sphere/callback
SPACE_FRONTEND_URL=https://space.example.com/
ALLOWED_ORIGINS=https://space.example.com
```

Only loopback HTTP URLs are allowed for local development. The issuer must be an origin; discovery and all discovered endpoints must have that origin. Keep private keys/secrets on the servers, outside frontend environment variables. Configuration is fixed by the deployment, never accepted from user input. If required settings are absent, the SPACE button is hidden and existing logins remain available. Keys should remain stable across restarts; this first version publishes one signing key (coordinate rotations with the five-minute token lifetime).

Serve SPACE's API under its frontend origin, or a same-site API host with credentialed CORS, so its HttpOnly, SameSite=Lax, Secure-in-HTTPS transaction cookie works. JSON writes require the exact configured frontend Origin. The backend keeps PKCE/state/nonce and pending results in server-only Redis entries; neither SPHERE tokens nor local API keys are passed in redirect URLs. Authentication attempts are limited to 30 per minute per IP in SPACE and on SPHERE's authorization/token routes.

The SPACE startup migration `20261103000000-sphere-identity.ts` adds the unique partial index idempotently; legacy users are outside the index. Seeders also build this index through the user schema. No credentials or identity grants need seeding in SPHERE. Disabling the OIDC settings rolls back the integration without changing local usernames/passwords. Accounts created without a local password still need SPHERE (or a local password added through the existing authorized account-management flow).

## Local laboratory

Run these commands from the SPHERE repository. Requires Node, pnpm dependencies installed in both repositories, Docker Desktop and sibling checkout `../space-api` (override `SPACE_REPOSITORY` if needed).

```bash
node scripts/sphere-space-lab.mjs
node scripts/sphere-space-lab.mjs status
node scripts/sphere-space-lab.mjs stop
```

- SPHERE: http://127.0.0.1:5183
- SPACE: http://127.0.0.1:5184
- SPHERE users: `sphere_demo` (new-account scenario), `sphere_link` (linking scenario).
- SPACE users: `space_local`, plus `sphere_demo` to deliberately produce a username collision.
- Password for these local-only users: `Lab-Sphere-Space-2026!`.
- MongoDB 27018: separate `sphere_identity_lab` / `space_identity_lab` databases. Redis 6378 uses separate lab prefixes. No existing app or database is erased. Stopping preserves the Docker volume.
- Private config, process IDs and logs are in the OS temp directory `sphere-space-identity-lab`; config is readable only by its owner. The launcher refuses occupied application ports.

Test first access by choosing **Continue with SPHERE** in SPACE, using `sphere_demo` in SPHERE, and confirming consent. Try the suggested name to see the collision, then choose another. For linking, sign in locally as `space_local`, connect `sphere_link` from Settings, then log out of SPACE and sign in using SPHERE.

The actual browser exercise creates and removes its own fixtures, without dropping lab databases:

```bash
pnpm --dir api exec tsx --tsconfig tsconfig.json scripts/test-identity-lab.ts
```

It uses installed Chrome and writes screenshots under `api/test-results/identity-lab`. It exercises first sign-in, a taken username, signup retry, provider rename, returning sign-in, existing local password login, explicit linking, refusal to claim another account's identity, and a mobile flow.

Focused SPHERE integration and MCP regression tests (run sequentially, separate from browser tests; the shared test harness drops `sphere_scratch`):

```bash
ENVIRONMENT=development DATABASE_TECHNOLOGY=mongoDB DATABASE_NAME=sphere_scratch \
MONGO_PROTOCOL=mongodb MONGO_HOST=127.0.0.1 MONGO_PORT=27018 DATABASE_USERNAME='' DATABASE_PASSWORD='' \
MONGO_AUTH_SOURCE=admin REDIS_URL=redis://127.0.0.1:6378 REDIS_KEY_PREFIX=sphere-identity-tests: \
SERVER_PORT=0 JWT_SECRET=identity-test-secret \
pnpm --dir api exec vitest run src/test/oidc.test.ts src/test/oauth.test.ts
```

SPACE's isolated service tests are at `api/src/test/unit-tests/sphere-auth.test.ts` in its repository.

The isolated SPACE persistence suite runs with `pnpm --dir api run test:identity` from SPACE,
using `DATABASE_NAME=space_identity_scratch`, `MONGO_URI=mongodb://127.0.0.1:27018/space_identity_scratch`,
`REDIS_URL=redis://127.0.0.1:6378`, `ENVIRONMENT=testing` and `SERVER_PORT=0`.
CI executes this suite in a separate job with its own disposable MongoDB and Redis.
