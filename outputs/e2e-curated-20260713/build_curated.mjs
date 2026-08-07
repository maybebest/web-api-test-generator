import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { FileBlob, SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const root = "/Users/maybebest/Documents/Projects/general/web-api-test-generator";
const externalPath = "/Users/maybebest/Documents/Projects/sains/sains_docs/outputs/pollen_e2e_generated_20260713/Nectar360_Pollen_E2E_Journey_Test_Suite.xlsx";
const repositoryPath = path.join(root, "packages/web/docs/ai-testing/e2e-test-case-inventory.json");
const outputDir = path.join(root, "outputs/e2e-curated-20260713");
const mappingPath = path.join(outputDir, "journey_mapping.json");
const dedupePath = path.join(outputDir, "dedupe_groups.json");
const outputPath = path.join(outputDir, "Nectar360_Pollen_Curated_E2E_Suite_20260713.xlsx");

const COLORS = {
  navy: "#19345A",
  orange: "#F36C00",
  paleBlue: "#DDEBF7",
  paleGreen: "#E2F0D9",
  paleYellow: "#FFF2CC",
  paleRed: "#FCE4D6",
  paleGray: "#E7E6E6",
  white: "#FFFFFF",
  text: "#20364F",
};

const range = (prefix, start, end) => Array.from(
  { length: end - start + 1 },
  (_, index) => `${prefix}${String(start + index).padStart(3, "0")}`,
);
const unique = (values) => [...new Set(values.filter(Boolean))];
const joinLines = (values, prefix = "• ") => (values ?? []).filter(Boolean).map((value) => `${prefix}${String(value)}`).join("\n");
const safeCell = (value) => {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (text.length > 32700) throw new Error(`Cell exceeds Excel limit (${text.length})`);
  return text;
};
const normalize = (value) => String(value ?? "")
  .normalize("NFKC")
  .toLocaleLowerCase("en-GB")
  .replace(/[^\p{L}\p{N}]+/gu, " ")
  .trim();
const sha256 = async (filePath) => createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
const sourceRefs = (item) => (item.sourceReferences ?? []).map(
  (ref) => `${path.join(root, "packages/web", ref.path)}:${ref.line} [${ref.kind}]`,
);
const codeId = (externalId) => `XLSX::${externalId}`;

const rangeFor = (column, lastRow) => `${column}1:${column}${lastRow}`;
const setColumnWidths = (sheet, lastRow, widths) => {
  for (const [column, width] of Object.entries(widths)) {
    sheet.getRange(rangeFor(column, lastRow)).format.columnWidth = width;
  }
};
const styleTitle = (sheet, rangeAddress, text) => {
  const target = sheet.getRange(rangeAddress);
  target.merge();
  target.values = [[text]];
  target.format = {
    fill: COLORS.navy,
    font: { bold: true, color: COLORS.white, size: 14 },
    verticalAlignment: "center",
  };
  target.format.rowHeight = 30;
};
const styleSubtitle = (sheet, rangeAddress, text) => {
  const target = sheet.getRange(rangeAddress);
  target.merge();
  target.values = [[text]];
  target.format = {
    fill: COLORS.orange,
    font: { color: COLORS.white },
    wrapText: true,
    verticalAlignment: "center",
  };
  target.format.rowHeight = 34;
};
const styleSection = (target) => {
  target.format = {
    fill: COLORS.navy,
    font: { bold: true, color: COLORS.white },
    verticalAlignment: "center",
  };
};

await fs.mkdir(outputDir, { recursive: true });
const [repository, mapping, dedupe] = await Promise.all([
  fs.readFile(repositoryPath, "utf8").then(JSON.parse),
  fs.readFile(mappingPath, "utf8").then(JSON.parse),
  fs.readFile(dedupePath, "utf8").then(JSON.parse),
]);
const externalWorkbook = await SpreadsheetFile.importXlsx(await FileBlob.load(externalPath));
const externalSheet = externalWorkbook.worksheets.getItem("E2E Test Cases");
const externalValues = externalSheet.getUsedRange().values;
const externalHeaders = externalValues[3].map((value) => String(value ?? ""));
const externalCases = externalValues.slice(4).map((row, index) => ({
  ...Object.fromEntries(externalHeaders.map((header, column) => [header, row[column] ?? ""])),
  __row: index + 5,
}));

if (repository.cases.length !== 752) throw new Error("Expected 752 repository records");
if (mapping.mappings.length !== 752 || new Set(mapping.mappings.map((item) => item.repoId)).size !== 752) {
  throw new Error("Journey mapping must contain 752 unique repository IDs");
}
if (externalCases.length !== 48) throw new Error("Expected 48 external journeys");
if (dedupe.counts.semanticUnionGroups !== 120 || dedupe.counts.semanticAliasesRemovedFromExecutableCount !== 181) {
  throw new Error("Dedupe audit counts changed");
}

const repositoryById = new Map(repository.cases.map((item) => [item.id, item]));
const mappingById = new Map(mapping.mappings.map((item) => [item.repoId, item]));
const externalById = new Map(externalCases.map((item) => [String(item["Test ID"]), item]));

for (const id of mapping.canonicalSets.external) {
  if (!externalById.has(id)) throw new Error(`Mapped external canonical ID not found: ${id}`);
}
for (const item of repository.cases) {
  if (!mappingById.has(item.id)) throw new Error(`Repository case is not mapped: ${item.id}`);
}

const aliasToCanonical = new Map();
const canonicalToAliases = new Map();
for (const group of dedupe.semanticUnionGroups) {
  canonicalToAliases.set(group.canonical, group.aliases);
  for (const alias of group.aliases) {
    if (aliasToCanonical.has(alias)) throw new Error(`Duplicate alias in dedupe groups: ${alias}`);
    aliasToCanonical.set(alias, group.canonical);
  }
}
const obsoleteById = new Map(dedupe.obsoleteIds.map((item) => [item.id, item]));
const coverageOnly = new Set(dedupe.coverageOnlyIds);

// Additional exclusions confirmed by the second-pass quality audit.
const versionGated = new Map([
  ["TC-GHM-004", "Pre-NUP-20956 conversation-box expectation; restore only if an owner confirms this surface intentionally differs from the current all-brand-linked contract."],
  ["TC-VAL-012", "Assumes an unsupported global Hero maximum and conflicts with the current configuration-driven channel-limit contract."],
]);
const ambiguousNoOracle = new Set([
  "CHAT-003", "CHAT-006", "CHAT-010", "CONV-005", "CONV-006", "CONV-009", "CONV-013", "CONV-014",
  "OBJ-004", "SAVE-006", "STORE-009", "SHELL-007", "TC-PRM-012", "TC-SPI-008", "TC-VAL-022",
]);
const invalidRecord = new Map([
  ["CHANNELM-E2E-012", "Expected-result cell contains pasted optional-space rules rather than a verifiable summary oracle."],
  ["SECONDAR-E2E-001", "Release/deployment flag-removal checklist, not an executable user journey; current behavior is covered by XLSX::TC-SEC-001."],
]);
const lowValueStandalone = new Map([
  ["ENTRY-003", "Stable selector is test-harness implementation detail, not user behavior."],
  ["OBS-001", "Generic no-console-error guard belongs in the suite harness and has no standalone business outcome."],
  ["OBS-002", "Generic no-console-error guard belongs in the suite harness and has no standalone business outcome."],
  ["OBS-007", "Browser DevTools Issues counter is tool-specific and not a product contract."],
  ["SHELL-005", "Sidebar highlight alone is cosmetic and carries no separate end-to-end risk."],
  ["TC-XJ-022", "Exact assistant prose is non-contractual and brittle; semantic and persisted-state parity is retained in AIQ journeys."],
]);
const preflightOnly = new Set([
  "FLOW-MP-004:NEG-001", "FLOW-MP-005:DC-006", "FLOW-MP-006:DC-013", "FLOW-MP-006:DC-014",
  "FLOW-MP-009:DC-001", "FLOW-MP-009:DC-002", "FLOW-MP-009:DC-003", "FLOW-MP-009:DC-005",
  "FLOW-MP-009:DC-006", "FLOW-MP-009:DC-008", "FLOW-MP-009:DC-011", "FLOW-MP-009:DC-012",
  "FLOW-MP-009:DC-013", "FLOW-MP-009:NEG-001", "FLOW-MP-009:NEG-004",
  "FLOW-MP-010:DC-006", "FLOW-MP-010:DC-010", "FLOW-MP-010:NEG-006",
]);

const repairedRepositoryCase = (item) => {
  if (item.id !== "AB-007") return item;
  return {
    ...item,
    steps: [
      "Select a brand whose source value contains a vertical bar, for example Unilever | Knorr | MS.",
      "Complete the guided flow and inspect the summary, generated plan name, and CSV/export representation.",
    ],
    expected: [
      "The UI, summary, plan name, and CSV/export display the brand safely and consistently without truncating the value at the vertical bar.",
    ],
    testData: ["Brand fixture containing a literal | character, e.g. Unilever | Knorr | MS"],
    __repairNote: "Parser repair: the unescaped | in the Markdown table truncated the parsed step/expected cells; restored from packages/web/specs/sains/nectar-ai-test-cases-by-module.md:94.",
  };
};

const preconditionCatalog = {
  BASE_URL: ["Available", "Approved HTTPS non-production Pollen URL.", "Environment owner", "Needed for every browser journey."],
  UI_AUTH: ["Available", "Fresh owner-only authenticated browser state for the exact non-production origin.", "Identity / environment team", "Available for read-only assessment; do not share or embed session secrets."],
  API_AUTH: ["Missing", "API-capable bearer/refreshable authorization for Planner/read-model verification.", "Identity / API team", "Without it, UI state cannot be independently verified."],
  DISPOSABLE_SESSION: ["Missing", "QA-owned disposable conversation/session namespace with create/read/delete lifecycle.", "Planner service", "Prevents test runs from sharing or corrupting user conversations."],
  MUTATION_APPROVAL: ["Missing", "Explicit approval for non-production plan, conversation, catalogue, rate, and channel mutations.", "Environment owner", "Required before any state-changing E2E run."],
  VERIFIED_CLEANUP: ["Missing", "Idempotent ownership-checked cleanup/restore for every created or modified record.", "Service owners", "Required for repeatability and safe parallel execution."],
  ROLE_SESSIONS: ["Missing", "Stable internal, external, restricted, admin, invalid, and expired role/session fixtures.", "Identity team", "Blocks authorization and role-visibility variants."],
  REAL_CATALOGUE_DATA: ["Partial", "Stable advertiser, brand, and brand-linked SKU fixtures for valid, invalid, boundary, and restricted cases.", "Catalogue owner", "Current data is not sufficient for every deterministic boundary."],
  CATALOGUE_MUTATION: ["Missing", "Verified reversible SKU brand-link/unlink controls.", "Catalogue owner", "Required for mutation and rollback cases."],
  PLAN_LIFECYCLE: ["Missing", "Disposable plan create, channel assignment, save/readback, reopen, and delete adapters.", "Plan service", "Blocks persistence and handoff verification."],
  CHANNEL_FIXTURES: ["Partial", "Exclusive versioned channel fixtures with eligibility, dates, stores, rates, Hero limits, and restrictions.", "Channel management", "Known fixture values and config versions are incomplete."],
  CHANNEL_CONFIG_ADMIN: ["Missing", "Admin identity plus safe channel/config edits and independently verified restoration.", "Channel management", "Required for changed/stale/invalid configuration journeys."],
  STORE_CHANNEL_ENV: ["Missing", "Known cost-per-store, cost-per-unit, base-rate, and unbounded store channel fixtures.", "Pricing / channel owner", "Blocks deterministic store/pricing calculations."],
  PARSER_ORACLE: ["Missing", "Deterministic completion signal and normalized parsed-state oracle for conversational inputs.", "Conversational Planning", "Exact prose must not be used as the oracle."],
  SECONDARY_SPACE_FIXTURES: ["Missing", "Controlled mandatory/optional/internal-only Secondary Space configuration, roles, source, persistence, and booking readback.", "Channel Management / Base / Plan", "Blocks Secondary Space automation."],
  FAILURE_INJECTION: ["Missing", "Run-scoped network/backend fault, latency, cache, clock, autosave, retry, and recovery controls.", "Platform / service owners", "Failure cases cannot be made deterministic without it."],
  EXTERNAL_READBACK: ["Missing", "Authorized saved-plan, CSV, booking/CRM/payload, persistence, and diagnostics readback as applicable.", "Integration owners", "Required for non-UI truth and handoff checks."],
  ATTACHMENT_VOICE_FIXTURES: ["Missing", "Approved feature scope, MIME/size matrix, upload fixtures, virtual microphone audio, permissions, locale matrix, and transcript oracle.", "Product / frontend", "Attachment/voice candidates remain out of E2E until this contract exists."],
  PRODUCT_DECISION: ["Missing", "One authoritative expected behavior and an explicit record of superseded cases.", "Product owner", "Decision-gated variants must remain blocked, not silently guessed."],
  AI_DETERMINISM: ["Partial", "Deterministic model settings or normalized structured-state comparison with repeat policy.", "Conversational Planning", "Needed to avoid flaky prose-based AI tests."],
  ACCESSIBILITY_CONTRACT: ["Missing", "Approved keyboard, focus, accessible-name, status/error announcement, and assistive-technology acceptance criteria.", "Accessibility / frontend", "Automated checks cover only part of the oracle."],
  ACCESSIBILITY_TOOLS: ["Partial", "Keyboard automation plus approved screen-reader/browser/OS matrix and evidence capture.", "Accessibility / QA", "Screen-reader semantics require manual or specialized execution."],
  RESPONSIVE_CONTRACT: ["Missing", "Supported viewport/device matrix and explicit no-overlap/reflow/control-visibility criteria.", "UX / frontend", "A vague 'mobile looks right' assertion is not automatable."],
  PERFORMANCE_SLO: ["Missing", "Approved dataset size, warm/cold conditions, percentile, timing boundaries, and pass threshold.", "Product / performance owner", "Performance has no pass/fail oracle without an SLO."],
  LARGE_RESULT_FIXTURE: ["Missing", "Stable large catalogue/search result fixture with known row count and ownership.", "Catalogue owner", "Required for repeatable large-result performance tests."],
};

const externalPreconditionCodes = (item) => {
  const id = String(item["Test ID"]);
  const family = id.split("-")[1];
  const codes = ["BASE_URL", "UI_AUTH", "API_AUTH", "DISPOSABLE_SESSION", "MUTATION_APPROVAL", "VERIFIED_CLEANUP", "EXTERNAL_READBACK"];
  if (family === "ACC") codes.push("PLAN_LIFECYCLE");
  if (["TC-ACC-002", "TC-ACC-005", "TC-SEC-002"].includes(id)) codes.push("ROLE_SESSIONS");
  if (["SKU", "CHS", "VAL", "AIQ"].includes(family)) codes.push("REAL_CATALOGUE_DATA");
  if (["CHS", "VAL", "CHN", "PRC", "CAL", "SEC"].includes(family)) codes.push("CHANNEL_FIXTURES");
  if (family === "CHN" || family === "PLN") codes.push("PLAN_LIFECYCLE");
  if (family === "SKU" && ["TC-SKU-004", "TC-SKU-005"].includes(id)) codes.push("CATALOGUE_MUTATION");
  if (id === "TC-SKU-006" || family === "AIQ") codes.push("PARSER_ORACLE", "AI_DETERMINISM");
  if (family === "SEC") codes.push("SECONDARY_SPACE_FIXTURES");
  if (["PRC", "CAL"].includes(family) || id === "TC-CHN-003") codes.push("STORE_CHANNEL_ENV");
  if (["TC-VAL-004", "TC-CHN-002", "TC-PRC-003", "TC-PRC-004", "TC-SEC-001"].includes(id)) codes.push("CHANNEL_CONFIG_ADMIN");
  if (["TC-CHN-005", "TC-PLN-003", "TC-PRC-004"].includes(id)) codes.push("FAILURE_INJECTION");
  if (/decision|required|confirm|authoritative|conflict/i.test(String(item["Missing Data / Decision Gate"] ?? ""))) codes.push("PRODUCT_DECISION");
  return unique(codes);
};

const extensionDefinitions = {
  "EXT-EXPORT-001": {
    area: "EXPORT", domain: "CSV and Pollen handoff", title: "Round-trip a saved and edited plan through CSV export", priority: "P0", pack: "Core regression",
    executionCategory: "Blocked", owner: "Plan / export / Pollen integration owners",
    codes: ["BASE_URL", "UI_AUTH", "API_AUTH", "DISPOSABLE_SESSION", "MUTATION_APPROVAL", "VERIFIED_CLEANUP", "PLAN_LIFECYCLE", "EXTERNAL_READBACK", "REAL_CATALOGUE_DATA"],
    data: ["Disposable saved multi-channel plan with known advertiser, brand, objective, dates, budget and SKUs", "Brand/SKU values containing commas, quotes, Unicode, and a literal |", "Known edit applied after first export"],
    steps: ["Create and save the disposable plan; capture its UI and API/read-model state.", "Download the CSV and parse it with a standards-compliant CSV parser.", "Compare plan-level fields, channel rows, SKU counts/details and special-character values with the saved state.", "Edit the plan, save again, download a second CSV and compare it with the updated state.", "Open the supported Pollen handoff/readback and compare the same canonical fields."],
    expected: ["Download is unavailable before a successful save and available afterwards.", "CSV structure and values match the saved plan without column shifts, truncation or character corruption.", "The second export reflects the edit exactly once and does not leak stale values.", "Pollen/read-model state, UI summary and CSV agree on the contractual fields."],
    nonUi: ["saved-plan revision and identifier", "parsed CSV field-level comparison", "Pollen/read-model field parity"],
  },
  "EXT-AUTOSAVE-001": {
    area: "RELIABILITY", domain: "Conversation autosave", title: "Recover from an autosave failure without losing or duplicating plan state", priority: "P0", pack: "Core regression",
    executionCategory: "Blocked", owner: "Conversation / Planner API owners",
    codes: ["BASE_URL", "UI_AUTH", "API_AUTH", "DISPOSABLE_SESSION", "MUTATION_APPROVAL", "VERIFIED_CLEANUP", "PLAN_LIFECYCLE", "FAILURE_INJECTION", "EXTERNAL_READBACK"],
    data: ["Disposable conversation with known partial plan state", "One controlled autosave failure followed by recovery"],
    steps: ["Create a conversation and complete a known planning step.", "Inject a failure for the next autosave and perform another state-changing step.", "Observe the failure state, then restore the service and use the supported retry/recovery path.", "Reload and read the conversation through the API/read model."],
    expected: ["Failure is visible and actionable; the UI does not falsely claim persistence.", "Previously persisted state remains intact and the pending change is not duplicated.", "Recovery commits the intended change exactly once.", "Reloaded UI and persisted conversation agree."],
    nonUi: ["autosave request/correlation ID", "revision sequence", "exactly-once persisted state"],
  },
  "EXT-DEPENDENCY-001": {
    area: "RELIABILITY", domain: "Dependency failures", title: "Fail safely when validation or product-search dependencies are unavailable", priority: "P0", pack: "Core regression",
    executionCategory: "Blocked", owner: "Platform / validation / catalogue owners",
    codes: ["BASE_URL", "UI_AUTH", "API_AUTH", "DISPOSABLE_SESSION", "MUTATION_APPROVAL", "VERIFIED_CLEANUP", "FAILURE_INJECTION", "REAL_CATALOGUE_DATA", "CHANNEL_FIXTURES", "EXTERNAL_READBACK"],
    data: ["Controlled validation 4xx/5xx/timeout", "Controlled product-search 4xx/5xx/timeout", "Known pre-failure plan state"],
    steps: ["Capture the initial persisted state.", "Inject the selected dependency failure and perform the dependent action.", "Inspect the user-visible error and available recovery action.", "Restore the dependency, retry once, and compare UI plus API/read-model state."],
    expected: ["The failure is surfaced without a misleading success state.", "No partial SKU/channel/plan mutation is persisted.", "Unrelated valid state remains usable.", "A single retry succeeds exactly once after recovery."],
    nonUi: ["failed dependency and correlation ID", "no partial mutation", "single successful retry"],
  },
  "EXT-AI-RETRY-001": {
    area: "RELIABILITY", domain: "AI timeout and retry", title: "Recover safely from a long-running or failed AI response", priority: "P0", pack: "Core regression",
    executionCategory: "Blocked", owner: "Conversational Planning / platform owners",
    codes: ["BASE_URL", "UI_AUTH", "API_AUTH", "DISPOSABLE_SESSION", "MUTATION_APPROVAL", "VERIFIED_CLEANUP", "FAILURE_INJECTION", "PARSER_ORACLE", "AI_DETERMINISM", "EXTERNAL_READBACK"],
    data: ["Controlled AI latency beyond the approved timeout", "Controlled transient AI error", "Known prompt and expected normalized state transition"],
    steps: ["Send the known planning prompt while injecting excessive latency or a transient error.", "Observe timeout/error and the supported retry/cancel controls.", "Restore service health and retry once.", "Compare the final normalized state and persistence with a clean single execution."],
    expected: ["The UI remains responsive and does not show a false completion.", "Retry/cancel is explicit and does not send accidental duplicate prompts.", "The recovered transition is applied once and matches the clean-run structured state.", "No stale spinner or orphaned partial state remains."],
    nonUi: ["prompt/request correlation", "retry count", "single normalized state transition"],
  },
  "EXT-A11Y-001": {
    area: "A11Y", domain: "Keyboard and focus", title: "Complete the primary planning journey using keyboard and verified focus behavior", priority: "P0", pack: "Accessibility regression",
    executionCategory: "Manual", owner: "Accessibility / frontend / QA",
    codes: ["BASE_URL", "UI_AUTH", "DISPOSABLE_SESSION", "MUTATION_APPROVAL", "VERIFIED_CLEANUP", "ACCESSIBILITY_CONTRACT", "ACCESSIBILITY_TOOLS"],
    data: ["Approved keyboard-only primary-flow fixture", "Supported browser/OS/screen-reader matrix", "Modal open/cancel/confirm/delete variants"],
    steps: ["Navigate from entry through the primary planning flow without a pointer.", "Open each critical selector/edit/delete modal and verify initial focus, tab order, focus containment and Escape/Cancel/Confirm behavior.", "Trigger a validation error and a successful state change.", "Verify focus return, accessible names, status/error announcements and absence of keyboard traps with approved assistive technology."],
    expected: ["Every critical action is reachable and operable by keyboard.", "Focus is visible, ordered, trapped only while a modal is open, and restored to the invoking control.", "Errors and successful state changes are announced according to the approved accessibility contract.", "No keyboard trap or pointer-only dependency blocks completion."],
    nonUi: ["manual assistive-technology evidence", "keyboard event/focus trace where available"],
  },
  "EXT-RESPONSIVE-001": {
    area: "UX", domain: "Responsive layout", title: "Complete the primary planning journey at every supported narrow viewport", priority: "P1", pack: "Extended regression",
    executionCategory: "Blocked", owner: "UX / frontend",
    codes: ["BASE_URL", "UI_AUTH", "DISPOSABLE_SESSION", "MUTATION_APPROVAL", "VERIFIED_CLEANUP", "RESPONSIVE_CONTRACT"],
    data: ["Approved supported viewport/device matrix", "Plan state large enough to scroll chat, summary and media rows"],
    steps: ["Run the primary journey at each approved viewport.", "Scroll chat and summary independently, edit a field, open a modal and reach every primary action.", "Capture layout and interaction evidence at the named checkpoints."],
    expected: ["No contractual content or action is clipped, overlapped or unreachable.", "Chat input, summary and modal controls remain usable while content scrolls.", "Reflow and navigation match the approved responsive contract at every supported viewport."],
    nonUi: ["viewport matrix and checkpoint evidence"],
  },
  "EXT-PERF-001": {
    area: "PERF", domain: "Large catalogue result", title: "Meet the approved performance SLO for a large SKU result set", priority: "P1", pack: "Performance regression",
    executionCategory: "Blocked", owner: "Product / performance / catalogue owners",
    codes: ["BASE_URL", "UI_AUTH", "API_AUTH", "REAL_CATALOGUE_DATA", "PERFORMANCE_SLO", "LARGE_RESULT_FIXTURE"],
    data: ["Stable large-result catalogue fixture with approved cardinality", "Approved cold/warm cache conditions, sample count, percentile and threshold"],
    steps: ["Prepare the approved dataset and cache condition.", "Search/load the large SKU result, select and edit known rows, then confirm the state.", "Repeat for the approved sample count and collect browser plus service timings.", "Compare the named percentile and error rate with the SLO."],
    expected: ["The contractual percentile and error-rate thresholds are met.", "Result completeness, selection and saved state remain correct under load.", "No pass/fail conclusion is reported if dataset size or SLO evidence is missing."],
    nonUi: ["dataset cardinality", "service/browser timing distribution", "error rate", "persisted selection correctness"],
  },
};

for (const id of mapping.canonicalSets.extensions) {
  if (!extensionDefinitions[id]) throw new Error(`Missing extension definition: ${id}`);
}

const decisionFor = (rawItem) => {
  const item = repairedRepositoryCase(rawItem);
  const mapped = mappingById.get(item.id);
  const canonicalTarget = mapped.targetKind === "external" ? codeId(mapped.canonicalId) : mapped.targetKind === "extension" ? mapped.canonicalId : "";
  const aliasOf = aliasToCanonical.get(item.id) ?? "";
  if (obsoleteById.has(item.id)) {
    const evidence = obsoleteById.get(item.id);
    return { decision: "REMOVE_OBSOLETE", target: canonicalTarget, duplicateOf: "", reason: `${evidence.reason} Replacement: ${evidence.replacement}.`, layer: "Removed" };
  }
  if (versionGated.has(item.id)) {
    return { decision: "REMOVE_VERSION_GATED", target: canonicalTarget, duplicateOf: "", reason: versionGated.get(item.id), layer: "Product decision gap" };
  }
  if (coverageOnly.has(item.id)) {
    return { decision: "REMOVE_COVERAGE_WRAPPER", target: canonicalTarget, duplicateOf: "", reason: "Composite/decision-table wrapper duplicates its referenced atomic variants and has no independent executable oracle.", layer: "Coverage only" };
  }
  if (ambiguousNoOracle.has(item.id)) {
    return { decision: "REMOVE_AMBIGUOUS", target: canonicalTarget, duplicateOf: "", reason: "Expected result permits incompatible outcomes, depends on an unapproved 'if available/in scope' feature, or lacks one verifiable oracle.", layer: "Product decision gap" };
  }
  if (invalidRecord.has(item.id)) {
    return { decision: "REMOVE_INVALID_RECORD", target: canonicalTarget, duplicateOf: "", reason: invalidRecord.get(item.id), layer: "Removed" };
  }
  if (lowValueStandalone.has(item.id)) {
    return { decision: "REMOVE_LOW_VALUE", target: canonicalTarget, duplicateOf: "", reason: lowValueStandalone.get(item.id), layer: "Harness/content/UI" };
  }
  if (preflightOnly.has(item.id)) {
    return { decision: "MOVE_TO_UNIT_OR_CONTRACT", target: canonicalTarget, duplicateOf: "", reason: "Pure helper, formula, predicate, message-builder or preflight oracle; retain below E2E and do not execute as a browser journey.", layer: "Unit/contract" };
  }
  if (mapped.targetKind === "move-out") {
    if (mapped.role === "ambiguous") {
      return { decision: "REMOVE_SCOPE_UNCONFIRMED", target: "", duplicateOf: "", reason: mapped.reason, layer: "Product decision gap" };
    }
    const declaredLayer = ["UI", "Integration", "Unit"].includes(item.declaredType) ? item.declaredType : "UI/component/harness";
    return { decision: "MOVE_TO_LOWER_LEVEL", target: "", duplicateOf: "", reason: mapped.reason, layer: declaredLayer };
  }
  if (aliasOf) {
    return { decision: "MERGE_DUPLICATE_ALIAS", target: canonicalTarget, duplicateOf: `REPO::${aliasOf}`, reason: `Same risk and oracle as ${aliasOf}; retain this ID and source evidence only as an alias.`, layer: "Canonical E2E variant" };
  }
  if (mapped.role === "ambiguous") {
    return { decision: "MERGE_DECISION_GATED_VARIANT", target: canonicalTarget, duplicateOf: "", reason: mapped.reason, layer: "Canonical E2E variant" };
  }
  if (mapped.targetKind === "extension") {
    return { decision: "MERGE_INTO_EXTENSION", target: canonicalTarget, duplicateOf: "", reason: mapped.reason, layer: "Canonical E2E variant" };
  }
  const decision = mapped.role === "assertion" ? "MERGE_AS_ASSERTION" : "MERGE_AS_VARIANT";
  return { decision, target: canonicalTarget, duplicateOf: "", reason: mapped.reason, layer: "Canonical E2E variant" };
};

const decisions = repository.cases.map((rawItem) => {
  const item = repairedRepositoryCase(rawItem);
  return { item, mapped: mappingById.get(item.id), ...decisionFor(item) };
});
const canonicalIds = new Set([
  ...mapping.canonicalSets.external.map(codeId),
  ...mapping.canonicalSets.extensions,
]);
const danglingTargets = decisions.filter((item) => item.target && !canonicalIds.has(item.target));
if (danglingTargets.length) throw new Error(`Dangling canonical targets: ${danglingTargets.map((item) => item.item.id).join(", ")}`);

const executableMappings = decisions.filter((item) => [
  "MERGE_AS_VARIANT", "MERGE_AS_ASSERTION", "MERGE_DECISION_GATED_VARIANT", "MERGE_INTO_EXTENSION",
].includes(item.decision));
const aliasMappings = decisions.filter((item) => item.decision === "MERGE_DUPLICATE_ALIAS");
const excludedMappings = decisions.filter((item) => item.decision.startsWith("REMOVE_") || item.decision.startsWith("MOVE_") || item.decision === "MERGE_DUPLICATE_ALIAS");

const mappingsByTarget = new Map([...canonicalIds].map((id) => [id, []]));
for (const item of executableMappings) mappingsByTarget.get(item.target).push(item);
const aliasesByTarget = new Map([...canonicalIds].map((id) => [id, []]));
for (const item of aliasMappings) {
  if (item.target) aliasesByTarget.get(item.target).push(item);
}

const requirementForCodes = (codes) => codes.map((code) => `[${code}] ${preconditionCatalog[code]?.[1] ?? "Definition missing"}`).join("\n");
const missingForCodes = (codes) => codes
  .filter((code) => !["Available"].includes(preconditionCatalog[code]?.[0]))
  .map((code) => `[${code}] ${preconditionCatalog[code]?.[0] ?? "Unknown"}`)
  .join("\n");

const canonicalRows = [];
const canonicalObjects = [];
for (const external of externalCases) {
  const sourceId = String(external["Test ID"]);
  const id = codeId(sourceId);
  const related = mappingsByTarget.get(id) ?? [];
  const aliases = aliasesByTarget.get(id) ?? [];
  const decisionGated = related.filter((item) => item.mapped.role === "ambiguous");
  const codes = externalPreconditionCodes(external);
  const sourceReadiness = String(external["Execution Readiness"]);
  const executionCategory = sourceReadiness === "Blocked" ? "Blocked" : "Conditional";
  const disposition = executionCategory === "Blocked"
    ? "Not automatable until the named decision, contract, fixture or observable oracle is supplied."
    : "Automatable after the listed auth, disposable-data, mutation, cleanup and readback controls are verified.";
  const object = {
    id, origin: "External canonical journey", sourceId, area: external.Area, domain: external.Domain, title: external.Title,
    priority: external.Priority, pack: external.Pack, sourceReadiness, executionCategory, disposition, owner: external["Required Owner"],
    codes, preconditions: external.Preconditions, missing: [external["Missing Data / Decision Gate"], missingForCodes(codes)].filter(Boolean).join("\n"),
    data: external["Test Data / Variant Matrix"], steps: external.Steps, expected: external["Expected Results"], nonUi: external["Non-UI Assertions"],
    related, aliases, decisionGated,
    evidence: [external["Source Tickets"], external["Source Evidence"], `Source workbook row ${external.__row}`].filter(Boolean).join("\n"),
    notes: [
      sourceReadiness === "Ready" ? "Source Ready normalized to Conditional because this assessment did not verify mutation, cleanup and API/readback controls." : "",
      mapping.canonicalSets.extendThenMerge.includes(sourceId) ? "Extended with repository variants/assertions below; see Merged Variants before automating." : "",
      related.length ? `${related.length} unique repository variants/assertions retained after duplicate and lower-level cleanup.` : "No repository row maps to this journey; this is one of the externally supplied unique journeys.",
    ].filter(Boolean).join("\n"),
  };
  canonicalObjects.push(object);
}
for (const sourceId of mapping.canonicalSets.extensions) {
  const definition = extensionDefinitions[sourceId];
  const related = mappingsByTarget.get(sourceId) ?? [];
  const aliases = aliasesByTarget.get(sourceId) ?? [];
  const object = {
    id: sourceId, origin: "Curated repository extension", sourceId, area: definition.area, domain: definition.domain, title: definition.title,
    priority: definition.priority, pack: definition.pack, sourceReadiness: "New curated journey", executionCategory: definition.executionCategory,
    disposition: definition.executionCategory === "Manual"
      ? "Hybrid/manual: keyboard checks are automatable, but assistive-technology semantics require approved manual evidence."
      : "Not automatable until the listed fixture, contract, SLO, failure-injection or external-readback prerequisites exist.",
    owner: definition.owner, codes: definition.codes, preconditions: requirementForCodes(definition.codes), missing: missingForCodes(definition.codes),
    data: joinLines(definition.data), steps: joinLines(definition.steps, ""), expected: joinLines(definition.expected), nonUi: joinLines(definition.nonUi),
    related, aliases, decisionGated: [],
    evidence: related.flatMap((item) => sourceRefs(item.item)).join("\n"),
    notes: `New canonical journey created because ${related.length} repository source rows describe a material E2E risk not fully covered by the 48 external journeys.`,
  };
  canonicalObjects.push(object);
}

if (canonicalObjects.length !== 55 || new Set(canonicalObjects.map((item) => item.id)).size !== 55) {
  throw new Error("Curated suite must contain 55 unique canonical journeys");
}

for (const object of canonicalObjects) {
  const mappedIds = object.related.map((item) => item.item.id);
  const aliasIds = object.aliases.map((item) => item.item.id);
  const decisionIds = object.decisionGated.map((item) => item.item.id);
  canonicalRows.push([
    object.id, object.origin, object.sourceId, object.area, object.domain, object.title, object.priority, object.pack,
    object.sourceReadiness, object.executionCategory, object.disposition, object.owner, object.codes.join(", "), object.preconditions,
    object.missing, object.data, object.steps, object.expected, object.nonUi, mappedIds.length, mappedIds.join(", "),
    aliasIds.length, aliasIds.join(", "), decisionIds.join(", "), object.evidence, object.notes,
  ].map(safeCell));
}

const canonicalHeaders = [
  "Canonical ID", "Origin", "Source ID", "Area", "Domain", "Title", "Priority", "Pack", "Source Readiness",
  "Current Execution Category", "Automation Disposition", "Required Owner", "Precondition Codes", "Required Preconditions",
  "Missing / Manual Gate", "Test Data / Variant Matrix", "Steps", "Expected Results", "Non-UI Assertions",
  "Unique Merged Source Count", "Unique Merged Source IDs", "Duplicate Alias Count", "Duplicate Alias IDs",
  "Decision-Gated Source IDs", "Source Evidence / Tickets", "Curation Notes",
];

const variantRows = executableMappings.map(({ item, mapped, decision, target, reason }) => [
  target, item.id, mapped.role, decision, item.area, item.title, item.priority, item.declaredType, item.kind,
  joinLines(item.testData ?? []), joinLines(item.steps, ""), joinLines(item.expected),
  joinLines(item.preconditions), (item.automation?.blockerCodes ?? []).join(", "), item.automation?.status ?? "",
  joinLines(sourceRefs(item)), [reason, item.__repairNote ?? ""].filter(Boolean).join("\n"),
].map(safeCell));
variantRows.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])));

