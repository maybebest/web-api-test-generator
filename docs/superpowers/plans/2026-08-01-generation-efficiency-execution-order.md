# Generation Efficiency Execution Order

The three implementation plans are executed in this dependency order:

1. Contract Plan Tasks 1–3: output contracts, validated generation input, and bounded context.
2. Token-Efficiency Plan Tasks 1–2: canonical flow and recording IR.
3. Gates/Telemetry Plan Task 1: explicit one-repeat fast gate.
4. Contract Plan Task 4: candidate-safe verified generation.
5. Token-Efficiency Plan Tasks 3–4: accepted cache states, single-flight, and stage routing.
6. Gates/Telemetry Plan Tasks 2–5: batched gates, full-funnel telemetry/reporting, UI coordination, and CI wiring.

Cross-plan interfaces are fixed by the individual `Interfaces` sections. If a task reveals that an interface must change, update the producing and consuming plan text before implementation continues.

Because this branch contains extensive pre-existing uncommitted work in the same files, implementation tasks do not create commits that could absorb unrelated changes. Each task instead records its changed paths and test evidence; the final handoff lists the design commit separately from the uncommitted implementation diff.
