import fs from 'node:fs/promises';

import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const root = '/Users/maybebest/Documents/Projects/general/web-api-test-generator';
const inputPath = `${root}/outputs/e2e-curated-20260713/Nectar360_Pollen_Curated_E2E_Suite_20260713.xlsx`;
const outputDir = `${root}/outputs/e2e-coverage-20260713`;
const outputPath = `${outputDir}/Nectar360_Pollen_E2E_Automation_Coverage_20260713.xlsx`;

const beforePartial = new Set([
  'TC-ACC-001', 'TC-ACC-002', 'TC-ACC-003', 'TC-ACC-004',
  'TC-SKU-001', 'TC-SKU-002', 'TC-SKU-003', 'TC-SKU-004', 'TC-SKU-005', 'TC-SKU-006', 'TC-SKU-007',
  'TC-CHS-001', 'TC-CHS-002', 'TC-CHS-003', 'TC-CHS-004',
  'TC-VAL-001', 'TC-VAL-002',
  'TC-CHN-001', 'TC-CHN-002', 'TC-CHN-003', 'TC-CHN-004', 'TC-CHN-005',
  'TC-PLN-001', 'TC-PLN-002', 'TC-PLN-003',
  'TC-PRC-001', 'TC-PRC-002',
  'TC-CAL-005', 'TC-CAL-006',
  'TC-AIQ-001', 'TC-AIQ-002', 'TC-AIQ-003',
  'EXT-A11Y-001', 'EXT-EXPORT-001'
]);

const beforeAbsent = new Set([
  'TC-ACC-005', 'TC-VAL-003', 'TC-VAL-004',
  'TC-SEC-001', 'TC-SEC-002', 'TC-SEC-003', 'TC-SEC-004', 'TC-SEC-005', 'TC-SEC-006', 'TC-SEC-007',
  'TC-PRC-003', 'TC-PRC-004',
  'TC-CAL-001', 'TC-CAL-002', 'TC-CAL-003', 'TC-CAL-004',
  'EXT-AI-RETRY-001', 'EXT-AUTOSAVE-001', 'EXT-DEPENDENCY-001', 'EXT-PERF-001', 'EXT-RESPONSIVE-001'
]);

const currentPartial = new Set([
  ...beforePartial,
  'TC-ACC-005',
  'TC-VAL-003',
  'TC-SEC-001', 'TC-SEC-002', 'TC-SEC-004', 'TC-SEC-005', 'TC-SEC-006', 'TC-SEC-007',
  'EXT-AI-RETRY-001', 'EXT-DEPENDENCY-001', 'EXT-PERF-001', 'EXT-RESPONSIVE-001'
]);

