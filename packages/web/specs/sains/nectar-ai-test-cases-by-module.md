# Nectar AI / Media Planning AI - test cases by module

Last updated: 2026-07-06, round 2

Scope:

- Based on `/Users/maybebest/Documents/sains-project-qa-notes.md`
- Based on `/Users/maybebest/Documents/nectar-ai-knowledge.md`
- Covers the main Nectar AI / Media Planning AI functionality except the detailed Secondary Space suite, which was handled separately.
- Includes missing test-data-management API methods at the end.
- Round 2 also includes live UI observations from the authenticated Chrome tab at `/planning/nectar-ai`.

Current known dev entry point:

- `https://www.dev.rtd.js-devops.co.uk/planning/nectar-ai`

Known smoke fixture from the 2026-07-05 live run:

- Advertiser: `N360_Unilever_MS`
- Brand: `Unilever | Knorr | MS`
- Objective: `Customer retention`
- Product search: `knorr`
- Measurement SKUs: 29 selected from product search
- Hero SKU: `2023755 - Knorr Knorr 8 Vegetable Stock Cubes 80g`
- Working channel: `Offsite, Meta`
- Use future relative dates, not old 2026 examples
- Budget input used in live run: `7k`

Known caveats:

- `DD Pubmatic - Display` was not available for `N360_Unilever_MS / Unilever | Knorr | MS` during the live run.
- Hard-coded 2026 campaign dates are now stale and rejected as past.
- UI button copy seen in dev: `Save plan as draft`.
- `7k` displayed as `GBP 7,010`; expected pricing formula needs confirmation.
- UI plan name and CSV plan name differed in the live run.
- Existing-session browser automation was blocked by Chrome DevTools attach/accessibility permissions during round 2, so round 2 live checks were limited to authenticated screenshots and visible UI inspection.

## Round 2 Live UI Observations

Visible on the authenticated `/planning/nectar-ai` page:

- Top actions: `View Conversations`, `New Conversation`, `Close Nectar AI`.
- Welcome copy says the conversation is `autosaved as you progress`.
- Starter prompt cards:
  - `Explain how Nectar AI can help me build a media plan`
  - `Help me build a plan based on my objective & budget`
- Chat input placeholder: `Ask Nectar`.
- Chat input controls: plus/add icon, microphone icon, send icon.
- Initial summary panel:
  - `Plan name: --`
  - `Advertiser`, `Brands`, `Objective`, `Dates`, `Hero SKUs`, `Measurement SKUs` all show `To be defined`.
  - Media section shows `Total Budget £--`, columns `Channel`, `Dates`, `Budget (£)`.
- Initial footer actions visible but disabled/inactive-looking:
  - `Edit plan in Pollen`
  - `Download`
  - `Proceed to Booking`
- Left application shell/sidebar is visible with multiple app-navigation icons, settings/help/logout/collapse-style controls.
- Chrome DevTools initially showed console/issues counters, so console/network cleanliness deserves explicit regression coverage.

## Module 1 - Access, Auth, Session

| ID | Priority | Scenario | Preconditions | Steps | Expected result |
| --- | --- | --- | --- | --- | --- |
| AUTH-001 | P0 | Authenticated user opens Nectar AI | User is logged in through Sains Chrome profile | Open `/planning/nectar-ai` | Planning/Nectar AI page opens without login loop; user identity/greeting is visible. |
| AUTH-002 | P0 | Unauthenticated direct access is protected | Use clean/incognito profile | Open `/planning/nectar-ai` | User is redirected to login or shown a clear access-denied state; protected content is not exposed. |
| AUTH-003 | P1 | Session expiry during flow | Authenticated session can be expired or token invalidated | Start a plan, expire session, continue entering data | App asks user to re-authenticate or retries safely; no silent data corruption. |
| AUTH-004 | P1 | Direct conversation route access | Existing Nectar AI conversation route exists | Open saved `/planning/nectar-ai/{conversationId}` | Route opens only for authorized user and restores the right conversation or shows a clean not-found/forbidden state. |
| AUTH-005 | P2 | Browser refresh after auth | User is logged in | Open Nectar AI, refresh page | Session remains valid; app reloads to a usable state. |
| AUTH-006 | P1 | Role-based access baseline | Internal and external users exist | Login as each role and open Nectar AI | Both can access standard planning if allowed; role-specific restrictions are enforced later in channel/media visibility. |

## Module 2 - Nectar AI Entry and Guided Flow

| ID | Priority | Scenario | Preconditions | Steps | Expected result |
| --- | --- | --- | --- | --- | --- |
| ENTRY-001 | P0 | Start guided flow from starter card | Authenticated user on planning page | Click `create plan in minutes...` or equivalent starter card | Nectar AI starts guided creation flow. |
| ENTRY-002 | P0 | Start guided flow from chat prompt | Authenticated user on planning page | Type `Help me build a plan based on my objective and budget` | Nectar AI starts the same guided flow as the starter card. |
| ENTRY-003 | P1 | Starter card accessible selector | Test automation can inspect DOM/AX tree | Locate and click starter action by accessible name/stable selector | Action works without fragile coordinate click. |
| ENTRY-004 | P1 | Empty prompt handling | Chat input is visible | Submit empty message or whitespace | Message is not sent, or user receives validation; no broken assistant state. |
| ENTRY-005 | P1 | Unsupported prompt handling | Chat input is visible | Enter unrelated prompt, e.g. `write a poem` | Nectar AI gives a clear planning-related correction or asks for relevant campaign details. |
| ENTRY-006 | P1 | Missing data follow-up | Flow started | Provide partial brief without channel/budget/timeline | AI asks only for missing required data. |
| ENTRY-007 | P1 | Ambiguous data follow-up | Flow started | Provide vague request, e.g. `I need some media for Knorr soon` | AI asks clarifying questions instead of guessing unsafe values. |
| ENTRY-008 | P2 | Long prompt handling | Flow started | Paste a long multi-channel brief | App remains responsive; AI extracts supported data or asks for clarification. |

## Module 3 - Advertiser and Brand Selection

