# Sains project QA notes

Source folder: `/Users/maybebest/Downloads/Telegram Desktop/sains`
Last structured: 2026-07-05

## 0. Extraction Coverage

Readable source set:

| Type | Count | Notes |
| --- | ---: | --- |
| Jira CSV exports | 15 | 64 unique Jira issues found, mostly `N360 Pollen / Media Planning AI`. |
| Manual test CSVs | 5 | Direct action/expected-result tests for timeline, deletion, and store ranges. |
| Jira XLSX exports | 51 | Work item fields/activity; useful for story descriptions and acceptance criteria. Some duplicates by date/export copy. |т и
| Jira DOC exports | 4 | Detailed stories/epic for channel deletion, timeline validation, store validation, Hero vs Measurement SKUs. |
| Confluence PDFs | 2 | Titles only extracted reliably: pricing models and cost calculations. Full PDF text needs manual opening or a PDF extractor with CMap support. |

High confidence project area:

- Project: `N360 Pollen`.
- Product/workstream: `Media Planning AI`, often referenced as `MP AI` or `Media Planner AI`.
- Core assistant/UI: `Nectar AI`.
- Main domain: creating and editing media plans with advertiser, brand, objective, SKUs, channels, budget, timeline, and booking-related details.
- Related admin/config surface: `Channel Management`.

## 1. Project Overview

### Product Summary

Media Planning AI helps a media planner create or edit a media plan through Nectar AI. The user provides advertiser/brand, objective, SKUs, channels, budgets, and timelines. The system validates channel rules, builds a summary panel, lets the user edit selected data, and saves data for later booking/CRM processing.

The discovered work is centered on:

- Channel validation and Channel Management alignment.
- Measurement SKUs vs Hero SKUs.
- Channel-level and global Hero SKU assignment.
- Dynamic channel lead-time validation.
- Store-count validation for in-store channels.
- Pricing/rates/costing model coverage.
- Secondary Space / PiggyBack assets.
- Plan saving, discard, and channel deletion behavior.
- Automated test coverage for the above areas.

### Environments

| Environment | URL | Purpose | Notes |
| --- | --- | --- | --- |
| Application under test | `https://www.dev.rtd.js-devops.co.uk/planning/nectar-ai` | Media Planner AI / Nectar AI exploratory testing | URL was provided by the user for the dev exploratory pass. |
| Jira | `https://sainsburys-tech.atlassian.net/browse/NUP-*` | Requirements, stories, test design/execution | Many source files are Jira exports. |
| Confluence | `https://sainsburys-tech.atlassian.net/wiki/spaces/NUP/...` | Requirements and calculation docs | PDF exports reference Confluence pages. |
| Figma | `https://www.figma.com/design/OaMB6MrJiMVFWACL1SEyhN/...` | UI references for Media Planner | Links found in Jira/DOC exports. |
| GitHub | `https://github.com/sainsburys-tech/mpla-app/...` | Implementation PR references | Found in Jira exports. |

### Access and Accounts

| Role/account | Credentials/source | Permissions | Notes |
| --- | --- | --- | --- |
| Internal media planner user | TBD | Create/edit media plans, add Secondary Space channels, see internal-only media where allowed | Key role for most happy paths. |
| External media planner user | TBD | Create/edit media plans with restricted access to internal-only Secondary Space | Needed for user-type validation. |
| Channel Management/admin user | TBD | Configure channels, lead times, store limits, pricing models, Hero SKU limits, Secondary Space config | Needed for setup/preconditions. |
| Booking/CRM/Activation Hub visibility | TBD | Verify saved booking details and downstream visibility | Need confirmation before changing live booking data. |

## 2. User Roles and Permissions

| Role | Can access / do | Cannot access / should be blocked | Key risks |
| --- | --- | --- | --- |
| Internal user | Add channels, configure mandatory/optional Secondary Space elements, edit summary data, save plan | Should still respect channel config, SKU limits, HFSS/category restrictions | Over-permissive UI can bypass configured rules. |
| External user | Use standard planning flow; view selected Secondary Space elements/quantities in booking/activation context where business allows | Should not add channels marked `Only visible to internal` or internal-only Secondary Space | Leakage of internal-only media or wrong eligibility. |
| Channel admin/config user | Maintain channel booking deadline, minimum campaign duration, min/max stores, pricing models, Hero SKU min/max, Secondary Space config | Should not create invalid config that breaks planning flow | Stale config, invalid values, and cache divergence. |
| System/integration | Fetch data from Base/Pollen, save to MongoDB, later send to CRM/booking | Should not save inconsistent SKU/channel/asset data | Data consistency and traceability across systems. |

## 3. Main User Flows

### Flow Map

| Flow | Entry point | Success outcome | Failure/edge states |
| --- | --- | --- | --- |
| Create media plan via Nectar AI | Planning page, `create plan in minutes...` | User reaches channel/budget/timeline step and summary panel | Missing advertiser/brand/objective/SKUs, unsupported input, failed AI parsing. |
| Measurement and Hero SKU setup | SKU input/table or single prompt | Measurement SKUs confirmed; Hero SKUs selected globally or per channel | No selected Measurement SKU, Hero SKU outside allowed brand/products, duplicate SKUs, invalid SKU IDs. |
| Add channels | Nectar AI chat or channel selector | Channels added to summary with budget/timeline | Booking deadline fail, min campaign duration fail, store count fail, HFSS/category restrictions, Hero SKU min/max fail. |
| Edit channel / SKU lists | Summary panel modal or edit buttons | Updated channel data and SKU state reflected immediately | Edits not persisted, wrong table updated, disabled state wrong, stale Hero flags. |
| Delete channel | Delete icon in media section | Confirmation appears; confirmed deletion removes channel and recalculates summary | Cancel still deletes, totals not recalculated, last deletion leaves stale budget/dates/SKUs. |
| Secondary Space | Add in-store channel with piggyBack assets | Mandatory/optional elements collected and saved per channel | Internal/external eligibility wrong, mandatory skipped, quantity validation wrong, optional skip broken. |
| Save / discard plan | End of planning flow | Save persists plan data; discard clears draft | Data lost unexpectedly, stale state after discard, partial save. |
| Booking/CRM handoff | Campaign save and downstream processing | Saved data is compatible with CRM/booking and visible where expected | Missing piggyBackAssets, wrong quantities, channel-by-channel vs final-send ambiguity. |

