# Nectar AI knowledge notes

Last updated: 2026-07-06

Source basis:

- `/Users/maybebest/Documents/sains-project-qa-notes.md`
- Source folder: `/Users/maybebest/Downloads/Telegram Desktop/sains`
- Live dev run from 2026-07-05 against `https://www.dev.rtd.js-devops.co.uk/planning/nectar-ai`

## 1. What Nectar AI Is

Nectar AI is the conversational media planning entry point for the Sains/N360 Pollen Media Planning AI workstream.

Its main job is to help a media planner create or edit a media plan by collecting:

- advertiser
- brand
- objective
- Measurement SKUs
- Hero SKUs
- media channels
- budgets
- campaign timelines
- channel-specific details such as store counts or Secondary Space assets

The assistant builds and maintains a summary panel, validates user input against channel configuration, and saves the resulting draft for later Pollen/booking/CRM processing.

Current known dev entry point:

- `https://www.dev.rtd.js-devops.co.uk/planning/nectar-ai`

Known live-run route example:

- `/planning/nectar-ai/3588edd707434573a46081b2`

Saved plans can open in regular Pollen, for example:

- `/planning/self-serve-plan/6a4a9b576ec8a640dbafa863/channels-and-media`

## 2. Core Product Flow

The expected high-level flow is:

1. Open the planning workspace and start Nectar AI.
2. Select advertiser and brand.
3. Enter or select the campaign objective.
4. Search and select Measurement SKUs.
5. Select Hero SKUs.
6. Add one or more media channels.
7. Provide budget and timeline.
8. Resolve channel-specific validation and follow-up questions.
9. Review the summary panel.
10. Save the plan as draft.
11. Optionally download CSV or open the saved plan in Pollen.

Nectar AI should ask for missing required information instead of guessing. It can process multiple channels in one prompt, but each channel must still be validated independently.

## 3. Important Business Concepts

### Measurement SKUs

Measurement SKUs are the base campaign SKUs. At least one Measurement SKU is required before the flow can proceed.

Expected behavior:

- confirm is disabled until at least one Measurement SKU is selected
- selected SKUs appear in the summary
- duplicates should be handled cleanly
- invalid or malformed SKU IDs should produce a clear correction path

### Hero SKUs

Hero SKUs are promoted/emphasized SKUs. They can be selected globally or adjusted per channel.

Expected behavior:

- global Hero SKUs pre-populate each selected channel
- channel-level Hero SKU edits affect only that channel
- later requirements expand Hero SKU selection to all SKUs linked to the selected brand
- if a Hero SKU was not initially in Measurement SKUs but is brand-linked, MP AI should auto-add it to Measurement SKUs
- `StateData.campaign_skus.is_hero` should stay in sync after channel edits and deletions

Important edge cases:

- Hero SKU min/max limits may be configured per channel
- too many or too few Hero SKUs should block or warn before booking
- if a channel using a Hero SKU is deleted, that SKU should stop being marked Hero if no remaining channel uses it

### Channels

Channels are validated against Channel Management configuration.

Known channel groups to cover:

- onsite
- offsite
- at home
- in-store

Channel validation can include:

- advertiser/brand eligibility
- booking deadline
- minimum campaign duration
- min/max store count
- Hero SKU min/max limits
- HFSS/category restrictions
- Secondary Space/PiggyBack configuration
- pricing/rate model rules

### Timeline Rules

Booking deadline and minimum campaign duration are channel-specific.

Expected behavior:

- start date too close to today is blocked when a booking deadline exists
- date range shorter than minimum duration is blocked
- boundary values exactly at the configured limit should be accepted
- channels without those settings should not be blocked by those specific rules
- tests should use dates generated relative to the current run date, not hard-coded past dates

### Store Count Rules

Some in-store channels require store count validation.

Expected behavior:

- store count below min is blocked
- store count above max is blocked
- store count within range is accepted
- if min/max is removed, the old range must not keep blocking the user

Known future risk:

- a product may be listed in fewer stores than the channel minimum; this business rule needs confirmation if it is in current scope

## 4. Secondary Space / PiggyBack Assets

Secondary Space is driven by `piggyBackAssetTypes`.

