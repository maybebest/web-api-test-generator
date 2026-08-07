# Secondary Space — generated test-case designs

Generated 2026-07-04 by the testcase-generator `from-source` pipeline (heuristic
extractor) from 11 Jira CSV exports of the NUP Secondary Space epic
(NUP-20399/20400/20401/20402/20403/20739/22595 + subtasks).

- `test-cases.yaml` — 24 ChannelManagement E2E cases (one per GWT scenario in
  the source stories: config detection, mandatory/optional element prompting,
  summary-panel updates, edit-via-modal, persistence, internal/external
  visibility matrix).
- `test-cases-feature-flag.yaml` — 1 case (feature-flag removal in production).
- `critical-user-journeys.yaml` — journey chains across the cases.

`sourceRefs` are `<ISSUE-KEY>.md#Lstart-Lend` into the converted issue docs at
`~/Downloads/sainsburys-qa/docs/` (adapter + rerun instructions in
`~/Downloads/sainsburys-qa/tools/README.md`).

Contains real project (NUP) content — do not publish this directory.