| ID | Priority | Scenario | Preconditions | Steps | Expected result |
| --- | --- | --- | --- | --- | --- |
| AB-001 | P0 | Plain text advertiser/brand is rejected when selector is required | Flow asks for advertiser/brand | Type advertiser and brand names as plain text without selecting rows | App asks user to select both advertiser and brand from UI. |
| AB-002 | P0 | Select advertiser and brand | Test advertiser/brand exists | Search/select advertiser, select linked brand, confirm | Summary panel shows selected advertiser and brand. |
| AB-003 | P1 | Confirm disabled until both selected | Advertiser/brand selector is open | Select only advertiser, then only brand if possible | Confirm remains disabled or validation blocks until both are selected. |
| AB-004 | P1 | Advertiser search no results | Selector is open | Search for nonexistent advertiser | Empty state appears; no stale previous advertiser remains selected. |
| AB-005 | P1 | Brand list depends on advertiser | Multiple advertisers/brands exist | Select advertiser A, observe brands; switch to advertiser B | Brand list updates; invalid brand from advertiser A is cleared. |
| AB-006 | P1 | Change advertiser/brand after SKUs selected | Plan has advertiser/brand and SKUs | Edit advertiser/brand from summary or flow | App clears or revalidates dependent SKUs/channels; no incompatible stale data remains. |
| AB-007 | P2 | Special characters in brand names | Brand has pipes/apostrophes/special chars | Select brand such as `Unilever | Knorr | MS` | UI, summary, plan name, CSV/export display brand safely and consistently. |

## Module 4 - Objective Selection / Entry

| ID | Priority | Scenario | Preconditions | Steps | Expected result |
| --- | --- | --- | --- | --- | --- |
| OBJ-001 | P0 | Enter valid objective | Advertiser/brand selected | Enter `Customer retention` | Objective is accepted and shown in summary. |
| OBJ-002 | P1 | Missing objective follow-up | Advertiser/brand selected | Try to proceed without objective | AI asks for objective before moving to required downstream steps. |
| OBJ-003 | P1 | Edit objective | Objective already set | Edit objective from summary or prompt | Summary updates; plan name/export behavior follows expected contract. |
| OBJ-004 | P2 | Unsupported objective text | Objective step active | Enter long/free-form objective | App either accepts as free text or maps to supported objective with confirmation. |
| OBJ-005 | P2 | Objective affects plan name | Objective set and plan saved | Save plan and compare UI/Pollen/CSV names | Objective inclusion is consistent with agreed naming contract. |

## Module 5 - Product Search and Measurement SKUs

| ID | Priority | Scenario | Preconditions | Steps | Expected result |
| --- | --- | --- | --- | --- | --- |
| SKU-M-001 | P0 | Product search returns table | Advertiser/brand/objective selected | Search for `knorr` | Product/SKU table appears with selectable rows. |
| SKU-M-002 | P0 | Measurement SKU confirm disabled with none selected | Product table visible | Deselect all rows | Confirm is disabled or validation blocks. |
| SKU-M-003 | P0 | Measurement SKU confirm enabled after one selection | Product table visible | Select one SKU | Confirm becomes enabled and proceeds. |
| SKU-M-004 | P0 | Select all Measurement SKUs | Product table visible with multiple rows | Click `Select All`, confirm | Summary shows correct Measurement SKU count. |
| SKU-M-005 | P1 | Search no matching product | Product search visible | Search nonexistent product | Empty state is shown; no previous SKU selection leaks in. |
| SKU-M-006 | P1 | Search result pagination/filtering | Large result set exists | Search, paginate/filter, select SKUs across pages | Selected SKUs persist correctly across pagination/filter changes. |
| SKU-M-007 | P1 | Duplicate SKU handling in prompt | AI accepts SKU prompt | Enter duplicated SKU IDs | Summary de-duplicates or clearly handles duplicates. |
| SKU-M-008 | P1 | Invalid SKU IDs | AI accepts SKU prompt | Enter malformed/nonexistent SKU IDs | User gets clear correction path; summary remains clean. |
| SKU-M-009 | P1 | Edit Measurement SKU list from table | Measurement SKUs selected | Click `Edit SKU list`, change selected SKUs | Table and summary update immediately. |
| SKU-M-010 | P1 | Edit Measurement SKU list from summary | Measurement SKUs selected | Use summary edit action and change list | Correct modal opens; summary reflects changes. |
| SKU-M-011 | P1 | Remove all Measurement SKUs after channels exist | Plan has channels and SKUs | Edit SKU list and remove all SKUs | App blocks invalid state or forces channel/Hero SKU revalidation. |
| SKU-M-012 | P2 | SKU display formatting | SKUs with id/name/size exist | Select and view in summary/export | SKU ID and product name are readable and consistently formatted. |

## Module 6 - Hero SKUs

| ID | Priority | Scenario | Preconditions | Steps | Expected result |
| --- | --- | --- | --- | --- | --- |
| SKU-H-001 | P0 | Hero SKU step appears after Measurement SKUs | Measurement SKUs confirmed | Continue flow | Hero SKU selection step appears. |
| SKU-H-002 | P0 | Select one Hero SKU | Hero SKU table visible | Select `2023755 - Knorr...`, confirm | Summary shows `Hero SKUs: 1 SKU`. |
| SKU-H-003 | P0 | Global Hero SKU prepopulates channel | Hero SKU selected globally | Add eligible channel | Added channel uses global Hero SKU by default. |
| SKU-H-004 | P0 | Channel-level Hero SKU edit affects one channel | Two channels added | Open channel A modal, add/remove Hero SKU | Only channel A changes; channel B remains unchanged. |
| SKU-H-005 | P0 | Brand-linked Hero SKU auto-adds to Measurement SKUs | Brand-linked SKU not in Measurement list exists | Select it as Hero SKU | SKU is added to Measurement SKUs and marked Hero. |
| SKU-H-006 | P0 | Single prompt Measurement + Hero SKUs | Prompt parsing enabled | Enter `SKUs 1,2,3,4 and Hero SKUs 3,5,6` | Summary contains unique Measurement SKUs `1,2,3,4,5,6`; Hero flags `3,5,6`. |
| SKU-H-007 | P1 | Edit Hero SKU list from table | Hero SKUs selected | Click `Edit SKU list`, change list | Hero table and summary update. |
| SKU-H-008 | P1 | Edit Hero SKU list from summary | Hero SKUs selected | Use summary edit action | Correct modal opens and updates summary. |
| SKU-H-009 | P0 | Hero flag sync after channel deletion | SKU is Hero only on one channel | Delete that channel | SKU no longer has `is_hero=true` if no remaining channel uses it. |
| SKU-H-010 | P0 | Hero flag sync after channel modification | Channel exists without Hero SKU | Add Hero SKU via modal | SKU becomes Hero in state/summary for that channel. |
| SKU-H-011 | P0 | Channel max Hero SKUs exceeded globally | Channel has max Hero SKU config | Select global Hero SKUs above max, add channel | App warns/blocks and asks for correction. |
| SKU-H-012 | P0 | Channel min Hero SKUs not met | Channel has min Hero SKU config | Add channel with fewer than min | App blocks or asks user to add required Hero SKUs. |
| SKU-H-013 | P1 | No max Hero SKU configured | Channel has no max | Select many Hero SKUs, add channel | No max-count restriction is applied. |
| SKU-H-014 | P1 | Multi-channel Hero limit handling | One channel valid, one violates limits | Enter both in one prompt | Valid channel can continue; invalid channel gives clear error. |

