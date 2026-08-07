# Flow: Media Planner pricing model cost calculation

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-MP-009 |
| Spec Version | 1.1.0 |
| Owner | aqa-team@example.com |
| Priority | P1 |
| Test Type | regression |
| Auth | required |
| Target Test File | tests/regression/media-planner-pricing-cost-calculation.authenticated.spec.ts |
| Base Path | /planning |
| Tags | @generated @regression @media-planner @authenticated @special-preconditions |
| Review Status | pending-review |
| Review Sign-off | pending |
| Generation Source | manual-test-case |
| Generation Status | generated |
| Generation Mode | suite |

## User Story

As a media planner,
I want the campaign cost the planner displays for each channel to match the documented pricing-model formulas and managed-service fee rules,
So that I can trust the Pollen cost shown for Trolley, Petrol Pumps, Travel Money, and Budget-Led channels before I book.

## Preconditions

- The user has a valid non-production authenticated Playwright storage state.
- `PLAYWRIGHT_TEST_BASE_URL` points to an explicitly configured non-production Pollen environment.
- Local storage key `feature-flags` enables `FEATURE_NECTAR_AI`, `FEATURE_NUP`, and `FEATURE_NECTAR_AI_MP`.
- The user can access Media Planner at `/planning`.
- The advertiser `N360_Unilever_MS`, brand `Unilever | Knorr | MS`, objective `Customer retention`, and product search `knorr` are available for the guided flow.
- The cost oracle module `automation/src/cost-oracle.ts` is importable and exposes `calculateTrolleyCost`, `calculatePetrolPumpCost`, `calculateTravelMoneyScreensCost`, `calculateBudgetLedCost`, `applyManagedService`, `roundToPence`, and `formatGBP`. The oracle is the source of truth for every expected cost; UI values are compared to oracle output, never to hard-coded strings.
- Group B cases (oracle-unit) require only the oracle module and run with no pre-configured channel.
- Group A cases require exact, read-only configured channels: Trolley (`Trolley Panels (KCTEST)`) at £3.37/unit and 3% managed service; Petrol (`Petrol Pump Nozzles`) at £16.24/unit and flat £2 managed service; Travel Money (`Travel Money Screens (KCTEST)`) at £300/store and 4% managed service; Digital Screens (`Digital Screens - 6 Sheets`) with Budget-Led pricing. Channel names and numeric values are env-overridable (see Test Data).
- The configured per-unit, per-store, units-per-store and managed-service-fee values for each Group A channel are read from env-override variables when set (see Test Data); the dev defaults above are used otherwise.
- Before each Group A case, a read-only configuration preflight must confirm the exact channel pricing model/rate/fee matches the expected env value or documented default; mismatch fails before a plan is sent.
- Campaign dates are derived from one per-case calendar anchor as today+45 through today+75 so unrelated deadline/duration checks do not block the cost assertion. Each case starts a fresh unsaved conversation and removes its added channel in cleanup.

## Out-of-scope

- Admin configuration changes are out of scope and must remain read-only.
- Channel pricing-model, rates-management, and managed-service-fee administration are out of scope; those values are treated as pre-configured.
- Store-volume min/max administration and the store-volume rejection wording are validated by their own flow and are out of scope here except where store count drives the cost.
- POS Base Rate pro-rata and back-to-back cycle math is out of scope for this flow.
- Final booking submission is out of scope; the test validates the planning-flow displayed cost only.
- Production credentials and production user data are out of scope.

## Stability Requirements

| Field | Value |
|---|---|
| Parallel Safe | no |
| Data Isolation | external |
| Allowed Retries | 0 |

## Variants

| Locale | Role | Plan |
|---|---|---|
| en-GB | media planner | N360_Unilever_MS |

## Includes

- none

## Business Rules