### Critical Paths

- Login/open the planning workspace.
- Create a media plan using Nectar AI.
- Add advertiser and brand.
- Add objective.
- Add Measurement SKUs and Hero SKUs.
- Add at least one channel from each relevant group: onsite, offsite, at home, in-store.
- Provide budget and timeline.
- Validate the summary panel.
- Edit SKU/channel details through modals.
- Save the plan.
- Reopen or inspect saved/booking data if accessible.

## 4. Functional Areas

### Landing / Public Pages

Not described in the source folder. Explore separately once the application URL is confirmed.

### Authentication

Not described in the source folder. Needed checks: login method, SSO/session behavior, access by internal/external role, and direct URL access control.

### Planning / Nectar AI

- Chat-like creation flow started from Planning page.
- User provides advertiser, brand, objective, SKUs, channels, budget, and timeline.
- System may ask for missing channel, budget, or timeline.
- Multiple channels can be provided in a single input and processed sequentially.
- AI input parsing must understand explicit Hero SKU declarations and channel-specific SKU declarations.

### Channel Management

- Maintains channel-level booking deadline.
- Maintains channel-level minimum campaign duration.
- Maintains min/max store volume for channels requiring store count.
- Maintains pricing/rate model settings.
- Maintains Hero SKU min/max limits.
- Maintains Secondary Space / piggyBack asset config or receives it from Base/Pollen.

### Measurement SKUs and Hero SKUs

- Measurement SKUs are the base campaign SKUs.
- Hero SKUs are promoted/emphasized SKUs.
- Global Hero SKUs can pre-populate every selected channel.
- Channel-level Hero SKUs can be edited per selected channel.
- Later requirement expands Hero SKU selection to all brand-linked SKUs, and MP AI must auto-add those Hero SKUs into Measurement SKUs.
- Summary panel and SKU tables have edit buttons/modals.

### Timeline Validation

- Channel booking deadline blocks start dates too close to today.
- Channel minimum campaign duration blocks too-short date ranges.
- Channels without those settings should not be blocked by those specific validations.

### Pricing / Rates / Costing

Source PDFs:

- `NUP-Pricing Models in Channel Management-210626-174057.pdf`
- `NUP-Instore & At Home Cost Calculations-210626-174055.pdf`

Related automated coverage tasks mention:

- Rates Management for Print Magazine / Nectar App.
- Onsite channels with client- and brand-specific rates.
- Offsite rates.
- In-store flat fee, multiplier, and channel-specific rates.
- Self-serve vs managed-serve costings.
- Pricing models including cost per store, cost per unit, base rate, fixed cost.

### Secondary Space / PiggyBack Assets

- Base is primary source of Secondary Space configuration.
- Pollen cache is fallback when Base is unavailable.
- The relevant array is `piggyBackAssetTypes`.
- Empty array means no Secondary Space configuration and standard planning flow applies.
- Mandatory and optional assets are collected separately.
- Mandatory quantities default to 1 and are selected through dropdowns.
- Optional elements can be selected with quantities or skipped.
- Data is saved per channel as `piggyBackAssets` with `id`, `quantity`, `name`, `mandatory`.
- Saved data goes to MongoDB and later CRM/booking.
- Internal/external user type and `Only visible to internal` must be validated.

### Save / Discard / Summary

- Summary panel reflects selected channels, budget, timeline, Measurement SKUs, Hero SKUs, and Secondary Space details.
- Plan deletion/modification updates state data.
- Deleting a channel recalculates total budget and campaign dates.
- Deleting all channels clears budget/date/channel values.

## 5. Data and Business Rules