## Module 7 - AI Prompt Parsing and Multi-Channel Input

| ID | Priority | Scenario | Preconditions | Steps | Expected result |
| --- | --- | --- | --- | --- | --- |
| AI-001 | P0 | Parse full single-channel prompt | Basic plan data selected | Enter channel, dates, budget in one message | Channel is recognized and summary updates. |
| AI-002 | P0 | Parse multiple channels in one prompt | Basic plan data selected | Enter two or more channels with budgets/dates | Channels are processed independently with clear feedback. |
| AI-003 | P0 | Mixed valid/invalid channel prompt | At least one valid and one invalid channel known | Enter both channels in one message | Valid channel can proceed; invalid one shows specific reason. |
| AI-004 | P1 | Missing channel follow-up | Plan has advertiser/brand/objective/SKUs | Provide budget/timeline but no channel | AI asks for channel. |
| AI-005 | P1 | Missing budget follow-up | Plan has channel and dates only | Enter channel and dates without budget | AI asks for budget. |
| AI-006 | P1 | Missing timeline follow-up | Plan has channel and budget only | Enter channel and budget without dates | AI asks for dates/timeline. |
| AI-007 | P1 | Channel-specific SKU declaration | Channel prompt supports SKU assignment | Enter channel with explicit SKUs | SKUs are assigned to intended channel only. |
| AI-008 | P1 | Hero SKU declaration in prompt | Prompt supports Hero declaration | Enter explicit Hero SKUs in free text | Hero SKUs are recognized and flagged correctly. |
| AI-009 | P1 | Ambiguous budget parsing | Basic plan ready | Enter `budget is around seven` | AI asks clarification or parses only if safe. |
| AI-010 | P2 | Date format variants | Basic plan ready | Try `20 Apr 2027`, `20/04/2027`, `2027-04-20` | Supported formats work consistently; unsupported formats ask for correction. |

## Module 8 - Channel Eligibility and Selection

| ID | Priority | Scenario | Preconditions | Steps | Expected result |
| --- | --- | --- | --- | --- | --- |
| CH-001 | P0 | Add eligible offsite channel | Known eligible channel exists, e.g. Meta | Add `Offsite, Meta` with future dates and budget | Channel is added to summary. |
| CH-002 | P0 | Unavailable channel for selected brand | Known unavailable channel exists, e.g. `DD Pubmatic - Display` for Knorr fixture | Try to add unavailable channel | App rejects with clear brand/channel availability reason. |
| CH-003 | P1 | Add onsite channel | Eligible onsite channel exists | Add onsite channel with valid data | Channel added and classified correctly. |
| CH-004 | P1 | Add at-home channel | Eligible at-home channel exists | Add at-home channel with valid data | Channel added and classified correctly. |
| CH-005 | P1 | Add in-store channel | Eligible in-store channel exists | Add in-store channel with valid data | Channel added and classified correctly. |
| CH-006 | P1 | Duplicate channel add | Channel already selected | Add same channel/date/budget again | App prevents duplicate or handles intentional duplicate according to contract. |
| CH-007 | P1 | Similar channel names | Channels with similar names exist | Search/select channel by prompt | Correct channel is selected; user can disambiguate if needed. |
| CH-008 | P1 | Channel group display | Multiple channel groups selected | Add onsite/offsite/in-store | Summary groups/channels under correct category. |
| CH-009 | P1 | Channel edit modal opens correct channel | Multiple channels exist | Open edit for channel B | Modal data belongs to channel B, not channel A. |
| CH-010 | P2 | Channel unavailable after advertiser change | Channel selected, then advertiser/brand changed | Change advertiser/brand | App revalidates and removes/blocks incompatible channel. |

## Module 9 - Timeline Validation

| ID | Priority | Scenario | Preconditions | Steps | Expected result |
| --- | --- | --- | --- | --- | --- |
| TIME-001 | P0 | Past start date blocked | Basic plan ready | Add channel with past dates | Channel is not added; user gets clear date error. |
| TIME-002 | P0 | Booking deadline blocks X-1 | Channel has booking deadline X days | Enter start date X-1 days from today | Channel is blocked; message references channel and X-day rule. |
| TIME-003 | P0 | Booking deadline boundary accepted | Channel has booking deadline X days | Enter start date exactly X days from today | Channel is accepted for this rule. |
| TIME-004 | P1 | Booking deadline future accepted | Channel has booking deadline X days | Enter start date X+1 or later | Channel is accepted for this rule. |
| TIME-005 | P1 | No booking deadline accepts near-term start | Channel has no booking deadline | Enter valid near-term start | Channel is not blocked by booking deadline. |
| TIME-006 | P0 | Minimum duration blocks X-1 | Channel has minimum duration X days | Enter date range X-1 days | Channel is blocked; message references minimum duration. |
| TIME-007 | P0 | Minimum duration boundary accepted | Channel has minimum duration X days | Enter range exactly X days | Channel is accepted for this rule. |
| TIME-008 | P1 | No minimum duration accepts short range | Channel has no min duration | Enter short but valid range | Channel is not blocked by min-duration rule. |
| TIME-009 | P1 | End date before start date | Basic plan ready | Enter end date earlier than start date | App blocks with clear correction. |
| TIME-010 | P1 | Multi-channel date aggregation | Two channels with different dates | Add both channels | Summary campaign start/end become earliest start and latest end. |
| TIME-011 | P1 | Edit channel dates recalculates campaign | Multiple channels exist | Edit one channel's dates | Summary campaign dates recalculate correctly. |
| TIME-012 | P2 | Timezone/current date boundary | Test around local midnight | Add date exactly at boundary | Validation uses intended business timezone/current date. |

## Module 10 - Store Count Validation

| ID | Priority | Scenario | Preconditions | Steps | Expected result |
| --- | --- | --- | --- | --- | --- |
| STORE-001 | P0 | Store count below min blocked | In-store channel has min store count | Enter min-1 | Channel not added; error explains allowed range. |
| STORE-002 | P0 | Store count above max blocked | In-store channel has max store count | Enter max+1 | Channel not added; error explains allowed range. |
| STORE-003 | P0 | Store count within range accepted | In-store channel has min/max | Enter value between min and max | Channel is added. |
| STORE-004 | P0 | Store count min boundary accepted | In-store channel has min | Enter exactly min | Channel is accepted. |
| STORE-005 | P0 | Store count max boundary accepted | In-store channel has max | Enter exactly max | Channel is accepted. |
| STORE-006 | P1 | No store range accepts old out-of-range value | Store min/max removed | Enter value outside previous range | App does not apply stale old range. |
| STORE-007 | P1 | Non-numeric store count blocked | Store count field/prompt active | Enter text/decimal/negative value | App blocks and asks for valid integer. |
| STORE-008 | P1 | Store count edit recalculates cost | In-store channel added | Edit store count | Summary cost/budget recalculates according to pricing rules. |
| STORE-009 | P2 | Product listing lower than channel min | Product listing/store metadata available | Select product listed in fewer stores than channel minimum | Expected behavior is confirmed or logged as business-rule gap. |

