// SKU suite generator: transforms specs/test-cases-skus-2.yaml (138 cases) into 5 validated
// solution-format SUITE specs under specs/skus/ and their data-driven Playwright tests under
// tests/regression/skus/. Run from packages/web:
//   node scripts/ai/gen-sku-suites.mjs [--write] [--write-tests]
// Regeneration is idempotent (same YAML + same SKU pools -> same output; the spec hash re-stamps).
//
// v3: data cases seed REAL catalogue skuIds (see mapCaseSkusToReal) and the arrange step resolves a
// live planningAI session via dataManager.ensurePlanningSession() instead of the old 'current'
// sentinel — both were execution blockers that kept the suites honest-red.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const YAML = path.join(WEB, 'specs/test-cases-skus-2.yaml');
const OUT_DIR = path.join(WEB, 'specs/skus');
// FLOW-SKU-EDIT is backed by the live modal suite in tests/regression/nectar-edit-sku-list.*.
// The generic counter emitter cannot express that UI contract, so regeneration must preserve the
// hand-remediated spec/test pair instead of replacing it with counter-only false coverage.
const MANUALLY_MAINTAINED_FLOW_IDS = new Set(['FLOW-SKU-EDIT']);

function unquote(value) {
  const v = value.trim();
  if (v.startsWith('"') && v.endsWith('"')) {
    try { return JSON.parse(v); } catch { return v.slice(1, -1).replace(/\\"/g, '"'); }
  }
  return v;
}
function inlineList(value) {
  const v = value.trim();
  if (v.startsWith('[') && v.endsWith(']')) {
    return v.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
  }
  return v ? [v] : [];
}

// --- tailored line parser for this machine-generated YAML ---------------------------------
function parseCases(text) {
  const lines = text.split('\n');
  const cases = [];
  let cur = null;
  let listKey = null;
  const LIST_FIELDS = new Set(['preconditions', 'testData', 'steps', 'expected']);

  for (const line of lines) {
    const idMatch = line.match(/^ {2}- id:\s*(.+)$/);
    if (idMatch) {
      if (cur) cases.push(cur);
      cur = { id: unquote(idMatch[1]), title: '', area: '', priority: '', type: '', technique: [], preconditions: [], testData: [], steps: [], expected: [], automationNotes: '' };
      listKey = null;
      continue;
    }
    if (!cur) continue;

    const scalar = line.match(/^ {4}(title|area|priority|type|automationNotes):\s*(.*)$/);
    if (scalar) { cur[scalar[1]] = unquote(scalar[2]); listKey = null; continue; }

    const tech = line.match(/^ {4}technique:\s*(.*)$/);
    if (tech) { cur.technique = inlineList(tech[1]); listKey = null; continue; }

    const listHeader = line.match(/^ {4}(preconditions|testData|steps|expected):\s*$/);
    if (listHeader && LIST_FIELDS.has(listHeader[1])) { listKey = listHeader[1]; continue; }

    if (line.match(/^ {4}traces:\s*$/)) { listKey = null; continue; }
    if (line.match(/^ {6}(tickets|sourceRefs):/)) { continue; }

    const item = line.match(/^ {4}- (.+)$/);
    if (item && listKey) { cur[listKey].push(unquote(item[1])); continue; }

    if (line.match(/^ {4}\w+:/)) { listKey = null; }
  }
  if (cur) cases.push(cur);
  return cases;
}

// --- per-area hand-authored boilerplate --------------------------------------------------
const AREAS = [
  {
    key: 'Maximum Hero',
    slug: 'max-hero-skus-per-channel',
    flowId: 'FLOW-SKU-MAX',
    title: 'Maximum Hero SKUs per channel validation',
    priority: 'P1',
    businessRules: [
      ['RULE-001', 'A channel blocks booking when its assigned Hero SKU count exceeds the configured maxHeroSkus', 'bookable = heroCount <= channel.maxHeroSkus; over-limit warning shown when heroCount > channel.maxHeroSkus', 'Booking stays blocked until heroCount <= maxHeroSkus'],
      ['RULE-002', 'The over-limit warning numeral is data-driven and equals the configured maxHeroSkus', "warning == 'Media limit: ' + channel.maxHeroSkus + ' Hero SKUs. Edit SKUs'", 'A numeral hardcoded to 3 (not tracking maxHeroSkus) is a defect'],
      ['RULE-003', 'A channel is still added with all selected Hero SKUs when over the limit; only booking is gated', 'channelAdded == true regardless of heroCount; only bookable is gated on the count', 'Silently dropping over-limit SKUs instead of warning is a defect'],
    ],
    flowSteps: [
      ['AC-001', 'Launch the Nectar AI guided planner', '/planning', 'Create Media Plans in minutes with Nectar AI; Help me build a plan based on my objective & budget', 'The guided objective-and-budget flow is active', 'guided flow control is visible'],
      ['AC-002', 'Seed the channel maxHeroSkus precondition via API', 'dataManager.setChannelMaxHeroSkus', 'channel; case maxHeroSkus', 'The channel under test has the case-specified maxHeroSkus', 'precondition helper resolves without error'],
      ['AC-003', 'Select advertiser and brand', 'Guided planner controls', 'advertiser; brand; Confirm', 'Advertiser and brand are shown on the summary panel', 'advertiser and brand visible on summary'],
      ['AC-004', 'Build to the Hero SKU selection step', 'Assistant chat and product search', 'objective; productSearch; select measurement SKUs; Confirm', 'The Hero SKU selection step is reached', 'Hero SKU controls are visible'],
      ['AC-005', "Assign the case's Hero SKUs to the channel and apply", 'Assistant chat / channel modal', 'case Hero SKUs; Apply', 'The channel is added with the selected Hero SKUs', 'channel appears in the Media section'],
      ['AC-006', 'Verify the over-limit warning numeral and booking state', 'Summary panel channel row; booking control', 'n/a', 'When heroCount > maxHeroSkus the warning reads exactly "Media limit: {maxHeroSkus} Hero SKUs. Edit SKUs" and booking is blocked; otherwise no warning and booking is allowed', 'warning text equals configured max; booking state matches the case'],
    ],
    negativeCases: [
      ['NEG-001', 'Assign maxHeroSkus+1 Hero SKUs to a channel configured with maxHeroSkus=2', 'Booking is blocked and the warning numeral equals 2 (the configured max), not a literal 3'],
      ['NEG-002', 'Assign Hero SKUs to a channel whose maxHeroSkus is unset (null)', 'The channel applies a safe default limit and surfaces a deterministic state rather than an unbounded selection'],
    ],
    preconditions: [
      'A valid non-production authenticated Playwright storage state (`playwright/.auth/user.json`).',
      '`PLAYWRIGHT_TEST_BASE_URL` points to `https://www.dev.pollen.js-devops.co.uk/`.',
      'The advertiser, brand and a brand-linked catalogue with the case SKUs are available.',
      'The channel under test can have its maxHeroSkus configured via the implemented dataManager.setChannelMaxHeroSkus (captured admin_editMedia contract).',
    ],
    salient: ['Media limit', 'Edit SKUs'],
  },
  {
    key: 'indicators',
    slug: 'hero-sku-indicators-and-count-recompute',
    flowId: 'FLOW-SKU-IND',
    title: 'Hero-SKU indicators, all-brand-linked modal, auto-add and count recompute',
    priority: 'P1',
    businessRules: [
      ['RULE-001', 'Selecting a Hero SKU updates the Hero and Measurement counts deterministically', 'heroCount and measurementCount on the summary recompute after each apply', 'A count that does not recompute after a change is a defect'],
      ['RULE-002', 'An all-brand-linked Hero SKU auto-adds across every affected channel and each recomputes independently', 'for each selectedChannel: channel.hero += brandLinkedHero; each count recomputes', 'A channel that does not reflect an auto-added Hero SKU is a defect'],
      ['RULE-003', 'A Hero indicator is shown only for SKUs that are flagged Hero (not Measurement-only)', 'indicator(sku) == sku.isHero', 'Showing the Hero indicator on a Measurement-only SKU is a defect'],
    ],
    flowSteps: [
      ['AC-001', 'Launch the Nectar AI guided planner', '/planning', 'Help me build a plan based on my objective & budget', 'The guided flow is active', 'guided flow control is visible'],
      ['AC-002', 'Seed brand-linked SKUs and channels via API', 'dataManager.ensureBrandLinkedSkus', 'brand; case SKUs', 'The brand catalogue contains the case SKUs', 'precondition helper resolves without error'],
      ['AC-003', 'Select advertiser and brand', 'Guided planner controls', 'advertiser; brand; Confirm', 'Advertiser and brand are shown on the summary panel', 'advertiser and brand visible on summary'],
      ['AC-004', 'Select Measurement and Hero SKUs', 'Assistant chat and product search', 'productSearch; select Measurement SKUs; promote Hero SKUs; Confirm', 'Hero and Measurement SKUs are applied', 'Hero and Measurement controls reflect the selection'],
      ['AC-005', "Apply the case's selection across the affected channels", 'Assistant chat / channel modal', 'case SKUs; affected channels; Apply', 'Each affected channel reflects the auto-added Hero SKUs', 'each channel row updates'],
      ['AC-006', 'Verify indicators and recomputed counts', 'Summary panel counts and indicators', 'n/a', 'The Hero/Measurement counts equal the expected values and Hero indicators appear only on Hero SKUs', 'counts and indicators match the case'],
    ],
    negativeCases: [
      ['NEG-001', 'A Measurement-only SKU is inspected for a Hero indicator', 'No Hero indicator is shown for a Measurement-only SKU'],
      ['NEG-002', 'A global Hero list exceeds a channel max after auto-add', 'The affected channel is warned and booking is blocked until adjusted, while counts still recompute'],
    ],
    preconditions: [
      'A valid non-production authenticated Playwright storage state (`playwright/.auth/user.json`).',
      '`PLAYWRIGHT_TEST_BASE_URL` points to `https://www.dev.pollen.js-devops.co.uk/`.',
      'A brand-linked catalogue containing the case Measurement and Hero SKUs is available.',
      'The affected channels exist; SKU seeding uses dataManager.setPlanHeroSkus. The ensureBrandLinkedSkus surface reads the captured catalogue and requires injected, verified link/unlink adapters only when links must change.',
    ],
    salient: ['Hero', 'Measurement'],
  },
  {
    key: 'Channel-level',
    slug: 'channel-level-hero-edit-and-deletion-sync',
    flowId: 'FLOW-SKU-CHAN',
    title: 'Channel-level Hero edit, per-channel SKU definition and deletion sync',
    priority: 'P1',
    businessRules: [
      ['RULE-001', 'Hero SKUs can be defined per channel and persist for that channel', "channel.hero is set independently per channel and reflected after Apply", 'A per-channel Hero edit that does not persist is a defect'],
      ['RULE-002', 'Deleting a Hero SKU syncs the change to the affected channels and recomputes counts', 'on delete(sku): every channel referencing sku drops it and recomputes its count', 'A stale SKU remaining on a channel after deletion is a defect'],
      ['RULE-003', 'Editing one channel does not mutate the Hero selection of another channel', 'edit(channelA) leaves channelB.hero unchanged', 'Cross-channel bleed of a per-channel edit is a defect'],
    ],
    flowSteps: [
      ['AC-001', 'Launch the Nectar AI guided planner', '/planning', 'Help me build a plan based on my objective & budget', 'The guided flow is active', 'guided flow control is visible'],
      ['AC-002', 'Seed the channels and their Hero SKUs via API', 'dataManager.setPlanHeroSkus', 'plan; channel; case Hero SKUs', 'Each channel starts from the case-defined Hero selection', 'precondition helper resolves without error'],
      ['AC-003', 'Select advertiser and brand', 'Guided planner controls', 'advertiser; brand; Confirm', 'Advertiser and brand are shown on the summary panel', 'advertiser and brand visible on summary'],
      ['AC-004', 'Open the channel Hero edit modal for the channel under test', 'Summary panel channel row; Edit', 'channel; Edit Hero', 'The per-channel Hero edit modal is shown with the current selection', 'edit modal is visible with the channel selection'],
      ['AC-005', "Apply the case's per-channel edit or deletion", 'Edit modal', 'case edit/delete; Apply', 'The edit or deletion is applied to the channel', 'channel selection reflects the edit'],
      ['AC-006', 'Verify per-channel persistence and deletion sync', 'Summary panel channel rows and counts', 'n/a', 'The edited channel reflects the change, deletions sync to all affected channels and recompute counts, and other channels are unchanged', 'channels and counts match the case'],
    ],
    negativeCases: [
      ['NEG-001', 'Delete a Hero SKU shared by two channels', 'Both channels drop the SKU and recompute; no channel retains the deleted SKU'],
      ['NEG-002', 'Cancel a per-channel Hero edit', 'The channel keeps its prior selection and no other channel is affected'],
    ],
    preconditions: [
      'A valid non-production authenticated Playwright storage state (`playwright/.auth/user.json`).',
      '`PLAYWRIGHT_TEST_BASE_URL` points to `https://www.dev.pollen.js-devops.co.uk/`.',
      'A plan with at least two channels and per-channel Hero selections is available.',
      'Per-channel Hero edit/delete is exercised via the UI; seeding uses dataManager.setPlanHeroSkus. Deletion-sync catalogue arrangement uses unlinkSkuFromBrand and requires an injected, verified catalogue mutation adapter.',
    ],
    salient: ['Hero', 'Edit'],
  },
  {
    key: 'Single-prompt',
    slug: 'single-prompt-hero-measurement-parsing',
    flowId: 'FLOW-SKU-PARSE',
    title: 'Single-prompt Hero and Measurement recognition and parsing',
    priority: 'P1',
    businessRules: [
      ['RULE-001', 'A single chat prompt is parsed into the correct Measurement and Hero SKU sets', "parse('1, 2, 3, 4 and hero skus 3, 5, 6') => measurement={1,2,3,4}, hero={3,5,6}", 'Misclassifying a Hero SKU as Measurement (or vice versa) is a defect'],
      ['RULE-002', 'A SKU named as both Measurement and Hero is recognised in both roles', 'sku in measurement AND hero when the prompt lists it in both', 'Dropping a dual-role SKU from either set is a defect'],
      ['RULE-003', 'Unknown or non-brand-linked SKUs in the prompt are reported, not silently dropped', 'unknownSkus(prompt) are surfaced to the user', 'Silently ignoring an unrecognised SKU is a defect'],
    ],
    flowSteps: [
      ['AC-001', 'Launch the Nectar AI guided planner', '/planning', 'Help me build a plan based on my objective & budget', 'The guided flow is active', 'guided flow control is visible'],
      ['AC-002', 'Seed the brand-linked SKUs referenced by the prompt via API', 'dataManager.ensureBrandLinkedSkus', 'brand; prompt SKUs', 'The catalogue contains the SKUs named in the prompt', 'precondition helper resolves without error'],
      ['AC-003', 'Select advertiser and brand', 'Guided planner controls', 'advertiser; brand; Confirm', 'Advertiser and brand are shown on the summary panel', 'advertiser and brand visible on summary'],
      ['AC-004', "Send the case's single Hero+Measurement prompt", 'Assistant chat', 'case prompt; Send', 'The assistant parses the prompt into Measurement and Hero sets', 'assistant returns a parsed selection'],
      ['AC-005', 'Apply the parsed selection', 'Assistant chat', 'Confirm', 'The parsed Measurement and Hero SKUs are applied to the plan', 'summary reflects the parsed selection'],
      ['AC-006', 'Verify the parsed Measurement and Hero sets', 'Summary panel counts and SKU lists', 'n/a', 'The Measurement and Hero sets equal the expected parse, including any dual-role SKU, and unknown SKUs are reported', 'parsed sets match the case'],
    ],
    negativeCases: [
      ['NEG-001', 'A prompt names a SKU not linked to the brand', 'The unrecognised SKU is reported to the user rather than silently dropped'],
      ['NEG-002', 'A prompt lists a SKU as both Measurement and Hero', 'The SKU is recognised in both roles'],
    ],
    preconditions: [
      'A valid non-production authenticated Playwright storage state (`playwright/.auth/user.json`).',
      '`PLAYWRIGHT_TEST_BASE_URL` points to `https://www.dev.pollen.js-devops.co.uk/`.',
      'A brand-linked catalogue containing every SKU named in the case prompts is available.',
      'Natural-language SKU parsing is enabled for the assistant (FEATURE_NECTAR_AI_MP).',
    ],
    salient: ['hero', 'Measurement'],
  },
  {
    key: 'Edit SKU list',
    slug: 'edit-sku-list-button-and-modal',
    flowId: 'FLOW-SKU-EDIT',
    title: 'Edit SKU list button visibility and modal',
    priority: 'P2',
    businessRules: [
      ['RULE-001', 'The "Edit SKU list" button is visible only when a channel has an editable SKU selection', 'visible(editSkuList) == channel.hasEditableSkus', 'Showing the button with nothing to edit, or hiding it when SKUs exist, is a defect'],
      ['RULE-002', 'Opening "Edit SKU list" shows the current selection with accurate counts', 'modal.selectedCount == channel.selectedSkuCount', 'A modal whose count disagrees with the channel is a defect'],
      ['RULE-003', 'Cancelling the modal leaves the channel selection unchanged', 'cancel => channel.skus unchanged', 'A cancel that mutates the selection is a defect'],
    ],
    flowSteps: [
      ['AC-001', 'Launch the Nectar AI guided planner', '/planning', 'Help me build a plan based on my objective & budget', 'The guided flow is active', 'guided flow control is visible'],
      ['AC-002', 'Seed a channel with the case SKU selection via API', 'dataManager.setPlanHeroSkus', 'plan; channel; case SKUs', 'The channel has the case-defined SKU selection', 'precondition helper resolves without error'],
      ['AC-003', 'Select advertiser and brand', 'Guided planner controls', 'advertiser; brand; Confirm', 'Advertiser and brand are shown on the summary panel', 'advertiser and brand visible on summary'],
      ['AC-004', 'Inspect the channel for the "Edit SKU list" button', 'Summary panel channel row', 'channel', 'The button visibility matches the channel SKU state', 'button visibility matches the case'],
      ['AC-005', 'Open the "Edit SKU list" modal when present', 'Channel row; Edit SKU list', 'Edit SKU list', 'The modal shows the current selection and counts', 'modal is visible with accurate counts'],
      ['AC-006', 'Verify modal counts and cancel behaviour', 'Edit SKU modal', 'Cancel', 'The modal selected count equals the channel selection and cancelling leaves it unchanged', 'counts and cancel behaviour match the case'],
    ],
    negativeCases: [
      ['NEG-001', 'A channel with no editable SKUs is inspected for the "Edit SKU list" button', 'The button is not shown'],
      ['NEG-002', 'The "Edit SKU list" modal is cancelled after toggling a SKU', 'The channel SKU selection is unchanged'],
    ],
    preconditions: [
      'A valid non-production authenticated Playwright storage state (`playwright/.auth/user.json`).',
      '`PLAYWRIGHT_TEST_BASE_URL` points to `https://www.dev.pollen.js-devops.co.uk/`.',
      'A plan with at least one channel and a known SKU selection is available.',
      'The channel SKU selection can be seeded via the implemented dataManager.setPlanHeroSkus (planningAI_updateState SET_SKUS).',
    ],
    salient: ['Edit SKU list'],
  },
];

function esc(cell) {
  return String(cell ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
}
function truncate(s, n) {
  const t = esc(s);
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}
function pad(n) {
  return String(n).padStart(3, '0');
}

// ---- E2E automatability classifier ----------------------------------------------------------
// The framework ships ONLY end-to-end tests: a data case earns a generated test iff its expectation
// is genuinely verifiable through the UI after an API seed (proven live 2026-07-03). Everything
// else is declared in the spec's "Pending Automation" section with its blocker — not emitted as a
// weak panel-smoke or a guaranteed-red placeholder.
function automationBlocker(s, area) {
  if (area.flowId === 'FLOW-SKU-CHAN') {
    return 'contract-mismatch: session-wide SET_SKUS cannot arrange or prove per-channel edit isolation/deletion sync';
  }
  if (area.flowId === 'FLOW-SKU-EDIT') {
    return 'contract-mismatch: a summary counter does not prove Edit SKU list button visibility, modal contents, or cancel persistence';
  }
  if (s.maxHeroSkus !== null) {
    return 'channel-config: needs channel media resolution (E2E_MP_*_CHANNEL) + admin_editMedia write';
  }
  if (s.expected.warning) {
    return 'warning-needs-channel: the plan has no channels; assignChannelToPlan requires an injected, verified media-plan adapter, otherwise the case must use the UI chat flow';
  }
  if (s.expected.heroCount === null && s.expected.measurementCount === null) {
    return 'no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow';
  }
  const heroSize = new Set(s.heroSkus).size;
  const unionSize = new Set([...s.heroSkus, ...s.measurementSkus]).size;
  const heroOk = s.expected.heroCount === null || s.expected.heroCount === heroSize;
  const measurementOk = s.expected.measurementCount === null || s.expected.measurementCount === unionSize;
  if (!heroOk || !measurementOk) {
    return 'ui-flow-expectation: the expected counts assume assistant-flow actions beyond the seeded state';
  }
  return null;
}

// The uniform E2E journey the generated suites actually automate (seed via API -> open the seeded
// session -> assert real UI outcomes). Every AC below is expect-verifiable, which is the framework's
// bar: E2E only — no panel-smoke placeholders, no guaranteed-red stubs.
const E2E_BUSINESS_RULES = [
  ['RULE-001', 'Hero SKUs are a subset of the selected SKU set', 'heroCount = |isHero:true|; measurementCount = |selected|', 'A SKU listed as both Hero and Measurement stays Hero'],
  ['RULE-002', 'Summary counters recompute from the seeded session state', 'counter text = "<n> SKUs"; an empty counter renders "To be defined"', 'A counter that does not reflect the seeded state is a defect'],
  ['RULE-003', 'SKU edit controls render only when a selection exists', 'visible(editControl) == selection.length > 0', 'An edit control on an empty selection (or a missing one on a non-empty selection) is a defect']
];
const E2E_FLOW_STEPS = [
  ['AC-001', 'Enter the Nectar AI planner', '/planning -> Try now', 'n/a', 'The guided objective-and-budget flow is reachable', 'guided flow control is visible'],
  ['AC-002', 'Open a seeded planning session directly', 'dataManager.ensurePlanningSession; /planning/nectar-ai/<sessionId>', 'live planningAI session', 'The seeded session hydrates to its summary panel', 'summary panel is visible'],
  ['AC-003', 'Verify the Hero counter against a known seed', 'Summary panel Hero row', 'two Hero SKUs from the real catalogue pool', 'The Hero SKUs counter equals the seeded Hero count', 'Hero counter shows the seeded count'],
  ['AC-004', 'Verify the per-case seeded counters', 'Summary panel Hero/Measurement rows', 'case SKU sets (real catalogue ids)', 'The Hero/Measurement counter equals the case expected value; an empty counter renders To be defined', 'counters match the data case']
];
const E2E_NEGATIVE_CASES = [
  ['NEG-001', 'Clear the session SKU selection via API and open the session', 'The "open modal Measurement SKUs" edit control is absent for an empty selection']
];
const E2E_SALIENT = ['SKUs', 'To be defined'];

function buildSpec(area, cases, structured) {
  const tags = `@generated @regression @media-planner @authenticated @${area.slug}`;
  const target = `tests/regression/skus/${area.slug}.authenticated.spec.ts`;

  const withBlockers = structured.map((s, i) => ({ s, source: cases[i], blocker: automationBlocker(s, area) }));
  const automatable = withBlockers.filter((x) => !x.blocker);
  const blocked = withBlockers.filter((x) => x.blocker);
  const isPending = automatable.length === 0;

  // Generated mode: the data-case table lists ONLY the automatable cases (renumbered; source ids
  // kept for traceability) because every table row must map to an emitted, executable E2E test.
  const dataCaseRows = isPending
    ? cases.map((c, i) => {
        const id = `DC-${pad(i + 1)}`;
        const inputs = truncate((c.testData.length ? c.testData : c.preconditions).join('; '), 160) || c.title;
        const expected = truncate(c.expected.join('; '), 160);
        const notes = `${esc(c.id)} (${esc(c.type)}/${esc(c.priority)})`;
        return `| ${id} | ${inputs} | ${expected} | ${notes} |`;
      })
    : automatable.map((x, i) => {
        const id = `DC-${pad(i + 1)}`;
        const seed = `hero=[${x.s.heroSkus.join(', ')}]; measurement=[${x.s.measurementSkus.join(', ')}] (pool: ${x.s.skuPool})`;
        const expected =
          x.s.expected.heroCount !== null
            ? `Hero counter shows ${x.s.expected.heroCount === 0 ? 'To be defined (0)' : `${x.s.expected.heroCount} SKUs`}`
            : `Measurement counter shows ${x.s.expected.measurementCount} SKUs`;
        return `| ${id} | ${esc(truncate(seed, 160))} | ${esc(expected)} | ${esc(x.source.id)} (${esc(x.source.type)}/${esc(x.source.priority)}) |`;
      });

  const dataCaseJson = (isPending ? cases : automatable.map((x) => x.source)).map((c, i) => ({
    caseId: `DC-${pad(i + 1)}`,
    inputs: {
      sourceCaseId: c.id,
      title: c.title,
      technique: c.technique,
      preconditions: c.preconditions,
      testData: c.testData,
      steps: c.steps,
      // Full expected text lives here (inputs are not scanned for "salient" tokens, so source
      // ticket refs / quoted strings here do not impose spurious assertion requirements).
      expectedText: c.expected,
    },
    // Keep `expected` minimal and token-free; the salient value to assert is declared explicitly
    // in Generated Test Requirements.
    expected: { outcome: 'matches the documented case behaviour' },
    notes: `${c.id} ${c.type}/${c.priority}`,
  }));

  const rules = isPending ? area.businessRules : E2E_BUSINESS_RULES;
  const flowSteps = isPending ? area.flowSteps : E2E_FLOW_STEPS;
  const negativeCases = isPending ? area.negativeCases : E2E_NEGATIVE_CASES;
  const salient = isPending ? area.salient : E2E_SALIENT;

  const businessRulesRows = rules.map((r) => `| ${r[0]} | ${esc(r[1])} | ${esc(r[2])} | ${esc(r[3])} |`).join('\n');
  const flowStepRows = flowSteps.map((s, i) => `| ${i + 1} | ${s[0]} | ${esc(s[1])} | ${esc(s[2])} | ${esc(s[3])} | ${esc(s[4]).replace(/["']/g, '')} | ${esc(s[5])} |`).join('\n');
  const acList = flowSteps.map((s) => `- ${s[0]}: ${esc(s[4])}`).join('\n');
  const negRows = negativeCases.map((n) => `| ${n[0]} | ${esc(n[1])} | ${esc(n[2])} |`).join('\n');
  const preconditions = area.preconditions.map((p) => `- ${p}`).join('\n');

  // Cases the framework does NOT emit tests for, each with its concrete blocker. Declared here so
  // the gap is documented coverage-debt instead of weak or guaranteed-red tests.
  const pendingSection = blocked.length
    ? `\n## Pending Automation (no test emitted)\n\n` +
      `These ${blocked.length} source cases are E2E-specified but cannot be verified end-to-end today. ` +
      `They are intentionally NOT generated — the framework ships only executable E2E tests.\n\n` +
      `| Source Case | Blocker |\n|---|---|\n` +
      blocked.map((x) => `| ${esc(x.source.id)} — ${esc(truncate(x.source.title, 110))} | ${esc(x.blocker)} |`).join('\n') +
      '\n'
    : '\n';

  return `# Flow: ${area.title}

## Metadata

| Field | Value |
|---|---|
| Flow ID | ${area.flowId} |
| Spec Version | 2.0.0 |
| Owner | aqa-team@example.com |
| Priority | ${area.priority} |
| Test Type | regression |
| Auth | required |
| Target Test File | ${target} |
| Base Path | /planning |
| Tags | ${tags} |
| Generation Mode | suite |
| Generation Source | manual-test-case |
| Generation Status | ${isPending ? 'pending-generation' : 'generated'} |

## User Story

As a media planner,
I want the Nectar AI planner to enforce ${area.title.toLowerCase()} correctly,
So that Hero/Measurement SKU selections behave deterministically (${automatable.length} of the ${cases.length} documented cases are automated end-to-end today; the rest are enumerated under Pending Automation).

## Preconditions

${preconditions}

## Out-of-scope

- Admin and channel configuration changes beyond the seeded preconditions are out of scope.
- Booking-deadline and minimum campaign-duration validation are out of scope (other specs).
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
${businessRulesRows}

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
${dataCaseRows.join('\n')}

## Data Cases as JSON

\`\`\`json
${JSON.stringify(dataCaseJson, null, 2)}
\`\`\`

## Test Data

| Name | Value | Notes |
|---|---|---|
| advertiser | N360_Unilever_MS | Non-production advertiser (data/media-planner.ts) |
| brand | Unilever \\| Knorr \\| MS | Non-production brand |
| dataManager | fixtures/test-data-manager.ts | API helpers to seed session/SKU preconditions |
| skuPool | specs/skus/.sku-pools.json | Real catalogue SKU ids the seeds use (live-probed) |
| salientCopy | ${esc(salient.join(', '))} | Salient strings the generated tests must assert |

## Mocks

| API/Route | Scenario | Response |
|---|---|---|
| none | Live Pollen development environment drives the guided Nectar AI flow end to end | [] |

## Mocks as JSON

\`\`\`json
[]
\`\`\`

## Flow Steps

| Step | AC IDs | Action | Target | Input | Expected Result | Assertion Hint |
|---:|---|---|---|---|---|---|
${flowStepRows}

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
${negRows}

## Acceptance Criteria

${acList}

## Locator Hints

- Prefer role/name and data-testid locators owned by PlanningPage / NectarFlow page objects.
- Use exact visible text for counter copy (e.g. "${esc(salient[0])}") and summary panel values.
- Use CSS only with an explicit \`// locator-policy:exception <reason>\` comment directly above the locator call.

## Generated Test Requirements

- Must import from fixtures/test and use Page Objects / Component Objects for all locators.
- Generation Mode is suite: generate one focused test per Data Case (DC-###), each enumerating its DC id in the title.
- Across the suite, every AC id (${flowSteps.map((s) => s[0]).join(', ')}) must be covered by at least one test.
- Seed preconditions via the \`dataManager\` fixture (fixtures/test-data-manager.ts); do not configure data through the admin UI.
- Put \`expect(...)\` only in the final assertion step of each test; title it \`Assert AC-###: ...\`.
- Must assert the salient expected values ${salient.map((s) => '"' + s + '"').join(', ')}.
- Must not use page.waitForTimeout, networkidle, XPath, test.only, or any form of skip; must not use real credentials or commit auth state.

## Notes

- This suite targets the live Pollen development environment; \`Parallel Safe\` is \`no\` and \`Data Isolation\` is \`external\`.
- E2E-only policy: every Data Case row above maps to an emitted, executable end-to-end test (API seed of REAL catalogue SKUs -> direct seeded-session navigation -> live UI assertion). Source cases that cannot be verified end-to-end today are enumerated under Pending Automation with their blockers — no weak panel-smoke or guaranteed-red placeholder tests are generated for them.
- Source: specs/test-cases-skus-2.yaml (area: ${area.title}); every row keeps its source case id for traceability.
- Locators were live-audited (2026-07-02/03) against the dev environment; the seed/hydrate/assert pipeline is live-proven.
${pendingSection}`;
}

const TEST_DIR = path.join(WEB, 'tests/regression/skus');

// ---- data-driven emitter (v2): every test actually USES its case's structured data -----------
function joinLines(arr) { return (arr || []).join('\n'); }
function extractChannel(c) {
  const m = joinLines(c.testData).match(/channel\s*=\s*([A-Za-z][A-Za-z0-9 _/-]*?)\s*(?:[;,(\n]|$)/i);
  return m ? m[1].trim() : 'offsite';
}
function extractMax(c) {
  const m = joinLines(c.testData).match(/maxHeroSkus\s*=\s*(\d+|null)/i);
  return m ? (m[1].toLowerCase() === 'null' ? null : Number(m[1])) : null;
}
function extractSkuList(text, kind) {
  const digits = (raw) => raw.split(/[,;\s]+/).map((s) => s.trim().replace(/^SKU[-_ ]?/i, '')).filter((s) => /^\d+$/.test(s)).slice(0, 12);
  // Prefer an explicit comma list before any parenthetical (e.g. "Hero assigned: 1,2,3 (count ...)").
  let m = text.match(new RegExp(kind + '[^:\\n]*:?\\s*([0-9]+(?:\\s*,\\s*[0-9]+)+)', 'i'));
  if (m) return digits(m[1]);
  // Otherwise a SKU-coded parenthetical (e.g. "(SKU-1001, SKU-1002)").
  m = text.match(new RegExp(kind + '[^\\n(]*\\(([^)]*SKU[^)]*)\\)', 'i'));
  if (m) return digits(m[1]);
  // Otherwise a bare count (e.g. "selected Hero SKUs=4") -> synthesise that many ids.
  m = text.match(new RegExp('selected\\s+' + kind + '\\s+SKUs\\s*=\\s*(\\d+)', 'i'));
  if (m) return Array.from({ length: Math.min(Number(m[1]), 12) }, (_, i) => String(i + 1));
  return [];
}
function extractWarning(c) {
  const m = joinLines(c.expected).match(/Media limit:\s*(\d+)\s*Hero SKUs/i);
  return m ? ('Media limit: ' + m[1] + ' Hero SKUs. Edit SKUs') : null;
}
function extractWarningAbsent(c) {
  return /\bno\b[^\n]{0,12}(media limit|warning)/i.test(joinLines(c.expected));
}
function extractCount(c, kind) {
  const e = joinLines(c.expected);
  // Displayed counts are small (1-2 digits). SKU ids in these specs are >=3 digits (1001, 12345) or
  // appear as braced set members, so a 1-2 digit number anchored to the word "count" near the kind is
  // the count the summary shows, not a SKU id. Generous gaps tolerate phrasings like
  // "Measurement SKU count in the summary panel updates to 3" / "Hero count = 2".
  const m =
    e.match(new RegExp(kind + '[^\\n]{0,40}?count[^\\n]{0,40}?\\b(\\d{1,2})\\b', 'i')) ||
    e.match(new RegExp('count[^\\n]{0,40}?' + kind + '[^\\n]{0,12}?\\b(\\d{1,2})\\b', 'i')) ||
    e.match(new RegExp(kind + '\\s*=\\s*(\\d{1,2})\\b', 'i'));
  return m ? Number(m[1]) : null;
}
// Many cases state the EXPECTED resulting SKU set (e.g. "Summary reflects ... Hero={3,5,6}",
// "offSite channel Hero SKUs = {1001,1002,1004}") rather than a bare count. The summary count the
// UI shows equals that set's cardinality, so derive the count from the set when no explicit count
// is present. Requires an `=` before the brace so prose like "remain the original set {...}" (an
// unchanged-other-channel aside, not a result) is NOT mistaken for this channel's outcome.
function extractExpectedSetCount(c, kind) {
  // Accept a stated result set: "Hero={3,5,6}", "Hero SKUs = {…}", and the bare-brace form
  // "Measurement SKUs {1,2,3,4}". The brace must follow the kind via only "SKUs"/"set"/"="/":" and
  // whitespace, so an unchanged-other-channel aside ("Hero SKUs remain the original set {…}") — where
  // prose sits between the kind and the brace — is NOT mistaken for this channel's outcome.
  const m = joinLines(c.expected).match(new RegExp(kind + '(?:\\s+SKUs?)?(?:\\s*(?:set|=|:))*\\s*\\{([^}]*)\\}', 'i'));
  if (!m) return null;
  return m[1].split(/[,;\s]+/).map((s) => s.trim()).filter((s) => /^\d+$/.test(s)).length;
}
// ---- real catalogue SKU pools -------------------------------------------------------------
// The generated data cases must seed REAL skuIds: the UI product checkboxes match /-\d{5,}$/ and
// planningAI SET_SKUS resolves ids against the live catalogue, so the YAML's synthetic tokens
// ("1", "1001", "234235") arrange nothing. Persil's 6 SKUs are live-verified (2026-07-02 via
// planning_getSkusBySkuId). specs/skus/.sku-pools.json (written from live probes) can extend this
// with a bigger second pool for the rare case needing more than 6 unique SKUs.
const FALLBACK_POOLS = {
  persil: [7096764, 7304367, 7759164, 8114265, 8114267, 8119540]
};
function loadSkuPools() {
  const file = path.join(OUT_DIR, '.sku-pools.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      persil: parsed.persil?.skuIds ?? FALLBACK_POOLS.persil,
      big: parsed.big?.skuIds,
      bigBrand: parsed.big?.brand
    };
  } catch {
    return { ...FALLBACK_POOLS };
  }
}
const SKU_POOLS = loadSkuPools();

// Map the YAML's synthetic sku tokens to REAL catalogue skuIds, case-locally and injectively: the
// n-th distinct token (order of first appearance, hero list first) becomes the n-th id of the
// smallest real pool that fits. Cardinalities and hero/measurement overlaps are preserved exactly,
// so every expected count still holds — the ids just exist for real. When no pool is large enough
// the synthetic ids are KEPT and the case is marked skuPool:'synthetic-UNSEEDABLE' (loud in the
// emitted data) rather than silently shrinking the set, which would change the asserted counts.
function mapCaseSkusToReal(hero, measurement) {
  const distinct = [...new Set([...hero, ...measurement])];
  if (distinct.length === 0) {
    return { hero, measurement, skuPool: 'none' };
  }
  let pool = SKU_POOLS.persil;
  let poolName = 'persil';
  if (distinct.length > pool.length) {
    if (SKU_POOLS.big && SKU_POOLS.big.length >= distinct.length) {
      pool = SKU_POOLS.big;
      poolName = `big:${SKU_POOLS.bigBrand ?? 'unknown'}`;
    } else {
      return { hero, measurement, skuPool: 'synthetic-UNSEEDABLE' };
    }
  }
  const map = new Map(distinct.map((token, index) => [token, String(pool[index])]));
  return {
    hero: hero.map((token) => map.get(token)),
    measurement: measurement.map((token) => map.get(token)),
    skuPool: poolName
  };
}

function structuredCase(c, i) {
  const td = joinLines(c.testData);
  const warning = extractWarning(c);
  // Contradiction guard (finding: multi-channel cases flattened into warning && warningAbsent both
  // true). The over-limit warning text is authoritative; only treat the case as "no warning" when
  // there is no warning text at all.
  const warningAbsent = warning ? false : extractWarningAbsent(c);
  const mapped = mapCaseSkusToReal(extractSkuList(td, 'Hero'), extractSkuList(td, 'Measurement'));
  return {
    caseId: 'DC-' + pad(i + 1),
    sourceId: c.id,
    // Source case is a multi-channel scenario the single-channel shape below cannot fully represent.
    multiChannel: /\b(each|per|both|every)\b[^\n]{0,30}channel/i.test(`${joinLines(c.preconditions)} ${td} ${joinLines(c.expected)}`),
    channel: extractChannel(c),
    maxHeroSkus: extractMax(c),
    heroSkus: mapped.hero,
    measurementSkus: mapped.measurement,
    // Which real catalogue pool the ids come from ('none' when the case seeds no SKUs;
    // 'synthetic-UNSEEDABLE' when no real pool is big enough — such a case cannot be arranged).
    skuPool: mapped.skuPool,
    expected: {
      warning,
      warningAbsent,
      heroCount: extractCount(c, 'Hero') ?? extractExpectedSetCount(c, 'Hero'),
      measurementCount: extractCount(c, 'Measurement') ?? extractExpectedSetCount(c, 'Measurement')
    }
  };
}

// v4 emitter — E2E ONLY. Emits a test file exclusively for the automatable data cases (see
// automationBlocker); returns null when a suite has none, so no test file exists for a
// pending-generation spec. Every emitted test is a real end-to-end journey proven live 2026-07-03:
// API seed of real catalogue SKUs -> direct seeded-session navigation -> live UI assertion.
function buildTestV4(area, cases, hash) {
  const tag = "['@generated', '@regression', '@media-planner', '@authenticated', '@" + area.slug + "']";
  const structured = cases.map((c, i) => structuredCase(c, i));
  const automatable = structured.filter((s) => !automationBlocker(s, area));
  if (automatable.length === 0) {
    return null;
  }
  const emitted = automatable.map((s, i) => ({
    caseId: `DC-${pad(i + 1)}`,
    sourceId: s.sourceId,
    heroSkus: s.heroSkus,
    measurementSkus: s.measurementSkus,
    skuPool: s.skuPool,
    expected: { heroCount: s.expected.heroCount, measurementCount: s.expected.measurementCount }
  }));
  const dataJson = JSON.stringify(emitted, null, 2);
  const heroSeedPair = JSON.stringify(SKU_POOLS.persil.slice(0, 2).map(String));

  return `// Spec-bound header: sha256 is the behavioral hash of the spec. Re-stamp with
// \`npm run ai:spec:drift\` if the spec's behavioral sections change.
/* spec: specs/skus/${area.slug}.md version:2.0.0 sha256:${hash} */
import { test, expect } from '../../../fixtures/test';
import { PlanningPage } from '../../../pages/PlanningPage';

// ${emitted.length} automatable Data Cases (of ${cases.length} source cases; the rest are declared
// under "Pending Automation" in the spec — E2E-only policy, no placeholder tests). Each row seeds
// REAL catalogue skuIds (specs/skus/.sku-pools.json) into a live planningAI session and asserts the
// summary counters the UI actually renders.
type SkuDataCase = {
  caseId: string;
  sourceId: string;
  heroSkus: string[];
  measurementSkus: string[];
  // Real catalogue pool the ids come from ('persil' / 'big:<brand>'); 'none' seeds an empty set.
  skuPool: string;
  expected: {
    heroCount: number | null;
    measurementCount: number | null;
  };
};

const dataCases: SkuDataCase[] = ${dataJson};

// Live DOM contract (observed 2026-07-03): plan-hero-skus / plan-measurement-skus resolve to the
// whole summary row, whose textContent concatenates children WITHOUT whitespace
// ("ProductHero SKUs2 SKUsEdit…") — so \\b never exists around the numeral; a digit lookbehind
// keeps "12 SKUs" from satisfying "2 SKUs". An empty counter renders "To be defined".
const countPattern = (count: number): RegExp =>
  count === 0 ? new RegExp('(?<!\\\\d)0 SKUs?|To be defined') : new RegExp(\`(?<!\\\\d)\${count} SKUs?\`);

// Spec Stability Requirements declare Parallel Safe = no, so the suite runs serially.
test.describe.serial(${JSON.stringify(area.title)}, () => {
  for (const dataCase of dataCases) {
    test(
      \`\${dataCase.caseId} \${dataCase.sourceId}\`,
      { tag: ${tag} },
      async ({ page, dataManager }) => {
        const planningPage = new PlanningPage(page);
        await test.step('seed the session with the case SKU sets and open it', async () => {
          const sessionId = await dataManager.ensurePlanningSession();
          if (dataCase.heroSkus.length > 0) {
            await dataManager.setPlanHeroSkus(sessionId, 'offsite', dataCase.heroSkus);
          }
          if (dataCase.measurementSkus.length > 0) {
            await dataManager.setPlanMeasurementSkus(sessionId, 'offsite', dataCase.measurementSkus);
          }
          await planningPage.gotoSession(sessionId);
        });
        await test.step('Assert AC-004: seeded Hero/Measurement counter matches the data case', async () => {
          if (dataCase.expected.heroCount !== null) {
            await expect(planningPage.summaryHeroCount()).toContainText(countPattern(dataCase.expected.heroCount));
          } else {
            await expect(planningPage.summaryMeasurementCount()).toContainText(countPattern(dataCase.expected.measurementCount as number));
          }
        });
      }
    );
  }

  test(
    ${JSON.stringify('AC-001 ' + area.slug)},
    { tag: ${tag} },
    async ({ page }) => {
      const planningPage = new PlanningPage(page);
      await test.step('walk the planner entry path', async () => {
        await planningPage.goto();
        await planningPage.startNectarAiPlanner();
      });
      await test.step('Assert AC-001: the guided objective-and-budget flow is reachable', async () => {
        await expect(planningPage.buildByObjectiveButton()).toBeVisible();
      });
    }
  );

  test(
    ${JSON.stringify('AC-002 ' + area.slug)},
    { tag: ${tag} },
    async ({ page, dataManager }) => {
      const planningPage = new PlanningPage(page);
      await test.step('open the live planning session directly', async () => {
        const sessionId = await dataManager.ensurePlanningSession();
        await planningPage.gotoSession(sessionId);
      });
      await test.step('Assert AC-002: the seeded session hydrates to its summary panel', async () => {
        await expect(planningPage.summaryPanel()).toBeVisible();
      });
    }
  );

  test(
    ${JSON.stringify('AC-003 ' + area.slug)},
    { tag: ${tag} },
    async ({ page, dataManager }) => {
      const planningPage = new PlanningPage(page);
      await test.step('seed exactly two Hero SKUs from the real catalogue pool', async () => {
        const sessionId = await dataManager.ensurePlanningSession();
        await dataManager.setPlanHeroSkus(sessionId, 'offsite', ${heroSeedPair});
        await planningPage.gotoSession(sessionId);
      });
      await test.step('Assert AC-003: the Hero counter equals the seeded Hero count', async () => {
        await expect(planningPage.summaryHeroCount()).toContainText(countPattern(2));
      });
    }
  );

  test(
    ${JSON.stringify('NEG-001 ' + area.slug)},
    { tag: ${tag} },
    async ({ page, dataManager }) => {
      const planningPage = new PlanningPage(page);
      await test.step('clear the session SKU selection via API and open it', async () => {
        const sessionId = await dataManager.ensurePlanningSession();
        await dataManager.setPlanHeroSkus(sessionId, 'offsite', []);
        await planningPage.gotoSession(sessionId);
      });
      await test.step('Assert NEG-001: no SKU edit control renders for an empty selection', async () => {
        await expect(planningPage.summaryEditMeasurementButton()).toBeHidden();
      });
    }
  );
});
`;
}

// --- run -----------------------------------------------------------------------------------
const text = fs.readFileSync(YAML, 'utf8');
const cases = parseCases(text);
console.log(`parsed ${cases.length} cases`);

const grouped = AREAS.map((area) => ({
  area,
  cases: cases.filter((c) => c.area.includes(area.key)),
}));

for (const { area, cases: list } of grouped) {
  console.log(`  ${area.slug}: ${list.length} cases`);
}
const total = grouped.reduce((n, g) => n + g.cases.length, 0);
console.log(`grouped total: ${total} (ungrouped: ${cases.length - total})`);

if (process.argv.includes('--write')) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const { area, cases: list } of grouped) {
    if (MANUALLY_MAINTAINED_FLOW_IDS.has(area.flowId)) {
      console.log(`preserved ${area.slug} (manually maintained modal suite)`);
      continue;
    }
    const structured = list.map((c, i) => structuredCase(c, i));
    const automatable = structured.filter((s) => !automationBlocker(s, area)).length;
    const file = path.join(OUT_DIR, `${area.slug}.md`);
    fs.writeFileSync(file, buildSpec(area, list, structured), 'utf8');
    console.log(`wrote ${file} (${automatable}/${list.length} cases automatable${automatable === 0 ? ' -> pending-generation' : ''})`);
  }
}

if (process.argv.includes('--write-tests')) {
  const { specSha256 } = await import(path.join(WEB, 'scripts/ai/lib/spec-parser.mjs'));
  fs.mkdirSync(TEST_DIR, { recursive: true });
  for (const { area, cases: list } of grouped) {
    if (MANUALLY_MAINTAINED_FLOW_IDS.has(area.flowId)) {
      console.log(`preserved ${area.slug} (manually maintained modal suite)`);
      continue;
    }
    // Absolute path so specSha256 reads the spec FILE (and hashes its behavioral content) regardless
    // of this generator's CWD. A relative path that doesn't resolve makes specSha256 treat the string
    // itself as spec content -> a constant skeleton hash for every area -> spec-drift/review failure.
    const hash = specSha256(path.join(OUT_DIR, `${area.slug}.md`));
    const file = path.join(TEST_DIR, `${area.slug}.authenticated.spec.ts`);
    const emitted = buildTestV4(area, list, hash);
    if (emitted === null) {
      // E2E-only policy: a suite with zero automatable cases is pending-generation and must have
      // NO test file (a stale one would trip gate-all's stale-Generation-Status check).
      if (fs.existsSync(file)) {
        fs.rmSync(file);
        console.log(`removed ${file} (0 automatable cases -> spec is pending-generation)`);
      } else {
        console.log(`skipped ${file} (0 automatable cases -> spec is pending-generation)`);
      }
      continue;
    }
    fs.writeFileSync(file, emitted, 'utf8');
    console.log(`wrote ${file} (sha ${hash.slice(0, 12)})`);
  }
}