| Rule ID | Rule | Formula | Blocking Behavior |
|---|---|---|---|
| RULE-001 | Trolley Cost-per-unit subtotal | trolleySubtotal = roundToPence(125 * costPerUnit * numberOfStores) | Non-blocking; the computed cost is displayed in the summary panel and must equal the oracle value |
| RULE-002 | Petrol Pumps Cost-per-unit subtotal | petrolSubtotal = roundToPence(costPerUnit * 30 * numberOfStores) | Non-blocking; the computed cost is displayed in the summary panel and must equal the oracle value |
| RULE-003 | Travel Money Cost-per-store subtotal | travelMoneySubtotal = roundToPence(costPerStoreStandard * numberOfStores) | Non-blocking; the computed cost is displayed in the summary panel and must equal the oracle value |
| RULE-004 | Budget-Led pass-through | budgetLedTotal = budget (managed-service fee is factored into the budget, never added on top, so 4% does not push £30,000 to £31,200) | Non-blocking; the displayed total equals the user-entered budget |
| RULE-005 | Managed-service fee application gate | applyManagedService(subtotal, type, fee) = subtotal when type !== 'Managed service' OR fee is undefined; subtotal + fee.amount when fee.kind === 'flat'; subtotal * (1 + fee.percent/100) when fee.kind === 'percentage'; flat/percentage 0 is a no-op | Non-blocking; the fee changes the displayed cost only when media service type is 'Managed service' and a non-zero fee exists |
| RULE-006 | Round to pence half-up with double-round | roundToPence(x) = Math.round(x * 100) / 100 (half-up toward +Infinity); subtotal is rounded before the percentage fee and the result is rounded again, so 21062.50 * 1.03 = 21694.375 rounds to 21694.38 | Non-blocking; the displayed pence value must match the half-up double-round result |
| RULE-007 | Petrol Pumps 4% percentage MS regression (NUP-18835) | correctTotal = roundToPence(16.24 * 30 * 40 * 1.04) = 20267.52; documented buggy value = 19489.02 | Oracle coverage must reject the buggy value now; the live UI regression is not emitted until a safe configured 4% channel exists and NUP-18835 is fixed—no skip/fixme is permitted |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | model=Trolley; costPerUnit=3.37; stores=50; mediaServiceType=Self-serve; managedServiceFee=none | cost=21062.50 (= 125 * 3.37 * 50) | Group B oracle-unit; runs on standard module, no pre-configured channel; worked example baseline |
| DC-002 | model=Trolley; costPerUnit=3.37; stores=50; mediaServiceType=Managed service; managedServiceFee=flat £2.00 | cost=21064.50 (flat fee added) | Group B oracle-unit; standard module; flat fee is added not multiplied |
| DC-003 | model=Trolley; costPerUnit=3.37; stores=50; mediaServiceType=Managed service; managedServiceFee=percentage 3% | cost=21694.38 (= 21062.50 * 1.03, half-up double-round) | Group B oracle-unit; standard module; worked example; load-bearing half-up at .375 to .38 |
| DC-004 | model=Trolley; stores=50; configured costPerUnit and managed percentage; UI cost displayed | UI cost === formatGBP(oracle); default fixture renders £21,694.38 | Group A; live configuration must match env/default before send |
| DC-005 | model=Petrol Pumps; costPerUnit=16.24; stores=40; mediaServiceType=Self-serve; managedServiceFee=none | cost=19488.00 (= 16.24 * 30 * 40) | Group B oracle-unit; standard module; confirms 30 units/store multiplier distinct from Trolley 125 |
| DC-006 | model=Petrol Pumps; costPerUnit=16.24; stores=40; mediaServiceType=Managed service; managedServiceFee=percentage 4%; reference case | cost=20267.52 (= 19488.00 * 1.04) and NOT 19489.02 | Group B oracle-unit; correct reference value for the regression |
| DC-007 | model=Petrol Pumps; stores=40; configured costPerUnit and flat managed fee; UI cost displayed | UI cost === formatGBP(oracle); default fixture renders £19,490.00 | Group A; green flat-fee control unaffected by NUP-18835 |
| DC-008 | model=Travel Money; costPerStoreStandard=300; stores=50; mediaServiceType=Self-serve; managedServiceFee=none | cost=15000.00 (= 300 * 50) | Group B oracle-unit; standard module; cost-per-store has no units multiplier |
| DC-009 | model=Travel Money; stores=50; configured costPerStore and managed percentage; UI cost displayed | UI cost === formatGBP(oracle); default fixture renders £15,600.00 | Group A; same percentage-fee semantics the Petrol bug should follow |
| DC-010 | model=Budget-Led; configured budget; managedServiceFee percentage is inert; UI cost displayed | cost === configured budget and not budget*1.04; default fixture renders £30,000.00, not £31,200.00 | Group A; Budget-Led fee does not inflate the entered total |
| DC-011 | applyManagedService gate; subtotal=15000; rows over {Self-serve, Managed service} x {flat 2, percentage 4, flat 0, percentage 0, undefined} | Self-serve and undefined and 0-value fees return 15000.00; Managed service flat 2 returns 15002.00; Managed service percentage 4 returns 15600.00 | Group B oracle-unit; standard module; exhaustive MS-gate decision table |
| DC-012 | roundToPence half-up; inputs {21694.375, 0.005, 0.004} and Trolley 50 @ £3.37 at 2%/3%/4% | 21694.375 to 21694.38; 0.005 to 0.01; 0.004 to 0.00; Trolley 2% to 21483.75; 3% to 21694.38; 4% to 21905.00 | Group B oracle-unit; standard module; protects worked-example value against a banker's-rounding regression |
| DC-013 | model=Petrol Pumps; costPerUnit=16.24; mediaServiceType=Managed service; managedServiceFee=percentage 4%; neighbours around the 40-store reference: 39 and 41 | 39 stores to 19760.83; 41 stores to 20774.21; both follow *1.04 | Group B oracle-unit; neighbouring inputs prove the bug is a percentage defect, not a 40-store special case |