## Module 11 - Budget, Pricing, Rates, Costing

| ID | Priority | Scenario | Preconditions | Steps | Expected result |
| --- | --- | --- | --- | --- | --- |
| RATE-001 | P0 | Budget accepted for eligible channel | Basic plan ready | Add channel with valid budget, e.g. `7k` | Budget/cost shown in summary. |
| RATE-002 | P0 | Budget formatting consistency | Channel added with budget | Compare chat, summary, CSV/export | Currency and numeric formatting are consistent or documented. |
| RATE-003 | P0 | Known formula check for `7k` | Expected pricing formula known | Add Meta with `7k` | Displayed cost matches expected formula; current observed value was `GBP 7,010`. |
| RATE-004 | P1 | Invalid budget rejected | Basic plan ready | Enter negative, zero, text, or unsupported currency | App asks for valid budget and does not add invalid channel. |
| RATE-005 | P1 | Onsite client/brand-specific rate | Channel has client/brand-specific rate | Add onsite channel for matching advertiser/brand | Correct rate is applied. |
| RATE-006 | P1 | Offsite rate coverage | Offsite channel has configured rate | Add offsite channel | Correct rate/cost appears in summary. |
| RATE-007 | P1 | In-store flat fee | In-store channel configured with flat fee | Add channel | Cost uses flat-fee formula. |
| RATE-008 | P1 | In-store multiplier | In-store channel configured with multiplier | Add channel | Cost uses multiplier formula. |
| RATE-009 | P1 | Cost per store | Channel configured as cost per store | Add store count and budget inputs | Cost is calculated per store. |
| RATE-010 | P1 | Cost per unit | Channel configured as cost per unit | Add relevant units | Cost is calculated per unit. |
| RATE-011 | P1 | Base rate | Channel configured with base rate | Add channel | Base rate is applied. |
| RATE-012 | P1 | Fixed cost | Channel configured with fixed cost | Add channel | Fixed cost is applied. |
| RATE-013 | P1 | Self-serve vs managed-serve costing | Same channel has both serving modes | Compare plans/modes | Expected costing difference is applied. |
| RATE-014 | P2 | Pricing config refresh | Admin changes rate config | Create plan immediately after change | Latest config is used or cache delay is explicit. |

## Module 12 - Summary Panel and Edit Modals

| ID | Priority | Scenario | Preconditions | Steps | Expected result |
| --- | --- | --- | --- | --- | --- |
| SUM-001 | P0 | Summary updates after advertiser/brand | Advertiser/brand selected | Observe summary | Correct advertiser and brand displayed. |
| SUM-002 | P0 | Summary updates after objective | Objective entered | Observe summary | Objective displayed. |
| SUM-003 | P0 | Summary updates after SKUs | Measurement/Hero SKUs selected | Observe summary | Correct counts and labels displayed. |
| SUM-004 | P0 | Summary updates after channel add | Channel added | Observe summary | Channel group/name, dates, budget, Hero SKU count displayed. |
| SUM-005 | P1 | Edit advertiser/brand from summary | Summary has advertiser/brand | Use edit action | Correct selector opens; dependent data is revalidated. |
| SUM-006 | P1 | Edit objective from summary | Summary has objective | Use edit action | Objective updates in summary. |
| SUM-007 | P1 | Edit Measurement SKUs from summary | Summary has Measurement SKUs | Use edit action | Correct SKU modal opens and updates summary. |
| SUM-008 | P1 | Edit Hero SKUs from summary | Summary has Hero SKUs | Use edit action | Correct Hero modal opens and updates summary. |
| SUM-009 | P1 | Edit channel details from summary | Summary has channel | Open channel edit modal | Modal pre-populates current channel details. |
| SUM-010 | P1 | Cancel modal edit | Edit modal open | Change fields, cancel | Summary remains unchanged. |
| SUM-011 | P1 | Save modal edit | Edit modal open | Change fields, confirm | Summary and underlying state update. |
| SUM-012 | P2 | Summary responsiveness | Use narrow viewport | Complete basic flow | Summary remains usable and does not overlap chat/table content. |

## Module 13 - Channel Deletion and Recalculation

| ID | Priority | Scenario | Preconditions | Steps | Expected result |
| --- | --- | --- | --- | --- | --- |
| DEL-001 | P0 | Delete confirmation opens | At least one channel selected | Click delete icon | Confirmation text appears, e.g. `Are you sure you want to delete this channel?`. |
| DEL-002 | P0 | Cancel delete | Delete confirmation open | Click cancel/close | Channel remains; no backend deletion if observable. |
| DEL-003 | P0 | Confirm delete | Delete confirmation open | Click confirm | Channel removed from summary/state. |
| DEL-004 | P0 | Budget recalculates after deletion | Two channels with budgets exist | Delete one channel | Total budget subtracts deleted channel budget. |
| DEL-005 | P0 | Campaign start recalculates | Delete earliest-start channel | Confirm deletion | Campaign start becomes earliest start among remaining channels. |
| DEL-006 | P0 | Campaign end recalculates | Delete latest-end channel | Confirm deletion | Campaign end becomes latest end among remaining channels. |
| DEL-007 | P0 | Delete all channels clears campaign values | Multiple channels selected | Delete all channels | Channel list, total budget, start/end dates are empty/cleared. |
| DEL-008 | P0 | Delete channel updates Hero flags | Deleted channel was only Hero user | Delete channel | Relevant SKU no longer marked Hero. |
| DEL-009 | P1 | Delete persisted saved channel | Draft saved and reopened in Pollen | Delete channel from saved plan if supported | UI and saved state reflect deletion. |
| DEL-010 | P1 | Delete icon accessible | Channel row visible | Navigate by keyboard/screen-reader if possible | Delete action is reachable and named clearly. |

## Module 14 - Save, Discard, Reopen