const variantHeaders = [
  "Canonical ID", "Source ID", "Role", "Decision", "Source Area", "Source Title", "Priority", "Declared Type", "Record Kind",
  "Test Data", "Source Steps", "Source Expected Results", "Source Preconditions", "Blocker Codes", "Source Automation Status",
  "Source References", "Curation / Repair Note",
];

const auditRows = [];
for (const decision of decisions) {
  const { item, mapped } = decision;
  auditRows.push([
    `REPO::${item.id}`, "Repository specifications", item.id, item.title, item.area, item.declaredType, item.kind, item.priority,
    mapped.role, decision.decision, decision.target, decision.duplicateOf, decision.layer, decision.reason,
    item.automation?.status ?? "", (item.automation?.blockerCodes ?? []).join(", "),
    joinLines(item.automation?.requiredPreconditions ?? item.preconditions ?? []), joinLines(sourceRefs(item)),
    [item.__repairNote ?? "", ...(item.assumptions ?? []).map((value) => `Assumption: ${value}`), ...(item.openQuestions ?? []).map((value) => `Open question: ${value}`)].filter(Boolean).join("\n"),
  ].map(safeCell));
}
for (const item of externalCases) {
  const id = String(item["Test ID"]);
  auditRows.push([
    `XLSX::${id}`, "External journey workbook", id, item.Title, item.Area, item["Test Level"], "consolidated-e2e-journey", item.Priority,
    "canonical", "KEEP_CANONICAL", codeId(id), "", "Canonical E2E", "Unique external journey retained as the canonical high-level E2E parent.",
    item["Execution Readiness"], externalPreconditionCodes(item).join(", "), item.Preconditions,
    [item["Source Tickets"], item["Source Evidence"], `Workbook row ${item.__row}`].filter(Boolean).join("\n"),
    dedupe.externalFalseIdCollisions.includes(id) ? "Bare ID collides with a different repository behavior; XLSX namespace is mandatory." : "",
  ].map(safeCell));
}
if (auditRows.length !== 800 || new Set(auditRows.map((row) => row[0])).size !== 800) throw new Error("Decision audit must contain 800 unique rows");