const evidence = {
  'TC-ACC-001': 'media-planner-booking-deadline.authenticated.spec.ts:120; safe live allowlist 8/8 passed',
  'TC-ACC-002': 'sains/entry-and-persistence.authenticated.spec.ts:423',
  'TC-ACC-003': 'sains/entry-and-persistence.authenticated.spec.ts:215,245',
  'TC-ACC-004': 'media-plan-save-via-nectar-ai.authenticated.spec.ts:53; sains/entry-and-persistence.authenticated.spec.ts:245',
  'TC-SKU-001': 'nectar-sku-management.authenticated.spec.ts:29,44,86',
  'TC-SKU-002': 'nectar-sku-management.authenticated.spec.ts:15,59,73; sains/sku-management-extended.authenticated.spec.ts:528',
  'TC-SKU-003': 'sains/sku-management-extended.authenticated.spec.ts:269,297',
  'TC-SKU-004': 'nectar-edit-sku-list.authenticated.spec.ts:108; sains/sku-management-extended.authenticated.spec.ts:528',
  'TC-SKU-005': 'sains/sku-management-extended.authenticated.spec.ts:415,564; skus/single-prompt-hero-measurement-parsing.authenticated.spec.ts:722',
  'TC-SKU-006': 'skus/single-prompt-hero-measurement-parsing.authenticated.spec.ts:624,657,690',
  'TC-SKU-007': 'nectar-edit-sku-list.authenticated.spec.ts:69,108,158',
  'TC-CHS-001': 'sains/channel-hero-assignment.authenticated.spec.ts:229,259',
  'TC-CHS-002': 'sains/channel-hero-assignment.authenticated.spec.ts:294,318,351',
  'TC-CHS-003': 'sains/channel-hero-assignment.authenticated.spec.ts:386,435',
  'TC-CHS-004': 'sains/channel-hero-assignment.authenticated.spec.ts:497,525,548',
  'TC-VAL-001': 'skus/max-hero-skus-per-channel.authenticated.spec.ts:230,1126',
  'TC-VAL-002': 'skus/max-hero-skus-per-channel.authenticated.spec.ts:443,567,1126',
  'TC-CHN-001': 'media-planner-booking-deadline.authenticated.spec.ts:160; media-planner-minimum-campaign-duration.authenticated.spec.ts:115',
  'TC-CHN-002': 'sains/entry-and-persistence.authenticated.spec.ts:324',
  'TC-CHN-003': 'media-planner-store-level-validation.authenticated.spec.ts:280,390,418',
  'TC-CHN-004': 'media-planner-channel-deletion-dialog.authenticated.spec.ts:127; media-planner-channel-deletion-recompute.authenticated.spec.ts:121',
  'TC-CHN-005': 'sains/entry-and-persistence.authenticated.spec.ts:374',
  'TC-PLN-001': 'media-plan-save-via-nectar-ai.authenticated.spec.ts:53,115,130',
  'TC-PLN-002': 'sains/media-plan-discard-flow.authenticated.spec.ts:90,133',
  'TC-PLN-003': 'sains/entry-and-persistence.authenticated.spec.ts:276',
  'TC-PRC-001': 'media-planner-pricing-cost-calculation.authenticated.spec.ts:430,448',
  'TC-PRC-002': 'media-planner-pricing-cost-calculation.authenticated.spec.ts:378,394,430',
  'TC-CAL-005': 'media-planner-pricing-cost-calculation.authenticated.spec.ts:349,357,430',
  'TC-CAL-006': 'media-planner-pricing-cost-calculation.authenticated.spec.ts:448; media-planner-cross-cutting-journeys.authenticated.spec.ts:475',
  'TC-AIQ-001': 'sains/ai-conversation-quality.authenticated.spec.ts:135,234',
  'TC-AIQ-002': 'sains/ai-conversation-quality.authenticated.spec.ts:162,284,308',
  'TC-AIQ-003': 'sains/ai-conversation-quality.authenticated.spec.ts:185,212',
  'EXT-A11Y-001': 'nectar-edit-sku-list.authenticated.spec.ts:158; sains/entry-shell-responsive-accessibility.authenticated.spec.ts:55,72,93',
  'EXT-EXPORT-001': 'media-plan-save-via-nectar-ai.authenticated.spec.ts:115,130; fixtures/csv-export.ts:65,313; tests/smoke/csv-export.unit.spec.ts:22',
  'EXT-RESPONSIVE-001': 'sains/entry-shell-responsive-accessibility.authenticated.spec.ts:31 (3 viewport rows)',
  'TC-ACC-005': 'sains/parallel-conversation-isolation.authenticated.spec.ts; ParallelConversationIsolationComponent.ts',
  'TC-VAL-003': 'sains/hfss-category-eligibility.authenticated.spec.ts; HfssEligibilityComponent.ts',
  'TC-SEC-001': 'secondary-space/nectar-ai-secondary-space-live.authenticated.spec.ts DC-001',
  'TC-SEC-002': 'secondary-space/nectar-ai-secondary-space-live.authenticated.spec.ts DC-002',
  'TC-SEC-004': 'secondary-space/nectar-ai-secondary-space-live.authenticated.spec.ts DC-003',
  'TC-SEC-005': 'secondary-space/nectar-ai-secondary-space-live.authenticated.spec.ts DC-004 and NEG-001',
  'TC-SEC-006': 'secondary-space/nectar-ai-secondary-space-live.authenticated.spec.ts DC-005 pre-save edit subset',
  'TC-SEC-007': 'secondary-space/nectar-ai-secondary-space-live.authenticated.spec.ts DC-006 save/reload persistence subset',
  'EXT-AI-RETRY-001': 'sains/reliability-recovery.authenticated.spec.ts DC-001 and DC-003',
  'EXT-DEPENDENCY-001': 'sains/reliability-recovery.authenticated.spec.ts DC-002 browser-transport subset',
  'EXT-PERF-001': 'sains/large-sku-selection-integrity.authenticated.spec.ts DC-001 (46-row live run)'
};