## Data Cases as JSON

```json
[
  {
    "caseId": "DC-001",
    "inputs": {"model": "Trolley", "costPerUnit": 3.37, "numberOfStores": 50, "mediaServiceType": "Self-serve", "managedServiceFee": null},
    "expected": {"cost": 21062.50, "formula": "125 * 3.37 * 50"},
    "notes": "Group B oracle-unit; standard module; worked-example baseline; calculateTrolleyCost."
  },
  {
    "caseId": "DC-002",
    "inputs": {"model": "Trolley", "costPerUnit": 3.37, "numberOfStores": 50, "mediaServiceType": "Managed service", "managedServiceFee": {"kind": "flat", "amount": 2.00}},
    "expected": {"cost": 21064.50, "formula": "21062.50 + 2.00"},
    "notes": "Group B oracle-unit; standard module; flat fee added not multiplied."
  },
  {
    "caseId": "DC-003",
    "inputs": {"model": "Trolley", "costPerUnit": 3.37, "numberOfStores": 50, "mediaServiceType": "Managed service", "managedServiceFee": {"kind": "percentage", "percent": 3}},
    "expected": {"cost": 21694.38, "formula": "roundToPence(21062.50 * 1.03)"},
    "notes": "Group B oracle-unit; standard module; half-up double-round at .375 -> .38."
  },
  {
    "caseId": "DC-004",
    "inputs": {"model": "Trolley", "costPerUnit": 3.37, "numberOfStores": 50, "mediaServiceType": "Managed service", "managedServiceFee": {"kind": "percentage", "percent": 3}, "channel": "Trolley Panels (KCTEST)", "uiCost": true},
    "expected": {"defaultDisplayed": "£21,694.38", "comparison": "uiCost === formatGBP(calculateTrolleyCost(configuredInput))"},
    "notes": "Group A; requires a Trolley channel pre-configured with Cost-per-unit £3.37 and 3% MS; E2E_MP_TROLLEY_COST_PER_UNIT and E2E_MP_TROLLEY_MS_PERCENT are the source of truth when set."
  },
  {
    "caseId": "DC-005",
    "inputs": {"model": "Petrol Pumps", "costPerUnit": 16.24, "numberOfStores": 40, "mediaServiceType": "Self-serve", "managedServiceFee": null},
    "expected": {"cost": 19488.00, "formula": "16.24 * 30 * 40"},
    "notes": "Group B oracle-unit; standard module; 30 units/store multiplier."
  },
  {
    "caseId": "DC-006",
    "inputs": {"model": "Petrol Pumps", "costPerUnit": 16.24, "numberOfStores": 40, "mediaServiceType": "Managed service", "managedServiceFee": {"kind": "percentage", "percent": 4}, "caseType": "reference"},
    "expected": {"cost": 20267.52, "mustNotEqual": 19489.02, "formula": "19488.00 * 1.04"},
    "notes": "Group B oracle-unit; standard module; at-minimum acceptable value the NUP-18835 regression asserts against; must not equal the buggy 19489.02."
  },
  {
    "caseId": "DC-007",
    "inputs": {"model": "Petrol Pumps", "costPerUnit": 16.24, "numberOfStores": 40, "mediaServiceType": "Managed service", "managedServiceFee": {"kind": "flat", "amount": 2.00}, "channel": "Petrol Pump Nozzles", "uiCost": true},
    "expected": {"defaultDisplayed": "£19,490.00", "comparison": "uiCost === formatGBP(calculatePetrolPumpCost(configuredInput))"},
    "notes": "Group A; requires a Petrol Pumps channel pre-configured with Cost-per-unit £16.24 and flat £2 MS; E2E_MP_PETROL_COST_PER_UNIT and E2E_MP_PETROL_MS_FLAT source of truth; green control for the flat path."
  },
  {
    "caseId": "DC-008",
    "inputs": {"model": "Travel Money", "costPerStoreStandard": 300, "numberOfStores": 50, "mediaServiceType": "Self-serve", "managedServiceFee": null},
    "expected": {"cost": 15000.00, "formula": "300 * 50"},
    "notes": "Group B oracle-unit; standard module; cost-per-store has no units multiplier."
  },
  {
    "caseId": "DC-009",
    "inputs": {"model": "Travel Money", "costPerStoreStandard": 300, "numberOfStores": 50, "mediaServiceType": "Managed service", "managedServiceFee": {"kind": "percentage", "percent": 4}, "channel": "Travel Money Screens (KCTEST)", "uiCost": true},
    "expected": {"defaultCost": 15600.00, "defaultDisplayed": "£15,600.00", "comparison": "uiCost === formatGBP(calculateTravelMoneyScreensCost(configuredInput))"},
    "notes": "Group A; requires a Travel Money Screens channel pre-configured with Cost-per-store £300 and 4% MS; E2E_MP_TRAVELMONEY_COST_PER_STORE and E2E_MP_TRAVELMONEY_MS_PERCENT source of truth; same *1.04 logic the petrol bug should follow."
  },
  {
    "caseId": "DC-010",
    "inputs": {"model": "Budget-Led", "budget": 30000, "managedServiceFee": {"kind": "percentage", "percent": 4}, "channel": "Digital Screens - 6 Sheets", "uiCost": true},
    "expected": {"defaultCost": 30000.00, "defaultMustNotEqual": 31200.00, "defaultDisplayed": "£30,000.00", "comparison": "uiTotal === formatGBP(calculateBudgetLedCost({budget:configuredBudget}))"},
    "notes": "Group A; requires a Digital Screens channel pre-configured with Budget-Led pricing and an MS fee; E2E_MP_BUDGETLED_BUDGET source of truth; MS fee is inert."
  },
  {
    "caseId": "DC-011",
    "inputs": {"function": "applyManagedService", "subtotal": 15000, "rows": [{"type": "Self-serve", "fee": {"kind": "flat", "amount": 2}}, {"type": "Self-serve", "fee": {"kind": "percentage", "percent": 4}}, {"type": "Managed service", "fee": null}, {"type": "Managed service", "fee": {"kind": "flat", "amount": 0}}, {"type": "Managed service", "fee": {"kind": "flat", "amount": 2}}, {"type": "Managed service", "fee": {"kind": "percentage", "percent": 0}}, {"type": "Managed service", "fee": {"kind": "percentage", "percent": 4}}]},
    "expected": {"selfServeAndUndefinedAndZero": 15000.00, "managedFlat2": 15002.00, "managedPercent4": 15600.00},
    "notes": "Group B oracle-unit; standard module; fee applies IFF mediaServiceType is Managed service AND fee is defined and non-zero."
  },
  {
    "caseId": "DC-012",
    "inputs": {"function": "roundToPence", "rounding": [21694.375, 0.005, 0.004], "trolleyPercentNeighbours": {"costPerUnit": 3.37, "numberOfStores": 50, "percents": [2, 3, 4]}},
    "expected": {"roundToPence": {"21694.375": 21694.38, "0.005": 0.01, "0.004": 0.00}, "trolley": {"2": 21483.75, "3": 21694.38, "4": 21905.00}},
    "notes": "Group B oracle-unit; standard module; half-up control; 3% is the load-bearing fractional-pence boundary."
  },
  {
    "caseId": "DC-013",
    "inputs": {"model": "Petrol Pumps", "costPerUnit": 16.24, "mediaServiceType": "Managed service", "managedServiceFee": {"kind": "percentage", "percent": 4}, "belowReferenceStores": 39, "aboveReferenceStores": 41, "caseType": "neighbours-around-40"},
    "expected": {"belowReference": 19760.83, "aboveReference": 20774.21, "rule": "both follow *1.04"},
    "notes": "Group B oracle-unit; neighbours around the 40-store reference prove the defect is percentage-application, not store-specific."
  }
]
```