| Rule | Source | Expected behavior | Test notes |
| --- | --- | --- | --- |
| Booking deadline is channel-specific | `NUP-16919.doc`, `NUP-18900.csv` | Start date must be at least X days from today. If not, channel is not added and message references channel name and X days. | Test one channel per group: onsite, offsite, at home, in-store. |
| No booking deadline | `NUP-16919.doc` | Any valid start date should be accepted for that rule. | Still subject to other validations. |
| Minimum campaign duration is channel-specific | `NUP-16919.doc`, `NUP-18906.csv` | Date range must be at least X days. If shorter, channel is not added and message references channel name and X days. | Check boundary exactly X days. |
| No minimum campaign duration | `NUP-18907.csv` | Any valid end date should be accepted for that rule. | Still subject to booking deadline and other validations. |
| Channel deletion requires confirmation | `NUP-15407.doc` | Delete icon opens confirmation: `Are you sure you want to delete this channel?`; confirm removes, cancel does nothing. | Verify no backend request on cancel if observable. |
| Deleting channels recalculates summary | `NUP-19001.csv` | Total budget subtracts deleted channel budget; campaign start/end adjust to remaining earliest/latest dates; deleting all clears values. | Include earliest-start and latest-end deletion cases. |
| Store volume range | `NUP-17415.doc`, `NUP-19132.csv` | In-store channel with min/max store requirements blocks values outside range and shows allowed range. | Cover cost per store, cost per unit, base rate, fixed cost. |
| No store volume range | `NUP-17415.doc`, `NUP-19132.csv` | Store value outside old range is accepted after min/max removed. | Confirm config refresh is not stale. |
| Product listing vs store minimum | `NUP-17415.doc` comments | Future risk: product may be listed in fewer stores than channel minimum. | Add exploratory risk check if data is available. |
| Measurement SKU confirmation | `NUP-15404_Export_24-06-2026.xlsx` | Confirm is enabled only after at least one Measurement SKU is selected. | Check empty table and invalid SKU IDs. |
| Global Hero SKUs | `NUP-15404`, `NUP-17546.doc` | Selected global Hero SKUs are pre-populated on every selected channel. | Verify summary and channel modal agree. |
| Channel-level Hero SKUs | `NUP-18943` | User can add/remove Hero SKUs per channel; changes affect only that channel. | Ensure SKU choices come from allowed source. |
| Hero SKUs from brand-linked SKUs | `NUP-20956` | User can assign Hero SKUs from all SKUs linked to selected brand, and MP AI auto-adds them to Measurement SKUs. | This supersedes older "only Measurement SKUs" behavior. |
| Single prompt Measurement + Hero SKUs | `NUP-19273`, `NUP-19967` | AI recognizes both sets in one prompt, skips table steps, displays summary of unique Measurement SKUs and Hero flags. | Include duplicates and Hero SKU not in initial Measurement list. |
| Edit SKU list buttons | `NUP-19216` | Edit buttons under Measurement table, Hero table, and summary open the right modal and reflect changes immediately. | Check both table-specific and summary-specific modals. |
| Hero SKU max/min per channel | `NUP-18944`, `NUP-20507` | Channel config controls allowed Hero SKU count; too many/too few should block or require adjustment before booking. | Multi-channel input should continue processing other valid channels. |
| Hero flag sync after channel modification/deletion | `NUP-19140` | `StateData.campaign_skus.is_hero` becomes false if no channel uses SKU as Hero, true when added to any channel. | Verify after delete and edit. |
| HFSS/category restrictions | `NUP-20003` via Jira exports | Channels blocked when HFSS/category/Hero SKU requirements are not met. | Need test data for restricted categories. |
| Secondary Space detection | `NUP-20399` | If `piggyBackAssetTypes` empty, standard flow; if not empty, Secondary Space flow. | Base primary, Pollen cache fallback. |
| Mandatory Secondary Space | `NUP-20400` | Mandatory assets displayed with quantity dropdown 1-10, default 1, confirm always enabled. | Check `N selected` uses sum of quantities, not count. |
| Optional Secondary Space | `NUP-20401` | User can select quantities or skip optional elements. | Optional flow after mandatory, or directly if no mandatory. |
| Secondary Space save | `NUP-20402` | Selected elements and quantities saved per channel and ready for CRM/booking. | Verify MongoDB/booking visibility if access exists. |
| Secondary Space edit modal | `NUP-20739` | Confirmed fields are disabled in chat flow and editable via summary panel modal; no Assign all in modal. | Changes update summary and saved data. |
| Secondary Space user visibility | `NUP-22595` | Internal/external user type and `Only visible to internal` setting decide eligibility. | Requires both internal and external accounts. |
| Secondary Space feature flag | `NUP-24049` | Production feature flag removed; intended users always have feature enabled. | Confirm no stale hidden/disabled state. |

## 6. Integrations

| Integration | Purpose | Test Surface | Risks |
| --- | --- | --- | --- |
| Nectar AI | Conversational media plan creation and parsing | Prompt input, follow-up questions, extracted channel/SKU/budget/timeline data | Misread prompts, duplicate values, missing fields, wrong validations. |
| Pollen | Channel/SKU/media source and cache fallback | Channel config, modals, Pollen cache fallback for Secondary Space | Stale cache, mismatched config, wrong modal behavior. |
| Base | Primary Secondary Space configuration source | `piggyBackAssetTypes`, mandatory/optional flags, internal visibility | Base unavailable, fallback mismatch, invalid asset config. |
| MongoDB | Saves plan/channel/Secondary Space state | Saved plan data, `piggyBackAssets`, SKU flags | Partial save, stale values after edits/deletes. |
| CRM / booking | Receives selected channel and Secondary Space details | Booking details after save | Wrong payload, missing quantities, unclear channel-by-channel vs final send. |
| Activation Hub | External/internal visibility of booking details | Visible selected elements and quantities | Sensitive internal data exposed to external users. |
| Figma | UI reference for modals/components | Visual comparison | UX drift from accepted design. |
| GitHub / mpla-app | Implementation and PR evidence | Regression areas, automation scope | Code may have changed after exports. |

## 7. Exploratory Testing Charters

| Charter ID | Area | Mission | Timebox | Notes |
| --- | --- | --- | --- | --- |
| CH-001 | Landing/public/auth | Find entry points, login, navigation, role boundaries | 45 min | Source docs do not cover public/auth flows. |
| CH-002 | Basic media plan | Create a plan end to end with one simple channel | 60 min | Establish baseline before edge cases. |
| CH-003 | SKU handling | Explore Measurement/Hero SKU tables, global/channel-level edits, single prompt parsing | 90 min | High-risk/high-change area. |
| CH-004 | Timeline rules | Validate booking deadline and minimum campaign duration | 60 min | Needs configurable/test channels. |
| CH-005 | Channel deletion/save/discard | Check state transitions and summary recalculation | 60 min | Include last-channel deletion. |
| CH-006 | Store ranges/pricing | Validate in-store min/max stores and pricing model effects | 90 min | Needs pricing model test data. |
| CH-007 | Secondary Space | Explore mandatory/optional assets, role visibility, summary modal, save | 120 min | Requires internal/external users and configured channels. |
| CH-008 | HFSS/category restrictions | Verify restricted products/categories before summary panel | 60 min | Needs known restricted test SKUs. |
| CH-009 | Multi-channel prompts | Send multiple channels in one input and verify per-channel feedback | 60 min | Include mixed valid/invalid channels. |
| CH-010 | Persistence/integrations | Save plan and verify MongoDB/booking/CRM-visible details if accessible | 90 min | Avoid irreversible booking actions unless approved. |
| CH-011 | Responsive/accessibility | Check primary planning screens at desktop/tablet/mobile and keyboard usage | 45 min | Include modals and dropdowns. |
| CH-012 | Error/empty states | Network failures, no results, stale config, invalid prompts | 60 min | Useful for AI and integration surfaces. |

## 8. Test Cases

### Public / Auth

| ID | Scenario | Steps | Expected Result | Priority |
| --- | --- | --- | --- | --- |
| SAI-AUTH-001 | User can open app and authenticate | Open confirmed app URL, login with provided test account | User reaches Planning/Media Planner workspace | P0 |
| SAI-AUTH-002 | Direct protected URL access without session | Open planning URL in logged-out/new profile | User is redirected to login or denied cleanly | P0 |
| SAI-AUTH-003 | Internal vs external role separation | Login as internal and external users, compare visible channels/features | Internal-only features are hidden/blocked for external user | P0 |