| ID | Priority | Scenario | Preconditions | Steps | Expected result |
| --- | --- | --- | --- | --- | --- |
| SAVE-001 | P0 | Save complete plan as draft | Complete valid plan exists | Click `Save plan as draft` | App confirms draft saved; next actions enabled. |
| SAVE-002 | P0 | Save preserves all summary fields | Plan saved | Reopen through Pollen or state API | Advertiser, brand, objective, SKUs, channels, dates, budgets preserved. |
| SAVE-003 | P0 | Edit in Pollen opens saved plan | Draft saved | Click `Edit plan in Pollen` | Regular Pollen route opens with saved plan data. |
| SAVE-004 | P1 | Save incomplete plan blocked | Required fields missing | Try to save | Save disabled or validation lists missing fields. |
| SAVE-005 | P1 | Discard draft clears state | Draft in progress | Click discard/cancel if available | Draft state cleared; user cannot accidentally book stale data. |
| SAVE-006 | P1 | Refresh before save | Draft in progress | Refresh browser | Draft restores or cleanly restarts according to expected behavior. |
| SAVE-007 | P1 | Duplicate save click | Complete plan ready | Double-click save or click repeatedly | Only one draft is created or operation is idempotent. |
| SAVE-008 | P1 | Save failure recovery | Simulate save API failure | Click save | User sees retryable error; draft data remains available. |
| SAVE-009 | P2 | Plan name generated correctly | Plan saved | Compare UI plan name to naming rules | Name includes expected date/brand/objective/channel/unique id components. |

## Module 15 - Export / CSV / Pollen Handoff

| ID | Priority | Scenario | Preconditions | Steps | Expected result |
| --- | --- | --- | --- | --- | --- |
| EXP-001 | P0 | Download CSV after save | Draft saved | Click download | CSV is downloaded successfully. |
| EXP-002 | P0 | CSV contains core plan fields | CSV downloaded | Inspect CSV | Advertiser, brand, objective, dates, SKUs, media row are present. |
| EXP-003 | P0 | CSV channel row matches summary | Channel added and saved | Compare summary to CSV | Channel group/name, dates, budget/cost match or known transformations are documented. |
| EXP-004 | P0 | UI and CSV plan name contract | Draft saved and CSV downloaded | Compare plan names | Names are consistent with agreed contract; current known deviation should be triaged. |
| EXP-005 | P1 | CSV handles special characters | Brand/objective includes special chars | Download CSV | CSV escaping is valid; no broken columns. |
| EXP-006 | P1 | CSV SKU count and details | Multiple SKUs selected | Download CSV | SKU count/details match summary/state. |
| EXP-007 | P1 | Pollen view matches Nectar summary | Draft saved | Open in Pollen | Pollen media rows, dates, Hero SKU count, budget match Nectar summary. |
| EXP-008 | P1 | Export after edits | Save, edit plan, export again | Download/export | Export reflects latest saved edits, not stale pre-edit data. |
| EXP-009 | P2 | Download disabled before save | Plan incomplete or unsaved | Observe download action | Download disabled until valid saved draft exists. |

## Module 16 - HFSS / Category / Eligibility Restrictions

| ID | Priority | Scenario | Preconditions | Steps | Expected result |
| --- | --- | --- | --- | --- | --- |
| REST-001 | P0 | HFSS restriction blocks channel | Product/channel violates HFSS rule | Add restricted channel | Channel blocked before summary; error explains reason. |
| REST-002 | P0 | Category restriction blocks channel | Product/category/channel violates rule | Add restricted channel | Channel blocked before summary; error explains reason. |
| REST-003 | P1 | Eligible non-HFSS product passes | Non-restricted fixture exists | Add same channel with eligible SKU | Channel accepted. |
| REST-004 | P1 | Mixed restricted and eligible SKUs | SKU list contains both | Add restricted channel | App either blocks with precise explanation or asks user to adjust SKU set. |
| REST-005 | P1 | Multi-channel restriction handling | One channel restricted, one allowed | Enter both channels in one prompt | Allowed channel can proceed; restricted channel clearly fails. |
| REST-006 | P1 | Restriction after SKU edit | Channel already selected | Edit SKU list to restricted SKU | App revalidates channel and blocks or asks correction. |

## Module 17 - Error Handling, Reliability, Accessibility

| ID | Priority | Scenario | Preconditions | Steps | Expected result |
| --- | --- | --- | --- | --- | --- |
| NEG-001 | P1 | Validation API failure | Basic plan ready | Simulate channel validation network failure | User sees retryable error; state remains consistent. |
| NEG-002 | P1 | Product search API failure | Product step active | Simulate product search failure | User sees clear error and can retry. |
| NEG-003 | P1 | Stale channel config | Channel config changes mid-flow | Continue plan | App uses latest config or communicates cache behavior. |
| NEG-004 | P1 | Back/forward browser navigation | Flow in progress | Use browser back/forward | App handles route/state without corrupting draft. |
| NEG-005 | P1 | Keyboard-only primary flow | No mouse | Complete key parts by keyboard | Focus order is logical; core actions reachable. |
| NEG-006 | P2 | Modal focus trap | Any modal open | Tab through modal | Focus stays in modal and returns to trigger after close. |
| NEG-007 | P2 | Mobile/narrow viewport | Narrow browser width | Complete basic flow | Chat, tables, summary, and modals remain usable. |
| NEG-008 | P2 | Large SKU result performance | Large SKU set exists | Search/select many SKUs | UI remains responsive; no timeout or broken selection. |
| NEG-009 | P2 | Long-running AI response | Slow AI/backend possible | Submit prompt | Loading state appears; user cannot create duplicate broken messages. |
| NEG-010 | P2 | Safe retry after AI failure | AI prompt fails | Retry same prompt | Retry works without duplicate channels/SKUs unless intended. |

## Module 18 - Conversation Management and Autosave

Round 2 note: this module was added because the live UI explicitly exposes `View Conversations`, `New Conversation`, and autosave copy.

| ID | Priority | Scenario | Preconditions | Steps | Expected result |
| --- | --- | --- | --- | --- | --- |
| CONV-001 | P0 | View conversations opens history | Authenticated user has access to Nectar AI | Click `View Conversations` | Conversation history/list opens without losing current draft state. |
| CONV-002 | P0 | Current conversation appears in history after progress | Start a plan and enter at least advertiser/brand/objective | Open `View Conversations` | Current autosaved conversation is present with recognizable title/date/status. |
| CONV-003 | P1 | Resume previous conversation | Existing conversation with partial progress exists | Open `View Conversations`, select previous conversation | Chat and summary restore the selected conversation state. |
| CONV-004 | P1 | Conversation history empty state | User has no previous conversations or test account is reset | Open `View Conversations` | Clear empty state is shown; no broken list or stale other-user data. |
| CONV-005 | P1 | Conversation list sorting | Multiple conversations exist | Open history | Most recent conversations appear first or sorting matches product contract. |
| CONV-006 | P1 | Conversation search/filter if available | History has many conversations | Use search/filter controls if present | Matching conversations appear; non-matching items are hidden; no state loss. |
| CONV-007 | P0 | New conversation starts clean state | Existing partial conversation open | Click `New Conversation` | New blank conversation opens with initial summary values reset to `To be defined`. |
| CONV-008 | P0 | New conversation does not delete previous autosaved draft | Existing partial conversation open | Click `New Conversation`, then open `View Conversations` | Previous draft remains available unless user explicitly deletes it. |
| CONV-009 | P1 | New conversation while unsaved plan has data | Partial plan has advertiser/brand/SKUs/channels | Click `New Conversation` | App either autosaves and starts new conversation, or warns user according to contract. |
| CONV-010 | P1 | Conversation isolation between tabs | Same user opens two Nectar tabs | Progress two different conversations | Data from one tab does not overwrite the other unexpectedly. |
| CONV-011 | P1 | Autosave after each major step | Complete advertiser/brand, objective, SKUs, channel | Refresh or reopen conversation after each step | Latest completed step is restored; no summary/chat mismatch. |
| CONV-012 | P1 | Autosave failure recovery | Autosave endpoint can fail | Make progress while autosave fails | User sees retry/error state; app does not claim saved progress incorrectly. |
| CONV-013 | P2 | Conversation title generation | Conversation reaches enough data for a plan name/title | Open history | Conversation title is meaningful and does not expose raw IDs unless intended. |
| CONV-014 | P2 | Delete/archive conversation if available | History exposes delete/archive | Delete/archive a conversation | User is asked to confirm; deleted item disappears and cannot be resumed accidentally. |

