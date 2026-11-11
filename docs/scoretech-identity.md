# Sign in to SPHERE with SCORETech Identity

SPHERE supports two runtime modes. During native development set the API
environment; with production Compose use its `docker/production/.env`, which
passes the same switch to both the API and Nginx:

```dotenv
AUTH_PROVIDER=local
# Or: AUTH_PROVIDER=scoretech
```

The frontend reads `/api/v1/auth/config`. No Vite authentication-mode flag or
client secret is needed. Restart the API after changing its environment and reload
SPHERE's browser tabs. In Docker, run `docker compose up -d server nginx` from
`docker/production` to recreate both with consistent settings. The default remains `local`, preserving password, Google
and US sign-in. An invalid enabled Identity configuration fails startup rather
than silently allowing local sign-in.

## Configure the OpenID Connect application

Create a **backend/confidential application** for SPHERE in SCORETech Identity's
Administration → Applications. Enable authorization code with S256 PKCE, and copy
its Client ID and secret into the API environment (never a `VITE_*` variable).
The native provider owns registration, Google/US login, verification and required
factors. Required application permissions are configured in Identity's application
entry; SPHERE's organization roles and resource permissions remain in SPHERE.

Use an exact redirect URI:

- Local SPHERE at `http://localhost:5173`:
  `http://localhost:5173/api/v1/auth/identity/callback`.
- Production at `https://sphere.score.us.es`:
  `https://sphere.score.us.es/api/v1/auth/identity/callback`.

Example API settings are in `api/.env.scoretech.example`. Merge them into your
existing API environment; keep real credentials out of Git:

```dotenv
AUTH_PROVIDER=local
FRONTEND_URL=https://sphere.score.us.es
SCORETECH_IDENTITY_ISSUER=https://sphere.score.us.es/identity/auth/realms/score
SCORETECH_IDENTITY_CLIENT_ID=<application Client ID>
SCORETECH_IDENTITY_CLIENT_SECRET=<application secret>
SCORETECH_IDENTITY_ACCOUNT_URL=https://sphere.score.us.es/identity/account/
```

The callback defaults to `FRONTEND_URL + BASE_URL_PATH +
/api/v1/auth/identity/callback`. An explicit `SCORETECH_IDENTITY_CALLBACK_URL` must
use the same public SPHERE origin and that callback path: the browser must return
to the host holding its flow cookie. Keep the public API behind SPHERE's proxy.
Localhost API ports may differ; cookie operations allow credentials only from the
configured frontend Origin. For distinct frontend/API hostnames, use the frontend
proxy rather than widening cookie domains.

When API containers cannot reach the public issuer, set
`SCORETECH_IDENTITY_TRANSPORT_URL` to that exact realm's private address (for
example `http://scoretech-identity-gateway:8080/identity/auth/realms/score` on the
shared SPHERE network).
This rewrites server transport only. Public issuer, signature and audience checks,
redirects, browser links and the WebAuthn host remain unchanged.

The approved legacy US callback rule must continue forwarding
`/api/v1/users/auth/sso/us/callback` directly to SCORETech Identity when its CAS
broker is in use. SPHERE disables its own legacy SSO handlers in Identity mode.

## Production Docker gateway

Use the sanitized additions in `docker/production/.env.example`; merge them into
its existing `.env` rather than replacing other services' configuration. Identity's
companion setup is documented in its `docker/README.md` (sibling repository
`SCORETech-identity`). Start SPHERE first so its Docker network exists, then start
Identity with its gateway attached to that network. The default network is
`production_sphere-network` and its gateway alias is `scoretech-identity-gateway`.
Only the Identity gateway joins SPHERE; its database/provider/APIs remain private.

For initial operator enrollment and application creation, set
`AUTH_PROVIDER=local` and `SCORETECH_IDENTITY_PREVIEW=true`. Run:

```bash
cd docker/production
docker compose up -d --build nginx
```

Preview exposes `/identity` while leaving SPHERE's local login and approved US
callback intact. Prepare Identity using email/passkeys or Google; US sign-in in
Identity requires the final callback handover. Create SPHERE's confidential OIDC
application, configure its credentials and complete account linking/migration.
Then set `AUTH_PROVIDER=scoretech`, clear preview, and run:

```bash
docker compose up -d --build server client nginx
```

Enabled mode forwards `/identity` and `/identity/` without stripping the prefix,
including Account, Admin, APIs and Google's native broker callback. It sends the
approved `/api/v1/users/auth/sso/us/callback` to Identity, which returns a browser
redirect into its native broker path so realm-scoped cookies are included.
`/api/v1/auth/identity/callback` stays on SPHERE's API. These callbacks have
different owners and must not be combined.