### Media Plan Creation

| ID | Scenario | Steps | Expected Result | Priority |
| --- | --- | --- | --- | --- |
| SAI-MP-001 | Start media plan via Nectar AI | Planning page > click `create plan in minutes...` | Nectar AI starts guided creation | P0 |
| SAI-MP-002 | Required information collection | Provide advertiser/brand, objective, and SKUs step by step | AI asks only for missing data and proceeds after all required data exists | P0 |
| SAI-MP-003 | Missing channel follow-up | Provide advertiser/brand/objective/SKUs but no channel | AI asks for channel | P1 |
| SAI-MP-004 | Missing budget/timeline follow-up | Provide channel without required budget/timeline | AI asks for budget/timeline | P1 |
| SAI-MP-005 | Multiple channels in one prompt | Enter several channels with budgets and timeline | Channels are processed independently with clear feedback per channel | P0 |
| SAI-MP-006 | Mixed valid and invalid channels | Enter one valid and one invalid channel in one prompt | Valid channel can proceed; invalid channel shows specific reason | P0 |

### Measurement and Hero SKUs

| ID | Scenario | Steps | Expected Result | Priority |
| --- | --- | --- | --- | --- |
| SAI-SKU-001 | Measurement SKU confirm disabled when none selected | Reach Measurement SKU table with no selected SKU | Confirm is disabled | P0 |
| SAI-SKU-002 | Measurement SKU confirm enabled | Select at least one Measurement SKU | Confirm becomes enabled and proceeds | P0 |
| SAI-SKU-003 | Global Hero SKUs prepopulate channels | Select global Hero SKUs, then add channels | Each added channel starts with the global Hero SKUs | P0 |
| SAI-SKU-004 | Channel-level Hero SKU edit affects one channel | Open one channel modal and add/remove Hero SKU | Only that channel changes; other channels stay unchanged | P0 |
| SAI-SKU-005 | Hero SKU from brand-linked list auto-adds to Measurement | Select Hero SKU that was not initially in Measurement list but is brand-linked | SKU is added to Measurement SKUs and flagged as Hero | P0 |
| SAI-SKU-006 | Single prompt with Measurement and Hero SKUs | Enter prompt like `SKUs 1,2,3,4 and Hero SKUs 3,5,6` | Summary contains unique Measurement SKUs `1,2,3,4,5,6`; Hero flags `3,5,6` | P0 |
| SAI-SKU-007 | Edit Measurement SKU list from table | Click `Edit SKU list` under Measurement table and change list | Measurement table and summary update immediately | P1 |
| SAI-SKU-008 | Edit Hero SKU list from table | Click `Edit SKU list` under Hero table and change list | Hero table and summary update immediately | P1 |
| SAI-SKU-009 | Edit SKU list from summary | Use summary panel SKU edit action | Correct modal opens and updates reflected in summary | P1 |
| SAI-SKU-010 | Hero flag sync after channel deletion | Add SKU as Hero only on one channel, delete that channel | SKU no longer marked Hero if no remaining channel uses it | P0 |
| SAI-SKU-011 | Hero flag sync after channel modification | Add Hero SKU to a channel through modal | SKU becomes `is_hero=true` in state/summary | P0 |

### Channel Timeline Validation

| ID | Scenario | Steps | Expected Result | Priority |
| --- | --- | --- | --- | --- |
| SAI-TIME-001 | Booking deadline blocks too-early start | Configure channel booking deadline X days; enter start date X-1 days from today | Channel not added; error references channel and X days | P0 |
| SAI-TIME-002 | Booking deadline boundary accepted | Enter start date exactly X days from today | Channel is added | P0 |
| SAI-TIME-003 | Booking deadline future accepted | Enter start date after X days | Channel is added | P1 |
| SAI-TIME-004 | No booking deadline accepts any start | Remove booking deadline and enter near-term start | Channel is added unless blocked by another rule | P1 |
| SAI-TIME-005 | Minimum duration blocks short range | Configure min duration X days; enter range X-1 days | Channel not added; error references channel and X days | P0 |
| SAI-TIME-006 | Minimum duration boundary accepted | Enter range exactly X days | Channel is added | P0 |
| SAI-TIME-007 | No minimum duration accepts any range | Remove min duration and enter short range | Channel is added unless blocked by another rule | P1 |
| SAI-TIME-008 | One channel per group coverage | Repeat deadline/duration tests for onsite, offsite, at home, in-store | Same rule behavior works across groups | P0 |

### Channel Delete / Save / Discard

| ID | Scenario | Steps | Expected Result | Priority |
| --- | --- | --- | --- | --- |
| SAI-DEL-001 | Delete confirmation opens | Click delete icon on selected channel | Confirmation text is shown | P0 |
| SAI-DEL-002 | Cancel delete | Click cancel in confirmation | Dialog closes and channel remains unchanged | P0 |
| SAI-DEL-003 | Confirm delete | Click confirm in confirmation | Channel is removed from list/summary | P0 |
| SAI-DEL-004 | Delete latest end-date channel | Delete channel with latest end date | Campaign end date becomes latest end date among remaining channels | P0 |
| SAI-DEL-005 | Delete earliest start-date channel | Delete channel with earliest start date | Campaign start date becomes earliest start date among remaining channels | P0 |
| SAI-DEL-006 | Delete channel budget recalculation | Delete any channel with budget | Total budget decreases by deleted channel budget | P0 |
| SAI-DEL-007 | Delete all channels | Remove every selected channel | Total budget and start/end dates become empty; no deleted channel values remain | P0 |
| SAI-SAVE-001 | Save plan persists summary | Save a complete plan, reopen if possible | Saved channels, dates, budgets, SKUs are preserved | P0 |
| SAI-SAVE-002 | Discard plan clears draft | Create draft, discard it | Draft state is cleared and not bookable/saved | P1 |

### Store Count and Pricing