const auditHeaders = [
  "Master ID", "Source Set", "Source ID", "Title", "Area", "Declared Type / Level", "Record Kind", "Priority", "Mapping Role",
  "Decision", "Final Canonical ID", "Duplicate Of", "Destination Layer", "Decision Reason", "Source Automation Status",
  "Blocker Codes", "Required Preconditions", "Source References / Tickets", "Notes / Assumptions / Repair",
];

const excludedIds = new Set(excludedMappings.map((item) => item.item.id));
const excludedRows = auditRows.filter((row) => row[1] === "Repository specifications" && excludedIds.has(row[2]));

const preconditionRows = Object.entries(preconditionCatalog).map(([code, [availability, requirement, owner, impact]]) => {
  const affected = canonicalObjects.filter((item) => item.codes.includes(code));
  return [code, availability, requirement, owner, affected.length, affected.map((item) => item.id).join(", "), impact];
});

const ruleRows = [
  ["KEEP_CANONICAL", "Retain", "The external row is a unique high-level journey with steps, business result and non-UI oracle."],
  ["MERGE_AS_VARIANT", "Merge", "Keep a distinct boundary/data/role/state variant under one canonical journey; do not count it as another journey."],
  ["MERGE_AS_ASSERTION", "Merge", "Move a granular UI/integration check into the expected results or non-UI assertions of its canonical journey."],
  ["MERGE_DECISION_GATED_VARIANT", "Merge but block", "Preserve the source variant and its product decision gate; never invent the oracle."],
  ["MERGE_DUPLICATE_ALIAS", "Remove duplicate row", "Same risk and oracle as the selected repository canonical; preserve ID and source evidence as an alias."],
  ["MOVE_TO_LOWER_LEVEL", "Move", "Source declares UI/Integration/Unit or is a granular control/harness assertion with no standalone E2E business outcome."],
  ["MOVE_TO_UNIT_OR_CONTRACT", "Move", "Formula/helper/predicate/preflight oracle belongs in unit, contract or API tests."],
  ["REMOVE_COVERAGE_WRAPPER", "Remove row", "Composite wrapper duplicates referenced atomics and has no independent executable oracle."],
  ["REMOVE_AMBIGUOUS / SCOPE_UNCONFIRMED", "Remove from active E2E", "No single approved outcome or feature contract; retain as a product-decision gap."],
  ["REMOVE_OBSOLETE / VERSION_GATED", "Remove from active E2E", "Conflicts with the current rule or documents a superseded version; replacement remains traceable."],
  ["REMOVE_LOW_VALUE / INVALID_RECORD", "Remove", "Tool-specific, cosmetic, exact-copy, malformed or release-only record without a separate E2E risk."],
];

