# Manual Test Case: Guest checkout confirmation

Scenario: Guest submits the deterministic local checkout form and sees a confirmation

Preconditions:

1. The deterministic fixture is running locally (`npm run fixture:start`, serves http://127.0.0.1:3000).
2. No authentication is required for this flow.

Steps:

Given the guest opens the checkout page at /recorded-example/checkout
When the guest fills the email and full name fields and submits the recording
Then the system must:

- The "Recording submitted" confirmation heading is visible
- The deterministic completion message is visible

Test data:

| Name | Value |
|---|---|
| Email | test@example.com |
| Full name | Test Customer |

Notes:

1. This file is the sample input for the manual-doc importer. Import it with:
   `npm run ai:spec:import -- --input docs/manual/example-checkout.md --out specs/example-checkout.draft.md`
2. The importer produces a draft spec full of `NEEDS_REVIEW` markers; resolve every marker and pass deterministic spec validation before generation. Delete the draft when you are done experimenting.