## Test Data

| Name | Value | Notes |
|---|---|---|
| advertiser | N360_Unilever_MS | Non-production advertiser for the standard guided flow |
| brand | Unilever \| Knorr \| MS | Non-production brand |
| objective | Customer retention | Media Planner objective |
| productSearch | knorr | Live-resolvable product search; select one result instead of relying on unlinked SKU 2001227 |
| oracleModule | automation/src/cost-oracle.ts | Source of truth for every expected cost; UI compared to oracle, never hard-coded |
| trolleyChannel | Trolley Panels (KCTEST) | Group A read-only channel; Cost-per-unit £3.37, 3% MS |
| trolleyChannelEnv | E2E_MP_TROLLEY_CHANNEL | Optional exact channel-name override |
| trolleyCostPerUnitEnv | E2E_MP_TROLLEY_COST_PER_UNIT | Optional override for the configured Trolley per-unit rate (default 3.37) |
| trolleyMsPercentEnv | E2E_MP_TROLLEY_MS_PERCENT | Optional override for the configured Trolley percentage MS fee (default 3) |
| trolleyUnitsPerStore | 125 | Read-only constant TROLLEY_UNITS_PER_STORE |
| petrolChannel | Petrol Pump Nozzles | Group A read-only channel; Cost-per-unit £16.24 |
| petrolChannelEnv | E2E_MP_PETROL_FLAT_CHANNEL | Optional exact flat-fee channel-name override |
| petrolCostPerUnitEnv | E2E_MP_PETROL_COST_PER_UNIT | Optional override for the configured Petrol per-unit rate (default 16.24) |
| petrolMsFlatEnv | E2E_MP_PETROL_MS_FLAT | Optional override for the configured Petrol flat MS fee (default 2.00) |
| petrolUnitsPerStore | 30 | Read-only constant PETROL_PUMP_UNITS_PER_STORE |
| travelMoneyChannel | Travel Money Screens (KCTEST) | Group A read-only channel; Cost-per-store £300, 4% MS |
| travelMoneyChannelEnv | E2E_MP_TRAVELMONEY_CHANNEL | Optional exact channel-name override |
| travelMoneyCostPerStoreEnv | E2E_MP_TRAVELMONEY_COST_PER_STORE | Optional override for the configured Travel Money per-store rate (default 300) |
| travelMoneyMsPercentEnv | E2E_MP_TRAVELMONEY_MS_PERCENT | Optional override for the configured Travel Money percentage MS fee (default 4) |
| budgetLedChannel | Digital Screens - 6 Sheets | Group A read-only channel; Budget-Led pricing with an MS fee configured |
| budgetLedChannelEnv | E2E_MP_BUDGETLED_CHANNEL | Optional exact channel-name override |
| budgetLedBudgetEnv | E2E_MP_BUDGETLED_BUDGET | Optional override for the Budget-Led budget (default 30000) |
| petrolBugCorrectValue | 20267.52 | Oracle-correct Petrol 40 stores 4% MS (= 19488.00 * 1.04) |
| petrolBugBuggyValue | 19489.02 | Documented NUP-18835 buggy app value; must never be asserted as a pass |
| nupTicket | NUP-18835 | Known-issue ticket gating the petrol-pump percentage regression assertion |

