# Channel Management API (CRUD)

A typed client for managing **channels** in the Pollen admin, built from the `Channel-management`
HAR capture using the conventions of this repo (GraphQL, env-resolved Bearer auth, secret-safe,
Playwright-compatible).

> In this product a **channel is a GraphQL `media` entity**. The admin route
> `/admin/channel-management/<id>/instore` edits it through `admin_editMedia(mediaId, input)`.

## Full list of API calls

All calls are `POST https://www.dev.pollen.js-devops.co.uk/api/graphql/?op=<op>` with
`Authorization: Bearer <azure-b2c-token>` and `content-type: application/json`. The `?op=` value is
the label the SPA attaches; the GraphQL `operationName` is the document's name.

| CRUD | `?op=` | operationName | GraphQL | In the HAR? |
|------|--------|---------------|---------|-------------|
| **Create** | `admin-create-media` | `admin_createMedia` | `mutation admin_createMedia($input: admin_MediaInput!) { admin_createMedia(input:$input){ id } }` | ❌ **inferred** |
| **Read one** | `admin_getMedia` | `admin_getMedia` | `query admin_getMedia($mediaId: ID!) { admin_getMedia(mediaId:$mediaId){ …full channel… } }` | ✅ observed |
| **Read list** | `query-admin_getEveryMedia` | `admin_getEveryMedia` | `query admin_getEveryMedia($businessGroup, $channelType, $mediaType, $isVisible, $isVisibleArgos, $planId){ admin_getEveryMedia(…){ …full channel… } }` | ✅ observed |
| **Update** | `admin-update-media` | `admin_editMedia` | `mutation admin_editMedia($mediaId: ID!, $input: admin_MediaInput!){ admin_editMedia(mediaId:$mediaId, input:$input){ id } }` | ✅ observed |
| **Delete** | `admin-delete-media` | `admin_deleteMedia` | `mutation admin_deleteMedia($mediaId: ID!){ admin_deleteMedia(mediaId:$mediaId){ id } }` | ❌ **inferred** |

**Create and Delete were not in the capture.** Their documents follow the observed
`admin_editMedia` naming convention and are flagged `observed: false` in
[`operations.ts`](src/operations.ts). Verify the real mutation name and return shape against the
GraphQL schema before relying on them (`CHANNEL_OPERATIONS.filter(o => !o.observed)`).

The exact documents are extracted verbatim from the HAR in [`documents.ts`](src/documents.ts) — the
read selection is the complete observed field set covering `inStore` / `onSite` / `offSite` /
`atHome`.

## Design — Builder + Factory

```
ChannelFactory  ──picks a recipe──▶  ChannelBuilder  ──customizes any field──▶  MediaInput
                                                                                    │
                                          ChannelApi(transport) ──CRUD──▶ GraphQL ◀─┘
```

- **Factory** ([`channelFactory.ts`](src/channelFactory.ts)) decides *which* starting payload to use:
  `inStoreTrolley()` clones the real observed "DD Trolleys" channel; `inStore()/onSite()/offSite()/atHome()`
  return minimal valid skeletons; `create(kind, overrides)` returns a ready `MediaInput`.
- **Builder** ([`channelBuilder.ts`](src/channelBuilder.ts)) customizes it. Typed fluent setters for
  common fields **plus** a generic `.set(path, value)` / `.merge(partial)` / `.unset(path)` that can
  change **any field, however deep**. `build()` validates required fields and the one-activation rule.
- **Client** ([`channelApi.ts`](src/channelApi.ts)) is one method per CRUD op over an injectable
  `GraphQLTransport` (Playwright `APIRequestContext` in tests, or `fetch` standalone).

## Change ANY field (update)

The update mutation takes the **full** `admin_MediaInput`, so changing one field is a
read → modify → write. Three ergonomic forms:

```ts
import { ChannelApi, PlaywrightGraphQLTransport } from './channel-management/src/index.js';
const api = new ChannelApi(new PlaywrightGraphQLTransport(request));

// 1) one deep field by path
await api.updateField(id, 'inStore.cost.managedService.minimumSpend', 250);

// 2) any subset of fields (deep merge)
await api.patch(id, { name: 'New name', inStore: { timeline: { bookingDeadlineDays: 30 } } });

// 3) builder callback
await api.edit(id, (b) => b.name('New name').set('inStore.setup.maxHeroSKUs', 8));
```