| ID | Scenario | Steps | Expected Result | Priority |
| --- | --- | --- | --- | --- |
| SAI-STORE-001 | Store count above max blocked | In-store channel with max store volume, enter max+1 | Channel not added; message asks to correct store count | P0 |
| SAI-STORE-002 | Store count below min blocked | In-store channel with min store volume, enter min-1 | Channel not added; message asks to correct store count | P0 |
| SAI-STORE-003 | Store count within range accepted | Enter value between min and max | Channel is added | P0 |
| SAI-STORE-004 | Store count accepted without min/max | Remove min/max and enter value outside previous range | Channel is added | P1 |
| SAI-STORE-005 | Pricing model coverage | Repeat store range checks for cost per store, cost per unit, base rate, fixed cost | Validation behavior is consistent where store input is required | P1 |
| SAI-RATE-001 | In-store flat fee/multiplier/channel-specific rates | Create channel/plan using each supported in-store rate type | Costing is calculated and displayed according to config | P1 |
| SAI-RATE-002 | Onsite client/brand-specific rate | Use onsite channel with client/brand-specific rate | Correct rate is applied for selected advertiser/brand | P1 |
| SAI-RATE-003 | Offsite rate coverage | Use offsite channel with configured rate | Correct rate/cost appears in summary | P2 |
| SAI-RATE-004 | Self-serve vs managed-serve costing | Compare same eligible channel under self-serve and managed-serve setup | Expected costing difference is applied | P1 |

### Hero SKU Limits / Restrictions

| ID | Scenario | Steps | Expected Result | Priority |
| --- | --- | --- | --- | --- |
| SAI-LIM-001 | Channel max Hero SKUs exceeded globally | Select global Hero SKUs above channel max, add channel | Channel requires adjustment/warning before booking | P0 |
| SAI-LIM-002 | Channel max Hero SKUs exceeded in modal | Edit channel and select above max | User is blocked or informed and cannot proceed invalidly | P0 |
| SAI-LIM-003 | Channel min Hero SKUs not met | Add channel with fewer than min Hero SKUs | User is blocked or asked to correct | P0 |
| SAI-LIM-004 | No max Hero SKU configured | Add many Hero SKUs to channel with no max | No max-count restriction is applied | P1 |
| SAI-LIM-005 | Multi-channel Hero SKU limit handling | Enter several channels where one fails Hero SKU limits | Other valid channels continue through resolver; invalid one gives clear error | P0 |
| SAI-REST-001 | HFSS restriction | Use product/channel combination that violates HFSS restriction | Channel is blocked before summary panel | P0 |
| SAI-REST-002 | Category restriction | Use restricted category for a channel | Channel is blocked before summary panel | P0 |

### Secondary Space

| ID | Scenario | Steps | Expected Result | Priority |
| --- | --- | --- | --- | --- |
| SAI-SS-001 | No Secondary Space config uses standard flow | Add channel with empty `piggyBackAssetTypes` | Standard planning flow continues | P0 |
| SAI-SS-002 | Detect configured Secondary Space | Add in-store channel with non-empty `piggyBackAssetTypes` | Secondary Space flow starts | P0 |
| SAI-SS-003 | Mandatory element default quantity | Reach mandatory elements step | Each mandatory element defaults to quantity 1 | P0 |
| SAI-SS-004 | Mandatory quantity range | Change mandatory quantity through dropdown | Allowed values are 1-10 only | P0 |
| SAI-SS-005 | Mandatory confirm enabled | Mandatory form displayed | Confirm is enabled even with defaults | P1 |
| SAI-SS-006 | Assign all button condition | Compare one mandatory element vs 2+ mandatory elements | Assign all enabled only when 2+ elements exist | P1 |
| SAI-SS-007 | `N selected` quantity sum | Select quantities 2 and 3 | Indicator shows 5 selected, not 2 selected | P0 |
| SAI-SS-008 | Optional elements after mandatory | Confirm mandatory elements | Optional elements prompt appears when optional config exists | P0 |
| SAI-SS-009 | Optional quantity selection | Select optional element quantity | Selection is reflected in summary | P1 |
| SAI-SS-010 | Skip optional elements | Choose skip optional | Flow proceeds without optional assets | P1 |
| SAI-SS-011 | Confirmed fields become disabled | Confirm Secondary Space selection in chat flow | Fields are disabled and not directly editable in chat | P0 |
| SAI-SS-012 | Edit via summary modal | Open summary modal for Secondary Space and change quantities | Modal updates selected data and summary; no Assign all in modal | P0 |
| SAI-SS-013 | Save Secondary Space data | Save plan with mandatory/optional selections | Saved channel includes `piggyBackAssets` id, quantity, name, mandatory | P0 |
| SAI-SS-014 | Internal user can add eligible internal-only channel | Login as internal user and add internal-only Secondary Space channel | Channel can be added if all validations pass | P0 |
| SAI-SS-015 | External user blocked for internal-only channel | Login as external user and add internal-only Secondary Space channel | Channel is blocked with clear eligibility message | P0 |
| SAI-SS-016 | Multiple Secondary Space channels in one prompt | Enter multiple channels with mixed Secondary Space config | Each channel is processed in sequence and feedback is clear | P1 |
| SAI-SS-017 | Base unavailable fallback | Simulate or choose case where Base unavailable and Pollen cache exists | Pollen cache is used; user flow still works | P1 |
| SAI-SS-018 | Base/Pollen mismatch | Use channel where Base and cache differ, if testable | System follows documented priority: Base first, Pollen fallback only | P1 |
| SAI-SS-019 | Feature flag removed | Check production/intended env for Secondary Space feature | Feature is available to intended users without hidden feature flag dependency | P1 |

### Negative / Error / Non-Functional