## Module 19 - Initial Empty State and Action Gating

Round 2 note: this module was added from the initial authenticated page state.

| ID | Priority | Scenario | Preconditions | Steps | Expected result |
| --- | --- | --- | --- | --- | --- |
| EMPTY-001 | P0 | Initial summary empty state | Open new Nectar conversation | Inspect summary panel | Plan name is `--`; required fields show `To be defined`; media table is empty. |
| EMPTY-002 | P0 | Initial action buttons disabled | Open new Nectar conversation | Inspect `Edit plan in Pollen`, `Download`, `Proceed to Booking` | Actions are disabled/inactive until a valid saved or bookable plan exists. |
| EMPTY-003 | P0 | Proceed to Booking disabled before save | Partial or unsaved plan exists | Inspect/click `Proceed to Booking` | Booking cannot start before required data and save/booking eligibility are complete. |
| EMPTY-004 | P1 | Edit in Pollen disabled before save | Unsaved plan exists | Inspect/click `Edit plan in Pollen` | No navigation occurs, or user sees clear reason action is unavailable. |
| EMPTY-005 | P1 | Download disabled before save | Unsaved plan exists | Inspect/click `Download` | No empty/broken CSV is downloaded; user sees clear unavailable state if clicked. |
| EMPTY-006 | P1 | Summary fields unlock progressively | Complete each required step | Observe summary after each step | Only completed fields change from `To be defined`; unrelated fields remain empty. |
| EMPTY-007 | P1 | Media table placeholder with no channels | Complete SKUs but no channels | Inspect media section | Media table remains empty and total budget stays `£--` or equivalent empty value. |
| EMPTY-008 | P1 | Plan name empty until enough data exists | Start flow and fill early fields | Observe `Plan name` | Plan name remains placeholder until required naming inputs are known. |
| EMPTY-009 | P2 | Empty state visual consistency | Resize browser or use narrow viewport | Inspect empty summary and action bar | Empty-state labels do not overlap or truncate critical values. |

## Module 20 - Chat Input Controls, Starter Prompts, Attachments, Voice

Round 2 note: this module was added because the live input includes prompt cards, plus/add, microphone, and send controls.

| ID | Priority | Scenario | Preconditions | Steps | Expected result |
| --- | --- | --- | --- | --- | --- |
| CHAT-001 | P0 | Informational starter prompt | New conversation open | Click `Explain how Nectar AI can help me build a media plan` | AI explains capabilities without corrupting summary fields or starting the wrong flow. |
| CHAT-002 | P0 | Build-plan starter prompt | New conversation open | Click `Help me build a plan based on my objective & budget` | Guided media-plan creation starts. |
| CHAT-003 | P1 | Starter prompt cards disappear or remain correctly | Starter prompt clicked | Observe prompt area | Cards are hidden, disabled, or remain reusable according to product contract; duplicate accidental sends are prevented. |
| CHAT-004 | P0 | Send icon disabled with empty input | New conversation open | Leave `Ask Nectar` empty | Empty message cannot be sent. |
| CHAT-005 | P0 | Send icon enabled with typed input | Chat input visible | Type valid text | Send becomes available and sends message on click or Enter according to expected behavior. |
| CHAT-006 | P1 | Enter key behavior | Chat input has text | Press Enter | Message sends, or newline behavior matches product contract. |
| CHAT-007 | P1 | Shift+Enter behavior | Chat input has text | Press Shift+Enter | Newline is inserted if multiline input is supported; otherwise behavior is documented. |
| CHAT-008 | P1 | Plus/add control opens attachment or action menu | New conversation open | Click plus/add icon | Expected upload/action menu opens; unsupported file actions are clearly blocked. |
| CHAT-009 | P1 | Attachment upload unsupported file | Attachment menu available | Try unsupported file type | App rejects with clear message and no broken chat state. |
| CHAT-010 | P1 | Attachment upload supported file if in scope | Supported file fixture exists | Upload file through plus/add | File appears in prompt context and can be removed before send. |
| CHAT-011 | P1 | Microphone permission prompt | Browser mic permission not granted | Click microphone icon | Browser/app requests permission cleanly; denial is handled gracefully. |
| CHAT-012 | P1 | Voice input transcript | Mic permission granted | Speak short planning prompt | Transcript appears accurately enough and can be edited before send. |
| CHAT-013 | P1 | Voice input cancellation | Mic recording active | Cancel/stop recording | No partial unintended message is sent. |
| CHAT-014 | P2 | Long typed message scrolls correctly | Chat input visible | Paste long multi-line brief | Input remains usable; send control stays accessible. |
| CHAT-015 | P2 | Input remains usable while summary scrolls | Page has enough content to scroll | Scroll page/summary and type | Input remains reachable; focus is not stolen by summary panel. |

## Module 21 - Close Nectar AI and Application Shell Navigation

Round 2 note: this module was added from visible top action and left app shell/sidebar.

