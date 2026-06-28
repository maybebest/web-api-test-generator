# Manual Test Case: Guest checkout confirmation

Scenario: Guest submits the demo checkout form and sees a confirmation

Preconditions:

1. The demo app is running locally (`npm run demo:start`, serves http://localhost:3000).
2. No authentication is required for this flow.

Steps:

Given the guest opens the checkout page at /ai-example/checkout
When the guest fills the email, full name, and shipping address fields and submits the order
Then the system must:

- Confirmation heading is visible
- The submitted email is shown in the confirmation summary
- A request ID is shown in the confirmation summary

Test data:

| Name | Value |
|---|---|
| Email | test@example.com |
| Full name | Test Customer |
| Shipping address | 123 Test Street, Kyiv |

Notes:

1. The demo API responds with a request ID that the confirmation page displays.
2. This file is the sample input for the manual-doc importer. Import it with:
   `npm run ai:spec:import -- --input docs/manual/example-checkout.md --out specs/example-checkout.draft.md`
3. The importer produces an `ai-draft` spec full of `NEEDS_REVIEW` markers; a human must review and promote it to `human-reviewed` before generation. Delete the draft when you are done experimenting.