`SCORETECH_IDENTITY_UPSTREAM` defaults to `scoretech-identity-gateway:8080`.
Docker DNS is resolved on requests, so Nginx starts independently and survives
Identity container replacement. The public edge overwrites forwarding headers;
Identity preserves the sanitized client chain. TLS stays on SPHERE's existing
certificate and ports. Invalid modes, preview values or upstream syntax fail
startup. Local mode with preview off needs no Identity network/service.

After code changes use `--build`; subsequent environment-only changes need
`docker compose up -d server nginx`. To roll back, set `AUTH_PROVIDER=local` and
`SCORETECH_IDENTITY_PREVIEW=false` and rerun that command. Keep persistent state.

The isolated Docker gateway regression test uses synthetic upstreams/certificates
and the actual gateway configurations from both repositories:

```bash
node nginx/production/test-gateway.mjs
```

## Migrate existing SPHERE accounts in one cutover

1. Keep SPHERE on `AUTH_PROVIDER=local` with `SCORETECH_IDENTITY_PREVIEW=true`.
   Start both stacks and verify the public OIDC issuer and SPHERE client are
   configured in the running SPHERE API. In Identity, enable Google (`google`)
   and the University of Seville (`us-sso`) for any corresponding accounts in
   the migration. Use the same Google and CAS configurations as SPHERE so the
   original Google subjects and UVUS identifiers still match. Verify email code
   delivery. Check in **Applications** that the SPHERE client is enabled and in
   **Roles** that its required permissions (for example `sphere:access`) are
   granted by the default registration role. Back up both databases.
2. From the SPHERE checkout, simulate the migration. Replace the path with the
   Identity checkout on the same machine.

   ```bash
   bash docker/migrate-scoretech-users ../SCORETech-identity
   ```

   The command reports new and reusable accounts, Google and US counts, and
   conflicts by SPHERE user ID. The entire preflight is read-only. If a central
   account is already present, the migration can reuse the exact existing link,
   the same upstream provider ID, or a verified matching mailbox. An unverified
   collision, conflicting provider IDs, or a missing legacy provider on an
   existing central account needs review. Resolve it in the source or destination
   and rerun. Settings → Account → **Connect SCORETech Identity** remains
   available in local mode for an explicit link to an existing account.
3. During a short change window, avoid creating accounts or changing email or
   provider links. Run the same command with `--apply`.

   ```bash
   bash docker/migrate-scoretech-users ../SCORETech-identity --apply
   ```

   It rechecks conflicts, creates the missing Identity users and broker links,
   assigns the configured registration role where needed, then records each
   issuer/subject link on the original SPHERE user. It does not email users or
   switch the running login mode. The same command safely resumes a partial run.
4. After all links are recorded, set `AUTH_PROVIDER=scoretech` and
   `SCORETECH_IDENTITY_PREVIEW=false` in `docker/production/.env`. From that
   directory, apply the configuration and build the updated SPHERE services.

   ```bash
   docker compose up -d --build server client nginx
   ```

   Sign in with an existing email, a Google account and a US account. Confirm
   each lands in the original SPHERE account with its expected organizations
   and permissions. The public US callback switches to Identity in this step.

Email users sign in with a one-time code sent to their registered mailbox. SPHERE
password hashes remain in MongoDB for rollback. Google and US users choose their
usual provider on the SCORETech sign-in screen. For legacy CAS addresses generated
from the UVUS with no mailbox verification, the migration preserves CAS sign-in
and uses an undeliverable placeholder until the user sets a real email in Identity.
SPHERE usernames, user IDs, roles, memberships and application data stay in MongoDB.

At runtime SPHERE resolves the signed OIDC subject using the stored link and never
auto-merges by email. An unmigrated collision is rejected. New identities can
create ordinary SPHERE users and their personal organizations after Identity
admits them to the application. Identity roles do not grant SPHERE's global ADMIN.

To roll back, set `AUTH_PROVIDER=local` and restart/reload. Original local
credentials and data remain intact; Identity-backed SPHERE bearers cease to work.
Users created only through Identity need a local sign-in method before a rollback
if they must continue signing in locally. Do not erase links or user data as part
of switching modes.

## User-facing behavior

In Identity mode, Login and Register immediately start native provider flows;
SPHERE's own forms are not shown. Direct password-reset and email-verification
pages also hand off to Identity. Sign-in errors offer an explicit retry without
redirect loops. Protected-page and OAuth/MCP consent return destinations survive
the redirect.

In Identity mode, Settings → Account shows only **Open my SCORETech profile**,
which opens Account in a separate tab with `noopener noreferrer`. Account Details,
Public Profile, Social Links and Sign-in & Security are managed through that link.
Connected applications (SPHERE MCP grants), Notifications, Payments, Beta features
and Danger Zone stay in SPHERE. Danger Zone deletes the SPHERE account and service
data. Direct API writes to the SPHERE login email and local credentials are blocked
in Identity mode. SPHERE role administration and API keys remain available.