| ID | Priority | Scenario | Preconditions | Steps | Expected result |
| --- | --- | --- | --- | --- | --- |
| SHELL-001 | P0 | Close Nectar AI from blank state | New Nectar conversation open | Click `Close Nectar AI` | User returns to expected planning/Pollen area without error. |
| SHELL-002 | P0 | Close Nectar AI with partial autosaved draft | Partial plan exists | Click `Close Nectar AI` | App preserves draft or warns user according to autosave contract. |
| SHELL-003 | P1 | Reopen Nectar after close | Nectar closed | Navigate back to Nectar AI | User can reopen and resume or start new conversation cleanly. |
| SHELL-004 | P1 | Browser back from Nectar AI | Nectar conversation open | Use browser Back | App navigates safely and preserves/restores state as expected. |
| SHELL-005 | P1 | Left sidebar current section indicator | Nectar AI open | Inspect left app shell | Correct planning/Nectar section is highlighted. |
| SHELL-006 | P1 | Sidebar navigation away with draft | Partial plan exists | Click another sidebar destination | App preserves draft or warns user; no silent data loss. |
| SHELL-007 | P1 | Help icon from shell | Nectar AI open | Click help icon if available | Help opens in correct context and does not break current conversation. |
| SHELL-008 | P1 | Settings/admin navigation from shell | User has permissions | Open settings/admin icon | Access control works; returning to Nectar preserves conversation. |
| SHELL-009 | P1 | Logout from shell with draft | Partial plan exists | Trigger logout | User is warned or autosave is reliable; session ends cleanly. |
| SHELL-010 | P2 | Collapse/expand sidebar | Sidebar collapse control visible | Collapse and expand | Layout adjusts; chat and summary remain usable. |

## Module 22 - Console, Network, Telemetry, and Diagnostics

Round 2 note: Chrome DevTools showed issue counters during visual inspection. These cases should be automated where possible.

| ID | Priority | Scenario | Preconditions | Steps | Expected result |
| --- | --- | --- | --- | --- | --- |
| OBS-001 | P1 | No blocking console errors on initial load | DevTools/automation can capture console | Open `/planning/nectar-ai` | No uncaught errors that affect user flow. |
| OBS-002 | P1 | No new console errors during happy path | Console capture active | Complete basic plan flow | No uncaught exceptions; warnings are triaged or accepted. |
| OBS-003 | P1 | Network request failures are surfaced | Network capture active | Trigger product search/channel validation/save | Failed API calls produce clear UI errors; no silent failure. |
| OBS-004 | P1 | Autosave telemetry/state traceable | Autosave endpoint observable | Complete each major step | Autosave calls include conversation id and enough state to debug restore issues. |
| OBS-005 | P1 | AI prompt/request correlation id | Submit prompt | Inspect network/logs | Prompt response can be correlated by request/conversation id for debugging. |
| OBS-006 | P1 | Save request idempotency | Click save twice or retry after timeout | Inspect network/backend state | Duplicate requests do not create duplicate plans. |
| OBS-007 | P2 | Browser issues counter baseline | DevTools issue capture available | Load page and inspect Issues panel | Known issues are documented; new CSP/cookie/deprecation issues fail regression if relevant. |
| OBS-008 | P2 | PII/logging safety | Submit advertiser/brand/SKU prompt | Inspect logs/network where accessible | Sensitive values are not leaked to inappropriate logs/third parties. |

## Smoke Pack Recommendation

Use this as the fastest daily sanity set:

| ID | Why |
| --- | --- |
| AUTH-001 | Confirms authenticated access. |
| ENTRY-001 or ENTRY-002 | Confirms guided flow can start. |
| AB-002 | Confirms advertiser/brand selector works. |
| OBJ-001 | Confirms objective collection. |
| SKU-M-001 / SKU-M-004 | Confirms product search and Measurement SKU selection. |
| SKU-H-001 / SKU-H-002 | Confirms Hero SKU step. |
| CH-001 | Confirms an eligible channel can be added. |
| TIME-001 | Confirms stale/past dates are blocked. |
| RATE-001 / RATE-003 | Confirms budget and known pricing behavior. |
| SUM-004 | Confirms summary panel updates. |
| SAVE-001 / SAVE-003 | Confirms draft save and Pollen handoff. |
| EXP-001 / EXP-002 | Confirms CSV download and core export data. |
| EMPTY-001 / EMPTY-002 | Confirms initial summary state and disabled footer actions. |
| CONV-001 / CONV-007 | Confirms conversation history and new conversation entry points. |
| CHAT-001 / CHAT-002 | Confirms both visible starter prompt cards behave correctly. |
| SHELL-001 | Confirms `Close Nectar AI` does not strand the user. |
| OBS-001 | Confirms initial load is free of blocking console errors. |

## Missing Test Data Management APIs

These are the APIs/fixture helpers that would make automation deterministic and reduce manual test-data setup.

### Test Run Lifecycle

| Method | Endpoint | Purpose | Key fields |
| --- | --- | --- | --- |
| POST | `/test-data/runs` | Create isolated test run namespace | `runName`, `owner`, `expiresAt`, `environment` |
| DELETE | `/test-data/runs/{runId}` | Clean all data created by run | `runId`, `force` |
| GET | `/test-data/runs/{runId}` | Inspect seeded data and cleanup status | `runId` |

### Conversations and Autosave

| Method | Endpoint | Purpose | Key fields |
| --- | --- | --- | --- |
| POST | `/test-data/conversations` | Seed Nectar conversation with chosen state | `userId`, `advertiserId`, `brandId`, `objective`, `skus`, `channels`, `status`, `runId` |
| GET | `/test-data/conversations/{conversationId}` | Read conversation chat and summary state | `conversationId`, `includeMessages`, `includeAutosaveState` |
| PATCH | `/test-data/conversations/{conversationId}` | Prepare partial/inconsistent states for restore tests | `messages`, `summaryState`, `autosaveVersion`, `status` |
| DELETE | `/test-data/conversations/{conversationId}` | Cleanup or simulate deleted conversation | `conversationId` |
| GET | `/test-data/users/{userId}/conversations` | Assert conversation history contents/order | `userId`, `limit`, `status` |
| POST | `/test-data/conversations/{conversationId}/autosave-failures` | Inject autosave failure for recovery testing | `conversationId`, `statusCode`, `duration` |
| DELETE | `/test-data/conversations/{conversationId}/autosave-failures` | Clear autosave failure injection | `conversationId` |

### Users and Roles

| Method | Endpoint | Purpose | Key fields |
| --- | --- | --- | --- |
| POST | `/test-data/users` | Create test user | `role`, `internalExternalType`, `permissions`, `runId` |
| PATCH | `/test-data/users/{userId}/roles` | Switch role/permissions | `role`, `permissions` |
| POST | `/test-data/sessions` | Create login/session shortcut for automation | `userId`, `environment` |
| DELETE | `/test-data/users/{userId}` | Remove test user | `userId` |

### Advertisers, Brands, Products, SKUs

| Method | Endpoint | Purpose | Key fields |
| --- | --- | --- | --- |
| POST | `/test-data/advertisers` | Seed advertiser | `advertiserName`, `clientId`, `runId` |
| POST | `/test-data/brands` | Seed brand linked to advertiser | `brandName`, `advertiserId`, `region`, `businessUnit` |
| POST | `/test-data/skus` | Seed searchable SKUs/products | `skuId`, `productName`, `brandId`, `category`, `hfss`, `storeListingCount` |
| PATCH | `/test-data/skus/{skuId}` | Change category/HFSS/listing fixture | `category`, `hfss`, `storeListingCount` |
| DELETE | `/test-data/advertisers/{advertiserId}` | Cleanup advertiser tree | `advertiserId`, `cascade` |