## Mocks

| API/Route | Scenario | Response |
|---|---|---|
| none | Live dev environment validates the configured channel rule | [] |

## Mocks as JSON

```json
[]
```

## Flow Steps

| Step | AC IDs | Action | Target | Input | Expected Result | Assertion Hint |
|---:|---|---|---|---|---|---|
| 1 | AC-001 | Import the cost oracle and compute expected values for the unit cases | automation/src/cost-oracle.ts | calculateTrolleyCost, calculatePetrolPumpCost, calculateTravelMoneyScreensCost, calculateBudgetLedCost, applyManagedService, roundToPence | Oracle returns the documented cost-math values used as expectations | oracle module imports without error and exposes the calculators |
| 2 | AC-002 | Assert Trolley cost-per-unit values for DC-001, DC-002, DC-003 | calculateTrolleyCost | 50 stores @ £3.37, none / flat £2.00 / percentage 3% | base 21062.50; flat 21064.50; 3% 21694.38 | oracle results match 21062.50, 21064.50, 21694.38 |
| 3 | AC-003 | Assert Petrol Pumps and Travel Money cost-per-unit / cost-per-store values for DC-005, DC-006, DC-008, DC-013 | calculatePetrolPumpCost, calculateTravelMoneyScreensCost | 40 stores @ £16.24 none / 4%; 50 stores @ £300 none; 39 and 41 stores @ £16.24 4% | petrol base 19488.00; petrol 4% 20267.52 and not 19489.02; travel money 15000.00; neighbours 19760.83 / 20774.21 | exact oracle object equals all five values |
| 4 | AC-004 | Assert managed-service gate and pence double-round for DC-011, DC-012 | applyManagedService, roundToPence | subtotal 15000 across the 7-row gate; roundToPence(21694.375)/(0.005)/(0.004); Trolley 2%/3%/4% | gate returns 15000/15002/15600 as specified; roundToPence 21694.38/0.01/0.00; Trolley 21483.75/21694.38/21905.00 | half-up double-round value is 21694.38 |
| 5 | AC-005 | Open Media Planner and run the guided Nectar AI flow for the Group A UI cases | /planning | advertiser N360_Unilever_MS; brand Unilever \| Knorr \| MS; objective Customer retention; product search knorr; select one; Confirm | Assistant requests a channel, budget and timeline | channel, budget, and timeline prompt visible |
| 6 | AC-006 | In independent fresh plans, preflight and send Trolley, Petrol-flat, Travel Money, and Budget-Led channels | Assistant request and summary panel | configured channel/rate/fee values; today+45..today+75 | each displayed value equals `formatGBP` of its configured oracle input; defaults render £21,694.38 / £19,490.00 / £15,600.00 / £30,000.00 | compare parsed UI money to numeric oracle and displayed text to `formatGBP(oracle)` |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | DC-006 oracle for Petrol Pumps 40 stores 4% MS must equal 20267.52 and must NOT equal the documented buggy value 19489.02 | Oracle returns 20267.52 and the assertion that it equals 19489.02 fails |
| NEG-003 | DC-010 Budget-Led with a 4% managed-service fee must not inflate the configured budget | Displayed total equals `formatGBP(configuredBudget)` and not `formatGBP(configuredBudget * 1.04)`; defaults are £30,000.00 / £31,200.00 |
| NEG-004 | DC-011 managed-service fee applied while media service type is Self-serve, fee undefined, or fee value 0 | applyManagedService returns the unchanged subtotal 15000.00; no fee is applied |