| ID | Scenario | Steps | Expected Result | Priority |
| --- | --- | --- | --- | --- |
| SAI-NEG-001 | Invalid SKU IDs | Enter malformed or nonexistent SKUs | User receives clear correction path; no broken summary state | P1 |
| SAI-NEG-002 | Duplicate SKUs | Enter duplicate Measurement/Hero SKUs | Duplicates are de-duped or clearly handled | P1 |
| SAI-NEG-003 | Ambiguous prompt | Enter vague channel/SKU/timeline prompt | AI asks clarifying question instead of guessing unsafe values | P1 |
| SAI-NEG-004 | Stale channel config | Change channel config, then immediately create plan | Latest config is used or cache behavior is explicit | P1 |
| SAI-NEG-005 | Network/API failure during validation | Interrupt channel validation request | User sees retryable error and draft state remains consistent | P1 |
| SAI-NEG-006 | Refresh during draft | Refresh browser mid-flow | Draft either restores correctly or cleanly restarts without stale data | P2 |
| SAI-NEG-007 | Keyboard-only modal use | Navigate SKU/Secondary Space modals by keyboard | Focus order is logical, no keyboard trap, confirm/cancel reachable | P2 |
| SAI-NEG-008 | Mobile/tablet layout | Run primary flow at narrow viewport | Chat, tables, summary, modals remain usable | P2 |

## 9. Known Risks / Findings

| Finding | Evidence | Impact | Follow-up |
| --- | --- | --- | --- |
| Application URL is not present in extracted files | Search found Jira/Confluence/Figma/GitHub URLs, not the app URL; current dev URL was later provided by the user | Future testers need the URL from this doc or test environment config | Keep `https://www.dev.rtd.js-devops.co.uk/planning/nectar-ai` as the current dev entry point. |
| PDF body text was not extracted by available local tools | `textutil` and Spotlight returned no usable body text; PDFs use Confluence/Chrome PDF structure with CMap | Pricing/costing details may be incomplete in this doc | Open PDFs manually or install/use a better PDF extractor. |
| Duplicate exports exist | Many XLSX files have same NUP and different export dates/copies | Risk of counting same requirement twice | Treat latest/most complete content as primary. |
| Secondary Space had known issue around selected count | Jira comment: `N selected` should display sum of quantities, not number of selected elements | Regression-prone UI logic | Include SAI-SS-007 in smoke/regression. |
| Some stories closed with known issues planned for next sprint | Jira comments in Secondary Space exports | Done status may not mean bug-free | Check linked defects/current Jira before final sign-off. |
| In-store channel edit modal had known problems | `NUP-19140` text mentions inStore channel edit modal problems | SKU/channel edit regressions likely | Prioritize modal edit checks. |
| Product listing vs store minimum not fully implemented | `NUP-17415.doc` comment raises future blocking need | Business rule gap: product may be listed in fewer stores than min channel stores | Confirm if in current scope. |
| CRM/booking send timing unclear | `NUP-20316` asks whether data is sent channel-by-channel or after final save | Integration test expectations unclear | Clarify before destructive/downstream tests. |

## 10. Open Questions

- Which accounts are available: internal, external, Channel Management/admin?
- Can we safely edit Channel Management config in the target environment?
- Which test advertiser/brand/SKUs/channels are safe to use?
- Are CRM/booking side effects allowed, or should tests stop before final booking?
- Is Base/Pollen/MongoDB/CRM access available for verification?
- Which pricing/cost formulas from the PDFs are in scope for this exploratory pass?
- Should tests cover production behavior or only stage/dev?

## 11. Source Material Index

| File / group | Type | Summary | Key details to test |
| --- | --- | --- | --- |
| `NUP-15407.doc` | Jira story DOC | Frontend channel deletion from media plan section | Delete icon, confirmation text, confirm/cancel, backend deletion request, UI removal. |
| `NUP-16919.doc` | Jira story DOC | Dynamic lead time validation: booking deadline and minimum campaign duration | Channel-specific date validation, boundary values, clear errors. |
| `NUP-17415.doc` | Jira story DOC | Test-only min/max store level enforcement | Store count below/above range, no range, future product-listing risk. |
| `NUP-17546.doc` | Jira epic DOC | Measurement vs Hero SKUs | Global/channel SKU assignment, distinction between Measurement and Hero SKUs. |
| `NUP-18900.csv` | Manual test CSV | Booking deadline tests | Start date X-1 blocked, X accepted, future accepted. |
| `NUP-18906.csv` | Manual test CSV | Minimum campaign duration tests | Duration X-1 blocked, X accepted. |
| `NUP-18907.csv` | Manual test CSV | No minimum campaign duration | Any end date allowed for that rule. |
| `NUP-19001.csv` | Manual test CSV | Channel deletion recalculation | Budget subtraction, start/end date recalculation, all-channel deletion clear state. |
| `NUP-19132.csv` | Manual test CSV | Store range tests for in-store pricing models | Cost per store/unit, base rate, fixed cost with min/max store volume. |
| `NUP-15404_Export_24-06-2026.xlsx` | Jira XLSX | Differentiate Measurement and Hero SKUs; manage global Hero list | Measurement table, global Hero pre-population, confirm rules. |
| `NUP-18943_Export_*` | Jira XLSX | Assign/edit Hero SKUs per channel | Channel modal, per-channel scope, allowed SKUs. |
| `NUP-18944_Export_*` | Jira XLSX | Max Hero SKUs per channel | Warnings/blocking when global/channel Hero SKUs exceed max. |
| `NUP-19140_Export_*` | Jira XLSX | Update Hero SKU state on channel deletion/modification | `is_hero` sync after edit/delete. |
| `NUP-19216_Export_*` | Jira XLSX | `Edit SKU list` button under SKU tables and summary | Correct modal opens and updates reflect immediately. |
| `NUP-19273_Export_*` | Jira XLSX | Measurement + Hero SKUs in a single prompt | Skip table steps, summary confirmation, unique SKU list. |
| `NUP-19529_Export_*` | Jira XLSX | Channel-specific SKU definition in channel prompt | Parse `offSite: Meta, budget, dates, skus...`; assign all Hero SKUs if none defined. |
| `NUP-19967_Export_*` | Jira XLSX | AI recognizes Hero SKU declaration in input | Prompt parsing and Hero flags. |
| `NUP-20507_Export_*` | Jira XLSX | Validate min/max Hero SKUs after channel activation | Single invalid channel blocks; multi-channel continues valid channels. |
| `Sainsbury's Jira (10).csv` | Jira CSV | Secondary Space epic/story set | Detection, mandatory/optional assets, save, edit modal, user visibility. |
| `Sainsbury's Jira (11).csv` | Jira CSV | Secondary Space implementation/test design details | PiggyBackNode, `piggyBackAssets`, chat components, feature flag. |
| `Sainsbury's Jira (5).csv` | Jira CSV | Automation testing backlog/tasks | Automated coverage themes for SKUs, Secondary Space, rates/costings. |
| `Sainsbury's Jira (7).csv` | Jira CSV | Save/discard functionality parent | Plan saving and discard tests. |
| `Sainsbury's Jira (8).csv` | Jira CSV | HFSS/category restrictions and Hero SKU limits | Restriction validation before summary panel. |
| `NUP-Pricing Models in Channel Management-210626-174057.pdf` | Confluence PDF | Pricing Models in Channel Management | Need manual text extraction; cover pricing model calculations. |
| `NUP-Instore & At Home Cost Calculations-210626-174055.pdf` | Confluence PDF | Instore & At Home Cost Calculations | Need manual text extraction; cover cost formulas. |