Source priority:

1. Base is the primary source.
2. Pollen cache is fallback when Base is unavailable.

Expected behavior:

- empty `piggyBackAssetTypes` means standard planning flow
- non-empty `piggyBackAssetTypes` starts the Secondary Space flow
- mandatory and optional assets are collected separately
- mandatory asset quantity defaults to 1
- allowed quantity range is 1-10
- optional assets can be selected with quantities or skipped
- selected data is saved per channel as `piggyBackAssets`

Saved Secondary Space data should include:

- `id`
- `quantity`
- `name`
- `mandatory`

Known UI/business risks:

- `N selected` should display the sum of quantities, not the number of selected asset rows
- confirmed Secondary Space fields become disabled in the chat flow
- edits should happen through the summary modal
- the summary modal should not include the `Assign all` shortcut
- internal/external user visibility must respect `Only visible to internal`

## 5. Pricing / Rates / Costing

Pricing documentation was present but not fully extracted by local tooling.

PDF sources:

- `NUP-Pricing Models in Channel Management-210626-174057.pdf`
- `NUP-Instore & At Home Cost Calculations-210626-174055.pdf`
Known pricing areas from extracted docs/tasks:

- Rates Management for Print Magazine / Nectar App
- onsite client- and brand-specific rates
- offsite rates
- in-store flat fee
- in-store multiplier
- channel-specific rates
- self-serve vs managed-serve costings
- cost per store
- cost per unit
- base rate
- fixed cost

Known live-run observation:

- prompt budget `7k` for Offsite Meta displayed/saved as `GBP 7,010`
- expected formula is not yet confirmed
- pricing/costing assertions need deeper PDF extraction or manual confirmation

## 6. Integrations

### Nectar AI

Purpose:

- conversational creation and parsing of media plans

Risks:

- prompt misread
- duplicate values
- missing fields
- wrong validation path
- unsafe guessing instead of follow-up questions

### Pollen

Purpose:

- regular planning app / saved plan editing
- channel and SKU media source
- fallback cache for Secondary Space

Risks:

- stale cache
- mismatch with Base
- saved plan differs from Nectar AI summary

### Base

Purpose:

- primary Secondary Space configuration source

Risks:

- unavailable Base should fall back to Pollen cache
- mismatched mandatory/optional flags
- incorrect internal-only asset/channel visibility

### MongoDB

Purpose:

- saves plan/channel/Secondary Space state

Risks:

- partial saves
- stale values after edit/delete
- incorrect Hero SKU flags
- missing `piggyBackAssets`

### CRM / booking

Purpose:

- receives selected channel and Secondary Space details after save/booking flow

Risks:

- wrong payload
- missing quantities
- unclear send timing: channel-by-channel vs final save
- avoid destructive downstream tests unless explicitly approved

### Activation Hub

Purpose:

- visibility of booking details for internal/external users

Risks:

- internal-only media or assets exposed to external users

## 7. Live Dev Run Findings From 2026-07-05

Environment:

- dev
- authenticated Chrome profile
- visible user greeting: `Hi Denys,`

Test data used:

- advertiser: `N360_Unilever_MS`
- brand: `Unilever | Knorr | MS`
- objective: `Customer retention`
- product search: `knorr`
- Measurement SKUs: 29 selected
- Hero SKUs: 1 selected, `2023755 - Knorr Knorr 8 Vegetable Stock Cubes 80g`
- successful channel: `Offsite, Meta`
- dates: `20/04/2027 - 20/05/2027`
- budget prompt: `7k`

Passed observations:

- Nectar AI opened while authenticated
- guided flow started from starter prompt
- advertiser and brand had to be selected from UI; plain text was rejected
- summary panel updated after advertiser/brand selection
- objective was accepted and shown in summary
- product search displayed a selectable SKU table
- selecting all `knorr` products produced 29 Measurement SKUs
- Hero SKU selection was a separate step after Measurement SKU selection
- Offsite Meta was added successfully with future dates
- summary showed dates, channel, Hero SKU count, and total budget
- save as draft succeeded
- CSV download succeeded
- `Edit plan in Pollen` opened the saved plan in regular Pollen

Blocked/deviation observations:

