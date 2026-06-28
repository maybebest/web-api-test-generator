# Nectar AI Media-Planner — Automation Triage Synthesis

> **Data note:** the source array contained **225 rows but only 201 distinct test IDs** — 24 IDs appear twice (the analyst re-triaged several cases as the brief firmed up, e.g. `TC-CHL-005/006`, `TC-ESL-001..003`, `TC-XJ-009..014`, `TC-ABL-011/032`). For every duplicate I took the **later / more-refined entry** (the one carrying `pomNeeds` or a sharpened verdict). The two `TC-ABL-011` rows were genuinely distinct sub-cases, so I kept both as `011a`/`011b`. All counts below are over the **201 deduped cases**.

---

## 1. Counts by verdict

### Overall (201 cases)

| Verdict | Count | % |
|---|---|---|
| **AUTOMATABLE** | 102 | 51% |
| **PARTIAL** | 66 | 33% |
| **BLOCKED** | 33 | 16% |
| **Automatable now or with POM work (A+P)** | **168** | **84%** |

### Per family

| Family | AUTOMATABLE | PARTIAL | BLOCKED | Total | A+P "addressable" |
|---|---:|---:|---:|---:|---:|
| **ESL** (Edit-SKU-list) | 22 | 6 | 0 | 28 | 100% |
| **CHL** (Channel) | 20 | 5 | 3 | 28 | 89% |
| **XJ** (Cross-journey) | 15 | 10 | 1 | 26 | 96% |
| **VAL** (Validation) | 11 | 7 | 4 | 22 | 82% |
| **ABL** (Auto-add brand-link) | 14 | 13 | 6 | 33 | 82% |
| **GHM** (Global Hero/Measurement) | 15 | 21 | 1 | 37 | 97% |
| **SPI** (Single-prompt) | 5 | 4 | 18 | 27 | 33% |

**Reading it:** ESL, CHL, XJ and GHM are healthy. **SPI is the outlier** — 18/27 blocked because the single-prompt summary feature (NUP-19273) is not confirmed live in dev. **BLOCKED root causes** cluster into just three buckets (see §3).

---

## 2. Distinct POM extensions for `PlanningPage`

Deduplicated from every `pomNeeds` plus locator gaps called out in PARTIAL reasons. Grouped by area. Items marked **(blocked-only)** serve cases that can't run until a missing rule lands — defer those.

### A. Edit-button state selectors (high reuse — unblocks GHM, XJ, VAL, ESL)
- `editMeasurementBtn` — `[data-testid=edit-measurement-btn]`, with `isEnabled()`/`isDisabled()` helpers
- `editHeroBtn` — `[data-testid=edit-hero-btn]`, with enabled/disabled helpers
- Per-table "Edit SKU list" pencil buttons:
  - `measurementEditSkuList` — `[data-testid=measurement-edit-sku-list]`
  - `heroEditSkuList` — `[data-testid=hero-edit-sku-list]`
  - `summaryEditSkuList` — `[data-testid=summary-edit-sku-list]` (single-prompt summary)
- `assertEditButtonState(button, expected)` — boundary/decision-table helper used across GHM-011..013, XJ-011, XJ-026

### B. Summary-panel count readers (very high reuse — nearly every A/P case)
- `summaryMeasurementCount()` — numeric reader scoped by label
- `summaryHeroCount()` — numeric reader (unique-count semantics)
- `pollCountAfterConfirm(selector)` — poll-until-stable helper (channel confirm / assistant turn settle)

### C. Edit modals (Measurement / Hero) — open, identity, mutate
- `openMeasurementEditModal()` / `openHeroEditModal()` (both summary-panel and under-table entry points)
- `modalIdentity()` — read title/`data-testid` to assert "no cross-wiring" (ESL-020) and two-entry-point parity (ESL-021/022)
- `modalAddSku(name)` / `modalRemoveSku(name)` / `modalCancel()`
- `modalOptionSet()` — capture selectable option set for brand-linked vs Measurement-scope comparison (ABL-001, ABL-028, GHM-015/036)
- `measurementModalRowHeroBadge(sku)` — `[data-testid=measurement-modal-row]` Hero indicator / "Hero SKU" label (XJ-014, ABL-011)

### D. SKU-table row interactions
- `measurementTableRow(sku)` / `heroTableRow(sku)` — presence/absence assertions
- `heroRowHoverUnassign(sku)` — **hover-to-reveal bin icon + click** (XJ-012, GHM-007); needs live hover-trigger recon
- `heroBadgeLabel(sku)` — tolerant contains-check for "Added to Hero SKUs"
- `rowEllipsisTitle(sku)` — `title`-attr / text-overflow reader (GHM-028, needs real long-named SKU)

### E. Channel modal & channel-card
- `openChannelHeroModal(channelName)` — pre-checked set reader (`prePopulatedHeroSet()`)
- `channelHeroAdd(sku)` / `channelHeroDelete(sku)` — immediate, no-confirm delete
- `deleteChannel(channelName)` — `[data-testid=delete-channel-{name}]`
- `channelCardHeroList(channelName)` — saved-set persistence reader
- `channelHeroConfirm()` + isolation re-open helper

### F. Single-prompt summary (build behind a feature probe)
- `singlePromptSummary()` selector + `summaryRowHeroFlag(sku)` (Hero vs Measurement-only marker)
- `assertStandardFlowHasNoSummaryEdit()` — negative check (ESL-017)
- **Defer until NUP-19273 is confirmed live** (see §3).