## 12. Execution Log - `planning/nectar-ai` - 2026-07-05

### Scope and Environment

- Environment: dev.
- Entry point: `https://www.dev.rtd.js-devops.co.uk/planning/nectar-ai`.
- Browser: user's already-authenticated Chrome window.
- Authenticated user visible in app: `Hi Denys,`.
- Tested Nectar AI conversation route: `/planning/nectar-ai/3588edd707434573a46081b2`.
- Main saved plan route opened in Pollen: `/planning/self-serve-plan/6a4a9b576ec8a640dbafa863/channels-and-media`.

### Test Data Used

| Field | Value |
| --- | --- |
| Advertiser | `N360_Unilever_MS` |
| Brand | Unilever &#124; Knorr &#124; MS |
| Objective | `Customer retention` |
| Product search | `knorr` |
| Measurement SKUs | 29 selected from product search table |
| Hero SKUs | 1 selected: `2023755 - Knorr Knorr 8 Vegetable Stock Cubes 80g` |
| Baseline channel attempted | `Offsite, DD Pubmatic - Display, 20/04/2026 till 20/05/2026, budget 7k` |
| Successful alternate channel | `Offsite, Meta, 20/04/2027 till 20/05/2027, budget 7k, MS` |
| UI plan name after channel | 2027_04_Unilever&#124;Knorr&#124;MS_Retention_offsite_1783274327 |
| Downloaded CSV | `/Users/maybebest/Downloads/2027_04_Unilever_Knorr_MS_1783274327.csv` |

### Baseline Journey Execution

| Step / Assertion | Status | Evidence / Notes | Automation Candidate |
| --- | --- | --- | --- |
| Open Nectar AI module while authenticated | PASS | Page opened and greeted authenticated user as `Hi Denys,`. | Yes |
| Start guided flow from Nectar AI | PASS | Chat prompt `Help me build a plan based on my objective and budget` started the required guided flow. Visual starter card existed; direct coordinate click was not reliable in the automation run. | Yes, via stable selector/accessible name |
| Text-only advertiser/brand input before selector | PASS as negative check | App rejected plain text and required selecting advertiser and brand: `Please make sure to select both to proceed.` | Yes |
| Select advertiser `N360_Unilever_MS` and brand Unilever &#124; Knorr &#124; MS | PASS | Advertiser row existed, brand checkbox selected, `Confirm and continue` accepted. | Yes |
| Summary shows advertiser and brand | PASS | Summary panel updated with selected advertiser and brand. | Yes |
| Enter objective `Customer retention` | PASS | Summary panel displayed objective. | Yes |
| Enter product search `knorr` | PASS | Product search table was displayed. | Yes |
| Select Measurement SKUs and confirm | PASS | `Select All` produced `29 selected`; after confirm summary showed `Measurement SKUs: 29 SKUs`. | Yes |
| Hero SKU handling | PASS with product-flow deviation | App required a separate Hero SKU step after Measurement SKUs. Selected one Hero SKU and summary showed `Hero SKUs: 1 SKU`. Baseline expected Hero and Campaign SKU counts from one product table step, but current UI separates them. | Yes |
| Add baseline channel `DD Pubmatic - Display` for chosen brand | BLOCKED by test data | App responded that `DD Pubmatic - Display` is not available for the chosen brand. Need eligible channel-brand fixture or update the baseline to an eligible channel. | Yes, once fixture exists |
| Use baseline dates `20/04/2026 - 20/05/2026` | BLOCKED by stale date data | Current system date is 2026-07-05, so app rejected 2026 dates as past. Need generated future dates relative to test run date. | Yes |
| Add alternate channel `Offsite, Meta` with future dates and budget 7k | PASS | App found several Meta matches; selecting `offSite: Meta` and using `20/04/2027 - 20/05/2027` added the media row. | Yes |
| Summary media row values | PASS with budget note | Summary showed Offsite > Meta, dates `20 Apr 2027 - 20 May 2027`, Hero SKUs `1`, total budget `GBP 7,010`. Input was `7k`, so expected pricing/rounding rule needs confirmation. | Yes |
| Summary date prefill from channel | PASS | Summary dates became `20 Apr 2027 - 20 May 2027`. | Yes |
| Click left-side `Confirm` after channel addition | PASS | App showed completion prompt: `Great! Your plan is ready to go.` | Yes |
| Save action prompt | PASS with copy deviation | Current UI button is `Save plan as draft`, not `Confirm the save plan`. | Yes |
| Save plan | PASS | App replied `Your plan has been saved as a draft. What would you like to do next?`; `Edit plan in Pollen` and `Download` became enabled. | Yes |
| Verify UI plan name structure | PASS with contract differences | UI name included start month, brand, shortened objective, channel group, and unique number: 2027_04_Unilever&#124;Knorr&#124;MS_Retention_offsite_1783274327. Format uses underscores and shortened objective. | Yes |
| Download CSV | PASS | CSV downloaded to `/Users/maybebest/Downloads/2027_04_Unilever_Knorr_MS_1783274327.csv`; file has 39 lines and includes advertiser, brand, objective, dates, SKUs, and media row. | Yes |
| CSV plan name matches UI plan name | FAIL / needs triage | CSV `Plan Name` was 2027_04_Unilever&#124;Knorr&#124;MS_1783274327, which omits `_Retention_offsite_` visible in the UI plan name. | Yes |
| Edit in Pollen opens regular app | PASS | `Edit plan in Pollen` opened `/planning/self-serve-plan/.../channels-and-media`; Off-site Social table showed Meta with dates `Apr 20 2027 - May 20 2027` and `Hero SKUs: 1 selected`. | Yes |