const remainingGap = {
  'TC-ACC-001': 'New isolated conversation plus UI/API identifier and owner correlation.',
  'TC-ACC-002': 'Expired, malformed and revoked sessions; approved role/API/audit matrix.',
  'TC-ACC-003': 'Every recovery checkpoint, version equality, owner and naming contract.',
  'TC-ACC-004': 'Full Planner read-model, durable-state and booking-readiness parity.',
  'TC-SKU-001': 'Complete zero/one/many lookup matrix and persisted set equality.',
  'TC-SKU-002': 'Reload and backend workflow-state parity at every lifecycle checkpoint.',
  'TC-SKU-003': 'Retry/idempotency plus reload/API persistence of promoted roles.',
  'TC-SKU-004': 'Failed update, lost response, transaction rollback and idempotency.',
  'TC-SKU-005': 'Zero/one/malformed/mixed catalogue boundaries, long names and full a11y matrix.',
  'TC-SKU-006': 'Normalized API/persistence equality and one approved ambiguous Hero-only oracle.',
  'TC-SKU-007': 'Equivalent versioned final state through every supported edit trigger.',
  'TC-CHS-001': 'Reload/API parity for default and explicit per-channel assignments.',
  'TC-CHS-002': 'Post-lock behavior and reload/API isolation proof.',
  'TC-CHS-003': 'Persisted campaign-Hero union after edit and deletion reload.',
  'TC-CHS-004': 'Count/dash persistence after reload and feature-state change.',
  'TC-VAL-001': 'Planner API validation state and configuration-version parity after reload.',
  'TC-VAL-002': 'No-version-increment and durable readback while warnings block save.',
  'TC-CHN-001': 'Structured reason codes and configuration version in the API/read model.',
  'TC-CHN-002': 'Actual V1→V2 configuration publication, cutover and durable version proof.',
  'TC-CHN-003': 'Audience Builder/API/persistence parity and unresolved availability rules.',
  'TC-CHN-004': 'Hero, asset, cost and read-model reconciliation after deletion.',
  'TC-CHN-005': 'Pre/post-commit failure, response loss/replay, stale concurrency and audit.',
  'TC-PLN-001': 'Pollen handoff/readback and complete persisted field parity.',
  'TC-PLN-002': 'Persisted discard/continue outcome, audit and isolation from other plans.',
  'TC-PLN-003': 'Timeout, lost response, replay, concurrency and idempotency-key behavior.',
  'TC-PRC-001': 'Remaining pricing models plus save/reopen and model-version parity.',
  'TC-PRC-002': 'All eligible fee combinations and persisted component breakdown.',
  'TC-CAL-005': 'Complete tier/fee/version/persistence matrix.',
  'TC-CAL-006': 'Print, Nectar, currency invalid/rounding and persistence matrix.',
  'TC-AIQ-001': 'Locale-sensitive ambiguity, approved SLO and normalized API equivalence.',
  'TC-AIQ-002': 'Stable API reason, authorization audit and persisted no-mutation proof.',
  'TC-AIQ-003': 'Mixed batches, context reset and API/persistence parity.',
  'EXT-A11Y-001': 'Full keyboard journey, post-entry dialogs, announcements and manual screen-reader/browser/OS matrix.',
  'EXT-EXPORT-001': 'Special-character variants, edit/re-export freshness and Pollen/read-model round trip.',
  'EXT-RESPONSIVE-001': 'Post-entry chat/summary/modal journey, approved device matrix and cross-browser/physical-device evidence.',
  'TC-ACC-005': 'Second independently authorised role plus a conversation delete/archive contract; current test covers same-user two-tab isolation and owned-plan discard.',
  'TC-VAL-003': 'Category-only, no-eligible partition, bounded post-filter min/max, all channel groups and mixed-batch ordering with stable reason codes.',
  'TC-VAL-004': 'Owner decision for min>max reject/normalize/error and V1→V2 snapshot-vs-latest semantics, plus safe versioned config publish/read/cleanup.',
  'TC-SEC-001': 'Approved direct-vs-cache authority/fallback rule; live data currently disagrees on asset names.',
  'TC-SEC-002': 'A fresh external-role auth state to prove denial of internal-only media.',
  'TC-SEC-003': 'Reviewed deterministic Secondary Space/non-Secondary pair, one-message grammar, batch order and partial-failure continuation contract.',
  'TC-SEC-004': 'Zero/multiple-mandatory fixtures, one-vs-many Assign all boundaries, invalid quantities and reload/API parity beyond the live-proven one-element case.',
  'TC-SEC-005': 'Fix the confirmed missing optional Assign all action; then add skip-message, overwrite and multi-shape fixtures.',
  'TC-SEC-006': 'Fix the confirmed non-opening Edit Channel action, then add the post-save lock point and reversible update-failure injector.',
  'TC-SEC-007': 'Booking/CRM payload schema, non-production booking stub and reversible cleanup.',
  'EXT-AI-RETRY-001': 'Product implementation of a visible error with Retry/Cancel; the new test currently exposes the silent-failure defect.',
  'EXT-DEPENDENCY-001': 'Run-scoped service-internal validation/product-search 4xx, 5xx and timeout injector plus persistence readback.',
  'EXT-PERF-001': 'Approved stable dataset, warm/cold boundary, sample count, percentile and numeric SLO; current test covers functional integrity only.',
  'EXT-AUTOSAVE-001': 'Run-scoped autosave failure injector, visible saved/unsaved contract, revision readback and exactly-once retry oracle.',
  'TC-PRC-003': 'Approved rate-precedence and missing-rate reason contract plus versioned Rates Management component/API fixtures.',
  'TC-PRC-004': 'V1/V2 pricing snapshot/cutover decision, immutable rate values and a fixture eligible for the selected brand.',
  'TC-CAL-001': 'Approved POS PFS/>300-store formula, rate fixtures, tax inclusion and currency rounding order.',
  'TC-CAL-002': 'Approved Sampling weekday/weekend/additional-hour domains, boundary fixtures and rounding order.',
  'TC-CAL-003': 'Approved Future Brand representation, operator precedence and immutable component rates.',
  'TC-CAL-004': 'Approved training-count mapping, tier/rate fixtures, tax and rounding semantics.'
};

