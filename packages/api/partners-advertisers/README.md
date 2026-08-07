# Partners / Advertisers API (CRUD)

A typed client for managing **advertisers** (and their **partner** relationship) in the Pollen admin,
built from the `Partners-advertisers` HAR capture using this repo's conventions (GraphQL, env-resolved
Bearer auth, secret-safe, Playwright-compatible).

> The primary entity is an **Advertiser**. Advertisers belong to a **partner**, so the read calls take
> a `partnerId`, and there is an observed mutation to assign an advertiser to an external partner.

## Full list of API calls

All calls are `POST https://www.dev.pollen.js-devops.co.uk/api/graphql/?op=<op>` with
`Authorization: Bearer <azure-b2c-token>` and `content-type: application/json`.

| CRUD                      | `?op=` / operationName                        | GraphQL                                                                                         | In the HAR?     |
| ------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------- |
| **Create**                | `admin_createAdvertiser`                      | `mutation admin_createAdvertiser($input: admin_AdvertiserInput!){ … { id } }`                   | ❌ **inferred** |
| **Read one**              | `admin_getAdvertiser`                         | `query admin_getAdvertiser($advertiserId: ID!, $partnerId: ID!){ … }`                           | ✅ observed     |
| **Read list**             | `admin_getAdvertisers`                        | `query admin_getAdvertisers($partnerId: ID!){ … }`                                              | ✅ observed     |
| **Update**                | `admin_editAdvertiser`                        | `mutation admin_editAdvertiser($advertiserId: ID!, $input: admin_AdvertiserInput!){ … { id } }` | ❌ **inferred** |
| **Delete**                | `admin_deleteAdvertiser`                      | `mutation admin_deleteAdvertiser($advertiserId: ID!){ … { id } }`                               | ❌ **inferred** |
| **Assign to partner**     | `admin_assignAdvertiserToExternalPartner`     | `mutation …($advertiserId: ID!, $partnerId: ID!){ … { id } }`                                   | ✅ observed     |
| **Unassign from partner** | `admin_unassignAdvertiserFromExternalPartner` | inverse mutation                                                                                | ❌ **inferred** |
| Companies (lookup)        | `base_getCompanies`                           | `query base_getCompanies { base_getCompanies { id name } }`                                     | ✅ observed     |

**Create / Update / Delete / Unassign were not in the capture.** Their documents follow the observed
naming convention and are flagged `observed: false` in [`operations.ts`](src/operations.ts); the
`admin_AdvertiserInput` shape is inferred from the read selection. The credentialed lifecycle runs
these operations and reports any GraphQL schema mismatch as a test failure; use a disposable target.
The exact observed documents are in [`documents.ts`](src/documents.ts).

## Design — Builder + Factory

```
AdvertiserFactory  ──picks a recipe──▶  AdvertiserBuilder  ──change any field──▶  AdvertiserInput
                                                                                       │
                                       AdvertiserApi(transport) ──CRUD/assign──▶ GraphQL ◀┘
```

- **Factory** ([`advertiserFactory.ts`](src/advertiserFactory.ts)): `sample()` (realistic seed) or
  `minimal(name)` (skeleton) → a pre-seeded builder.
- **Builder** ([`advertiserBuilder.ts`](src/advertiserBuilder.ts)): typed fluent setters **plus** a
  generic `.set(path, value)` / `.merge(partial)` / `.unset(path)` that changes **any field**.
- **Client** ([`advertiserApi.ts`](src/advertiserApi.ts)): one method per operation over an
  injectable `GraphQLTransport`. Carries a default `partnerId` (constructor or `ADVERTISER_PARTNER_ID`).

## Change ANY field (update)

The update mutation takes the **full** `admin_AdvertiserInput`, so changing one field is read →
modify → write (the read needs the partner context):

```ts
import {
  AdvertiserApi,
  PlaywrightGraphQLTransport,
} from "./partners-advertisers/src/index.js";
const api = new AdvertiserApi(new PlaywrightGraphQLTransport(request), {
  partnerId,
});

// 1) one field by path
await api.updateField(advertiserId, "goldClient", true);
await api.updateField(advertiserId, "brands[0].displayName", "New Brand");

// 2) any subset of fields (deep merge)
await api.patch(advertiserId, {
  strategicClient: true,
  websiteUrl: "https://x.com",
});

// 3) builder callback
await api.edit(advertiserId, (b) =>
  b.goldClient(true).websiteUrl("https://x.com"),
);
```

`AdvertiserBuilder.from(advertiser)` / `.toInput()` project the read result down to a valid
`admin_AdvertiserInput`, stripping server-managed fields (`id`, `createdAt`, `activeChannels`,
`agencyBaseAdvertiserMapper`) and output-only nested fields (`availableChannels`).

## Create / Read / Delete / Assign

```ts
// CREATE — factory recipe + builder customization
const input = AdvertiserFactory.sample(
  AdvertiserFactory.uniqueName("QA Advertiser"),
)
  .goldClient(true)
  .build();
const created = await api.create(input); // ?op=admin_createAdvertiser (inferred)

// READ (need a partner context)
const advertiser = await api.get(created.id); // ?op=admin_getAdvertiser
const advertisers = await api.list(); // ?op=admin_getAdvertisers
const companies = await api.getCompanies(); // ?op=base_getCompanies

// PARTNER relationship
await api.assignToPartner(created.id); // observed
await api.unassignFromPartner(created.id); // inferred

// DELETE
await api.delete(created.id); // ?op=admin_deleteAdvertiser (inferred)
```

## Auth & configuration (env, never logged)

| Variable                   | Purpose                                                                  |
| -------------------------- | ------------------------------------------------------------------------ |
| `ADVERTISER_BEARER_TOKEN`  | Azure B2C access token (falls back to `API_AUTHORIZATION` → `API_TOKEN`) |
| `ADVERTISER_PARTNER_ID`    | default partner context for reads/assign                                 |
| `ADVERTISER_BASE_URL`      | origin override (falls back to `BASE_URL`)                               |
| `ADVERTISER_FEATURE_FLAGS` | optional `enabled-feature-flags` header                                  |
| `ADVERTISER_TEST_ID`       | disposable advertiser id for the live update test                        |

Observed ids (handy for live read tests): advertiser `5f9ff4589a3425000931293a`, partner
`6a1eceda422c9d574e7e69af` (also exported as `OBSERVED_ADVERTISER_ID` / `OBSERVED_PARTNER_ID`).

## Running

```bash
npm run test:unit -- advertiserBuilderFactory          # pattern logic (no network, runs in CI)
ADVERTISER_BEARER_TOKEN=<t> ADVERTISER_PARTNER_ID=<p> npx playwright test partners-advertisers
ADVERTISER_BEARER_TOKEN=<t> ADVERTISER_PARTNER_ID=<p> \
  npx tsx partners-advertisers/examples/crud-demo.ts
```

## Caveats (SDET notes)

- **Create/Update/Delete/Unassign are inferred**, not observed. Their operation names and
  `admin_AdvertiserInput` shape are validated by the credentialed lifecycle at execution time.
- The capture had **no response bodies**, so [`fixtures.ts`](src/fixtures.ts) is a representative
  sample built from the read selection — adjust values to your data.
- Reads require a `partnerId`; the client fails fast with a clear error if none is configured.
- If the server rejects an update with "unknown field", add that field to `NESTED_OUTPUT_ONLY` /
  `TOP_LEVEL_OUTPUT_ONLY` in `advertiserBuilder.ts`.