### G. Validation messages (tolerant)
- `validationMessageContains(substr)` — `(blocked-only)` for min/max copy; use contains-matching, never verbatim.

### H. Assistant-message text (tolerant, cross-cutting)
- `lastAssistantMessage()` + `assertContainsPhrases([...])` — **contains/normalize-whitespace only.** Drives the many PARTIAL "tolerant" cases (GHM-001/004/026, XJ-022, SPI-026). Verbatim equality is explicitly flagged fragile throughout.

**Build priority:** **A → B → C → D/E** unblock the bulk of A+P cases. **F/G** are gated on missing features. **H** is small but converts a large tail of tolerant PARTIALs.

---

## 3. Recommended automation batching plan

### Wave 1 — Quick wins (high value, lowest recon) — ~63 AUTOMATABLE
Start where mechanics are live-verified and assertions are structural (DOM state / counts), needing only POM blocks **A + B**.

- **ESL AUTOMATABLE (22)** — best ROI. Pencil-button visibility, modal open/identity, add/remove/cancel no-op, presence/absence negatives. Self-contained, almost no data mapping.
- **CHL AUTOMATABLE (20)** — channel Hero add/delete, unique-count dedup (set-union, not sum), channel-delete recompute, modal persistence/isolation, cancel-discard. Needs POM block **E**.
- **VAL AUTOMATABLE confirm-gating (006–008, 014–021)** — confirm-button disabled/enabled at min boundaries; pure structural state. Needs **A**.

These three give a fast green core and exercise nearly every Wave-1 POM locator, de-risking later waves.

### Wave 2 — Core auto-add + state machine — ~44 (AUTOMATABLE-heavy)
- **ABL AUTOMATABLE (001–003, 005–010, 020, 021, 026, 030, 032)** — the NUP-20956 auto-add engine (Hero-not-in-Measurement → global Measurement; channel-level → global; bulk dedup; silent no-toast negative). Highest *behavioural* value; count-delta assertions. Needs **C + D**.
- **GHM AUTOMATABLE (15)** — Hero assign/unassign, Confirm boundaries, summary edit-button enablement transitions. Needs **A + C + D**.
- **XJ AUTOMATABLE (15)** — end-to-end happy path + auto-add journeys + boundary (min Measurement, channel max where present). These are the headline regression journeys; run after Wave 1/2 POM exists since they compose sub-flows. Tolerate 60s assistant-turn polling via **B**.

### Wave 3 — PARTIALs needing recon/POM extension (66)
Schedule after the POM is mature; each needs one specific unlock:
- **Tolerant-text PARTIALs** (GHM-001/004/006/026, XJ-022, SPI-026): unblock with POM block **H** (contains-matching). Cheap; batch together.
- **Locator-recon PARTIALs** (hover-unassign XJ-012/GHM-007; two-entry-point edit ESL-021/022; measurement-modal Hero badge XJ-014/ABL-011): one live recon session adds blocks **C/D**, then they flip to automatable.
- **Channel-bridge PARTIALs** (GHM-019/020/031, ABL-017/018/019): depend on block **E** landing in Wave 1 — revisit immediately after.
- **Contradiction PARTIALs — resolve before coding:** GHM-030 ⟷ GHM-035/037, and XJ-010 ⟷ XJ-026/XJ-023 disagree on the global-Hero-edit *disable trigger* (channel **confirm** vs channel-level **edit start**). Per the notes, **XJ-026 / NUP-18943 Scenario 5 supersede** (trigger = edit start). Automate the corrected expectation; keep the superseded drafts as xfail/divergence flags. Likewise GHM-015 is **superseded by NUP-20956 (GHM-036)** — confirm which is live before investing.

### BLOCKED — do not schedule until the dependency lands (33)
Three root causes only:

1. **Single-prompt feature unverified in dev (NUP-19273)** — **18 SPI cases** (001–013, 015–018) + SPI-022. The whole feature path is unconfirmed live. *Unblock:* confirm NUP-19273 is deployed; then most flip to AUTOMATABLE (SPI-020/021/023/024/027 already are, proving the underlying SKU/auto-add mechanics work — only the *summary entry path* is missing).
2. **Channel Hero min/max validation rule absent (NUP-18944)** — CHL-016/025/028, ABL-024/025, GHM-033, XJ-020-adjacent VAL max cases. Dev enforces no min/max, so these are no-ops / false-negatives today. CHL-015 ⟷ CHL-028 even contradict on MIN (0 vs 1). *Unblock:* confirm NUP-18944 is implemented and get the real MAX/MIN values (currently assumed 3/1).
3. **Test data references non-existent brands/SKUs** — VAL-001–004 ("Coca-Cola", "SKU-A/B/C", "Channel-1") and ABL-013/014/015/029 ("BrandA/BrandB", "SKU-200"). Real dev is the *Unilever | Knorr | MS* brand with real Knorr SKUs. *Unblock:* reverse-map test data to live Knorr SKUs / real channel names — a data exercise, no code dependency. ABL-015/029 additionally need brand-switch capability, which Constraint 6 (brand locks after channel selection) may forbid.
   - Plus one rule-gate: **XJ-020** (global SKU removal blocked once channel provided, Constraint 6) — rule not confirmed live.

**Bottom line:** ~84% of cases (168) are addressable. Land POM blocks **A + B + C + E** first; that alone unlocks Waves 1–2 (~107 cases). Park SPI and all min/max-boundary cases behind explicit "feature live?" checks for NUP-19273 and NUP-18944, and run a single data-mapping + contradiction-resolution pass to convert the PARTIAL tail."
  }
}