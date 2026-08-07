import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { FileBlob, SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const sourcePath = "/Users/maybebest/Documents/Projects/sains/sains_docs/outputs/pollen_e2e_generated_20260713/Nectar360_Pollen_E2E_Journey_Test_Suite.xlsx";
const repositoryPath = "/Users/maybebest/Documents/Projects/general/web-api-test-generator/packages/web/docs/ai-testing/e2e-test-case-inventory.json";
const outputDir = "/Users/maybebest/Documents/Projects/general/web-api-test-generator/outputs/e2e-master-20260713";
const outputPath = path.join(outputDir, "Nectar360_Pollen_Complete_E2E_Master_List_20260713.xlsx");

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

const joinItems = (items, prefix = "• ") => (items ?? []).filter(Boolean).map((item) => `${prefix}${String(item)}`).join("\n");
const safeCell = (value) => {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (text.length > 32700) throw new Error(`Cell content exceeds Excel limit: ${text.length} characters`);
  return text;
};
const normalizeTitle = (value) => String(value ?? "")
  .normalize("NFKC")
  .toLocaleLowerCase("en-GB")
  .replace(/[^\p{L}\p{N}]+/gu, " ")
  .trim();
const sha256 = async (filePath) => createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
const rangeFor = (column, lastRow) => `${column}1:${column}${lastRow}`;
const setColumnWidths = (sheet, lastRow, widths) => {
  for (const [column, width] of Object.entries(widths)) {
    sheet.getRange(rangeFor(column, lastRow)).format.columnWidth = width;
  }
};
const styleTitle = (sheet, range, text) => {
  const titleRange = sheet.getRange(range);
  titleRange.merge();
  titleRange.values = [[text]];
  titleRange.format = {
    fill: COLORS.navy,
    font: { bold: true, color: COLORS.white },
    verticalAlignment: "center",
  };
  titleRange.format.rowHeight = 30;
};
const styleSubtitle = (sheet, range, text) => {
  const subtitleRange = sheet.getRange(range);
  subtitleRange.merge();
  subtitleRange.values = [[text]];
  subtitleRange.format = {
    fill: COLORS.orange,
    font: { color: COLORS.white },
    wrapText: true,
    verticalAlignment: "center",
  };
  subtitleRange.format.rowHeight = 30;
};
const styleSectionHeader = (range) => {
  range.format = {
    fill: COLORS.navy,
    font: { bold: true, color: COLORS.white },
    verticalAlignment: "center",
  };
};

await fs.mkdir(outputDir, { recursive: true });

const sourceBlob = await FileBlob.load(sourcePath);
const sourceWorkbook = await SpreadsheetFile.importXlsx(sourceBlob);
const repositoryInventory = JSON.parse(await fs.readFile(repositoryPath, "utf8"));

const sourceCaseSheet = sourceWorkbook.worksheets.getItem("E2E Test Cases");
const sourceCaseValues = sourceCaseSheet.getUsedRange().values;
const sourceHeaders = sourceCaseValues[3].map((value) => String(value ?? ""));
const externalCases = sourceCaseValues.slice(4).map((row, index) => {
  const record = Object.fromEntries(sourceHeaders.map((header, column) => [header, row[column] ?? ""]));
  record.__sourceRow = index + 5;
  return record;
});

const fixtureSheet = sourceWorkbook.worksheets.getItem("Test Data Fixtures");
const fixtureValues = fixtureSheet.getUsedRange().values;
const fixtureHeaders = fixtureValues[3].map((value) => String(value ?? ""));
const externalFixtures = fixtureValues.slice(4).map((row, index) => ({
  ...Object.fromEntries(fixtureHeaders.map((header, column) => [header, row[column] ?? ""])),
  __sourceRow: index + 5,
}));

const sourceInventorySheet = sourceWorkbook.worksheets.getItem("Source Inventory");
const sourceInventoryValues = sourceInventorySheet.getUsedRange().values;
const sourceInventoryHeaders = sourceInventoryValues[3].map((value) => String(value ?? ""));
const sourceInventoryRows = sourceInventoryValues.slice(4).map((row) => Object.fromEntries(
  sourceInventoryHeaders.map((header, column) => [header, row[column] ?? ""]),
));

const traceabilitySheet = sourceWorkbook.worksheets.getItem("Traceability");
const traceabilityValues = traceabilitySheet.getUsedRange().values;
const traceabilityHeaders = traceabilityValues[3].map((value) => String(value ?? ""));
const traceabilityRows = traceabilityValues.slice(4).map((row) => Object.fromEntries(
  traceabilityHeaders.map((header, column) => [header, row[column] ?? ""]),
));

const repositoryIds = new Set(repositoryInventory.cases.map((item) => item.id));
const externalJourneyIds = new Set(externalCases.map((item) => String(item["Test ID"])));
const repositoryTitles = new Map();
for (const item of repositoryInventory.cases) {
  const key = normalizeTitle(item.title);
  if (!repositoryTitles.has(key)) repositoryTitles.set(key, []);
  repositoryTitles.get(key).push(item.id);
}

const externalSourceIds = externalCases.flatMap((item) => String(item["Source Case IDs"] ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean));
const uniqueExternalSourceIds = new Set(externalSourceIds);
const exactSourceIdMatches = [...uniqueExternalSourceIds].filter((id) => repositoryIds.has(id));
const externalJourneyIdCollisions = externalCases
  .filter((item) => repositoryIds.has(String(item["Test ID"])))
  .map((item) => String(item["Test ID"]));
const exactExternalTitleMatches = externalCases.flatMap((item) => {
  const matches = repositoryTitles.get(normalizeTitle(item.Title)) ?? [];
  return matches.map((repositoryId) => ({ externalId: item["Test ID"], repositoryId }));
});

const extractTickets = (value) => [...new Set(String(value ?? "").match(/NUP-\d+/g) ?? [])];
const referencedExternalTickets = new Set(externalCases.flatMap((item) => extractTickets(item["Source Tickets"])));
const inventoriedExternalTickets = new Set(sourceInventoryRows.flatMap((item) => extractTickets(item["Issue IDs"])));
const missingExternalTicketSources = [...referencedExternalTickets]
  .filter((ticket) => !inventoriedExternalTickets.has(ticket))
  .sort();

const traceabilityByJourney = new Map([...externalJourneyIds].map((id) => [id, []]));
const danglingTraceabilityIds = [];
let traceabilityReferenceCount = 0;
for (const item of traceabilityRows) {
  const ids = String(item["Final Test IDs"] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  traceabilityReferenceCount += ids.length;
  for (const id of ids) {
    if (!traceabilityByJourney.has(id)) {
      danglingTraceabilityIds.push(id);
      continue;
    }
    traceabilityByJourney.get(id).push(String(item["Requirement / Rule"] ?? ""));
  }
}

if (repositoryInventory.cases.length !== 752) throw new Error("Repository inventory count changed; review merge assumptions");
if (externalCases.length !== 48) throw new Error("External journey count changed; review merge assumptions");
if (externalSourceIds.length !== 316 || uniqueExternalSourceIds.size !== 316) throw new Error("External atomic-check references changed or are duplicated");
if (exactSourceIdMatches.length !== 0 || exactExternalTitleMatches.length !== 0) throw new Error("A deterministic cross-source match now exists; review before merging");
if (missingExternalTicketSources.join(",") !== "NUP-18835,NUP-18922,NUP-18945,NUP-19104,NUP-20820,NUP-21160") {
  throw new Error(`External missing-source inventory changed: ${missingExternalTicketSources.join(", ")}`);
}
if (traceabilityRows.length !== 123 || traceabilityReferenceCount !== 168 || danglingTraceabilityIds.length !== 0 || [...traceabilityByJourney.values()].some((rules) => rules.length === 0)) {
  throw new Error("External traceability must contain 123 rules, 168 valid references, and cover all 48 journeys");
}

const strongOverlapIds = new Set([
  "TC-ACC-001", "TC-ACC-003", "TC-ACC-004", "TC-ACC-005",
  "TC-SKU-001", "TC-SKU-002", "TC-SKU-003", "TC-SKU-007",
  "TC-CHS-001", "TC-CHS-002", "TC-CHS-003", "TC-CHS-004",
  "TC-VAL-001", "TC-VAL-002", "TC-CHN-001", "TC-CHN-003", "TC-CHN-004",
  "TC-PLN-001", "TC-PLN-002", "TC-SEC-001", "TC-SEC-002", "TC-SEC-003", "TC-SEC-004", "TC-SEC-005",
  "TC-PRC-001", "TC-PRC-002", "TC-CAL-005",
]);
const partialOverlapIds = new Set([
  "TC-ACC-002", "TC-SKU-004", "TC-SKU-005", "TC-SKU-006", "TC-VAL-003", "TC-VAL-004",
  "TC-CHN-005", "TC-PLN-003", "TC-SEC-006", "TC-SEC-007", "TC-PRC-003", "TC-PRC-004",
  "TC-CAL-006", "TC-AIQ-001", "TC-AIQ-002", "TC-AIQ-003",
]);
const materiallyNewIds = new Set(["TC-CHN-002", "TC-CAL-001", "TC-CAL-002", "TC-CAL-003", "TC-CAL-004"]);
const semanticAssessment = (id) => {
  if (strongOverlapIds.has(id)) return "Strong semantic overlap candidate — retain until assertions and canonical mappings are reconciled";
  if (partialOverlapIds.has(id)) return "Partial overlap candidate — contains additional variants or assertions";
  if (materiallyNewIds.has(id)) return "Materially new journey family relative to the repository inventory";
  throw new Error(`Missing semantic assessment for external journey ${id}`);
};
if (strongOverlapIds.size !== 27 || partialOverlapIds.size !== 16 || materiallyNewIds.size !== 5) {
  throw new Error("External semantic classification must cover 27 strong, 16 partial, and 5 materially new journeys");
}

const mapRepositoryExecution = (status) => {
  const mapping = {
    automatable: ["Ready", "Automatable with the currently recorded baseline prerequisites."],
    "automated-live-unverified": ["Implemented, live unverified", "Automation exists, but authenticated live behavior has not been verified."],
    "automatable-execution-blocked": ["Conditional", "Automatable after the listed execution prerequisites are provided."],
    "blocked-test-data": ["Conditional", "Automatable after controlled test data or fixtures are provided."],
    "blocked-observability-or-contract": ["Blocked", "Cannot be automated reliably until the required contract or observable oracle exists."],
    "blocked-product-decision": ["Blocked", "Cannot be automated until one authoritative expected behavior is approved."],
    "manual-release-or-integration": ["Manual", "Requires manual release evidence or an external integration check that is not currently automatable."],
    "duplicate-or-composite": ["Composite only", "Composite or duplicate record; do not count as additional atomic coverage."],
  };
  return mapping[status] ?? ["Unassessed", `Unrecognized repository automation status: ${status}`];
};

const repositoryRows = repositoryInventory.cases.map((item) => {
  const [executionCategory, disposition] = mapRepositoryExecution(item.automation.status);
  const sourceReferences = item.sourceReferences.map((ref) => `${ref.path}:${ref.line} [${ref.kind}]`);
  const formalMappings = item.formalMappings.map((mapping) => {
    const caseId = mapping.dataCaseId ?? mapping.negativeCaseId ?? "";
    return `${mapping.flowId}${caseId ? `:${caseId}` : ""} -> ${mapping.specPath}`;
  });
  const missing = [
    ...(item.automation.missingCodes ?? []).map((code) => `[${code}]`),
    ...(item.automation.blockerDetails ?? []),
    ...(item.openQuestions ?? []),
  ];
  const notes = [
    ...(item.assumptions ?? []).map((value) => `Assumption: ${value}`),
    ...(item.automationNotes ?? []).map((value) => `Automation: ${value}`),
    ...formalMappings.map((value) => `Formal mapping: ${value}`),
  ];
  return [
    `REPO::${item.id}`,
    "Repository specifications",
    item.id,
    item.kind,
    item.area,
    "",
    item.title,
    item.priority,
    item.declaredType,
    "",
    item.automation.status,
    disposition,
    executionCategory,
    item.implementation.status,
    "",
    joinItems(item.preconditions),
    joinItems(missing),
    joinItems(item.testData ?? []),
    joinItems(item.steps, ""),
    joinItems(item.expected),
    "",
    joinItems(sourceReferences),
    joinItems(item.composedCaseIds ?? [], ""),
    joinItems(item.duplicateTitleCandidates ?? [], ""),
    "Retained canonical repository record",
    joinItems(notes),
  ].map(safeCell);
});

const externalRows = externalCases.map((item) => {
  const sourceReadiness = String(item["Execution Readiness"]);
  const executionCategory = sourceReadiness === "Blocked" ? "Blocked" : "Conditional";
  const disposition = sourceReadiness === "Blocked"
    ? "Cannot be automated until the named product decision, contract, or observable oracle is approved."
    : sourceReadiness === "Conditional"
      ? "Automatable after the named data, environment capability, or decision gate is recorded."
      : "Source-backed oracle exists, but this assessment has not verified the required standard fixtures and mutation/cleanup controls.";
  const externalId = String(item["Test ID"]);
  const overlapNote = semanticAssessment(externalId);
  const unavailableSources = extractTickets(item["Source Tickets"]).filter((ticket) => missingExternalTicketSources.includes(ticket));
  const requirementRules = traceabilityByJourney.get(externalId) ?? [];
  return [
    `XLSX::${externalId}`,
    "External journey workbook",
    externalId,
    "consolidated-e2e-journey",
    item.Area,
    item.Domain,
    item.Title,
    item.Priority,
    item["Test Level"],
    item.Pack,
    sourceReadiness,
    disposition,
    executionCategory,
    "unassessed",
    item["Required Owner"],
    item.Preconditions,
    item["Missing Data / Decision Gate"],
    item["Test Data / Variant Matrix"],
    item.Steps,
    item["Expected Results"],
    item["Non-UI Assertions"],
    [item["Source Tickets"], item["Source Evidence"], `Workbook row ${item.__sourceRow}`].filter(Boolean).join("\n"),
    item["Source Case IDs"],
    overlapNote,
    repositoryIds.has(externalId)
      ? "Retained separately — local Test ID collides with a different repository behavior"
      : "Retained separately — no deterministic cross-source merge key",
    [
      item.Techniques ? `Techniques: ${item.Techniques}` : "",
      item["Automation Notes"] ? `Automation: ${item["Automation Notes"]}` : "",
      item.Status ? `Status: ${item.Status}` : "",
      item.Tags ? `Tags: ${item.Tags}` : "",
      unavailableSources.length ? `Referenced source unavailable in workbook inventory: ${unavailableSources.join(", ")}` : "",
      `Traceability rules (${requirementRules.length}): ${requirementRules.join("; ")}`,
    ].filter(Boolean).join("\n"),
  ].map(safeCell);
});

const masterHeaders = [
  "Master ID", "Source Set", "Source ID", "Record Type", "Area", "Domain", "Title", "Priority",
  "Test Level", "Pack", "Source Readiness", "Automation Disposition", "Execution Category",
  "Implementation Status", "Required Owner", "Preconditions", "Missing Data / Decision Gate",
  "Test Data / Variants", "Steps", "Expected Results", "Non-UI Assertions", "Source References / Tickets",
  "Covered Case IDs", "Duplicate / Overlap Candidates", "Merge Disposition", "Notes / Automation Notes",
];
const masterRows = [...repositoryRows, ...externalRows];
if (masterRows.length !== 800 || new Set(masterRows.map((row) => row[0])).size !== 800) {
  throw new Error("Master list must contain 800 uniquely identified records");
}

const duplicateTitleGroups = [...repositoryTitles.entries()]
  .filter(([, ids]) => ids.length > 1)
  .map(([normalizedTitle, ids]) => {
    const title = repositoryInventory.cases.find((item) => item.id === ids[0])?.title ?? normalizedTitle;
    return [title, ids.length, ids.join(", "), "Candidate only — variants and expected results must be compared manually"];
  })
  .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
if (duplicateTitleGroups.length !== 32) throw new Error("Repository duplicate-title group count changed");

const preconditionCounts = Object.fromEntries(Object.keys(repositoryInventory.preconditionBundles).map((code) => [
  code,
  repositoryInventory.cases.filter((item) => item.automation.blockerCodes.includes(code)).length,
]));
const repositoryPreconditions = Object.entries(repositoryInventory.preconditionBundles).map(([code, item]) => [
  "Repository inventory",
  code,
  "",
  "",
  item.availability,
  item.requirement,
  preconditionCounts[code],
]);
const externalPreconditions = externalFixtures.map((item) => {
  const requirement = String(item["Required Fixture Contract"] ?? "");
  const affected = externalCases.filter((testCase) => String(testCase.Preconditions ?? "").includes(requirement)).length;
  return [
    "External journey workbook",
    item["Gate / Data ID"],
    item.Category,
    item.Owner,
    item.Readiness,
    requirement,
    affected,
  ];
});
const preconditionHeaders = ["Source Set", "Code", "Category", "Owner", "Availability / Readiness", "Requirement", "Affected Master Records"];
const preconditionRows = [...repositoryPreconditions, ...externalPreconditions].map((row) => row.map(safeCell));

const sourceHash = await sha256(sourcePath);
const repositoryHash = await sha256(repositoryPath);
const sourceSummaryRows = [
  ...Object.entries(repositoryInventory.scope.sourceCounts).map(([source, count]) => ["Repository specification", source, count, "Explicit source rows; normalization may merge or expand records"]),
  ["External workbook", sourcePath, externalCases.length, `48 consolidated journeys referencing ${externalSourceIds.length} unique atomic check IDs`],
  ["External traceability", "Traceability!A5:E127", traceabilityRows.length, `${traceabilityReferenceCount} valid journey references; all 48 journeys covered; no dangling IDs`],
  ["External source audit", "Referenced-but-unavailable ticket artifacts", missingExternalTicketSources.length, missingExternalTicketSources.join(", ")],
];

const workbook = Workbook.create();
// Create every worksheet before assigning cross-sheet formulas.
const summary = workbook.worksheets.add("Summary");
const master = workbook.worksheets.add("Master E2E Tests");
const preconditions = workbook.worksheets.add("Preconditions");
const merge = workbook.worksheets.add("Merge Analysis");
const sources = workbook.worksheets.add("Source Summary");

// Summary
summary.showGridLines = false;
styleTitle(summary, "A1:H1", "Nectar360 Pollen — Complete E2E Master List");
styleSubtitle(summary, "A2:H2", "One master list from repository specifications and Nectar360_Pollen_E2E_Journey_Test_Suite.xlsx | no unverified semantic merges");

summary.getRange("A4:B4").values = [["Master record counts", "Value"]];
styleSectionHeader(summary.getRange("A4:B4"));
summary.getRange("A5:A10").values = [
  ["Total master records"],
  ["Repository records"],
  ["External consolidated journeys"],
  ["Atomic + negative records"],
  ["Composite/consolidated journeys"],
  ["External atomic checks referenced"],
];
summary.getRange("B5:B9").formulas = [
  ["=COUNTA('Master E2E Tests'!$A$5:$A$804)"],
  ["=COUNTIF('Master E2E Tests'!$B$5:$B$804,\"Repository specifications\")"],
  ["=COUNTIF('Master E2E Tests'!$B$5:$B$804,\"External journey workbook\")"],
  ["=COUNTIF('Master E2E Tests'!$D$5:$D$804,\"atomic\")+COUNTIF('Master E2E Tests'!$D$5:$D$804,\"negative\")"],
  ["=COUNTIF('Master E2E Tests'!$D$5:$D$804,\"composite-journey\")+COUNTIF('Master E2E Tests'!$D$5:$D$804,\"consolidated-e2e-journey\")"],
];
summary.getRange("B10").values = [[externalSourceIds.length]];

summary.getRange("D4:E4").values = [["Execution category", "Records"]];
styleSectionHeader(summary.getRange("D4:E4"));
const executionCategories = ["Ready", "Implemented, live unverified", "Conditional", "Blocked", "Manual", "Composite only"];
summary.getRange("D5:D10").values = executionCategories.map((value) => [value]);
summary.getRange("E5:E10").formulas = executionCategories.map((value) => [
  `=COUNTIF('Master E2E Tests'!$M$5:$M$804,\"${value}\")`,
]);

summary.getRange("G4:H4").values = [["Merge analysis", "Value"]];
styleSectionHeader(summary.getRange("G4:H4"));
summary.getRange("G5:G10").values = [
  ["Confirmed hard merges"],
  ["External journey ID collisions"],
  ["External source-case ID matches"],
  ["Exact normalized title matches"],
  ["Repository duplicate-title groups"],
  ["Unique external atomic-check IDs"],
];
summary.getRange("H5:H10").values = [[0], [externalJourneyIdCollisions.length], [exactSourceIdMatches.length], [exactExternalTitleMatches.length], [duplicateTitleGroups.length], [uniqueExternalSourceIds.size]];

summary.getRange("A12:H12").merge();
summary.getRange("A12").values = [["Interpretation"]];
styleSectionHeader(summary.getRange("A12:H12"));
summary.getRange("A13:H18").merge();
summary.getRange("A13").values = [[
  "The final master list contains 800 records: all 752 repository records plus 48 externally supplied consolidated E2E journeys. " +
  "The external workbook also names 316 unique atomic check IDs, but it does not provide those checks as standalone rows with independent steps and expected results, so they are retained as coverage references inside their parent journeys rather than inflated into 316 additional tests. " +
  "Four local journey IDs collide with repository IDs but describe different behavior, while no external source-case ID or normalized title exactly matches a repository record. " +
  "Conservative review found 27 strong overlap candidates, 16 partial overlaps with additional checks, and 5 materially new journey families. None is a proven full duplicate, so no cross-source record was silently merged or deleted. " +
  "Six ticket references in the external journeys have no standalone artifact in that workbook's Source Inventory and remain marked as referenced-but-unavailable in the affected master rows and Source Summary.",
]];
summary.getRange("A13:H18").format = { fill: COLORS.paleBlue, wrapText: true, verticalAlignment: "top" };

summary.getRange("A19:H19").merge();
summary.getRange("A19").values = [["Current execution constraint"]];
styleSectionHeader(summary.getRange("A19:H19"));
summary.getRange("A20:H23").merge();
summary.getRange("A20").values = [[
  "The supplied browser session proved read-only UI access to the dev Planning route, but it did not prove API authorization, role variants, disposable data, mutation approval, cleanup, external readback, failure injection, or product decisions. " +
  "Accordingly, external journeys labelled Ready by their source are normalized to Conditional for this assessment until their named standard fixtures and controls are verified. Authentication secrets are not embedded in this workbook.",
]];
summary.getRange("A20:H23").format = { fill: COLORS.paleYellow, wrapText: true, verticalAlignment: "top" };
summary.getRange("B5:B10").format.numberFormat = "#,##0";
summary.getRange("E5:E10").format.numberFormat = "#,##0";
summary.getRange("H5:H10").format.numberFormat = "#,##0";
summary.getRange("A4:H23").format.borders = { preset: "inside", style: "thin", color: "#D9E2F3" };
setColumnWidths(summary, 23, { A: 32, B: 14, C: 3, D: 32, E: 14, F: 3, G: 34, H: 16 });
summary.freezePanes.freezeRows(2);

// One complete list
master.showGridLines = false;
styleTitle(master, "A1:Z1", "Complete E2E Test List — 800 Source-Preserving Records");
styleSubtitle(master, "A2:Z2", "Filter by Source Set, Execution Category, Area, Priority, or Merge Disposition. Long-form steps and expected results are preserved in full.");
master.getRange("A4:Z4").values = [masterHeaders];
master.getRange(`A5:Z${masterRows.length + 4}`).values = masterRows;
const masterTable = master.tables.add(`A4:Z${masterRows.length + 4}`, true, "MasterE2ETestsTable");
masterTable.style = "TableStyleMedium2";
masterTable.showFilterButton = true;
master.getRange(`A4:Z${masterRows.length + 4}`).format.wrapText = true;
master.getRange(`A4:Z${masterRows.length + 4}`).format.verticalAlignment = "top";
master.getRange("A4:Z4").format.rowHeight = 34;
setColumnWidths(master, masterRows.length + 4, {
  A: 24, B: 24, C: 18, D: 25, E: 30, F: 28, G: 46, H: 10, I: 20, J: 18, K: 28, L: 48, M: 28,
  N: 25, O: 30, P: 55, Q: 52, R: 48, S: 58, T: 58, U: 42, V: 52, W: 46, X: 48, Y: 44, Z: 50,
});
master.getRange(`A5:Z${masterRows.length + 4}`).format.autofitRows();
const executionRange = master.getRange(`M5:M${masterRows.length + 4}`);
executionRange.conditionalFormats.add("containsText", { text: "Ready", format: { fill: COLORS.paleGreen, font: { color: "#006100" } } });
executionRange.conditionalFormats.add("containsText", { text: "Conditional", format: { fill: COLORS.paleYellow, font: { color: "#7F6000" } } });
executionRange.conditionalFormats.add("containsText", { text: "Blocked", format: { fill: COLORS.paleRed, font: { color: "#9C0006" } } });
executionRange.conditionalFormats.add("containsText", { text: "Manual", format: { fill: COLORS.paleGray, font: { color: "#404040" } } });
executionRange.conditionalFormats.add("containsText", { text: "Composite", format: { fill: COLORS.paleBlue, font: { color: COLORS.text } } });
master.freezePanes.freezeRows(4);
master.freezePanes.freezeColumns(4);

// Preconditions
preconditions.showGridLines = false;
styleTitle(preconditions, "A1:G1", "Automation Preconditions and Missing Capabilities");
styleSubtitle(preconditions, "A2:G2", "Repository bundles and external fixture contracts are preserved separately; counts overlap and must not be summed.");
preconditions.getRange("A4:G4").values = [preconditionHeaders];
preconditions.getRange(`A5:G${preconditionRows.length + 4}`).values = preconditionRows;
const preconditionTable = preconditions.tables.add(`A4:G${preconditionRows.length + 4}`, true, "MasterPreconditionsTable");
preconditionTable.style = "TableStyleMedium4";
preconditionTable.showFilterButton = true;
preconditions.getRange(`A4:G${preconditionRows.length + 4}`).format.wrapText = true;
preconditions.getRange(`A4:G${preconditionRows.length + 4}`).format.verticalAlignment = "top";
preconditions.getRange(`G5:G${preconditionRows.length + 4}`).format.numberFormat = "#,##0";
setColumnWidths(preconditions, preconditionRows.length + 4, { A: 25, B: 28, C: 30, D: 32, E: 28, F: 78, G: 20 });
preconditions.getRange(`A5:G${preconditionRows.length + 4}`).format.autofitRows();
preconditions.freezePanes.freezeRows(4);
preconditions.freezePanes.freezeColumns(2);

// Merge analysis
merge.showGridLines = false;
styleTitle(merge, "A1:H1", "Cross-Source Merge Analysis");
styleSubtitle(merge, "A2:H2", "Only explicit canonical mappings qualify for hard merge. ID, title, or semantic similarity alone is retained for review.");
const externalMergeHeaders = ["External Journey ID", "Title", "Atomic Check IDs", "Local ID Collision", "Source Case ID Matches", "Exact Title Match", "Semantic Assessment", "Disposition"];
const externalMergeRows = externalCases.map((item) => {
  const externalId = String(item["Test ID"]);
  const covered = String(item["Source Case IDs"] ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const coveredMatches = covered.filter((id) => repositoryIds.has(id));
  const collides = repositoryIds.has(externalId);
  return [
    externalId,
    item.Title,
    covered.length,
    collides ? "Yes — different behavior" : "No",
    coveredMatches.length,
    "No",
    semanticAssessment(externalId),
    collides
      ? "Retained separately with XLSX namespace; unsafe bare-ID collision"
      : "Retained separately — no explicit canonical mapping",
  ];
});
merge.getRange("A4:H4").values = [externalMergeHeaders];
merge.getRange(`A5:H${externalMergeRows.length + 4}`).values = externalMergeRows;
const externalMergeTable = merge.tables.add(`A4:H${externalMergeRows.length + 4}`, true, "ExternalMergeAnalysisTable");
externalMergeTable.style = "TableStyleMedium2";
externalMergeTable.showFilterButton = true;
merge.getRange(`C5:C${externalMergeRows.length + 4}`).format.numberFormat = "#,##0";
merge.getRange(`E5:E${externalMergeRows.length + 4}`).format.numberFormat = "#,##0";

const duplicateStart = externalMergeRows.length + 7;
merge.getRange(`A${duplicateStart}:D${duplicateStart}`).values = [["Repository exact-title duplicate candidates", "Count", "Repository IDs", "Disposition"]];
styleSectionHeader(merge.getRange(`A${duplicateStart}:D${duplicateStart}`));
merge.getRange(`A${duplicateStart + 1}:D${duplicateStart + duplicateTitleGroups.length}`).values = duplicateTitleGroups;
const duplicateTable = merge.tables.add(`A${duplicateStart}:D${duplicateStart + duplicateTitleGroups.length}`, true, "RepositoryDuplicateCandidatesTable");
duplicateTable.style = "TableStyleMedium4";
duplicateTable.showFilterButton = true;
merge.getRange(`A4:H${duplicateStart + duplicateTitleGroups.length}`).format.wrapText = true;
merge.getRange(`A4:H${duplicateStart + duplicateTitleGroups.length}`).format.verticalAlignment = "top";
setColumnWidths(merge, duplicateStart + duplicateTitleGroups.length, { A: 30, B: 52, C: 20, D: 28, E: 22, F: 20, G: 58, H: 52 });
merge.getRange(`A5:H${duplicateStart + duplicateTitleGroups.length}`).format.autofitRows();
merge.freezePanes.freezeRows(4);

// Source summary
sources.showGridLines = false;
styleTitle(sources, "A1:D1", "Source Coverage and Provenance");
styleSubtitle(sources, "A2:D2", "Counts describe source rows or supplied journeys; they are not all unique business behaviors.");
sources.getRange("A4:D4").values = [["Source Type", "Source", "Records", "Interpretation"]];
sources.getRange(`A5:D${sourceSummaryRows.length + 4}`).values = sourceSummaryRows;
const sourceTable = sources.tables.add(`A4:D${sourceSummaryRows.length + 4}`, true, "MasterSourceSummaryTable");
sourceTable.style = "TableStyleMedium2";
sourceTable.showFilterButton = true;
sources.getRange(`C5:C${sourceSummaryRows.length + 4}`).format.numberFormat = "#,##0";
const hashStart = sourceSummaryRows.length + 7;
sources.getRange(`C${hashStart}:D${hashStart}`).merge();
sources.getRange(`A${hashStart}:C${hashStart}`).values = [["Input artifact", "Path", "SHA-256"]];
styleSectionHeader(sources.getRange(`A${hashStart}:D${hashStart}`));
sources.getRange(`A${hashStart + 1}:B${hashStart + 2}`).values = [
  ["External journey workbook", sourcePath],
  ["Repository inventory JSON", repositoryPath],
];
for (const [row, hash] of [[hashStart + 1, sourceHash], [hashStart + 2, repositoryHash]]) {
  sources.getRange(`C${row}:D${row}`).merge();
  sources.getRange(`C${row}`).values = [[hash]];
}
sources.getRange(`A4:D${hashStart + 2}`).format.wrapText = true;
sources.getRange(`A4:D${hashStart + 2}`).format.verticalAlignment = "top";
setColumnWidths(sources, hashStart + 2, { A: 30, B: 82, C: 28, D: 40 });
sources.getRange(`A5:D${hashStart + 2}`).format.autofitRows();
sources.freezePanes.freezeRows(4);

// Compact value/formula verification before export.
const summaryInspection = await workbook.inspect({
  kind: "table",
  range: "Summary!A4:H10",
  include: "values,formulas",
  tableMaxRows: 10,
  tableMaxCols: 8,
  maxChars: 8000,
});
console.log("SUMMARY_INSPECTION");
console.log(summaryInspection.ndjson);

const masterInspection = await workbook.inspect({
  kind: "table",
  range: "Master E2E Tests!A4:Z8",
  include: "values,formulas",
  tableMaxRows: 5,
  tableMaxCols: 26,
  tableMaxCellChars: 120,
  maxChars: 12000,
});
console.log("MASTER_INSPECTION");
console.log(masterInspection.ndjson);

const externalInspection = await workbook.inspect({
  kind: "table",
  range: "Master E2E Tests!A755:Z760",
  include: "values,formulas",
  tableMaxRows: 6,
  tableMaxCols: 26,
  tableMaxCellChars: 160,
  maxChars: 16000,
});
console.log("EXTERNAL_MASTER_INSPECTION");
console.log(externalInspection.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan",
  maxChars: 6000,
});
console.log("FORMULA_ERRORS");
console.log(errors.ndjson);

const previewRanges = [
  ["Summary", "A1:H23", "Summary"],
  ["Master E2E Tests", "A1:M12", "Master_E2E_Tests_Left"],
  ["Master E2E Tests", "N1:Z12", "Master_E2E_Tests_Right"],
  ["Master E2E Tests", "A753:M760", "Master_External_Left"],
  ["Master E2E Tests", "N753:Z760", "Master_External_Right"],
  ["Preconditions", "A1:G18", "Preconditions"],
  ["Merge Analysis", "A1:H18", "Merge_Analysis"],
  ["Source Summary", `A1:D${Math.min(hashStart + 2, 24)}`, "Source_Summary"],
];
for (const [sheetName, range, previewName] of previewRanges) {
  const preview = await workbook.render({ sheetName, range, scale: 1, format: "png" });
  const safeName = previewName.replace(/[^a-z0-9_-]+/gi, "_");
  await fs.writeFile(path.join(outputDir, `final_${safeName}.png`), new Uint8Array(await preview.arrayBuffer()));
}

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);

const exportedBlob = await FileBlob.load(outputPath);
const exportedWorkbook = await SpreadsheetFile.importXlsx(exportedBlob);
const exportedOverview = await exportedWorkbook.inspect({
  kind: "workbook,sheet,table",
  maxChars: 7000,
  tableMaxRows: 3,
  tableMaxCols: 8,
  tableMaxCellChars: 100,
});
console.log("EXPORTED_WORKBOOK_OVERVIEW");
console.log(exportedOverview.ndjson);
const exportedErrors = await exportedWorkbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "exported workbook formula error scan",
  maxChars: 6000,
});
console.log("EXPORTED_FORMULA_ERRORS");
console.log(exportedErrors.ndjson);

await fs.writeFile(path.join(outputDir, "build_summary.json"), JSON.stringify({
  outputPath,
  masterRecords: masterRows.length,
  repositoryRecords: repositoryRows.length,
  externalJourneys: externalRows.length,
  externalAtomicCheckReferences: externalSourceIds.length,
  uniqueExternalAtomicCheckReferences: uniqueExternalSourceIds.size,
  exactCrossSourceIdMatches: exactSourceIdMatches.length,
  externalJourneyIdCollisions,
  exactCrossSourceTitleMatches: exactExternalTitleMatches.length,
  confirmedHardMerges: 0,
  repositoryDuplicateTitleGroups: duplicateTitleGroups.length,
  semanticAssessment: { strongOverlap: strongOverlapIds.size, partialOverlap: partialOverlapIds.size, materiallyNew: materiallyNewIds.size },
  externalTraceability: { uniqueRules: traceabilityRows.length, references: traceabilityReferenceCount, danglingIds: danglingTraceabilityIds.length },
  missingExternalTicketSources,
  sourceHash,
  repositoryHash,
}, null, 2));

console.log(`OUTPUT ${outputPath}`);