const restoredSpecIds = new Set([
  'TC-ACC-001', 'TC-ACC-002', 'TC-ACC-003', 'TC-ACC-004', 'TC-ACC-005',
  'TC-CHN-002', 'TC-CHN-005', 'TC-PLN-002', 'TC-PLN-003',
  'TC-SKU-001', 'TC-SKU-002', 'TC-SKU-003', 'TC-SKU-004', 'TC-SKU-005', 'TC-SKU-006', 'TC-SKU-007',
  'TC-CHS-001', 'TC-CHS-002', 'TC-CHS-003', 'TC-CHS-004',
  'TC-AIQ-001', 'TC-AIQ-002', 'TC-AIQ-003'
]);

function implementationThisTurn(id) {
  const changes = [];
  if (restoredSpecIds.has(id)) changes.push('Restored exact hash-matching strict spec binding.');
  if (id === 'EXT-A11Y-001' || id === 'EXT-RESPONSIVE-001') {
    changes.push('Added FLOW-MP-027 and six read-only authenticated entry-shell checks.');
  }
  if (id === 'EXT-EXPORT-001' || id === 'TC-PLN-001') {
    changes.push('Added bounded UTF-8/RFC 4180 download inspection and five local parser tests.');
  }
  if (['TC-VAL-001', 'TC-VAL-002', 'TC-SKU-006', 'TC-CHS-001', 'TC-CHS-002', 'TC-CHS-003', 'TC-CHS-004'].includes(id)) {
    changes.push('Resolved present-test/pending-generation metadata conflict to generated.');
  }
  if (id === 'TC-ACC-005') changes.push('Added opt-in two-tab UI/API isolation with ownership-scoped plan cleanup.');
  if (id === 'TC-VAL-003') changes.push('Added live-preflighted mixed HFSS/non-HFSS channel filtering and API readback.');
  if (['TC-SEC-001', 'TC-SEC-002', 'TC-SEC-004', 'TC-SEC-005', 'TC-SEC-006', 'TC-SEC-007'].includes(id)) {
    changes.push('Added Secondary Space configuration, quantity, edit and persistence subsets with guarded cleanup.');
  }
  if (id === 'EXT-AI-RETRY-001' || id === 'EXT-DEPENDENCY-001') {
    changes.push('Added message-scoped GraphQL fault injection and atomic-state/retry assertions.');
  }
  if (id === 'EXT-PERF-001') changes.push('Added a live large-result functional-integrity row without inventing a timing SLO.');
  return changes.join(' ');
}