## Acceptance Criteria

- AC-001: The cost oracle module imports and exposes the channel calculators and helpers used to derive every expected cost.
- AC-002: Trolley cost-per-unit totals match the documented formula and managed-service rules (base 21062.50, flat 21064.50, 3% 21694.38).
- AC-003: Petrol Pumps and Travel Money totals match their formulas, the petrol 4% case equals 20267.52 and not 19489.02, and the below-minimum/above-minimum store neighbours follow *1.04.
- AC-004: The managed-service fee gate and the pence half-up double-round behave as documented (15000/15002/15600 and 21694.375 to 21694.38).
- AC-005: Media Planner opens and the guided Nectar AI flow reaches the channel request prompt for the Group A UI cases.
- AC-006: The displayed Pollen cost for the pre-configured Trolley, Petrol-flat, Travel Money and Budget-Led channels equals formatGBP of the oracle value.

## Locator Hints

- Prefer role/name locators for buttons and links such as Try now and Confirm.
- Prefer labels for any form fields exposed by the guided assistant (advertiser, brand, objective, SKU).
- Prefer exact visible text for assistant option chips such as Help me build a plan based on my objective & budget, the advertiser, the brand, the objective, and the SKU.
- Read the displayed cost from the summary panel via the summary-panel Page Object accessor; scope channel sends to the active in-store tabpanel.
- Use CSS only with an explicit locator-policy exception comment directly above the locator call.