### Existing Test Case Coverage Marked From This Run

| Existing ID | Status | Notes |
| --- | --- | --- |
| SAI-AUTH-001 | PASS | Authenticated dev URL access verified. |
| SAI-MP-001 | PASS | Guided Nectar AI flow started. Use stable UI selector for the starter card in automation. |
| SAI-MP-002 | PASS | Advertiser/brand, objective, SKUs, and channel data collected step by step. |
| SAI-MP-004 | PASS | Missing/invalid channel or dates triggered corrective follow-up messages. |
| SAI-SKU-002 | PASS | Measurement SKU selection enabled confirmation and updated summary. |
| SAI-SKU-003 | PARTIAL | Global Hero SKU selection worked before channel add, and the channel used the selected Hero SKU. More checks needed for multiple Hero SKUs and multiple channels. |
| SAI-TIME-001 | PARTIAL | Past-date blocking was observed. Booking-deadline-specific boundary testing still needs configurable channel/date fixtures. |
| SAI-RATE-003 | PARTIAL | Offsite budget/cost displayed, but expected rate formula for `7k -> GBP 7,010` is not confirmed. |
| SAI-DEL-001 | NOT EXECUTED | Saved Pollen plan displayed a Meta row with delete icon, but available browser access did not expose a stable DOM/AX selector and coordinate clicks did not trigger the delete action. Use Playwright/CDP or app test ids for automation. |
| SAI-SAVE-001 | PASS | Saved draft, downloaded CSV, and opened the saved plan in Pollen. |

### Missing Test Data / Blockers

| Missing data / setup | Why it is needed |
| --- | --- |
| Eligible fixture for `N360_Unilever_MS` + Unilever &#124; Knorr &#124; MS + `DD Pubmatic - Display` | Required to run the user's exact baseline channel step. Current app says this channel is unavailable for the selected brand. |
| Future-dated baseline dates | The example dates `20/04/2026 - 20/05/2026` are now in the past and are rejected by the app. |
| Expected offsite pricing rule for Meta | Need to know whether `7k` should display/save as `GBP 7,000`, `GBP 7,010`, or another calculated value. |
| Plan naming contract | UI and CSV disagree about objective/channel in the plan name. Need expected contract for UI, DB, CSV, and Pollen. |
| Internal, external, and Channel Management/admin accounts | Needed for permission, internal-only channel, and config-management cases. |
| Test brands/products with HFSS/category restrictions | Needed for SAI-REST cases. |
| Channels with known booking deadlines and minimum durations | Needed for deterministic SAI-TIME boundary automation. |
| Channels with min/max Hero SKU limits | Needed for SAI-LIM automation. |
| In-store channels with min/max store volume and each pricing model | Needed for SAI-STORE and SAI-RATE coverage. |
| Secondary Space/PiggyBack fixture data | Needed for SAI-SS cases. |

### Recommended Test Data Management APIs

Create these test-only APIs or equivalent fixtures so automation can prepare and clean data deterministically:

| API / Fixture Capability | Purpose |
| --- | --- |
| `POST /test-data/run` and `DELETE /test-data/run/{runId}` | Create isolated test run namespace and clean all data created by that run. |
| `POST /test-data/advertisers` | Create advertiser such as `N360_Unilever_MS`. |
| `POST /test-data/brands` | Create brand linked to advertiser, with region/business unit metadata. |
| `POST /test-data/products` or `POST /test-data/skus` | Create searchable products/SKUs with brand, category, HFSS flags, listing/store metadata. |
| `POST /test-data/channel-eligibility` | Attach or remove channel availability for advertiser/brand combinations. |
| `POST /test-data/channels` and `PATCH /test-data/channels/{id}` | Manage channel group/name, self-serve/managed-serve flags, internal-only visibility, booking deadlines, min duration, store rules, and Hero SKU limits. |
| `POST /test-data/channel-rates` | Seed pricing/rate formulas so budget and total cost assertions are deterministic. |
| `POST /test-data/secondary-space` | Seed PiggyBack/Secondary Space mandatory and optional assets for a channel. |
| `POST /test-data/restrictions` | Seed HFSS/category/channel restrictions for negative tests. |
| `POST /test-data/users` or `POST /test-data/user-roles` | Create/switch internal, external, and admin test roles. |
| `POST /test-data/media-plans` | Seed existing plans for edit/delete/reopen scenarios. |
| `GET /test-data/media-plans/{id}` | Verify saved plan state without relying only on UI or CSV. |
| `GET /test-data/media-plans/{id}/export` | Verify CSV/export contents through API and compare with downloaded UI file. |
| `POST /test-data/clock` or relative-date fixture support | Avoid stale hard-coded dates by generating future windows relative to test execution date. |

### Follow-Up Findings From The Live Run

| Finding | Evidence | Suggested action |
| --- | --- | --- |
| Baseline channel fixture is not valid for the selected brand | `DD Pubmatic - Display` was rejected as unavailable | Either seed eligibility for this exact baseline or change baseline to a known eligible channel such as Meta. |
| Baseline dates are stale | 2026 dates were rejected as past on 2026-07-05 | Automation should generate dates relative to today. |
| Hero SKU flow is separate from Measurement SKU flow | After Measurement confirm, app requested Hero SKU selection | Update baseline case to include explicit Hero SKU step. |
| Save button copy differs from baseline | UI shows `Save plan as draft` | Update test expectation or confirm intended copy. |
| UI and CSV plan names differ | UI includes objective/channel; CSV omits them | Triage as potential defect or clarify expected export behavior. |
| `7k` budget became `GBP 7,010` | Summary and CSV showed `GBP 7,010` | Confirm pricing/costing formula from Channel Management/Pricing docs. |