function executionState(id, status) {
  if (id === 'TC-ACC-001') return 'Read-only entry subset: 8/8 passed live; canonical journey remains partial.';
  if (id === 'EXT-RESPONSIVE-001') return 'New entry-shell viewport probes: 3/3 passed live.';
  if (id === 'EXT-A11Y-001') return 'New subset: accessible name and keyboard passed; axe failed on button-name, select-name, svg-img-alt.';
  if (id === 'EXT-EXPORT-001' || id === 'TC-PLN-001') return 'Parser unit tests 5/5 passed; mutating save/download journey not run.';
  if (id === 'TC-ACC-005') return 'Live passed: two tabs kept distinct session/plan IDs and canonical objectives; Bravo survived Alpha discard; both owned plans were removed. Consent NEG also passed.';
  if (id === 'TC-VAL-003') return 'Live passed: mixed HFSS filtering retained the eligible channel SKU, preserved global state, matched API/UI and removed the owned channel; missing-consent NEG passed.';
  if (id === 'TC-SEC-001') return 'Live failed as designed: direct Base names are null while cached names are populated for the same asset IDs.';
  if (id === 'TC-SEC-002') return 'Internal-role subset passed live; external-role denial not run without a second auth state.';
  if (id === 'TC-SEC-004') return 'Live passed: mandatory default/options/quantity update/lock; the owned plan was deleted and verified absent.';
  if (id === 'TC-SEC-005') return 'Zero-gating NEG passed; live Assign all case failed because the required action is missing with two optional elements. Cleanup passed.';
  if (id === 'TC-SEC-006') return 'Live reached a valid summary, but Edit Channel opened no modal/section; the owned plan was still deleted.';
  if (id === 'TC-SEC-007') return 'Live passed: manually selected optional assets retained exact IDs/quantities through Save and same-session Reload; cleanup passed.';
  if (id === 'EXT-AI-RETRY-001') return 'Three live fault cases failed on the same product defect: injected HTTP 503 yields no error, Retry or Cancel. Non-target routing control passed.';
  if (id === 'EXT-DEPENDENCY-001') return 'Live product-search 503 reproduced the missing recovery surface; service-internal injector and full persistence readback remain unavailable.';
  if (id === 'EXT-PERF-001') return 'Live passed 1/1: 46/46 Measurement SKUs remained selected and the Hero step rendered; no performance SLO claimed.';
  if (status === 'Partial') return 'Implementation discovered; full canonical live journey not safely verified.';
  return 'No meaningful canonical implementation; not executed.';
}