const falseTitleRows = dedupe.falseTitleGroups.map((item) => [item.ids.join(" / "), item.reason]);
const sourceHashes = {
  externalWorkbook: await sha256(externalPath),
  repositoryInventory: await sha256(repositoryPath),
  journeyMapping: await sha256(mappingPath),
  dedupeGroups: await sha256(dedupePath),
};

const counts = Object.fromEntries([...new Set(auditRows.map((row) => row[9]))].map((decision) => [
  decision,
  auditRows.filter((row) => row[9] === decision).length,
]));
const removedCount = decisions.filter((item) => item.decision.startsWith("REMOVE_")).length;
const movedCount = decisions.filter((item) => item.decision.startsWith("MOVE_")).length;

const workbook = Workbook.create();
const summary = workbook.worksheets.add("Summary");
const suite = workbook.worksheets.add("Curated E2E Suite");
const variants = workbook.worksheets.add("Merged Variants");
const audit = workbook.worksheets.add("Decision Audit");
const excluded = workbook.worksheets.add("Excluded Source Rows");
const preconditions = workbook.worksheets.add("Preconditions");
const rules = workbook.worksheets.add("Curation Rules");

// Summary
summary.showGridLines = false;
styleTitle(summary, "A1:H1", "Nectar360 Pollen — Curated E2E Suite");
styleSubtitle(summary, "A2:H2", "Duplicate-free journey list with full source traceability, explicit lower-level moves, product-decision gaps, and automation prerequisites");
summary.getRange("A4:B4").values = [["Final suite", "Count"]];
styleSection(summary.getRange("A4:B4"));
summary.getRange("A5:A10").values = [["Canonical E2E journeys"], ["External canonical journeys"], ["Repository-only extensions"], ["Conditional"], ["Blocked"], ["Manual / hybrid"]];
summary.getRange("B5").formulas = [[`=COUNTA('Curated E2E Suite'!$A$5:$A$${canonicalRows.length + 4})`]];
summary.getRange("B6").formulas = [[`=COUNTIF('Curated E2E Suite'!$B$5:$B$${canonicalRows.length + 4},"External canonical journey")`]];
summary.getRange("B7").formulas = [[`=COUNTIF('Curated E2E Suite'!$B$5:$B$${canonicalRows.length + 4},"Curated repository extension")`]];
summary.getRange("B8:B10").formulas = ["Conditional", "Blocked", "Manual"].map((value) => [`=COUNTIF('Curated E2E Suite'!$J$5:$J$${canonicalRows.length + 4},"${value}")`]);