The read model is wider than the write input (it carries output-only fields like
`citrusAdPlacementLabel`). `ChannelBuilder.from(channel)` / `ChannelBuilder.toInput()` project the
read result down to a valid `admin_MediaInput` and strip server-managed fields (`id`, `createdAt`,
…) before sending it back.

## Create / Read / Delete

```ts
// CREATE — factory recipe + builder customization
const input = ChannelFactory.inStoreTrolley(ChannelFactory.uniqueName('QA Trolleys'))
  .description('created by QA')
  .set('inStore.cost.managedService.minimumSpend', 0)
  .build();
const created = await api.create(input);          // POST ?op=admin-create-media (inferred)

// READ
const channel  = await api.get(created.id);       // POST ?op=admin_getMedia
const channels = await api.getEvery({ businessGroup: 'sainsburys', isVisible: true });

// DELETE
await api.delete(created.id);                      // POST ?op=admin-delete-media (inferred)
```

## Auth & configuration

Resolved from env (never logged), matching the generator's conventions:

| Variable | Purpose |
|----------|---------|
| `CHANNEL_BEARER_TOKEN` | Azure B2C access token (falls back to `API_AUTHORIZATION` → `API_TOKEN`) |
| `CHANNEL_BASE_URL` | Origin override (falls back to `BASE_URL`, then the captured origin) |
| `CHANNEL_FEATURE_FLAGS` | optional `enabled-feature-flags` header value |
| `CHANNEL_TEST_MEDIA_ID` | disposable channel id for the live update test |

The token is short-lived; obtain it from the
`nectarplatformpreprod.b2clogin.com/.../oauth2/v2.0/token` endpoint (also in the HAR) or copy it
from a logged-in browser session.

## Running

```bash
# pattern logic — unit tested in the repo's vitest suite (no network)
npm run test:unit -- channelBuilderFactory

# live CRUD demo (needs a token; create/delete lifecycle is test.fixme until ops are confirmed)
CHANNEL_BEARER_TOKEN=<token> npx playwright test channel-management

# standalone script
CHANNEL_BEARER_TOKEN=<token> CHANNEL_DEMO_WRITE=true npx tsx channel-management/examples/crud-demo.ts
```

## Files

| File | Responsibility |
|------|----------------|
| [`src/documents.ts`](src/documents.ts) | Verbatim GraphQL documents from the HAR (read selection = full observed contract) |
| [`src/operations.ts`](src/operations.ts) | The 5 CRUD operations + metadata (`?op`, operationName, observed flag) |
| [`src/types.ts`](src/types.ts) | `MediaInput` (write) / `Channel` (read) domain types |
| [`src/transport.ts`](src/transport.ts) | `GraphQLTransport` + Playwright & fetch adapters, auth/base-url resolution |
| [`src/channelBuilder.ts`](src/channelBuilder.ts) | Builder — change any field, validate, project read→input |
| [`src/channelFactory.ts`](src/channelFactory.ts) | Factory — preconfigured channel recipes |
| [`src/channelApi.ts`](src/channelApi.ts) | CRUD client |
| [`src/fixtures.ts`](src/fixtures.ts) | `OBSERVED_TROLLEY_CHANNEL` — the real captured payload |
| [`tests/channel-crud.spec.ts`](tests/channel-crud.spec.ts) | Live Playwright CRUD demo |
| [`examples/crud-demo.ts`](examples/crud-demo.ts) | Standalone `fetch` demo |
| `../tests/unit/channelBuilderFactory.test.ts` | vitest unit tests for the patterns (runs in CI) |

## Caveats (SDET notes)

- **Create/Delete are inferred**, not observed — confirm the mutation names before activating.
- The capture only exercised the **`inStore`** surface; `onSite/offSite/atHome` input shapes are
  best-effort skeletons. `inStore` types are precise; the others are intentionally open.
- The read→write roundtrip strips a **denylist** of known output-only fields
  (`citrusAdPlacementLabel`, `isAudienceTargetingAvailable`, …). If the server rejects an update with
  "unknown field", add that field to `NESTED_OUTPUT_ONLY` in `channelBuilder.ts`.