function nextAutomation(id, status) {
  if (id === 'EXT-A11Y-001') return 'Automated subset exists; screen-reader evidence stays manual.';
  if (id === 'EXT-RESPONSIVE-001') return 'Entry shell automated; full flow waits for approved support matrix and disposable data.';
  if (id === 'EXT-EXPORT-001') return 'CSV subset exists; full round trip waits for owned saved-plan/readback fixtures.';
  if (id === 'EXT-AI-RETRY-001') return 'Fix the confirmed visible-recovery defect, then rerun DC-001/DC-003.';
  if (id === 'TC-SEC-001') return 'Resolve the Base direct/cache data contract before promoting the red test.';
  if (id === 'EXT-PERF-001') return 'Keep the functional test; add metrics only after an owner supplies the missing SLO contract.';
  if (status === 'Partial') return 'More automation is possible only after the listed API/data/cleanup gates are supplied.';
  return 'Blocked: do not generate a passing test until the listed fixture, contract or oracle exists.';
}

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const sourceSheet = workbook.worksheets.getItem('Curated E2E Suite');
const sourceRows = sourceSheet.getRange('A5:Z59').values;

const summary = workbook.worksheets.add('Coverage Summary');
const matrix = workbook.worksheets.add('Automation Coverage');

const matrixHeaders = [
  'Canonical ID', 'Priority', 'Pack', 'Journey', 'Before audit', 'Current status', 'Live / verification state',
  'Implementation evidence', 'Implemented this turn', 'Remaining canonical gap', 'Automation next step',
  'Required owner', 'Precondition codes (full gates in Curated E2E Suite)', 'Merged source checks', 'Merged source IDs', 'Original execution category'
];

const matrixRows = sourceRows.map((row) => {
  const id = String(row[0]).replace(/^XLSX::/, '');
  const before = beforePartial.has(id) ? 'Partial' : beforeAbsent.has(id) ? 'Absent / blocked' : 'Unclassified';
  const current = currentPartial.has(id) ? 'Partial' : 'Absent / blocked';
  const gap = remainingGap[id] ?? `No meaningful automation for the canonical journey: ${row[5]}.`;
  return [
    id,
    row[6],
    row[7],
    row[5],
    before,
    current,
    executionState(id, current),
    evidence[id] ?? '',
    implementationThisTurn(id),
    gap,
    nextAutomation(id, current),
    row[11],
    row[12],
    row[19],
    row[20],
    row[9]
  ];
});

matrix.mergeCells('A1:P1');
matrix.getRange('A1').values = [['Nectar360 Pollen — Canonical E2E Automation Coverage']];
matrix.mergeCells('A2:P2');
matrix.getRange('A2').values = [[
  'Strict coverage requires the complete canonical UI journey plus every required API/read-model, persistence, reload, role/configuration or failure assertion.'
]];
matrix.getRange('A4:P4').values = [matrixHeaders];
matrix.getRange(`A5:P${4 + matrixRows.length}`).values = matrixRows;
matrix.tables.add(`A4:P${4 + matrixRows.length}`, true, 'CanonicalAutomationCoverage');
matrix.freezePanes.freezeRows(4);
matrix.freezePanes.freezeColumns(1);
matrix.showGridLines = false;

matrix.getRange('A1:P1').format = {
  fill: '#17365D',
  font: { bold: true, color: '#FFFFFF', size: 18 },
  rowHeight: 30,
  verticalAlignment: 'center'
};
matrix.getRange('A2:P2').format = {
  fill: '#F57C00',
  font: { color: '#FFFFFF', size: 10 },
  rowHeight: 28,
  wrapText: true,
  verticalAlignment: 'center'
};
matrix.getRange('A4:P4').format = {
  fill: '#0E7490',
  font: { bold: true, color: '#FFFFFF' },
  rowHeight: 30,
  wrapText: true,
  verticalAlignment: 'center'
};
matrix.getRange(`A5:P${4 + matrixRows.length}`).format = {
  font: { size: 9, color: '#1F2937' },
  verticalAlignment: 'top',
  wrapText: true,
  borders: { insideHorizontal: { style: 'thin', color: '#D7E3F0' } }
};
matrix.getRange(`A5:A${4 + matrixRows.length}`).format.font = { bold: true, color: '#17365D' };
matrix.getRange(`N5:N${4 + matrixRows.length}`).format.numberFormat = '0';
matrix.getRange(`E5:F${4 + matrixRows.length}`).format.horizontalAlignment = 'center';