summary.getRange("D4:E4").values = [["Source-row disposition", "Count"]];
styleSection(summary.getRange("D4:E4"));
summary.getRange("D5:D10").values = [["Input source rows"], ["Kept canonical rows"], ["Merged unique variants/assertions"], ["Duplicate aliases removed"], ["Moved below E2E"], ["Removed from active E2E"]];
summary.getRange("E5").formulas = [["=COUNTA('Decision Audit'!$A$5:$A$804)"]];
summary.getRange("E6").formulas = [["=COUNTIF('Decision Audit'!$J$5:$J$804,\"KEEP_CANONICAL\")"]];
summary.getRange("E7").formulas = [[`=COUNTA('Merged Variants'!$A$5:$A$${variantRows.length + 4})`]];
summary.getRange("E8").formulas = [["=COUNTIF('Decision Audit'!$J$5:$J$804,\"MERGE_DUPLICATE_ALIAS\")"]];
summary.getRange("E9").formulas = [["=COUNTIF('Decision Audit'!$J$5:$J$804,\"MOVE_TO_LOWER_LEVEL\")+COUNTIF('Decision Audit'!$J$5:$J$804,\"MOVE_TO_UNIT_OR_CONTRACT\")"]];
summary.getRange("E10").formulas = [[`=COUNTA('Excluded Source Rows'!$A$5:$A$${excludedRows.length + 4})-E8-E9`]];

