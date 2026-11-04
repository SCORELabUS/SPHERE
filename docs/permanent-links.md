# Permanent pricing links and SPACE integration

SPHERE exposes `/p/{pricingId}` for a pricing family and `/c/{collectionId}` for a collection. The UI resolves their current destination on every visit. Renaming or moving a pricing does not change its identity. Deleting the first version does not delete the family; deleting the final version tombstones its identity. Recreating a pricing with the same name creates a new ID. Collection IDs are their existing MongoDB IDs.

Private links require normal authentication and permissions. Knowing a permanent URL never grants access. Anonymous unavailable/private resources return 404. The public synchronization API filters private versions for anonymous callers and for authenticated callers who may not read them. A caller authenticated with `Authorization: Bearer <token>` or `x-api-key: sk-...` who may read the pricing (OWNER/ADMIN of its organization, global ADMIN through a token, or GET permission on the pricing or its collection; API keys are limited by their scope, so a `VIEW` key reads as MEMBER and a key scoped to another organization grants nothing) also receives the private versions, each flagged `"private": true`. Authenticated responses are sent with `Cache-Control: private, no-store`; every response carries `Vary: Authorization, x-api-key`. An invalid or expired credential is rejected with 401, as on the rest of the API.

The same rule applies to the YAML files under `/static`. The file of a private version is only served to a caller who may read that version (`Authorization: Bearer <token>` or `x-api-key`, with the same role, entity-permission and API key scope rules as the rest of the API), with `Cache-Control: private, no-store`. For anyone else it is answered exactly like a file that does not exist. Files under `static/pricings/uploaded/` and `static/collections/` that no pricing version references (drafts, files left after deleting a version) are not served. Public versions, the seeded datasets, templates and avatars are served as before.

## Public API

- `GET /api/v1/permalinks/{resourceType}/{resourceId}`, with `resourceType=pricing|collection`: `{ "location": "/pricings/..." }` or the collection destination. Responses are revalidated; no permanent redirect to a mutable slug is cached.
- `GET /api/v1/public/pricings/{pricingId}`: name, permanent URL, immutable pricing identity, version summaries visible to the caller and `latestVersionId` (the newest of them, so it can be a private version for an authorized caller).
- `GET /api/v1/public/pricings/{pricingId}/versions/{versionId}/yaml`: YAML content of a version visible to the caller, with visibility checked again before sending it.
- `GET /api/v1/public/pricings/{pricingId}/download`: ZIP archive with every version visible to the caller.

Version summaries include `versionId`, the original `version` label, `createdAt`, `contentHash` and, only on private versions, `private: true`. Latest means descending pricing date (from YAML), with descending version ID as deterministic tie-breaker. Labels need not be semantic versions. The SHA-256 fingerprint canonicalizes YAML mappings and excludes `saasName`; a rename does not represent a new functional pricing snapshot. Responses support ETag/If-None-Match, but visibility is checked before any 304 response. Files are served through validated local paths with a 5 MiB synchronization limit.

Set `SPHERE_PUBLIC_URL` to the externally visible frontend base URL (default `https://sphere.score.us.es`). Existing API base path configuration still applies. SPACE accepts only `/p/` links in v1; collection permanent links are for navigation.

## Version links

`/p/{pricingId}?version={versionId}` opens one version of a pricing family. `versionId` is the ID of that version (the MongoDB `_id` of its pricing document, 24 hexadecimal characters), the same `versionId` listed by `GET /api/v1/public/pricings/{pricingId}` and stored by SPACE in `pricing.sphere.versionId`. The exact version name (`?version=2024`, case sensitive) is accepted too, since names are unique within a family; a value that is both an ID and a name is taken as the ID. `/p/{pricingId}` without `version` keeps working as before.

`GET /api/v1/permalinks/pricing/{pricingId}?version=...` answers with `version={versionId}` in the location when the version belongs to the family and the caller may see it. A private version takes the same permission as a fully private pricing (OWNER/ADMIN of the organization, global ADMIN through a user token, or GET permission on the pricing or its collection; API keys limited by their scope). A version that is unknown, malformed, of another family, or private and not readable by the caller is ignored: the answer is exactly the one for the link without `version` (the family's location, or 404 when the caller may see none of it). It never says whether a hidden version exists.

The permalink page forwards `?version=` to the API and keeps the query and fragment of the location it gets. The pricing page opens the version named by `?version=` when it lists it (it only lists versions the viewer may see) and the newest one otherwise.

## Migration and rollout

1. Back up MongoDB and pricing YAML files. Pause pricing writes.
2. Run the normal API migration mechanism (`pnpm --dir api exec migrate up`), including `1790000000000-pricing-identities.ts`.
3. The migration preflights name/organization/collection families and rejects duplicate versions, conflicting slugs or reused identities. It creates one `pricingIdentities` document per family, assigns `pricingId` to versions and adds unique indexes. Repeating it preserves IDs.
4. Resume writes with the new API, verify public and authorized private links, then deploy the frontend.
5. Enable SPACE integration only after testing the public manifest and download endpoints. Configure SPACE's trusted origin before enabling its periodic worker.

Seeded development data receives the same identity migration after import. Runtime pricing creation assigns an identity before inserting versions. Do not restore an old database over published identity records: IDs must remain stable. A code rollback can leave additive identity fields intact; the down migration deliberately refuses to erase permanent identities.

## Verification

Unit suite:

```sh
pnpm --dir api exec vitest run src/test/unit-tests
pnpm run build
```

Opt-in MongoDB tests use and delete only `mongodb://127.0.0.1:27981/sphere_permalink_test`, with temporary YAML under `/tmp/sphere-permanent-link-test`:

```sh
SPHERE_SYNC_TEST_MONGO=true pnpm --dir api exec vitest run src/test/unit-tests/permanent-links.test.ts
```

Run that command only against a dedicated disposable MongoDB instance. It tests migration idempotency, ambiguity rejection, renaming, moving, collection renaming, first-version deletion, final deletion/recreation, private visibility and ETag revalidation.