const widths = [18, 9, 18, 42, 16, 16, 34, 48, 44, 48, 42, 30, 68, 14, 58, 18];
for (let index = 0; index < widths.length; index += 1) {
  matrix.getRangeByIndexes(0, index, 4 + matrixRows.length, 1).format.columnWidth = widths[index];
}
matrix.getRange(`A5:P${4 + matrixRows.length}`).format.rowHeight = 66;
matrix.getRange(`E5:F${4 + matrixRows.length}`).conditionalFormats.add('containsText', {
  text: 'Partial',
  format: { fill: '#FFF2CC', font: { color: '#7F6000', bold: true } }
});
matrix.getRange(`E5:F${4 + matrixRows.length}`).conditionalFormats.add('containsText', {
  text: 'Absent',
  format: { fill: '#FCE4D6', font: { color: '#9C0006', bold: true } }
});

summary.mergeCells('A1:H1');
summary.getRange('A1').values = [['Nectar360 Pollen — E2E Coverage Result']];
summary.mergeCells('A2:H2');
summary.getRange('A2').values = [[
  'Baseline: 0 fully covered / 34 partial / 21 absent. Current: 0 fully covered / 46 partial / 9 absent after adding honest gap automation and preserving strict canonical gates.'
]];
for (const range of ['A4:B4', 'C4:D4', 'E4:F4', 'G4:H4', 'A5:B5', 'C5:D5', 'E5:F5', 'G5:H5']) {
  summary.mergeCells(range);
}
summary.getRange('A4:H4').values = [[
  'Canonical journeys', null, 'Fully covered now', null, 'Partial now', null, 'Absent / blocked now', null
]];
summary.getRange('A5').formulas = [["=COUNTA('Automation Coverage'!A5:A59)"]];
summary.getRange('C5').formulas = [["=COUNTIF('Automation Coverage'!F5:F59,\"Covered\")"]];
summary.getRange('E5').formulas = [["=COUNTIF('Automation Coverage'!F5:F59,\"Partial\")"]];
summary.getRange('G5').formulas = [["=COUNTIF('Automation Coverage'!F5:F59,\"Absent / blocked\")"]];
summary.getRange('A7:H7').values = [[
  'Before: partial', 34, 'Before: absent', 21, 'New gap tests', 16, 'Targeted new live', '16/16 executed: 10 pass, 6 confirmed defect reds'
]];

summary.mergeCells('A9:H9');
summary.getRange('A9').values = [['Changes applied']];
for (let row = 10; row <= 15; row += 1) {
  summary.mergeCells(`B${row}:C${row}`);
  summary.mergeCells(`D${row}:H${row}`);
}
summary.getRange('A10:H15').values = [
  ['1', 'Added parallel-conversation isolation', null, 'Primary and missing-consent NEG passed live; two tabs stayed isolated and both owned plans were discarded.', null, null, null, null],
  ['2', 'Added live HFSS filtering', null, 'The mixed HFSS/non-HFSS path and missing-consent NEG pass; channel removal, global integrity and cleanup are verified.', null, null, null, null],
  ['3', 'Added Secondary Space coverage', null, 'Seven tests independently cover Base consistency, role metadata, mandatory/optional quantities, Assign all, edit, save/reload and zero gating with verified plan deletion.', null, null, null, null],
  ['4', 'Added reliability fault cases', null, 'Three scoped 503 cases confirm the missing recovery UI; the non-target routing control passes.', null, null, null, null],
  ['5', 'Added large-result integrity', null, 'A live 46-row result retained all 46 selections through the Measurement-to-Hero transition without a fabricated SLO.', null, null, null, null],
  ['6', 'Kept blocked rows honest', null, 'Pricing/calculation, autosave, V1→V2 limits and mixed Secondary Space remain absent until owner contracts and fixtures exist.', null, null, null, null]
];