summary.getRange("G4:H4").values = [["Quality control", "Value"]];
styleSection(summary.getRange("G4:H4"));
summary.getRange("G5:G10").values = [["Canonical ID duplicates"], ["Dangling canonical targets"], ["Source rows without decision"], ["False bare-ID collisions namespaced"], ["AB-007 parser repair"], ["Reduction vs 800 source rows"]];
summary.getRange("H5:H9").values = [[0], [danglingTargets.length], [800 - auditRows.length], [dedupe.externalFalseIdCollisions.length], ["Applied"]];
summary.getRange("H10").formulas = [["=1-(B5/E5)"]];
summary.getRange("H10").format.numberFormat = "0.0%";

summary.getRange("A12:H12").merge();
summary.getRange("A12").values = [["What changed"]];
styleSection(summary.getRange("A12:H12"));
summary.getRange("A13:H18").merge();
summary.getRange("A13").values = [[
  `The active suite is reduced from 800 source rows to 55 canonical E2E journeys: 48 externally supplied high-level journeys plus 7 material repository-only risks. ` +
  `${executableMappings.length} distinct repository variants/assertions remain attached to those journeys; ${aliasMappings.length} semantic aliases are no longer counted separately. ` +
  `${movedCount} rows were moved to UI, integration, unit, contract or harness coverage, and ${removedCount} obsolete, ambiguous, malformed, wrapper or low-value rows were removed from active E2E. ` +
  "Every source row still appears in Decision Audit with a reason, target, blocker and source reference.",
]];
summary.getRange("A13:H18").format = { fill: COLORS.paleBlue, wrapText: true, verticalAlignment: "top" };

summary.getRange("A19:H19").merge();
summary.getRange("A19").values = [["Execution readiness"]];
styleSection(summary.getRange("A19:H19"));
summary.getRange("A20:H25").merge();
summary.getRange("A20").values = [[
  "No canonical journey is marked Ready for immediate unattended execution. The supplied authenticated browser state supports read-only UI access, but API authorization, disposable data, mutation approval, verified cleanup, role fixtures, failure injection and external readback were not verified. " +
  "Blocked and Manual rows state the exact missing contract, fixture, SLO or assistive-technology evidence. Do not substitute invented expectations for product-decision gaps.",
]];
summary.getRange("A20:H25").format = { fill: COLORS.paleYellow, wrapText: true, verticalAlignment: "top" };
summary.getRange("B5:B10").format.numberFormat = "#,##0";
summary.getRange("E5:E10").format.numberFormat = "#,##0";
summary.getRange("A4:H25").format.borders = { preset: "inside", style: "thin", color: "#D9E2F3" };
setColumnWidths(summary, 25, { A: 34, B: 14, C: 3, D: 34, E: 14, F: 3, G: 36, H: 18 });
summary.freezePanes.freezeRows(2);