### Copy profiles after linking accounts

Deploy the SCORETech Identity version with profile import support first. From
the SPHERE checkout, preview and apply the profile import:

```bash
bash docker/migrate-scoretech-users ../SCORETech-identity --profiles
bash docker/migrate-scoretech-users ../SCORETech-identity --profiles --apply
```

This can run with `AUTH_PROVIDER=scoretech`. It reads only linked SPHERE users
and matches their stored issuer/subject binding. It fills missing profile,
social links, phone and avatar groups in Account, preserving groups already
saved there. Uploaded images are read from SPHERE storage and copied to
Identity's private avatar storage. The preview reports missing links and
unsupported or unavailable images without changing either database. Rerun
the same command to resume a partial import. SPHERE keeps its original data.

The Account link includes the originating Settings URL so Account can show
**Back to application**. Same-origin SPHERE works automatically. If Identity
and SPHERE use different origins, include the SPHERE origin in Identity's
`IDENTITY_ACCOUNT_RETURN_ORIGINS` and rerender its public configuration.

## Applications that already use SPHERE sign-in

Browser-based OAuth/OIDC consumers continue using SPHERE as their provider. A
request follows consumer → SPHERE consent → SCORETech Identity authentication →
SPHERE consent → consumer callback. Pending consent survives the external redirect.
SPHERE still signs its own OIDC tokens and preserves its issuer and the linked
SPHERE user ID as `sub`; consumer Client IDs, secrets and callbacks stay unchanged.
Existing accounts must be linked before switching the authentication mode.

This does not apply to integrations that post username/password directly to
`/users/login`: Identity mode rejects those local credential endpoints. Such
consumers need the browser authorization-code flow. Application/resource roles,
MCP scopes and the downstream tokens remain owned by SPHERE.

The Identity browser regression includes a SPACE-like confidential consumer with
PKCE and verifies the actual central redirect, resumed consent, callback state,
SPHERE signature/issuer/subject, nonce and userinfo.

## Sessions and security

Authorization uses a one-use Redis state, an independent browser-bound HttpOnly
cookie, nonce and S256 PKCE. ID/access tokens are signature/issuer/expiry checked;
ID-token audience and access-token authorized party must match this application.
Provider refresh tokens remain on the API in private, namespaced Redis entries;
no provider token is placed in URLs or browser storage. Sensitive responses are
`no-store`.

SPHERE issues five-minute application bearers bound to the server bridge. Every
API/static-file/SSE authentication validates that bridge in Identity mode. Access
is renewed against the provider as needed, with refresh rotation and concurrency
coordination. Background/focus recovery retains the page on transient failures;
revocation or genuine native-session expiry requires sign-in. Local legacy web
bearers are rejected while Identity mode is active. Independent API keys and MCP
OAuth grants continue following SPHERE's own scope and revocation rules.

Logout removes the bridge, clears its cookie and requests native provider logout.
A concurrent refresh cannot recreate the removed bridge. Redis loss invalidates
these browser sessions and requires sign-in; it does not remove users or their
SPHERE data. Protect Redis as a credential store, with private networking and
appropriate access controls/backups.

## Verification

```bash
pnpm --dir api exec vitest run src/test/unit-tests/scoretech-identity.test.ts \
  src/test/unit-tests/auth-provider-service.test.ts src/test/unit-tests/sso-controller.test.ts
pnpm --dir api run build
pnpm --dir frontend run build
```

The optional real-Identity browser suite requires the sibling
`../SCORETech-identity` local lab (`./lab up`), Mongo 27018 and Redis 6378. It creates
and removes only disposable provider users/clients. The SPHERE test harness drops
**only** the selected `sphere_scratch` database; never point it at another database
or run it concurrently with database suites. The Redis namespace must be unique;
no global flush is used.

```bash
ENVIRONMENT=development DATABASE_TECHNOLOGY=mongoDB \
MONGO_PROTOCOL=mongodb MONGO_HOST=127.0.0.1 MONGO_PORT=27018 \
DATABASE_NAME=sphere_scratch DATABASE_USERNAME= DATABASE_PASSWORD= \
REDIS_URL=redis://127.0.0.1:6378 REDIS_KEY_PREFIX=sphere-identity-browser-test \
SPHERE_E2E_BROWSER_CHANNEL=chrome pnpm --dir api run test:e2e:identity
```

It uses Vite on `localhost:5177` and validates local login, explicit linking,
retained user identity/roles, native SSO/registration, the external profile tab,
filtered Settings, direct API enforcement, native refresh, mobile layout and
rollback to local forms. Screenshots are in `api/test-results/scoretech-identity/`.
The standard connected-applications E2E command remains independent of this lab.