## Generated Test Requirements

- Must import from fixtures/test.
- Must use test.step.
- Must use Page Objects or Component Objects for all locators; no direct `page.getBy*` or `page.locator(...)` in generated test bodies.
- This spec declares `Generation Mode | suite`; split the oracle-unit (Group B) cases and the live UI (Group A) cases into focused tests.
- Oracle-unit tests must import `calculateTrolleyCost`, `calculatePetrolPumpCost`, `calculateTravelMoneyScreensCost`, `calculateBudgetLedCost`, `applyManagedService`, `roundToPence`, and `formatGBP` from `automation/src/cost-oracle.ts` and must never hard-code a UI string as the expected value.
- UI tests must compute the expected cost via the oracle and assert the displayed value equals `formatGBP(oracleResult)`.
- Must put `expect(...)` only in the final assertion step for each test.
- Must title assertion steps `Assert AC-###: ...` or `Assert NEG-###: ...`.
- Must include meaningful assertions for user-visible behaviour; the documented GBP literals are default-fixture examples only, while env-overridden UI expectations must be computed dynamically.
- For NEG-001 assert the petrol 4% oracle equals 20267.52 and `.not.toBe(19489.02)`.
- In suite mode, must cover every AC ID from this spec with a final assertion step.
- Default generated-test execution target is Chromium only; cross-browser execution is opt-in.
- Must enumerate every Data Cases as JSON case ID (DC-001 through DC-013).
- Must derive UI dates from one per-case calendar anchor, fail on date rollover, and perform cleanup in `finally` without masking the primary assertion failure.
- Group A must fail before the plan send if the read-only channel pricing model/rate/fee differs from the configured oracle input.
- Must not use page.waitForTimeout.
- Must not use page.waitForLoadState('networkidle').
- Must not use XPath.
- Must not use test.only.
- Must not silently skip; `test.skip`, `test.fixme`, and `test.fail` are forbidden. The blocked NUP-18835 UI case is not emitted.
- Must not use real credentials.
- Must not commit auth state.

## Notes

- This test intentionally avoids admin pages and does not change Channel Management, pricing-model, rates-management, or managed-service-fee configuration; all Group A channel values are read-only and treated as pre-configured.
- Group B oracle-unit cases run with no live environment and assert the documented cost-math directly against `automation/src/cost-oracle.ts`; Group A cases drive the live Nectar AI flow and compare the displayed cost to the oracle.
- The NUP-18835 known issue records £19,489.02 for Petrol Pumps 40 stores at 4% managed service instead of the correct £20,267.52. Oracle tests enforce the correct value; no live test is skipped or allowed to pass the buggy value.
- Worked examples anchored in this spec: 50 stores @ £3.37 Trolley = £21,062.50, +3% = £21,694.38; 50 stores @ £300 Travel Money +4% = £15,600.00; £30,000 Budget-Led = £30,000.00.
- Campaign dates use today+45 through today+75 with calendar arithmetic so booking-deadline and minimum-duration validations do not mask cost assertions.
- Each `E2E_MP_*` override defines the expected fixture contract, not proof of server state. Read-only preflight must confirm the live channel values before using them as oracle input; documented defaults are 3.37, 16.24, 300, and 30000 (units/store constants 125 and 30).

## Pending Automation (no skipped test emitted)

| Source Case | Blocker | Exit Criteria |
|---|---|---|
| NUP-18835 live Petrol 4% UI comparison | The documented application result is wrong and the emitted Group A fixture is the flat-fee Petrol variant, not a proven 4% variant | Product fix deployed; exact 4% non-production channel and read-only config preflight available; UI total equals oracle £20,267.52 |

Human review must confirm every pricing formula/rate source, managed-service application semantics, half-up rounding convention, exact configured channel, UI summary field, and cleanup behavior before signoff.
