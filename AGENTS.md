# SPHERE Agents

## Project Structure

- **api/** — Express + MongoDB + Redis backend (TypeScript)
- **frontend/** — React + Vite + TailwindCSS v4 frontend
- Package manager: **pnpm** (not npm/yarn)

## Developer Commands

```bash
pnpm run install    # Install dependencies for both packages
pnpm run dev        # Run API + Vite dev servers concurrently (from root)
pnpm run dev:setup  # Run MongoDB and Redis containers locally with Docker Compose. Also seeds MongoDB with test data. It must be run BEFORE dev commands.
pnpm run test       # Run API tests (vitest) then reseed MongoDB
pnpm run build      # Build both frontend and api
```

## Running Single Test / Package

```bash
cd api && npx vitest --run --test-name-pattern "<pattern>"
```

## Prerequisites (required for dev and tests)

- **MongoDB** — must be running with a seeded database
- **MiniZinc** — required for analytics/pricing optimization; must have `gecode` solver available

  If analytics return 500, verify with:
  ```bash
  minizinc --solvers  # gecode must appear in output
  ```

## Important Quirks

- `test` script runs `seed:mongo-local:small` **after** tests to reset state
- Tests run sequentially (`fileParallelism: false` in vitest.config.ts)
- API entry point: `api/src/main/backend.ts`
- Migrations auto-run via `npx migrate up` in `dev:api` script
- API uses `ts-migrate-mongoose` for MongoDB migrations
- `api/scripts/link-zip-uploads-to-collections.ts` links pricings of ZIP uploads made before the bulk upload stored their collection: a dry run by default (`npx tsx --tsconfig tsconfig.json scripts/link-zip-uploads-to-collections.ts` from `api/`), `--apply` links only the unambiguous ones. It is not a migration that runs by itself.
- The API is rate limited (`api/src/main/middlewares/RateLimitMiddleware.ts`), with counters in Redis: 300 requests every 10 seconds per user or, without one, per IP (`RATE_LIMIT_MAX_REQUESTS`, `RATE_LIMIT_WINDOW_SECONDS`), and 10 every 5 minutes per address and account on login, registration and password reset (`AUTH_RATE_LIMIT_MAX_REQUESTS`, `AUTH_RATE_LIMIT_WINDOW_SECONDS`). A value of 0 turns a limiter off. Both are off under Vitest unless set explicitly, and requests go through if Redis is down.
- Pricings use optimistic concurrency. `GET /pricings/{org}/{slug}` returns `ETag: "<pricingId>.<revision>"`; the revision lives on `PricingIdentity` and moves on with every write to any version (`refreshIdentities` in `PricingMongoose.ts`, plus `PricingRepository.create`/`bumpRevisions` where no middleware runs). `PUT`/`DELETE` on the pricing or a version and `POST` of a version accept `If-Match`: `PricingRepository.claimRevision` checks it and claims the revision in one conditional update before the write, so a stale tag gets 412 and changes nothing. The revision also moves with private versions, so only callers who may read the private versions (`_canSeePrivateVersions`) get an `ETag`, and for anyone else no tag matches (only `*`). Without `If-Match` writes behave as before (ORBIT never sends one); `PRICING_REQUIRE_IF_MATCH=true` makes it required on `PUT`/`DELETE` (428), off by default. Revision-bearing reads and the full pricing-service mutation (including writes without If-Match) share a queue by pricingId in `utils/pricing-revision-lock.ts`, so a GET cannot pair a claimed revision with content that has not been written. This queue is shared across service instances in the current single API process; before running multiple API processes, replace it with cross-process coordination or transactions. The guard is always released on errors.
- NGINX also limits each IP (`nginx/*/nginx.conf`): 50 requests/s with bursts of 100 on `/api/v1`, and 20/s with bursts of 40 on `/harvey-api`, answering 429. It is the barrier against floods; the per-user limits are the API's.

## ORBIT assistant

- Lives in `api/src/main/services/orbit/` and is served under `/api/v1/orbit/**`. The model only reads (query tools) and proposes plans; `OrbitPlanService` validates them by code and `OrbitExecutorService` applies a confirmed plan with the user's own permissions, re-checked per step.
- Configured with `ORBIT_OPENAI_API_KEY` (falls back to `HARVEY_API_KEY`, then `OPENAI_API_KEY`), `ORBIT_OPENAI_MODEL` (default `gpt-5-nano`) and optionally `ORBIT_OPENAI_BASE_URL`. Without a key, `GET /orbit/status` reports `available: false` and messages answer 503.
- In production ORBIT uses HARVEY's OpenAI key (see the docker-compose files), so both share its rate limits and spending. `ORBIT_MAX_MESSAGES_PER_MINUTE` (default 20) caps the messages of all ORBIT users together to leave room for HARVEY; each user is also limited to 30 messages every 10 minutes and to `ORBIT_MESSAGES_PER_HOUR` (10) messages an hour, shown as `maxOrbitMessages` in SPHERE's pricing (`frontend/public/pricing/SPHERE.yml`). Past the hourly limit the refusal points to the user's own Claude or ChatGPT through the plugin at https://github.com/SCORELabUS/sphere-orbit-plugin (`ORBIT_SKILL_URL` overrides it; set empty, the refusal points to the MCP server, which has no such limit since it calls no model).
- A conversation is one MongoDB document (16 MB cap, files included): new messages are refused with 409 past 12 MB, or 4 MB of files.
- Phase 2 (teams and permissions) adds role changes, removals, invitation revocations, moves, ownership transfer and pricing/collection permissions, plus the `list_resources`, `who_can_access` and `get_member_access` review tools. Role changes and removals act on the direct membership; an inherited role is changed in the parent. Revocations are checked against the organization's own invitations, because `OrganizationService.revokeInvitation` accepts any id.
- An ownership transfer goes alone in its plan, which stores a `confirmationPhrase` (the organization's name); `POST /orbit/plans/:id/confirm` needs it back in `confirmation`.
- Phase 3 (pricings and collections) lives in `orbitPricingTools.ts` (read tools), `orbitPricingSteps.ts` (plan validation, with the same `PermissionEngine` checks the API makes) and `orbitPricingDiff.ts` (version comparison). Executed steps call `PricingService`/`PricingCollectionService`, which check permissions again. Pricing YAML is always parsed from text with `retrievePricingFromText`: `retrievePricingFromPath` can rewrite the file it reads.
- Phase 4 (account and notifications) lives in `orbitAccountTools.ts` (read tools) and `orbitAccountSteps.ts` (plan validation). It only touches the user's own notifications, notification preferences and public profile, through `NotificationService` and `UserSettingsService`; social links are checked with the same `isValidSocialUrl` as the settings endpoint.
- Phase 5 (deletions) lives in `orbitDeletionSteps.ts`. A deletion plan holds nothing else and stores a `confirmationPhrase` (the name of what goes, or `delete N items`). Deleting an organization takes being its OWNER and deletes its whole tree, deepest first, because `OrganizationService.destroy` checks no permissions and leaves sub-organizations behind; the run fails if the tree changed after the plan.
- Phase 6 (MCP) lives in `OrbitMcpService.ts` and is served at `POST /api/v1/orbit/mcp` with the official SDK (`@modelcontextprotocol/sdk`, stateless Streamable HTTP). It only takes user API keys (`x-api-key`) and calls no language model: it runs ORBIT's tools through `OrbitToolRunner.runParsed`, leaves `propose_plan` plans in a conversation with `channel: 'mcp'` (plan `source: 'mcp'`, with the `apiKeyId` that proposed it). `confirm_plan` applies a plan only with that same key, through `OrbitService.confirmPlan` (phrase, daily allowance and confirmation limit as in the web). An `initialize` opens a session (in memory, bound to the user and the key, closed after 30 idle minutes, answers as SSE); when the client supports elicitation, SPHERE asks the user in a dialog the model cannot answer, and the phrase of deletions and handovers is typed there. Requests without a session stay stateless and answer in JSON; then the assistant's call confirms, with the phrase the user typed. Plans can still be confirmed in the web. The key's scopes bound every organization named in the arguments and filter `list_my_organizations` and `search_pricings`: VIEW only reads, and ownership transfer, moves and organization deletions need ALL. The tools also read with the key, as the REST API does (`OrbitActor.apiKey`, applied by `resolveOrgRole` and by the services through `requesterOf`): a VIEW scope acts as a plain MEMBER, MANAGEMENT at most as an ADMIN, and a global ADMIN gets no bypass, so private versions and private collections only reach the assistant where the key's user may read them as such. For an assistant that needs private reads without write power, use a dedicated member account granted GET on the specific pricings or collections, with a VIEW key of that account (or a MANAGEMENT key if write power is acceptable).
- Private versions and private collections are read by one rule, `policies/privateReadRule.ts` (`PermissionService.privateReader` / `canReadPrivateVersions`, first written for private permanent links): OWNER/ADMIN of the organization, a global ADMIN with a token, or GET on the pricing or its collection (or on the collection), with API keys limited as above. Listings, show, configuration space, forks, follows and their notifications, ZIP downloads, write responses, permissions endpoints and ORBIT use it; a pricing whose versions are all private answers like a missing one to anyone else. Permissions in listings are matched by organization and slug (`pricingKeys`, `collectionKeys`), never by slug alone.
- New operations for later phases are added as tools in `OrbitTools.ts`, plan operations in `types/models/Orbit.ts`, validation in `OrbitPlanService` and execution in `OrbitExecutorService`.

## MCP OAuth

- `OAuthService` implements the MCP SDK OAuth provider; `OAuthRoutes` mounts the SDK protocol handlers under `/api/v1/oauth`. DCR is supported; CIMD is not advertised or fetched.
- `OAUTH_ISSUER_URL` overrides the public origin (otherwise `FRONTEND_URL`, then `http://localhost:5173`). The issuer must match the externally reachable origin; discovery is served at `/.well-known/oauth-authorization-server` and both root/path-specific protected-resource URLs. nginx and Vite proxy these documents to the API.
- OAuth is only accepted by `/orbit/mcp`: opaque `sph_oat_` access tokens live for one hour; rotating `sph_ort_` refresh tokens live for 30 days. Mongo stores hashes only, checks grant revocation on every request and retains spent refresh hashes until expiry to detect replay. Redis stores consent requests (10 minutes) and authorization codes (5 minutes), consumed atomically. The grant (the "connected application") is only created when its code is exchanged, so an approval whose code is never used leaves nothing behind.
- `/oauth/requests/*` and `/oauth/grants*` require a SPHERE web session, never an API key or OAuth token. Consent selects organization scopes with the shared selectors in `modules/core/components`. `/oauth/consent` preserves its request across password and SSO login in sessionStorage. Settings → Connected applications lists and revokes connections.
- MCP plans use namespaced `credentialId` (`oauth:<grantId>` or `api-key:<keyId>`); legacy `apiKeyId` plans remain confirmable by their original API key. Both credentials share the same MCP scopes and per-user rate limiter.
- No clients, grants or tokens are seeded; the seeder initializes the empty indexed OAuth collections. Run migration `20261024120000-create-oauth-collections` for existing databases.
- `/api/src/test/oauth.test.ts` covers discovery, DCR, PKCE, audience binding, single-use codes, refresh replay, consent ownership, grant revocation and MCP credential isolation. Run integration tests only against `DATABASE_NAME=sphere_scratch`, Mongo 27018 and Redis 6378: the shared test harness drops its selected database.

## API Documentation

- `/api/docs/sphere-api-docs.yaml` contains the OpenAPI specification for the API. Use it as the primary reference for understanding available endpoints, request and response schemas, authentication requirements, and general API behavior.

## Test distribution

- /api/src/test/unit-tests/** – tests related to individual utility functions, services, and repositories. These tests should be focused on isolated logic and should mock external dependencies.
- /api/src/test/auth.test.ts – tests related to authentication flows, including login, token generation, and token validation
- /api/src/test/cache.test.ts – tests related to caching mechanisms
- /api/src/test/oauth.test.ts — MCP OAuth discovery, registration, PKCE, token rotation, revocation, scopes and credential isolation; uses the isolated scratch database.
- /api/src/test/user.test.ts – tests related to user management, authentication, and authorization
- /api/src/test/organization.test.ts – tests related to organization management and organization-user interactions
- /api/src/test/collection.test.ts — tests related to collection management and collection-pricing interactions
- /api/src/test/pricing.test.ts — tests related to pricing management and pricing-analytics
- /api/src/test/pricing-concurrency.test.ts — tests related to pricing ETags and `If-Match` on pricing writes
- /api/src/test/unit-tests/pricing-revision-race.test.ts — deterministic claim/write interleaving, writes without If-Match, identity changes during reads and recovery after failed writes
- /api/src/test/private-versions.test.ts — tests related to who may read private pricing versions (server-managed fields, permissions across organizations, collections, forks, follows, API keys, ORBIT and the MCP server)
- /api/src/test/zip-upload-links.test.ts — tests for `scripts/link-zip-uploads-to-collections.ts`, which links pricings of old ZIP uploads to their collection
- /api/src/test/orbit.test.ts — tests related to the ORBIT assistant (conversations, plans, file import, plan execution, teams and permissions, pricings and collections, account and notifications, deletions, and the MCP server). The language model is replaced with a scripted fake from `/api/src/test/utils/orbit/`

In addition, test utilities are organized in `/api/src/test/utils/` with subfolders for auth, users, organizations, collections and pricings.

## Lint Config

- API: `api/eslint.config.ts` (TypeScript-eslint, semi required)
- Frontend: `frontend/eslint.config.js`

## Instructions for Adding New API Endpoints

1. Define the endpoint in the OpenAPI spec (`/api/docs/sphere-api-docs.yaml`). This will serve as the source of truth for the endpoint's contract, including request/response schemas and authentication requirements.
2. Implement the endpoint in its corresponder router (different routets can be found in `api/src/main/routers/`). Follow the RESTful conventions to name the endpoints and ensure that the implementation adheres to the contract defined in the OpenAPI spec.
3. Add any necessary permissions of the endpoint in `api/src/main/config/permissions.ts`. This will ensure that the endpoint is properly secured and only accessible to authorized users.
4. Add a method in the appropiate controller (found in `api/src/main/controllers/`) to parse the request body and parameters to the appropriate data structures. The controller should interact with the necessary services to fulfill the request and return the appropriate response.
5. If needed, add any necessary business logic in the services layer (found in `api/src/main/services/`). This layer should contain the core logic of the application and should be decoupled from the controllers and routers to ensure separation of concerns. If needed, you can use repositories here to communicate with the database. Nontheless, if you can fulfill the requirements of the endpoint without adding any new logic to the services layer, you can directly call the necessary service methods from the controller.
6. If the endpoint requires any changes to persist in the database or requires retrieving information from it, add any necessary database queries in the appropriate repository (found in `api/src/main/repositories/mongoose/`).
7. Write tests for the new endpoint in the appropriate test file under `api/src/test/
8. Ensure that the tests cover various scenarios, including successful requests, validation errors, and unauthorized access. Use the test utilities in `api/src/test/utils/` to help set up test data and mock dependencies as needed.
9. Run the tests to verify that the new endpoint works as expected and does not introduce any regressions. Use `pnpm run test` from the root directory to execute all tests, or run specific tests using `npx vitest --run --test-name-pattern "<pattern>"` from the `api` directory.

IMPORTANT NOTES if adding a new entity to the database schema:

- You must create a new mongoose schema in `api/src/main/repositories/mongoose/models`
- You must add any necessary migrations in `api/src/main/migrations/`. Remember to run the migrations using `npx migrate up` after implementing the new endpoint to ensure that the database schema is updated accordingly.
- You must update the seeders located in `api/src/main/database/seeders/mongo/` to reflect the changes
- You must register the new repository and service in the awilix container located in `api/src/main/config/container.ts` to ensure that they can be properly injected into the controllers and other services as needed.

## Instructions for Adding New Frontend Pages/Components

The frontend organizes its functionality in modules, which are located in `frontend/src/modules/`. Each module corresponds to a specific feature or section of the application and contains its own components, pages, and styles. When adding new pages or components, you should determine which module they belong to based on their functionality and the existing structure of the application. In particular, each module may have the following subfolders:

- pages/: contains the main pages of the module, which are typically associated with specific routes in the application. Pages are responsible for rendering the overall layout and structure of a particular section of the application and may include multiple components to display data and handle user interactions.
- components/: contains reusable components that are specific to the module. These components can be used across different pages within the same module and are designed to encapsulate specific functionality or UI elements related to the module's feature set. IMPORTANT: If you wanna reuse a component across different modules, you should place it in the `frontend/src/modules/core/components/` folder instead of the module's components folder.
- utils/: contains utility functions that are specific to the module. These functions can be used across different components and pages within the same module and are designed to encapsulate specific logic related to the module's feature set. IMPORTANT: If you wanna reuse a utility function across different modules, you should place it in the `frontend/src/modules/core/utils/` folder instead of the module's utils folder.
- api/: contains functions that handle API calls related to the module's feature set. These functions are responsible for making HTTP requests to the backend API and processing the responses. They can be used across different components and pages within the same module to interact with the backend and retrieve or manipulate data as needed. IMPORTANT: remember to check wheter an API function that fulfills your needs already exists before creating a new one, even in a different module. If it does, you should reuse it instead of creating a new one.
- contexts/: contains React contexts that are specific to the module. These contexts can be used to manage state and share data across different components and pages within the same module. They are designed to encapsulate specific logic related to the module's feature set and can help improve the organization and maintainability of the codebase.
- hooks/: contains custom React hooks that are specific to the module. These hooks can be used to encapsulate reusable logic related to the module's feature set and can help improve the organization and maintainability of the codebase. They can be used across different components and pages within the same module to handle common functionality such as form handling, data fetching, or state management.
- layouts/: contains layout components that are specific to the module. These components are responsible for defining the overall structure and layout of the pages within the module and can be used to ensure a consistent look and feel across different sections of the application.

When adding new pages or components you should always follow the style depicted in `./DESIGN.md` and make sure to keep the code organized and maintainable by placing it in the appropriate module and subfolder based on its functionality and purpose. Additionally, remember to update the routing configuration if you are adding new pages that need to be accessible via specific routes in the application.

If you need to add any new color to the palette, you should add it to the `frontend/src/main/styles/tailwind.css` file to ensure that it can be used consistently across the application and is available for use in the TailwindCSS classes throughout the codebase. In addition, you should ALWAYS include a dark mode variant for any new colors you add by extending the class `.dark` in the same file. This will ensure that the new colors are properly displayed in both light and dark modes, providing a better user experience for users who prefer dark mode.

IMPORTANT RULE: EVERY CLICKABLE COMPONENT IN THE UI MUST HAVE A "cursor-pointer" CLASS TO INDICATE THAT IT IS INTERACTIVE. This is a crucial aspect of the user experience, as it provides a visual cue to users that an element is clickable and can be interacted with. By adding the "cursor-pointer" class to all clickable components, you can improve the usability of the application and make it more intuitive for users to navigate and interact with the various features and functionalities available.