- baseline channel `DD Pubmatic - Display` was unavailable for the selected brand
- baseline 2026 dates were stale and rejected as past
- UI button copy is `Save plan as draft`, not `Confirm the save plan`
- UI plan name included objective/channel, but CSV plan name omitted those parts
- `7k` became `GBP 7,010`, formula not confirmed
- delete icon in saved Pollen plan was visible, but automation could not trigger it through available stable selectors

## 8. Highest-Value Test Coverage

Smoke/regression priorities:

- authenticated access to Nectar AI
- start guided flow from stable selector/accessible name
- advertiser/brand selection
- objective entry
- Measurement SKU table selection and confirm gating
- Hero SKU selection
- single-channel add with future relative dates
- multi-channel prompt with mixed valid/invalid channels
- channel-specific booking deadline boundaries
- channel-specific minimum duration boundaries
- Hero SKU min/max validation
- channel deletion confirmation/cancel/confirm
- budget/date recalculation after channel deletion
- save draft and reopen in Pollen
- CSV export content compared with UI plan data
- Secondary Space mandatory/optional asset flow
- internal vs external visibility for internal-only channels/assets
- pricing/rate formula checks once formulas are confirmed

## 9. Open Questions / Missing Fixtures

Needed before stronger automation:

- internal user account
- external user account
- Channel Management/admin account
- safe advertiser/brand/SKU/channel fixture set
- eligible fixture for `N360_Unilever_MS + Unilever | Knorr | MS + DD Pubmatic - Display`, or updated baseline to use Meta
- channels with known booking deadlines
- channels with known minimum campaign duration
- channels with min/max Hero SKU limits
- in-store channels with min/max store volume
- pricing fixtures for each supported rate/cost model
- Secondary Space/PiggyBack fixture data
- HFSS/category restriction test products
- expected plan naming contract for UI, CSV, DB, and Pollen
- expected formula for `7k -> GBP 7,010`
- confirmation of whether CRM/booking side effects are safe to trigger

## 10. Suggested Automation Fixture APIs

Useful test-only APIs or fixture helpers:

- create/delete isolated test run namespace
- create advertisers and brands
- create products/SKUs with brand, category, HFSS, and listing metadata
- attach/remove channel eligibility for advertiser/brand combinations
- create/patch channels with group/name, booking deadline, minimum duration, store rules, Hero SKU limits, internal-only visibility
- seed pricing/rate formulas
- seed Secondary Space mandatory/optional assets
- seed HFSS/category restrictions
- create/switch internal, external, and admin users
- seed existing media plans
- fetch saved plan state directly for assertions
- fetch exported CSV/API payload directly
- generate relative future dates or provide test clock support

## 11. Source Files Worth Reopening

Core DOC/CSV sources:

- `NUP-15407.doc` - channel deletion
- `NUP-16919.doc` - dynamic lead time validation
- `NUP-17415.doc` - store min/max validation
- `NUP-17546.doc` - Measurement vs Hero SKUs
- `NUP-18900.csv` - booking deadline tests
- `NUP-18906.csv` - minimum campaign duration tests
- `NUP-18907.csv` - no minimum campaign duration tests
- `NUP-19001.csv` - deletion recalculation tests
- `NUP-19132.csv` - store range/pricing model tests

Core XLSX/Jira areas:

- `NUP-15404` - Measurement/Hero SKU distinction
- `NUP-18943` - channel-level Hero SKUs
- `NUP-18944` - max Hero SKUs per channel
- `NUP-19140` - Hero flag sync after channel modification/deletion
- `NUP-19216` - edit SKU list buttons/modals
- `NUP-19273` - Measurement + Hero SKUs in one prompt
- `NUP-19529` - channel-specific SKU definition in prompt
- `NUP-19967` - Hero SKU declaration parsing
- `NUP-20507` - min/max Hero SKU validation after channel activation

Secondary Space/Jira areas:

- `Sainsbury's Jira (10).csv`
- `Sainsbury's Jira (11).csv`

Known incomplete PDF sources:

- `NUP-Pricing Models in Channel Management-210626-174057.pdf`
- `NUP-Instore & At Home Cost Calculations-210626-174055.pdf`