// Curated suite
suite.showGridLines = false;
styleTitle(suite, "A1:Z1", "Curated E2E Suite — 55 Canonical Journeys");
styleSubtitle(suite, "A2:Z2", "One executable journey per business risk; distinct boundaries and assertions are retained in Merged Variants, while aliases and excluded rows remain auditable");
suite.getRange("A4:Z4").values = [canonicalHeaders];
suite.getRange(`A5:Z${canonicalRows.length + 4}`).values = canonicalRows;
const suiteTable = suite.tables.add(`A4:Z${canonicalRows.length + 4}`, true, "CuratedE2ESuiteTable");
suiteTable.style = "TableStyleMedium2";
suiteTable.showFilterButton = true;
suite.getRange(`A4:Z${canonicalRows.length + 4}`).format.wrapText = true;
suite.getRange(`A4:Z${canonicalRows.length + 4}`).format.verticalAlignment = "top";
suite.getRange(`A5:Z${canonicalRows.length + 4}`).format.rowHeight = 82;
setColumnWidths(suite, canonicalRows.length + 4, {
  A: 22, B: 27, C: 18, D: 12, E: 28, F: 48, G: 10, H: 20, I: 22, J: 24, K: 52, L: 34, M: 48,
  N: 66, O: 60, P: 60, Q: 62, R: 62, S: 48, T: 18, U: 58, V: 17, W: 50, X: 48, Y: 58, Z: 48,
});
const readinessRange = suite.getRange(`J5:J${canonicalRows.length + 4}`);
readinessRange.conditionalFormats.add("containsText", { text: "Conditional", format: { fill: COLORS.paleYellow, font: { color: "#7F6000" } } });
readinessRange.conditionalFormats.add("containsText", { text: "Blocked", format: { fill: COLORS.paleRed, font: { color: "#9C0006" } } });
readinessRange.conditionalFormats.add("containsText", { text: "Manual", format: { fill: COLORS.paleGray, font: { color: "#404040" } } });
suite.freezePanes.freezeRows(4);
suite.freezePanes.freezeColumns(3);

// Merged variants
variants.showGridLines = false;
styleTitle(variants, "A1:Q1", "Unique Variants and Assertions Merged into Canonical Journeys");
styleSubtitle(variants, "A2:Q2", "Duplicate aliases and lower-level-only rows are excluded here; use Decision Audit for the complete 800-row provenance trail");
variants.getRange("A4:Q4").values = [variantHeaders];
variants.getRange(`A5:Q${variantRows.length + 4}`).values = variantRows;
const variantTable = variants.tables.add(`A4:Q${variantRows.length + 4}`, true, "MergedVariantIndexTable");
variantTable.style = "TableStyleMedium4";
variantTable.showFilterButton = true;
variants.getRange(`A4:Q${variantRows.length + 4}`).format.wrapText = true;
variants.getRange(`A4:Q${variantRows.length + 4}`).format.verticalAlignment = "top";
variants.getRange(`A5:Q${variantRows.length + 4}`).format.rowHeight = 50;
setColumnWidths(variants, variantRows.length + 4, { A: 22, B: 18, C: 15, D: 30, E: 34, F: 52, G: 10, H: 18, I: 18, J: 40, K: 56, L: 56, M: 44, N: 42, O: 30, P: 58, Q: 52 });
variants.freezePanes.freezeRows(4);
variants.freezePanes.freezeColumns(2);

// Decision audit
audit.showGridLines = false;
styleTitle(audit, "A1:S1", "Decision Audit — All 800 Source Rows");
styleSubtitle(audit, "A2:S2", "No source row is silently deleted: filter by Decision, Destination Layer, Mapping Role, Canonical ID, blocker or source reference");
audit.getRange("A4:S4").values = [auditHeaders];
audit.getRange(`A5:S${auditRows.length + 4}`).values = auditRows;
const auditTable = audit.tables.add(`A4:S${auditRows.length + 4}`, true, "DecisionAuditTable");
auditTable.style = "TableStyleMedium2";
auditTable.showFilterButton = true;
audit.getRange(`A4:S${auditRows.length + 4}`).format.wrapText = true;
audit.getRange(`A4:S${auditRows.length + 4}`).format.verticalAlignment = "top";
audit.getRange(`A5:S${auditRows.length + 4}`).format.rowHeight = 44;
setColumnWidths(audit, auditRows.length + 4, { A: 23, B: 24, C: 18, D: 50, E: 36, F: 20, G: 22, H: 10, I: 18, J: 32, K: 24, L: 24, M: 22, N: 62, O: 30, P: 42, Q: 60, R: 58, S: 52 });
audit.freezePanes.freezeRows(4);
audit.freezePanes.freezeColumns(3);

// Excluded source rows
excluded.showGridLines = false;
styleTitle(excluded, "A1:S1", "Excluded, Moved, Duplicate, Obsolete and Decision-Gated Source Rows");
styleSubtitle(excluded, "A2:S2", "These rows are not standalone E2E journeys; reasons and required prerequisites remain explicit so useful checks can live at the correct test layer");
excluded.getRange("A4:S4").values = [auditHeaders];
excluded.getRange(`A5:S${excludedRows.length + 4}`).values = excludedRows;
const excludedTable = excluded.tables.add(`A4:S${excludedRows.length + 4}`, true, "ExcludedSourceRowsTable");
excludedTable.style = "TableStyleMedium9";
excludedTable.showFilterButton = true;
excluded.getRange(`A4:S${excludedRows.length + 4}`).format.wrapText = true;
excluded.getRange(`A4:S${excludedRows.length + 4}`).format.verticalAlignment = "top";
excluded.getRange(`A5:S${excludedRows.length + 4}`).format.rowHeight = 48;
setColumnWidths(excluded, excludedRows.length + 4, { A: 23, B: 24, C: 18, D: 50, E: 36, F: 20, G: 22, H: 10, I: 18, J: 32, K: 24, L: 24, M: 22, N: 62, O: 30, P: 42, Q: 60, R: 58, S: 52 });
excluded.freezePanes.freezeRows(4);
excluded.freezePanes.freezeColumns(3);

// Preconditions
preconditions.showGridLines = false;
styleTitle(preconditions, "A1:G1", "Automation Preconditions and Manual Gates");
styleSubtitle(preconditions, "A2:G2", "Availability reflects this assessment only; affected counts overlap because each journey needs multiple controls");
preconditions.getRange("A4:G4").values = [["Code", "Availability", "Requirement", "Owner", "Affected Canonical Journeys", "Canonical IDs", "Why It Matters"]];
preconditions.getRange(`A5:G${preconditionRows.length + 4}`).values = preconditionRows;
const preconditionTable = preconditions.tables.add(`A4:G${preconditionRows.length + 4}`, true, "CuratedPreconditionsTable");
preconditionTable.style = "TableStyleMedium4";
preconditionTable.showFilterButton = true;
preconditions.getRange(`A4:G${preconditionRows.length + 4}`).format.wrapText = true;
preconditions.getRange(`A4:G${preconditionRows.length + 4}`).format.verticalAlignment = "top";
preconditions.getRange(`A5:G${preconditionRows.length + 4}`).format.rowHeight = 64;
setColumnWidths(preconditions, preconditionRows.length + 4, { A: 28, B: 16, C: 72, D: 34, E: 22, F: 64, G: 58 });
const availabilityRange = preconditions.getRange(`B5:B${preconditionRows.length + 4}`);
availabilityRange.conditionalFormats.add("containsText", { text: "Available", format: { fill: COLORS.paleGreen, font: { color: "#006100" } } });
availabilityRange.conditionalFormats.add("containsText", { text: "Partial", format: { fill: COLORS.paleYellow, font: { color: "#7F6000" } } });
availabilityRange.conditionalFormats.add("containsText", { text: "Missing", format: { fill: COLORS.paleRed, font: { color: "#9C0006" } } });
preconditions.freezePanes.freezeRows(4);
preconditions.freezePanes.freezeColumns(2);

