# Database Seeders — Technical Reference

> **Last updated:** 2026-05-21
> **Scope:** Local development / testing only

This document describes the complete state of the MongoDB database after running the seeder pipeline (`pnpm run dev:setup`). It serves as the authoritative reference for understanding test data, entity relationships, and the permission model as seeded.

---

## Table of Contents

1. [Seeder System Architecture](#1-seeder-system-architecture)
2. [Collections Overview](#2-collections-overview)
3. [Users](#3-users)
4. [Organizations](#4-organizations)
5. [Organization Memberships](#5-organization-memberships)
6. [Pricing Collections](#6-pricing-collections)
7. [Pricings](#7-pricings)
8. [Entity Permissions](#8-entity-permissions)
9. [Entity Relationship Diagram](#9-entity-relationship-diagram)
10. [Indexes](#10-indexes)
11. [Migrations Applied After Seeding](#11-migrations-applied-after-seeding)

---

## 1. Seeder System Architecture

### Runner

**File:** `api/src/main/database/seeders/mongo/seeder.ts`

Uses the [`mongo-seeding`](https://github.com/nicholasgriffintn/mongo-seeding) library. Key behavior:

- **`dropDatabase: true`** — the entire database is dropped before each seed run.
- Reads all subdirectories under `api/src/main/database/seeders/mongo/` via `seeder.readCollectionsFromPath()`.
- **Folder names map directly to MongoDB collection names.** For example, `users/` → `users` collection, `pricings/` → `pricings` collection.
- Each folder contains a single `.json` file with an array of documents (or a single object for `pricingCollections`).

### Execution Flow

```
pnpm run dev:setup
  └─ docker-compose up -d          # Starts MongoDB + Redis containers
  └─ npx migrate up                # Runs all migrations (seed-database migration triggers seeder)
       └─ seedDatabase()           # Drops DB, imports JSON files into collections
```

The seeder is triggered by the migration `1739210427506-seed-database.ts`, which calls `seedDatabase()` only when `ENVIRONMENT === 'development'`.

### Connection

**File:** `api/src/main/config/mongoose.ts`

```
getMongoDBConnectionURI()
```

Constructs the URI from environment variables:
`MONGO_PROTOCOL`, `MONGO_HOST`, `MONGO_PORT`, `DATABASE_USERNAME`, `DATABASE_PASSWORD`, `DATABASE_NAME`.

For non-SRV protocols, appends `?authSource=<DATABASE_NAME>`.

### Seeder Directory Structure

```
api/src/main/database/seeders/mongo/
├── seeder.ts                                    # Seeder runner
├── generateBcryptedPassword.ts                  # Utility: bcrypt hash generator
├── users/
│   └── users.json                               # 4 documents → "users" collection
├── organizations/
│   └── organizations.json                       # 4 documents → "organizations" collection
├── organizationMemberships/
│   └── organizationMemberships.json             # 10 documents → "organizationMemberships" collection
├── pricingCollections/
│   └── pricingCollections.json                  # 1 document → "pricingCollections" collection
├── pricings/
│   └── pricings.json                            # 127 documents → "pricings" collection
└── entityPermissions/
    └── entityPermissions.json                   # 15 documents → "entityPermissions" collection
```

---

## 2. Collections Overview

| Collection | Document Count | Description |
|---|---|---|
| `users` | 4 | Platform users with credentials, profiles, and settings |
| `organizations` | 4 | Organizations (1 personal, 1 shared, 2 sub-orgs) |
| `organizationMemberships` | 10 | User-org role assignments (OWNER / ADMIN / MEMBER) |
| `pricingCollections` | 1 | Named group of pricings (research dataset) |
| `pricings` | 127 | SaaS pricing page snapshots across years |
| `entityPermissions` | 15 | Granular CRUD permissions per user/org/entity |
| `notifications` | 0 | Empty (no seed data) |
| `organizationInvitations` | 0 | Empty (no seed data) |

---

## 3. Users

**Collection:** `users`
**Model:** `UserMongoose.ts`

All 4 users share the same password: `faked` (bcrypt hash with salt rounds 5).

| Field | admin | sphere | testuser | faked |
|---|---|---|---|---|
| `_id` | `63f74bf8eeed64054274b52d` | `63f74bf8eeed64058364b52e` | `63f74bf8eeed64054274b529` | `63f74bf8eeed64054274b528` |
| `username` | `admin` | `sphere` | `testuser` | `faked` |
| `email` | `admin1@admin.com` | `sphere@sphere.com` | `test_user@test.com` | `faked@acme.com` |
| `role` (platform) | `ADMIN` | `USER` | `USER` | `USER` |
| `firstName` | Admin | Sphere | Test | Faker |
| `lastName` | 1 | Admin | User | User |
| `settings.profile.displayName` | Admin 1 | Sphere Admin | Test User | Faker User |

### Settings Schema (common to all users)

Each user has a `settings` subdocument with:

- `phone`, `avatar`, `avatarBgColor`, `avatarFgColor`
- `profile`: `{ displayName, bio, city, country, dateOfBirth }`
- `socialLinks`: `{ linkedin, instagram, facebook, x }`
- `notificationPrefs`: Map with 4 notification types (`OrganizationInvitation`, `System`, `CollectionShared`, `PricingUpdated`), each with `{ email: true, inbox: true }`.

### Pre-save Hooks

- Password is re-hashed via bcrypt if the `password` field is modified.
- A `token` and `tokenExpiration` are auto-generated if not already set.
- `settings.avatar` defaults to `'static/avatars/users/default-user.webp'` if not provided.

### Unique Constraints

- `username` — unique, case-insensitive (collation `en-US`, strength 2).
- `email` — unique, validated via regex `/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/`.

---

## 4. Organizations

**Collection:** `organizations`
**Model:** `OrganizationMongoose.ts`

| Field | sphere PERSONAL | Demo Organization | Sub Organization 1 | Sub Organization 2 |
|---|---|---|---|---|
| `_id` | `63f74bf8eeed64058364b600` | `63f74bf8eeed64058364b601` | `63f74bf8eeed64058364b602` | `63f74bf8eeed64058364b603` |
| `name` | `sphere` | `demo-org` | `sub-org-1` | `sub-org-2` |
| `displayName` | sphere PERSONAL | Demo Organization | Sub Organization 1 | Sub Organization 2 |
| `isPersonal` | `true` | `false` | `false` | `false` |
| `_parentId` | — | — | `...b601` (demo-org) | `...b601` (demo-org) |
| `avatar` | `null` | `static/avatars/orgs/default-org.webp` | `null` | `null` |

### Hierarchy

```
sphere PERSONAL (personal, standalone)
    └── no parent

Demo Organization (shared)
    ├── Sub Organization 1  (_parentId → demo-org)
    └── Sub Organization 2  (_parentId → demo-org)
```

### Unique Constraints

- Compound unique: `{ name: 1, isPersonal: 1 }` with case-insensitive collation, partial filter on `deletedAt`.

---

## 5. Organization Memberships

**Collection:** `organizationMemberships`
**Model:** `OrganizationMembershipMongoose.ts`

Links users to organizations with a role. The `role` setter automatically computes `_roleWeight` (hidden field, `select: false`):

| Role | Weight |
|---|---|
| `OWNER` | 3 |
| `ADMIN` | 2 |
| `MEMBER` | 1 |

### Membership Matrix

| User | sphere PERSONAL (`...b600`) | Demo Organization (`...b601`) | Sub Org 1 (`...b602`) | Sub Org 2 (`...b603`) |
|---|---|---|---|---|
| **sphere** (`...b52e`) | OWNER | OWNER | OWNER | OWNER |
| **admin** (`...b52d`) | — | **MEMBER** | OWNER | OWNER |
| **testuser** (`...b529`) | — | ADMIN | ADMIN | ADMIN |
| **faked** (`...b528`) | — | MEMBER | — | — |

### Document List

| `_id` | `_userId` | `_organizationId` | `role` | `joinedAt` |
|---|---|---|---|---|
| `63f74bf8eeed64058364b700` | `...b52e` (sphere) | `...b600` (sphere PERSONAL) | OWNER | 2023-02-20T11:22:04Z |
| `63f74bf8eeed64058364b701` | `...b52e` (sphere) | `...b601` (demo-org) | OWNER | 2023-02-20T11:22:04Z |
| `63f74bf8eeed64058364b721` | `...b52e` (sphere) | `...b602` (sub-org-1) | OWNER | 2023-02-20T11:22:04Z |
| `63f74bf8eeed64058364b711` | `...b52e` (sphere) | `...b603` (sub-org-2) | OWNER | 2023-02-20T11:22:04Z |
| `63f74bf8eeed64058364b702` | `...b52d` (admin) | `...b601` (demo-org) | MEMBER | 2023-02-20T11:22:04Z |
| `63f740f8eeed64058364b702` | `...b52d` (admin) | `...b602` (sub-org-1) | OWNER | 2023-02-20T11:22:04Z |
| `63f74bf8eeed64018364b702` | `...b52d` (admin) | `...b603` (sub-org-2) | OWNER | 2023-02-20T11:22:04Z |
| `63f74bf8eaed64058364b703` | `...b529` (testuser) | `...b601` (demo-org) | ADMIN | 2023-02-20T11:22:04Z |
| `63f74bf8eded64052364b703` | `...b529` (testuser) | `...b602` (sub-org-1) | ADMIN | 2023-02-20T11:22:04Z |
| `63f74bf8e0ed64050364b703` | `...b529` (testuser) | `...b603` (sub-org-2) | ADMIN | 2023-02-20T11:22:04Z |
| `63f74bf8eeed64058364b704` | `...b528` (faked) | `...b601` (demo-org) | MEMBER | 2023-02-20T11:22:04Z |

### Unique Constraints

- Compound unique: `{ _userId: 1, _organizationId: 1 }` — a user can only have one role per organization.

---

## 6. Pricing Collections

**Collection:** `pricingCollections`
**Model:** `PricingCollectionMongoose.ts`

| Field | Value |
|---|---|
| `_id` | `6787d0facaeb2b25748bc12a` |
| `name` | IEEE TSC 2025 |
| `slug` | `ieee-tsc-2025` |
| `_organizationId` | `63f74bf8eeed64058364b601` (Demo Organization) |
| `description` | *This collection includes the dataset of real-world pricings presented in the paper [PAPER NAME], which has been submitted to the IEEE Transactions on Services Computing journal 2025 paper. Its primary objective is to serve as a replication package for the paper, enabling readers to review and experiment with the results in real time. Additionally, this dataset can serve as a benchmark for future research on pricing strategies in the context of cloud computing.* |
| `private` | (not set; defaults to `false` via migration) |

### Collection-Level Analytics

The collection stores aggregate evolution metrics across all its pricings:

```json
{
  "evolutionOfPlans": {
    "dates":  ["2019-05-23", "2020-05-23", "2021-05-23", "2022-05-23", "2023-05-23", "2024-05-23", "2025-05-23"],
    "values": [3, 3.5, 3.64, 3.68, 3.74, 3.71, 3.9]
  },
  "evolutionOfAddOns": {
    "dates":  ["2019-05-23", "2020-05-23", "2021-05-23", "2022-05-23", "2023-05-23", "2024-05-23", "2025-05-23"],
    "values": [0, 0.65, 1.04, 1.39, 1.87, 2.42, 3.13]
  },
  "evolutionOfFeatures": {
    "dates":  ["2019-05-23", "2020-05-23", "2021-05-23", "2022-05-23", "2023-05-23", "2024-05-23", "2025-05-23"],
    "values": [5, 30.55, 36.04, 41.42, 48.48, 53.94, 62.97]
  },
  "evolutionOfConfigurationSpaceSize": {
    "dates":  ["2019-05-23", "2020-05-23", "2021-05-23", "2022-05-23", "2023-05-23", "2024-05-23", "2025-05-23"],
    "values": [3, 13.65, 14.84, 19.55, 53.35, 151.74, 525.32]
  }
}
```

### Unique Constraints

- Compound unique: `{ name: 1, _organizationId: 1 }`
- Compound unique (sparse): `{ slug: 1, _organizationId: 1 }`

### Pre-save Hook

Auto-generates `slug` from `name` via `generateSlug()` if not provided.

---

## 7. Pricings

**Collection:** `pricings`
**Model:** `PricingMongoose.ts`

**Total documents:** 127

All pricings belong to:
- **Organization:** Demo Organization (`63f74bf8eeed64058364b601`)
- **Collection:** IEEE TSC 2025 (`6787d0facaeb2b25748bc12a`)

### Product Catalog (34 products, 127 versions)

| Product | Versions | Year Range | Currency Range | Plans Range | Features Range |
|---|---|---|---|---|---|
| Box | 6 | 2019–2024 | USD, EUR | 4–5 | 40–50 |
| Buffer | 6 | 2019–2024 | USD | 2–4 | 28–76 |
| Canva | 6 | 2019–2024 | USD, EUR | 3–4 | 19–92 |
| Clickup | 6 | 2019–2024 | USD | 4–5 | 26–136 |
| Clockify | 6 | 2019–2024 | USD | 4–6 | 24–72 |
| Crowdcast | 5 | 2020–2024 | USD | 3–4 | 16–20 |
| Databox | 6 | 2019–2024 | USD | 3–5 | 21–66 |
| Deskera | 4 | 2021–2024 | USD | 3 | 22–100 |
| Dropbox | 4 | 2021–2024 | USD, EUR | 4–5 | 52–83 |
| Evernote | 6 | 2019–2024 | USD | 3–4 | 32–80 |
| Figma | 6 | 2019–2024 | USD, EUR | 3–6 | 35–91 |
| Fleet Management | 3 | 0.0.1, 0.1.0, 1.0.0 | USD | 2 | 4 |
| Github | 6 | 2019–2024 | EUR | 3–4 | 38–81 |
| Hypercontext | 4 | 2021–2024 | USD | 3–4 | 49–63 |
| Jira | 6 | 2019–2024 | USD | 3–4 | 14–60 |
| Mailchimp | 6 | 2019–2024 | USD | 4 | 48–90 |
| Microsoft | 5 | 2020–2024 | USD | 4 | 54–60 |
| Notion | 4 | 2021–2024 | USD | 4 | 37–58 |
| Office | 1 | 2019 | USD | 3 | 44 |
| Openphone | 5 | 2020–2024 | USD | 2–3 | 18–48 |
| Overleaf | 6 | 2019–2024 | USD | 3–4 | 11–16 |
| Planable | 6 | 2019–2024 | USD | 3–4 | 5–41 |
| Postman | 5 | 2020–2024 | USD | 4 | 22–100 |
| Pumble | 4 | 2021–2024 | USD | 2–4 | 21–34 |
| Quip | 6 | 2019–2024 | USD | 3 | 15–18 |
| Salesforce | 6 | 2019–2024 | USD, EUR | 3–4 | 60–111 |
| Slack | 4 | 2019–2020, 2023–2024 | USD | 3–4 | 25–44 |
| Tableau | 6 | 2019–2024 | USD | 3 | 35–41 |
| Trustmary | 4 | 2021–2024 | USD | 3–4 | 14–45 |
| Userguiding | 5 | 2020–2024 | USD | 3 | 21–59 |
| Wrike | 6 | 2019–2024 | USD | 4–5 | 44–81 |
| Zapier | 5 | 2019–2020, 2022–2024 | USD | 4–5 | 19–51 |

### Pricing Document Schema

Each pricing document contains:

```typescript
{
  _id: ObjectId,
  name: string,                    // Product name (e.g. "Box")
  _collectionId: string,           // Reference to PricingCollection
  _organizationId: ObjectId,       // Reference to Organization
  version: string,                 // Version identifier (e.g. "2024", "1.0.0")
  currency: string,                // "USD" or "EUR"
  yaml: string,                    // Path to YAML source file
  url: string | null,              // Source URL (null for seeded data)
  private: boolean,                // false for all seeded pricings
  createdAt: Date,                 // Historical extraction date
  analytics: {                     // 30+ computed fields
    numberOfFeatures: number,
    numberOfInformationFeatures: number,
    numberOfIntegrationFeatures: number,
    numberOfIntegrationApiFeatures: number,
    numberOfIntegrationExtensionFeatures: number,
    numberOfIntegrationIdentityProviderFeatures: number,
    numberOfIntegrationWebSaaSFeatures: number,
    numberOfIntegrationMarketplaceFeatures: number,
    numberOfIntegrationExternalDeviceFeatures: number,
    numberOfDomainFeatures: number,
    numberOfAutomationFeatures: number,
    numberOfBotAutomationFeatures: number,
    numberOfFilteringAutomationFeatures: number,
    numberOfTrackingAutomationFeatures: number,
    numberOfTaskAutomationFeatures: number,
    numberOfManagementFeatures: number,
    numberOfGuaranteeFeatures: number,
    numberOfSupportFeatures: number,
    numberOfPaymentFeatures: number,
    numberOfUsageLimits: number,
    numberOfRenewableUsageLimits: number,
    numberOfNonRenewableUsageLimits: number,
    numberOfResponseDrivenUsageLimits: number,
    numberOfTimeDrivenUsageLimits: number,
    numberOfPlans: number,
    numberOfFreePlans: number,
    numberOfPaidPlans: number,
    numberOfAddOns: number,
    numberOfReplacementAddons: number,
    numberOfExtensionAddons: number,
    configurationSpaceSize: number,
    minSubscriptionPrice: number,
    maxSubscriptionPrice: number
  }
}
```

### Full Pricing ID Reference

<details>
<summary>Click to expand all 127 pricing IDs</summary>

#### Box
| ID | Version | Currency | Plans | Features | Config Space |
|---|---|---|---|---|---|
| `6787d0facaeb2b25748bc021` | 2019 | USD | 4 | 40 | 4 |
| `6787d0facaeb2b25748bc020` | 2020 | USD | 4 | 42 | 4 |
| `6787d0facaeb2b25748bc01f` | 2021 | USD | 4 | 45 | 4 |
| `6787d0facaeb2b25748bc01e` | 2022 | USD | 5 | 50 | 5 |
| `6787d0facaeb2b25748bc01d` | 2023 | EUR | 5 | 50 | 5 |
| `6787d0facaeb2b25748bc01c` | 2024 | EUR | 5 | 50 | 5 |

#### Buffer
| ID | Version | Currency | Plans | Features | Config Space |
|---|---|---|---|---|---|
| `6787d0facaeb2b25748bc027` | 2019 | USD | 3 | 28 | 3 |
| `6787d0facaeb2b25748bc026` | 2020 | USD | 3 | 31 | 3 |
| `6787d0facaeb2b25748bc025` | 2021 | USD | 2 | 62 | 3 |
| `6787d0facaeb2b25748bc024` | 2022 | USD | 4 | 71 | 7 |
| `6787d0facaeb2b25748bc023` | 2023 | USD | 4 | 76 | 7 |
| `6787d0facaeb2b25748bc022` | 2024 | USD | 4 | 76 | 7 |

#### Canva
| ID | Version | Currency | Plans | Features | Config Space |
|---|---|---|---|---|---|
| `6787d0facaeb2b25748bc02d` | 2019 | USD | 3 | 19 | 3 |
| `6787d0facaeb2b25748bc02c` | 2020 | USD | 3 | 33 | 3 |
| `6787d0facaeb2b25748bc02b` | 2021 | USD | 3 | 37 | 3 |
| `6787d0facaeb2b25748bc02a` | 2022 | USD | 3 | 37 | 3 |
| `6787d0facaeb2b25748bc029` | 2023 | EUR | 3 | 61 | 3 |
| `6787d0facaeb2b25748bc028` | 2024 | EUR | 4 | 92 | 4 |

#### Clickup
| ID | Version | Currency | Plans | Features | Config Space |
|---|---|---|---|---|---|
| `6787d0facaeb2b25748bc033` | 2019 | USD | 4 | 26 | 4 |
| `6787d0facaeb2b25748bc032` | 2020 | USD | 4 | 80 | 4 |
| `6787d0facaeb2b25748bc031` | 2021 | USD | 5 | 112 | 9 |
| `6787d0facaeb2b25748bc030` | 2022 | USD | 5 | 121 | 9 |
| `6787d0facaeb2b25748bc02f` | 2023 | USD | 4 | 136 | 13 |
| `6787d0facaeb2b25748bc02e` | 2024 | USD | 4 | 135 | 13 |

#### Clockify
| ID | Version | Currency | Plans | Features | Config Space |
|---|---|---|---|---|---|
| `6787d0facaeb2b25748bc039` | 2019 | USD | 4 | 24 | 4 |
| `6787d0facaeb2b25748bc038` | 2020 | USD | 4 | 31 | 4 |
| `6787d0facaeb2b25748bc037` | 2021 | USD | 5 | 38 | 5 |
| `6787d0facaeb2b25748bc036` | 2022 | USD | 5 | 65 | 9 |
| `6787d0facaeb2b25748bc035` | 2023 | USD | 5 | 68 | 9 |
| `6787d0facaeb2b25748bc034` | 2024 | USD | 6 | 72 | 10 |

#### Crowdcast
| ID | Version | Currency | Plans | Features | Config Space |
|---|---|---|---|---|---|
| `6787d0facaeb2b25748bc03e` | 2020 | USD | 4 | 20 | 5 |
| `6787d0facaeb2b25748bc03d` | 2021 | USD | 4 | 20 | 5 |
| `6787d0facaeb2b25748bc03c` | 2022 | USD | 3 | 16 | 4 |
| `6787d0facaeb2b25748bc03b` | 2023 | USD | 3 | 16 | 4 |
| `6787d0facaeb2b25748bc03a` | 2024 | USD | 3 | 16 | 4 |

#### Databox
| ID | Version | Currency | Plans | Features | Config Space |
|---|---|---|---|---|---|
| `6787d0facaeb2b25748bc044` | 2019 | USD | 4 | 21 | 3 |
| `6787d0facaeb2b25748bc043` | 2020 | USD | 4 | 22 | 4 |
| `6787d0facaeb2b25748bc042` | 2021 | USD | 3 | 32 | 5 |
| `6787d0facaeb2b25748bc041` | 2022 | USD | 3 | 43 | 6 |
| `6787d0facaeb2b25748bc040` | 2023 | USD | 5 | 66 | 8 |
| `6787d0facaeb2b25748bc03f` | 2024 | USD | 5 | 63 | 8 |

#### Deskera
| ID | Version | Currency | Plans | Features | Config Space |
|---|---|---|---|---|---|
| `6787d0facaeb2b25748bc048` | 2021 | USD | 3 | 22 | 3 |
| `6787d0facaeb2b25748bc047` | 2022 | USD | 3 | 63 | 7 |
| `6787d0facaeb2b25748bc046` | 2023 | USD | 3 | 63 | 7 |
| `6787d0facaeb2b25748bc045` | 2024 | USD | 3 | 100 | 8 |

#### Dropbox
| ID | Version | Currency | Plans | Features | Config Space |
|---|---|---|---|---|---|
| `6787d0facaeb2b25748bc04c` | 2021 | USD | 5 | 52 | 6 |
| `6787d0facaeb2b25748bc04b` | 2022 | USD | 5 | 54 | 7 |
| `6787d0facaeb2b25748bc04a` | 2023 | USD | 4 | 76 | 7 |
| `6787d0facaeb2b25748bc049` | 2024 | EUR | 4 | 83 | 7 |

#### Evernote
| ID | Version | Currency | Plans | Features | Config Space |
|---|---|---|---|---|---|
| `6787d0facaeb2b25748bc052` | 2019 | USD | 3 | 57 | 5 |
| `6787d0facaeb2b25748bc051` | 2020 | USD | 3 | 48 | 5 |
| `6787d0facaeb2b25748bc050` | 2021 | USD | 4 | 80 | 7 |
| `6787d0facaeb2b25748bc04f` | 2022 | USD | 3 | 77 | 5 |
| `6787d0facaeb2b25748bc04e` | 2023 | USD | 3 | 76 | 5 |
| `6787d0facaeb2b25748bc04d` | 2024 | USD | 4 | 32 | 5 |

#### Figma
| ID | Version | Currency | Plans | Features | Config Space |
|---|---|---|---|---|---|
| `6787d0facaeb2b25748bc058` | 2019 | USD | 3 | 35 | 3 |
| `6787d0facaeb2b25748bc057` | 2020 | USD | 3 | 38 | 3 |
| `6787d0facaeb2b25748bc056` | 2021 | USD | 3 | 40 | 3 |
| `6787d0facaeb2b25748bc055` | 2022 | USD | 4 | 54 | 4 |
| `6787d0facaeb2b25748bc054` | 2023 | EUR | 4 | 73 | 4 |
| `6787d0facaeb2b25748bc053` | 2024 | USD | 6 | 91 | 6 |

#### Fleet Management
| ID | Version | Currency | Plans | Features | Config Space |
|---|---|---|---|---|---|
| `67a8b01f0f009fd3b4310167` | 0.0.1 | USD | 2 | 4 | 2 |
| `67a8af9c0f009fd3b4310151` | 0.1.0 | USD | 2 | 4 | 2 |
| `6787d0facaeb2b25748bc0fe` | 1.0.0 | USD | 2 | 4 | 2 |

#### Github
| ID | Version | Currency | Plans | Features | Config Space |
|---|---|---|---|---|---|
| `6787d0facaeb2b25748bc05e` | 2019 | EUR | 4 | 38 | 4 |
| `6787d0facaeb2b25748bc05d` | 2020 | EUR | 4 | 47 | 5 |
| `6787d0facaeb2b25748bc05c` | 2021 | EUR | 3 | 49 | 5 |
| `6787d0facaeb2b25748bc05b` | 2022 | EUR | 3 | 51 | 5 |
| `6787d0facaeb2b25748bc05a` | 2023 | EUR | 3 | 73 | 5 |
| `6787d0facaeb2b25748bc059` | 2024 | EUR | 3 | 81 | 5 |

#### Hypercontext
| ID | Version | Currency | Plans | Features | Config Space |
|---|---|---|---|---|---|
| `6787d0facaeb2b25748bc062` | 2021 | USD | 3 | 50 | 5 |
| `6787d0facaeb2b25748bc061` | 2022 | USD | 3 | 49 | 5 |
| `6787d0facaeb2b25748bc060` | 2023 | USD | 3 | 49 | 5 |
| `6787d0facaeb2b25748bc05f` | 2024 | USD | 4 | 63 | 6 |

#### Jira
| ID | Version | Currency | Plans | Features | Config Space |
|---|---|---|---|---|---|
| `6787d0facaeb2b25748bc068` | 2019 | USD | 3 | 14 | 3 |
| `6787d0facaeb2b25748bc067` | 2020 | USD | 4 | 33 | 4 |
| `6787d0facaeb2b25748bc066` | 2021 | USD | 4 | 37 | 4 |
| `6787d0facaeb2b25748bc065` | 2022 | USD | 4 | 40 | 4 |
| `6787d0facaeb2b25748bc064` | 2023 | USD | 4 | 46 | 4 |
| `6787d0facaeb2b25748bc063` | 2024 | USD | 4 | 60 | 4 |

#### Mailchimp
| ID | Version | Currency | Plans | Features | Config Space |
|---|---|---|---|---|---|
| `6787d0facaeb2b25748bc06e` | 2019 | USD | 4 | 48 | 5 |
| `6787d0facaeb2b25748bc06d` | 2020 | USD | 4 | 69 | 7 |
| `6787d0facaeb2b25748bc06c` | 2021 | USD | 4 | 90 | 9 |
| `6787d0facaeb2b25748bc06b` | 2022 | USD | 4 | 89 | 9 |
| `6787d0facaeb2b25748bc06a` | 2023 | USD | 4 | 80 | 8 |
| `6787d0facaeb2b25748bc069` | 2024 | USD | 4 | 90 | 9 |

#### Microsoft
| ID | Version | Currency | Plans | Features | Config Space |
|---|---|---|---|---|---|
| `6787d0facaeb2b25748bc074` | 2020 | USD | 4 | 55 | 5 |
| `6787d0facaeb2b25748bc073` | 2021 | USD | 4 | 54 | 5 |
| `6787d0facaeb2b25748bc072` | 2022 | USD | 4 | 60 | 6 |
| `6787d0facaeb2b25748bc071` | 2023 | USD | 4 | 54 | 5 |
| `6787d0facaeb2b25748bc070` | 2024 | USD | 4 | 60 | 6 |

#### Notion
| ID | Version | Currency | Plans | Features | Config Space |
|---|---|---|---|---|---|
| `6787d0facaeb2b25748bc078` | 2021 | USD | 4 | 37 | 4 |
| `6787d0facaeb2b25748bc077` | 2022 | USD | 4 | 45 | 5 |
| `6787d0facaeb2b25748bc076` | 2023 | USD | 4 | 43 | 5 |
| `6787d0facaeb2b25748bc075` | 2024 | USD | 4 | 58 | 6 |

#### Office
| ID | Version | Currency | Plans | Features | Config Space |
|---|---|---|---|---|---|
| `6787d0facaeb2b25748bc06f` | 2019 | USD | 3 | 44 | 4 |

#### Openphone
| ID | Version | Currency | Plans | Features | Config Space |
|---|---|---|---|---|---|
| `6787d0facaeb2b25748bc07d` | 2020 | USD | 2 | 18 | 2 |
| `6787d0facaeb2b25748bc07c` | 2021 | USD | 3 | 28 | 3 |
| `6787d0facaeb2b25748bc07b` | 2022 | USD | 3 | 44 | 4 |
| `6787d0facaeb2b25748bc07a` | 2023 | USD | 3 | 45 | 4 |
| `6787d0facaeb2b25748bc079` | 2024 | USD | 3 | 48 | 5 |

#### Overleaf
| ID | Version | Currency | Plans | Features | Config Space |
|---|---|---|---|---|---|
| `6787d0facaeb2b25748bc083` | 2019 | USD | 3 | 11 | 3 |
| `6787d0facaeb2b25748bc082` | 2020 | USD | 4 | 13 | 4 |
| `6787d0facaeb2b25748bc081` | 2021 | USD | 4 | 13 | 4 |
| `6787d0facaeb2b25748bc080` | 2022 | USD | 4 | 13 | 4 |
| `6787d0facaeb2b25748bc07f` | 2023 | USD | 3 | 16 | 3 |
| `6787d0facaeb2b25748bc07e` | 2024 | USD | 3 | 16 | 3 |

#### Planable
| ID | Version | Currency | Plans | Features | Config Space |
|---|---|---|---|---|---|
| `6787d0facaeb2b25748bc089` | 2019 | USD | 3 | 5 | 2 |
| `6787d0facaeb2b25748bc088` | 2020 | USD | 4 | 18 | 4 |
| `6787d0facaeb2b25748bc087` | 2021 | USD | 4 | 18 | 4 |
| `6787d0facaeb2b25748bc086` | 2022 | USD | 4 | 23 | 5 |
| `6787d0facaeb2b25748bc085` | 2023 | USD | 4 | 27 | 5 |
| `6787d0facaeb2b25748bc084` | 2024 | USD | 4 | 41 | 7 |

#### Postman
| ID | Version | Currency | Plans | Features | Config Space |
|---|---|---|---|---|---|
| `6787d0facaeb2b25748bc08e` | 2020 | USD | 4 | 22 | 4 |
| `6787d0facaeb2b25748bc08d` | 2021 | USD | 4 | 24 | 4 |
| `6787d0facaeb2b25748bc08c` | 2022 | USD | 4 | 40 | 6 |
| `6787d0facaeb2b25748bc08b` | 2023 | USD | 4 | 39 | 6 |
| `6787d0facaeb2b25748bc08a` | 2024 | USD | 4 | 100 | 9 |

#### Pumble
| ID | Version | Currency | Plans | Features | Config Space |
|---|---|---|---|---|---|
| `6787d0facaeb2b25748bc092` | 2021 | USD | 3 | 21 | 3 |
| `6787d0facaeb2b25748bc091` | 2022 | USD | 2 | 25 | 2 |
| `6787d0facaeb2b25748bc090` | 2023 | USD | 2 | 28 | 2 |
| `6787d0facaeb2b25748bc08f` | 2024 | USD | 4 | 34 | 4 |

#### Quip
| ID | Version | Currency | Plans | Features | Config Space |
|---|---|---|---|---|---|
| `6787d0facaeb2b25748bc098` | 2019 | USD | 3 | 18 | 3 |
| `6787d0facaeb2b25748bc097` | 2020 | USD | 3 | 16 | 3 |
| `6787d0facaeb2b25748bc096` | 2021 | USD | 3 | 15 | 3 |
| `6787d0facaeb2b25748bc095` | 2022 | USD | 3 | 15 | 3 |
| `6787d0facaeb2b25748bc094` | 2023 | USD | 3 | 15 | 3 |
| `6787d0facaeb2b25748bc093` | 2024 | USD | 3 | 15 | 3 |

#### Salesforce
| ID | Version | Currency | Plans | Features | Config Space |
|---|---|---|---|---|---|
| `6787d0facaeb2b25748bc09e` | 2019 | USD | 4 | 60 | 7 |
| `6787d0facaeb2b25748bc09d` | 2020 | USD | 4 | 60 | 7 |
| `6787d0facaeb2b25748bc09c` | 2021 | USD | 4 | 60 | 7 |
| `6787d0facaeb2b25748bc09b` | 2022 | USD | 4 | 67 | 7 |
| `6787d0facaeb2b25748bc09a` | 2023 | EUR | 4 | 62 | 7 |
| `6787d0facaeb2b25748bc099` | 2024 | USD | 3 | 111 | 7 |

#### Slack
| ID | Version | Currency | Plans | Features | Config Space |
|---|---|---|---|---|---|
| `6787d0facaeb2b25748bc0a2` | 2019 | USD | 3 | 25 | 3 |
| `6787d0facaeb2b25748bc0a1` | 2020 | USD | 4 | 33 | 4 |
| `6787d0facaeb2b25748bc0a0` | 2023 | USD | 4 | 41 | 4 |
| `6787d0facaeb2b25748bc09f` | 2024 | USD | 4 | 44 | 4 |

#### Tableau
| ID | Version | Currency | Plans | Features | Config Space |
|---|---|---|---|---|---|
| `6787d0facaeb2b25748bc0a8` | 2019 | USD | 3 | 35 | 4 |
| `6787d0facaeb2b25748bc0a7` | 2020 | USD | 3 | 37 | 4 |
| `6787d0facaeb2b25748bc0a6` | 2021 | USD | 3 | 40 | 4 |
| `6787d0facaeb2b25748bc0a5` | 2022 | USD | 3 | 40 | 4 |
| `6787d0facaeb2b25748bc0a4` | 2023 | USD | 3 | 40 | 4 |
| `6787d0facaeb2b25748bc0a3` | 2024 | USD | 3 | 41 | 4 |

#### Trustmary
| ID | Version | Currency | Plans | Features | Config Space |
|---|---|---|---|---|---|
| `6787d0facaeb2b25748bc0ac` | 2021 | USD | 3 | 14 | 3 |
| `6787d0facaeb2b25748bc0ab` | 2022 | USD | 4 | 25 | 5 |
| `6787d0facaeb2b25748bc0aa` | 2023 | USD | 4 | 32 | 5 |
| `6787d0facaeb2b25748bc0a9` | 2024 | USD | 4 | 45 | 6 |

#### Userguiding
| ID | Version | Currency | Plans | Features | Config Space |
|---|---|---|---|---|---|
| `6787d0facaeb2b25748bc0b1` | 2020 | USD | 3 | 21 | 3 |
| `6787d0facaeb2b25748bc0b0` | 2021 | USD | 3 | 43 | 5 |
| `6787d0facaeb2b25748bc0af` | 2022 | USD | 3 | 43 | 5 |
| `6787d0facaeb2b25748bc0ae` | 2023 | USD | 3 | 45 | 5 |
| `6787d0facaeb2b25748bc0ad` | 2024 | USD | 3 | 59 | 6 |

#### Wrike
| ID | Version | Currency | Plans | Features | Config Space |
|---|---|---|---|---|---|
| `6787d0facaeb2b25748bc0b7` | 2019 | USD | 4 | 44 | 5 |
| `6787d0facaeb2b25748bc0b6` | 2020 | USD | 4 | 45 | 5 |
| `6787d0facaeb2b25748bc0b5` | 2021 | USD | 5 | 53 | 7 |
| `6787d0facaeb2b25748bc0b4` | 2022 | USD | 5 | 75 | 9 |
| `6787d0facaeb2b25748bc0b3` | 2023 | USD | 5 | 81 | 9 |
| `6787d0facaeb2b25748bc0b2` | 2024 | USD | 5 | 81 | 9 |

#### Zapier
| ID | Version | Currency | Plans | Features | Config Space |
|---|---|---|---|---|---|
| `6787d0facaeb2b25748bc0bc` | 2019 | USD | 5 | 19 | 3 |
| `6787d0facaeb2b25748bc0bb` | 2020 | USD | 5 | 21 | 3 |
| `6787d0facaeb2b25748bc0ba` | 2022 | USD | 5 | 31 | 4 |
| `6787d0facaeb2b25748bc0b9` | 2023 | USD | 5 | 51 | 6 |
| `6787d0facaeb2b25748bc0b8` | 2024 | USD | 4 | 51 | 6 |

</details>

### Unique Constraints

- Compound unique: `{ name: 1, _organizationId: 1, version: 1, _collectionId: 1 }`

---

## 8. Entity Permissions

**Collection:** `entityPermissions`
**Model:** `EntityPermissionMongoose.ts`

Provides granular, per-entity CRUD permission control. All 15 seeded permissions are granted to the **admin** user within **Demo Organization**, granted by the **sphere** user.

### Permission Scoping Model

Entity permissions support two scoping levels:

1. **Org-scoped** (`entityId: null`): Applies to all entities of the given type within the organization. Acts as a baseline/fallback permission.
2. **Entity-scoped** (`entityId: <ObjectId>`): Applies to a specific entity. Overrides the org-scoped permission for that entity.

The unique compound index `{ _userId, _organizationId, entityType, entityId }` allows **one org-scoped + one entity-scoped** record per user/org/type combination (MongoDB treats `null` as a distinct value in unique indexes).

### Seeded Permissions for admin (`...b52d`) in Demo Organization (`...b601`)

| # | entityType | entityId | Entity Name | GET | PUT | DELETE | CREATE | Effective Access |
|---|---|---|---|---|---|---|---|---|
| 1 | `collection` | `null` | *(all collections in org)* | yes | yes | yes | yes | Full CRUD on all collections |
| 2 | `collection` | `6787d0facaeb2b25748bc12a` | IEEE TSC 2025 | yes | no | no | no | Read-only (specific collection) |
| 3 | `pricing` | `null` | *(all pricings in org)* | yes | no | no | yes | Read + Create on all pricings |
| 4 | `pricing` | `6787d0facaeb2b25748bc01c` | Box 2024 | yes | yes | no | no | Read + Update |
| 5 | `pricing` | `6787d0facaeb2b25748bc01d` | Box 2023 | yes | yes | no | no | Read + Update |
| 6 | `pricing` | `6787d0facaeb2b25748bc01e` | Box 2022 | yes | no | no | no | Read-only |
| 7 | `pricing` | `6787d0facaeb2b25748bc022` | Buffer 2024 | yes | yes | yes | no | Read + Update + Delete |
| 8 | `pricing` | `6787d0facaeb2b25748bc023` | Buffer 2023 | yes | yes | yes | no | Read + Update + Delete |
| 9 | `pricing` | `6787d0facaeb2b25748bc028` | Canva 2024 | yes | no | no | no | Read-only |
| 10 | `pricing` | `6787d0facaeb2b25748bc029` | Canva 2023 | yes | no | no | no | Read-only |
| 11 | `pricing` | `6787d0facaeb2b25748bc02e` | Clickup 2024 | yes | yes | no | yes | Read + Update + Create |
| 12 | `pricing` | `6787d0facaeb2b25748bc02f` | Clickup 2023 | yes | yes | no | yes | Read + Update + Create |
| 13 | `pricing` | `6787d0facaeb2b25748bc034` | Clockify 2024 | yes | no | no | no | Read-only |
| 14 | `pricing` | `6787d0facaeb2b25748bc035` | Clockify 2023 | yes | no | no | no | Read-only |
| 15 | `pricing` | `6787d0facaeb2b25748bc036` | Clockify 2022 | yes | no | no | no | Read-only |

### Permission Document Schema

```typescript
{
  _id: ObjectId,
  _userId: ObjectId,              // ref User — who holds the permission
  _organizationId: ObjectId,      // ref Organization — scope
  entityType: 'pricing' | 'collection',
  entityId: ObjectId | null,      // null = org-scoped (applies to all of entityType)
  permissions: {
    GET: boolean,                 // Read access
    PUT: boolean,                 // Update access
    DELETE: boolean,              // Delete access
    CREATE: boolean               // Create access
  },
  grantedBy: ObjectId,            // ref User — who granted this permission
  createdAt: Date,
  updatedAt: Date
}
```

### Key Design Notes

- The `grantedBy` field records who granted the permission (here, always `sphere`).
- `permissions.CREATE` was added later via migration `1781000000000-add-create-permission.ts`. Existing documents received a default `false`.
- The compound unique index is recreated in that migration to accommodate the new field.
- The `entityId` field uses Mongoose `get`/`set` transforms to handle ObjectId conversion, so `null` values are properly managed.

### Indexes

| Index | Type | Purpose |
|---|---|---|
| `{ _userId: 1, _organizationId: 1, entityType: 1, entityId: 1 }` | Unique compound | Enforces one permission record per user/org/type/entity combination |
| `{ _organizationId: 1 }` | Non-unique | Fast lookup of all permissions within an organization |
| `{ _userId: 1, entityType: 1 }` | Non-unique | Fast lookup of a user's permissions by entity type |

---

## 9. Entity Relationship Diagram

```
┌─────────────┐       ┌────────────────────────┐       ┌─────────────────────┐
│    users     │       │ organizationMemberships │       │   organizations     │
├─────────────┤       ├────────────────────────┤       ├─────────────────────┤
│ _id (PK)    │──┐    │ _id (PK)               │    ┌──│ _id (PK)            │
│ username     │  │    │ _userId (FK → users)    │────┘  │ name                │
│ password     │  │    │ _organizationId (FK)    │────┘   │ displayName         │
│ role         │  │    │ role (OWNER/ADMIN/MEMBER)│       │ description         │
│ firstName    │  │    │ _roleWeight (computed)   │       │ avatar              │
│ lastName     │  │    │ joinedAt                │       │ isPersonal          │
│ email        │  │    └────────────────────────┘       │ _parentId (FK→self) │
│ settings     │  │                                      │ ancestors           │
│ token        │  │    ┌────────────────────────┐       └─────────────────────┘
│ apiKeys      │  │    │  entityPermissions      │                │
└─────────────┘  │    ├────────────────────────┤                │
                 │    │ _id (PK)               │                │
                 │    │ _userId (FK → users)    │────┐           │
                 │    │ _organizationId (FK)    │────┘           │
                 │    │ entityType              │                │
                 │    │ entityId (FK → entity)  │                │
                 └────│ permissions {GET,PUT,   │                │
                      │   DELETE,CREATE}        │                │
                      │ grantedBy (FK → users)  │                │
                      │ createdAt, updatedAt    │                │
                      └────────────────────────┘                │
                                                                │
         ┌──────────────────────────────────────────────────────┘
         │
         ▼
┌────────────────────────┐       ┌─────────────────────┐
│      pricings           │       │  pricingCollections  │
├────────────────────────┤       ├─────────────────────┤
│ _id (PK)               │       │ _id (PK)            │
│ name                    │       │ name                │
│ _collectionId (FK)      │──────▶│ slug                │
│ _organizationId (FK)    │──────▶│ _organizationId (FK)│
│ version                 │       │ description         │
│ currency                │       │ private             │
│ yaml                    │       │ analytics {evolution}│
│ private                 │       └─────────────────────┘
│ analytics (30+ fields)  │
│ createdAt               │
└────────────────────────┘
```

### Relationship Summary

| Relationship | Type | Description |
|---|---|---|
| `organizationMemberships._userId` → `users._id` | N:1 | Each membership belongs to one user |
| `organizationMemberships._organizationId` → `organizations._id` | N:1 | Each membership belongs to one organization |
| `organizations._parentId` → `organizations._id` | N:1 (self) | Sub-organizations reference a parent |
| `pricings._organizationId` → `organizations._id` | N:1 | Each pricing belongs to one organization |
| `pricings._collectionId` → `pricingCollections._id` | N:1 | Each pricing belongs to one collection |
| `pricingCollections._organizationId` → `organizations._id` | N:1 | Each collection belongs to one organization |
| `entityPermissions._userId` → `users._id` | N:1 | Each permission belongs to one user |
| `entityPermissions._organizationId` → `organizations._id` | N:1 | Each permission is scoped to one organization |
| `entityPermissions.grantedBy` → `users._id` | N:1 | Records who granted the permission |

---

## 10. Indexes

### `users`

| Index | Type | Fields |
|---|---|---|
| `username_1` | Unique | `{ username: 1 }` — case-insensitive collation `en-US` strength 2 |
| `email_1` | Unique | `{ email: 1 }` |
| `apiKeys.key_1` | Non-unique | `{ 'apiKeys.key': 1 }` — for API key lookup |

### `organizations`

| Index | Type | Fields | Notes |
|---|---|---|---|
| `name_1_isPersonal_1` | Unique compound | `{ name: 1, isPersonal: 1 }` | Case-insensitive, partial filter on `deletedAt` |
| `_parentId_1` | Non-unique | `{ _parentId: 1 }` | Sub-organization lookup |
| `ancestors_1` | Non-unique | `{ ancestors: 1 }` | Ancestor-based queries |

### `organizationMemberships`

| Index | Type | Fields |
|---|---|---|
| `_userId_1_organizationId_1` | Unique compound | `{ _userId: 1, _organizationId: 1 }` |
| `_organizationId_1` | Non-unique | `{ _organizationId: 1 }` |
| `_userId_1` | Non-unique | `{ _userId: 1 }` |

### `pricings`

| Index | Type | Fields |
|---|---|---|
| `name_1_organizationId_1_version_1__collectionId_1` | Unique compound | `{ name: 1, _organizationId: 1, version: 1, _collectionId: 1 }` |

### `pricingCollections`

| Index | Type | Fields | Notes |
|---|---|---|---|
| `name_1_organizationId_1` | Unique compound | `{ name: 1, _organizationId: 1 }` | |
| `slug_1_organizationId_1` | Unique compound (sparse) | `{ slug: 1, _organizationId: 1 }` | Sparse: allows multiple null slugs |

### `entityPermissions`

| Index | Type | Fields |
|---|---|---|
| `_userId_1_organizationId_1_entityType_1_entityId_1` | Unique compound | `{ _userId: 1, _organizationId: 1, entityType: 1, entityId: 1 }` |
| `_organizationId_1` | Non-unique | `{ _organizationId: 1 }` |
| `_userId_1_entityType_1` | Non-unique | `{ _userId: 1, entityType: 1 }` |

### `notifications`

| Index | Type | Fields |
|---|---|---|
| `_userId_1_read_1` | Non-unique | `{ _userId: 1, read: 1 }` |
| `_userId_1_createdAt_-1` | Non-unique | `{ _userId: 1, createdAt: -1 }` |

### `organizationInvitations`

| Index | Type | Fields |
|---|---|---|
| `code_1` | Unique | `{ code: 1 }` |

---

## 11. Migrations Applied After Seeding

The seeder runs via the `seed-database` migration. After seeding, additional migrations execute in order:

| # | Migration | Purpose |
|---|---|---|
| 1 | `1739210427506-seed-database` | Drops DB and imports JSON seed files (dev only) |
| 2 | `1739211122208-pricings-private-flag` | Adds `private: false` to pricings missing the field |
| 3 | `1739212857394-private-and-description-in-collections` | Adds `description` and `private: false` to collections missing them |
| 4 | `1739545536480-add-collection-analytics` | Computes collection-level analytics by aggregating pricing data via `$lookup` |
| 5 | `1741562045508-collection-index-pricings` | Drops old pricing index, creates new compound index with `_collectionId` |
| 6 | `1777535727000-add-user-roles` | Renames `userType` → `role` (uppercased) on user documents |
| 7 | `1777879340000-rename-extractionDate` | Renames `extractionDate` → `createdAt` on pricing documents |
| 8 | `1777879350000-replace-owner-with-organization` | Replaces `owner` (username string) with `_organizationId` (ObjectId) on pricings and collections; recreates indexes |
| 9 | `1779000000000-create-entity-permissions` | Creates indexes on `entityPermissions` collection |
| 10 | `1780000000000-migrate-user-settings` | Migrates flat user fields into nested `settings` subdocument |
| 11 | `1781000000000-add-create-permission` | Adds `permissions.CREATE` field to entity permissions; recreates unique index |

---

## Quick Reference: Test Credentials

| User | Email | Password | Platform Role |
|---|---|---|---|
| `admin` | `admin1@admin.com` | `faked` | ADMIN |
| `sphere` | `sphere@sphere.com` | `faked` | USER |
| `testuser` | `test_user@test.com` | `faked` | USER |
| `faked` | `faked@acme.com` | `faked` | USER |