### Channel Management Fixtures

| Method | Endpoint | Purpose | Key fields |
| --- | --- | --- | --- |
| POST | `/test-data/channels` | Create channel fixture | `channelGroup`, `channelName`, `serveType`, `runId` |
| PATCH | `/test-data/channels/{channelId}` | Update channel config | `bookingDeadlineDays`, `minimumDurationDays`, `minStores`, `maxStores`, `heroSkuMin`, `heroSkuMax`, `internalOnly` |
| POST | `/test-data/channel-eligibility` | Attach channel to advertiser/brand | `channelId`, `advertiserId`, `brandId`, `enabled` |
| DELETE | `/test-data/channel-eligibility/{id}` | Remove eligibility | `id` |
| POST | `/test-data/channel-restrictions` | Seed HFSS/category restrictions | `channelId`, `category`, `hfss`, `allowed` |
| GET | `/test-data/channels/{channelId}` | Read effective channel config | `channelId`, `includeRates`, `includeRestrictions` |

### Pricing and Costing

| Method | Endpoint | Purpose | Key fields |
| --- | --- | --- | --- |
| POST | `/test-data/channel-rates` | Seed deterministic rate | `channelId`, `pricingModel`, `rate`, `currency`, `effectiveFrom`, `clientId`, `brandId` |
| PATCH | `/test-data/channel-rates/{rateId}` | Change rate during cache tests | `rate`, `pricingModel`, `effectiveFrom` |
| GET | `/test-data/pricing/calculate` | Verify expected cost through backend oracle | `channelId`, `budget`, `stores`, `units`, `dates`, `serveType` |
| DELETE | `/test-data/channel-rates/{rateId}` | Cleanup rate fixture | `rateId` |

### Media Plan State and Export

| Method | Endpoint | Purpose | Key fields |
| --- | --- | --- | --- |
| POST | `/test-data/media-plans` | Seed existing plan for edit/delete/reopen cases | `advertiserId`, `brandId`, `objective`, `skus`, `channels`, `runId` |
| GET | `/test-data/media-plans/{planId}` | Assert saved backend state | `planId` |
| PATCH | `/test-data/media-plans/{planId}` | Prepare state for edit/delete tests | `skus`, `channels`, `status` |
| DELETE | `/test-data/media-plans/{planId}` | Cleanup plan | `planId` |
| GET | `/test-data/media-plans/{planId}/export` | Fetch export payload/CSV without browser download | `planId`, `format` |
| GET | `/test-data/media-plans/{planId}/audit` | Inspect save/edit/delete audit trail | `planId` |

### Chat Input, Attachments, Voice

| Method | Endpoint | Purpose | Key fields |
| --- | --- | --- | --- |
| POST | `/test-data/chat-attachments` | Seed supported/unsupported attachment fixtures | `fileName`, `mimeType`, `sizeBytes`, `contentRef`, `runId` |
| DELETE | `/test-data/chat-attachments/{attachmentId}` | Cleanup attachment fixture | `attachmentId` |
| POST | `/test-data/voice-transcripts` | Stub deterministic microphone transcript | `userId`, `transcript`, `language`, `runId` |
| DELETE | `/test-data/voice-transcripts/{id}` | Cleanup voice transcript stub | `id` |

### Diagnostics and Observability

| Method | Endpoint | Purpose | Key fields |
| --- | --- | --- | --- |
| GET | `/test-data/diagnostics/conversations/{conversationId}` | Fetch AI prompt/response diagnostics for a conversation | `conversationId`, `includeRequests`, `includeErrors` |
| GET | `/test-data/diagnostics/media-plans/{planId}` | Fetch save/export/booking diagnostics | `planId`, `includeAudit`, `includeRequests` |
| GET | `/test-data/diagnostics/request/{correlationId}` | Fetch correlated backend trace | `correlationId` |
| POST | `/test-data/diagnostics/reset` | Clear run-scoped captured diagnostics | `runId` |

### Dates, Cache, and Failure Injection

| Method | Endpoint | Purpose | Key fields |
| --- | --- | --- | --- |
| POST | `/test-data/clock` | Freeze or shift business date for timeline tests | `runId`, `currentDate`, `timezone` |
| DELETE | `/test-data/clock/{runId}` | Restore real time | `runId` |
| POST | `/test-data/cache/flush` | Flush Pollen/Base/channel config cache | `scope`, `runId` |
| POST | `/test-data/faults` | Inject controlled backend/API failure | `service`, `operation`, `statusCode`, `duration`, `runId` |
| DELETE | `/test-data/faults/{faultId}` | Remove failure injection | `faultId` |

### Secondary Space Fixture APIs, For Completeness

Detailed Secondary Space cases are separate, but automation still needs fixture methods:

| Method | Endpoint | Purpose | Key fields |
| --- | --- | --- | --- |
| POST | `/test-data/secondary-space/assets` | Seed PiggyBack/Secondary Space assets | `assetName`, `mandatory`, `internalOnly`, `defaultQuantity`, `quantityRange` |
| POST | `/test-data/secondary-space/channel-config` | Attach assets to channel as `piggyBackAssetTypes` | `channelId`, `assetIds`, `source`, `runId` |
| PATCH | `/test-data/secondary-space/channel-config/{id}` | Change mandatory/optional/internal flags | `assetIds`, `mandatory`, `internalOnly` |
| DELETE | `/test-data/secondary-space/channel-config/{id}` | Remove Secondary Space config | `id` |

## Data Still Needed For Manual/Automated Execution

- Stable internal user.
- Stable external user.
- Channel Management/admin user.
- Safe advertiser/brand/SKU fixture set.
- Eligible channel fixtures for onsite, offsite, at-home, and in-store.
- Channels with known booking deadline values.
- Channels with known minimum campaign duration values.
- Channels with known min/max store counts.
- Channels with known Hero SKU min/max values.
- Products/SKUs with HFSS and category restrictions.
- Deterministic rate fixtures for pricing model checks.
- Expected plan naming contract across Nectar UI, Pollen, DB/API, and CSV.
- Expected formula for the observed `7k -> GBP 7,010` conversion.
- Confirmation whether CRM/booking downstream side effects are safe to trigger in dev.
- Expected conversation-history sorting, naming, deletion/archive, and retention rules.
- Expected autosave frequency and exact restore contract after refresh, close, new conversation, logout, and multi-tab usage.
- Supported attachment file types, size limits, and whether attachments are in scope for Nectar AI prompts.
- Voice input support matrix: browsers, languages, permission behavior, transcript quality expectations.
- Accepted baseline for browser console warnings/issues on `/planning/nectar-ai`.