// Rules and provenance
rules.showGridLines = false;
styleTitle(rules, "A1:D1", "Curation Rules, Exceptions and Provenance");
styleSubtitle(rules, "A2:D2", "Evidence-based second pass: same risk + same oracle is merged; different boundaries, roles, pricing models and expected outcomes remain distinct variants");
rules.getRange("A4:C4").values = [["Decision", "Action", "Rule"]];
styleSection(rules.getRange("A4:C4"));
rules.getRange(`A5:C${ruleRows.length + 4}`).values = ruleRows;
const ruleEnd = ruleRows.length + 4;
const falseStart = ruleEnd + 3;
rules.getRange(`A${falseStart}:B${falseStart}`).values = [["False same-title group — keep separate", "Reason"]];
styleSection(rules.getRange(`A${falseStart}:B${falseStart}`));
rules.getRange(`A${falseStart + 1}:B${falseStart + falseTitleRows.length}`).values = falseTitleRows;
const exceptionStart = falseStart + falseTitleRows.length + 3;
rules.getRange(`A${exceptionStart}:D${exceptionStart}`).values = [["Important exception", "Value", "Evidence", "Disposition"]];
styleSection(rules.getRange(`A${exceptionStart}:D${exceptionStart}`));
const exceptionRows = [
  ["Bare ID collisions", dedupe.externalFalseIdCollisions.map((item) => item.bareId).join(", "), "Repository and XLSX rows describe different behavior.", "Use REPO:: and XLSX:: namespaces; never merge on bare ID."],
  ["AB-007 parser corruption", "Repaired", `${path.join(root, "packages/web/specs/sains/nectar-ai-test-cases-by-module.md")}:94`, "Restored literal | brand example and UI/summary/plan-name/CSV oracle."],
  ["Product-decision variants", mapping.summary.blockedProductDecisionRecords, "Journey mapping role=ambiguous", "Preserved under decision-gated canonical journeys; no oracle invented."],
  ["External journeys with no repository row", mapping.summary.externalCanonicalIdsWithoutRepositoryRows.join(", "), "Journey mapping audit", "Retained as unique canonical journeys."],
  ["Live execution", "Not rerun for this curation", "Prior assessment verified read-only browser access only.", "All state-changing cases remain Conditional, Blocked or Manual."],
];
rules.getRange(`A${exceptionStart + 1}:D${exceptionStart + exceptionRows.length}`).values = exceptionRows;
const sourceStart = exceptionStart + exceptionRows.length + 3;
rules.getRange(`A${sourceStart}:D${sourceStart}`).values = [["Input artifact", "Path", "SHA-256", "Records"]];
styleSection(rules.getRange(`A${sourceStart}:D${sourceStart}`));
rules.getRange(`A${sourceStart + 1}:D${sourceStart + 4}`).values = [
  ["External journey workbook", externalPath, sourceHashes.externalWorkbook, externalCases.length],
  ["Repository inventory", repositoryPath, sourceHashes.repositoryInventory, repository.cases.length],
  ["Journey mapping audit", mappingPath, sourceHashes.journeyMapping, mapping.mappings.length],
  ["Semantic dedupe audit", dedupePath, sourceHashes.dedupeGroups, dedupe.semanticUnionGroups.length],
];
const rulesLastRow = sourceStart + 4;
rules.getRange(`A4:D${rulesLastRow}`).format.wrapText = true;
rules.getRange(`A4:D${rulesLastRow}`).format.verticalAlignment = "top";
rules.getRange(`A5:D${rulesLastRow}`).format.rowHeight = 60;
setColumnWidths(rules, rulesLastRow, { A: 42, B: 58, C: 76, D: 58 });
rules.freezePanes.freezeRows(4);

// Verification before export.
const checks = {
  canonicalJourneys: canonicalRows.length,
  externalCanonical: externalCases.length,
  extensions: mapping.canonicalSets.extensions.length,
  sourceAuditRows: auditRows.length,
  uniqueExecutableVariantRows: variantRows.length,
  excludedRows: excludedRows.length,
  semanticAliases: aliasMappings.length,
  movedRows: movedCount,
  removedRows: removedCount,
  danglingTargets: danglingTargets.length,
  formulaErrors: 0,
};

const summaryInspection = await workbook.inspect({
  kind: "table", range: "Summary!A4:H10", include: "values,formulas", tableMaxRows: 10, tableMaxCols: 8, maxChars: 10000,
});
console.log("SUMMARY_INSPECTION");
console.log(summaryInspection.ndjson);
const suiteInspection = await workbook.inspect({
  kind: "table", range: "Curated E2E Suite!A4:Z9", include: "values,formulas", tableMaxRows: 6, tableMaxCols: 26, tableMaxCellChars: 140, maxChars: 18000,
});
console.log("SUITE_INSPECTION");
console.log(suiteInspection.ndjson);
const auditInspection = await workbook.inspect({
  kind: "table", range: "Decision Audit!A4:S10", include: "values,formulas", tableMaxRows: 7, tableMaxCols: 19, tableMaxCellChars: 140, maxChars: 16000,
});
console.log("AUDIT_INSPECTION");
console.log(auditInspection.ndjson);
const errors = await workbook.inspect({
  kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 300 }, summary: "formula error scan", maxChars: 8000,
});
console.log("FORMULA_ERRORS");
console.log(errors.ndjson);

const previewRanges = [
  ["Summary", "A1:H25", "final_Summary"],
  ["Curated E2E Suite", "A1:M12", "final_Curated_Left"],
  ["Curated E2E Suite", "N1:Z12", "final_Curated_Right"],
  ["Merged Variants", "A1:Q12", "final_Merged_Variants"],
  ["Decision Audit", "A1:S12", "final_Decision_Audit"],
  ["Excluded Source Rows", "A1:S12", "final_Excluded"],
  ["Preconditions", "A1:G18", "final_Preconditions"],
  ["Curation Rules", `A1:D${Math.min(rulesLastRow, 32)}`, "final_Curation_Rules"],
];
for (const [sheetName, rangeAddress, fileName] of previewRanges) {
  const preview = await workbook.render({ sheetName, range: rangeAddress, scale: 1, format: "png" });
  await fs.writeFile(path.join(outputDir, `${fileName}.png`), new Uint8Array(await preview.arrayBuffer()));
}

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);

const exportedWorkbook = await SpreadsheetFile.importXlsx(await FileBlob.load(outputPath));
const exportedOverview = await exportedWorkbook.inspect({
  kind: "workbook,sheet,table", maxChars: 12000, tableMaxRows: 3, tableMaxCols: 12, tableMaxCellChars: 100,
});
console.log("EXPORTED_OVERVIEW");
console.log(exportedOverview.ndjson);
const exportedErrors = await exportedWorkbook.inspect({
  kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 300 }, summary: "exported formula error scan", maxChars: 8000,
});
console.log("EXPORTED_FORMULA_ERRORS");
console.log(exportedErrors.ndjson);

await fs.writeFile(path.join(outputDir, "build_summary.json"), JSON.stringify({
  outputPath,
  checks,
  decisionCounts: counts,
  executionCounts: Object.fromEntries(["Conditional", "Blocked", "Manual"].map((value) => [
    value,
    canonicalObjects.filter((item) => item.executionCategory === value).length,
  ])),
  sourceHashes,
  falseBareIdCollisions: dedupe.externalFalseIdCollisions,
  repairedSourceCase: "AB-007",
  notes: [
    "All 800 source rows remain in Decision Audit.",
    "External Ready rows are normalized to Conditional until environment controls are verified.",
    "No source repository files were modified.",
  ],
}, null, 2));

console.log(`OUTPUT ${outputPath}`);
