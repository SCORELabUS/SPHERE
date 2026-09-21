# Permanent pricing links and SPACE integration

SPHERE exposes `/p/{pricingId}` for a pricing family and `/c/{collectionId}` for a collection. The UI resolves their current destination on every visit. Renaming or moving a pricing does not change its identity. Deleting the first version does not delete the family; deleting the final version tombstones its identity. Recreating a pricing with the same name creates a new ID. Collection IDs are their existing MongoDB IDs.

Private links require normal authentication and permissions. Knowing a permanent URL never grants access. Anonymous unavailable/private resources return 404. The public synchronization API always filters private versions, even for authenticated callers.

## Public API

- `GET /api/v1/permalinks/{resourceType}/{resourceId}`, with `resourceType=pricing|collection`: `{ "location": "/pricings/..." }` or the collection destination. Responses are revalidated; no permanent redirect to a mutable slug is cached.
- `GET /api/v1/public/pricings/{pricingId}`: name, permanent URL, immutable pricing identity, public version summaries and `latestVersionId`.
- `GET /api/v1/public/pricings/{pricingId}/versions/{versionId}/yaml`: currently public YAML content, with visibility checked again before sending it.

Version summaries include `versionId`, the original `version` label, `createdAt` and `contentHash`. Latest means descending pricing date (from YAML), with descending version ID as deterministic tie-breaker. Labels need not be semantic versions. The SHA-256 fingerprint canonicalizes YAML mappings and excludes `saasName`; a rename does not represent a new functional pricing snapshot. Responses support ETag/If-None-Match, but visibility is checked before any 304 response. Files are served through validated local paths with a 5 MiB synchronization limit.

Set `SPHERE_PUBLIC_URL` to the externally visible frontend base URL (default `https://sphere.score.us.es`). Existing API base path configuration still applies. SPACE accepts only `/p/` links in v1; collection permanent links are for navigation.

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