summary.mergeCells('A17:H17');
summary.getRange('A17').values = [['Hard blockers that code alone cannot remove']];
for (let row = 18; row <= 23; row += 1) {
  summary.mergeCells(`B${row}:H${row}`);
}
summary.getRange('A18:H23').values = [
  ['Data lifecycle', 'Plan deletion is live-proven for owned created plans, but no conversation delete/archive exists; session-shell tests remain explicit opt-in.', null, null, null, null, null, null],
  ['API/readback', 'No approved booking/CRM/audit readback and no second external-role auth state.', null, null, null, null, null, null],
  ['Failure injection', 'Browser GraphQL faults exist; no service-internal autosave/validation timeout, lost-response, replay or concurrency controls.', null, null, null, null, null, null],
  ['Configuration fixtures', 'No approved rate-version/POS/Sampling/Future Brand/training or invalid V1→V2 limit fixtures and decision oracles.', null, null, null, null, null, null],
  ['Accessibility/responsive', 'No approved browser/OS/screen-reader/device matrix or post-entry layout/announcement contract.', null, null, null, null, null, null],
  ['Performance', 'No privacy-approved authenticated collector, stable large-result dataset or numeric percentile SLO.', null, null, null, null, null, null]
];

summary.mergeCells('A25:H25');
summary.getRange('A25').values = [['Interpretation']];
summary.mergeCells('A26:H29');
summary.getRange('A26').values = [[
  'The 395 merged checks are not 395 standalone E2E tests. They are variants and assertions attached to 55 canonical journeys. This update moves meaningful rows from Absent to Partial, including red tests that expose real defects. No row is promoted to Covered until every canonical oracle, role/configuration variant, persistence boundary and cleanup requirement exists. New specs remain pending-review; automation does not forge human sign-off.'
]];

summary.showGridLines = false;
summary.getRange('A1:H1').format = { fill: '#17365D', font: { bold: true, color: '#FFFFFF', size: 18 }, rowHeight: 30 };
summary.getRange('A2:H2').format = { fill: '#F57C00', font: { color: '#FFFFFF' }, rowHeight: 28, wrapText: true };
summary.getRange('A4:H4').format = { fill: '#0E7490', font: { bold: true, color: '#FFFFFF' }, wrapText: true, rowHeight: 28 };
summary.getRange('A5:H5').format = { fill: '#DCE6F1', font: { bold: true, color: '#17365D', size: 18 }, rowHeight: 34 };
summary.getRange('A7:H7').format = { fill: '#FFF2CC', font: { bold: true, color: '#7F6000' }, wrapText: true, rowHeight: 34 };
for (const row of [9, 17, 25]) {
  summary.getRange(`A${row}:H${row}`).format = { fill: '#17365D', font: { bold: true, color: '#FFFFFF' }, rowHeight: 24 };
}
summary.getRange('A10:H15').format = { wrapText: true, verticalAlignment: 'center', rowHeight: 42, borders: { insideHorizontal: { style: 'thin', color: '#D7E3F0' } } };
summary.getRange('A18:H23').format = { wrapText: true, verticalAlignment: 'center', rowHeight: 42, borders: { insideHorizontal: { style: 'thin', color: '#D7E3F0' } } };
summary.getRange('A26:H29').format = { fill: '#EAF2F8', wrapText: true, verticalAlignment: 'top' };
summary.getRange('A26:H29').format.rowHeight = 26;
const summaryWidths = [20, 18, 28, 18, 27, 18, 28, 24];
for (let index = 0; index < summaryWidths.length; index += 1) {
  summary.getRangeByIndexes(0, index, 29, 1).format.columnWidth = summaryWidths[index];
}
summary.freezePanes.freezeRows(2);

await fs.mkdir(outputDir, { recursive: true });

const summaryPreview = await workbook.render({ sheetName: 'Coverage Summary', range: 'A1:H29', scale: 1.2, format: 'png' });
await fs.writeFile(`${outputDir}/coverage-summary.png`, new Uint8Array(await summaryPreview.arrayBuffer()));
const matrixPreview = await workbook.render({ sheetName: 'Automation Coverage', range: 'A1:P16', scale: 0.7, format: 'png' });
await fs.writeFile(`${outputDir}/coverage-matrix-top.png`, new Uint8Array(await matrixPreview.arrayBuffer()));

const exported = await SpreadsheetFile.exportXlsx(workbook);
await exported.save(outputPath);

console.log(outputPath);
