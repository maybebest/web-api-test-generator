# Environment variables

Copy `.env.example` to `.env` and fill it in. `playwright.config.ts` loads `.env` automatically, so a plain `npm run test:api` works after that.

Never commit `.env` — it is in `.gitignore`.

## Required

| Variable | What it is | Example |
|---|---|---|
| `WEB_BASIC_AUTH_USER` | User name of the HTTP basic auth in front of the site | `qa` |
| `WEB_BASIC_AUTH_PASSWORD` | Password of that basic auth | `secret` |
| `AGENT_PASSWORD` | One password shared by all agents in the pool | `1234` |
| `ADMIN_EMAIL` | E-mail of the administrator account (expert tests) | `admin@example.com` |
| `ADMIN_PASSWORD` | Password of that administrator | `secret` |

A run fails immediately with a clear message if any of these is missing.

## Optional

| Variable | What it is | Default |
|---|---|---|
| `TEST_ENV` | Which environment to run against, see `config/environments.ts` | `stage` |
| `AGENT_POOL_LOGINS` | Comma separated agent logins the tests borrow from | `aqa1@gmail.com,aqa2@gmail.com,aqa3@gmail.com` |
| `TEST_CARD_NUMBER` | Card used in paid steps | `4242424242424242` |
| `TEST_CARD_EXPIRY` | Card expiry | `04/44` |
| `TEST_CARD_CVC` | Card CVC | `444` |
| `TEST_CARD_PAYMENT_METHOD_ID` | Payment method id for the API path | `pm_card_visa` |
| `TEST_EMAIL_LOCAL_PART` | Local part of generated e-mails | `olekwer` |
| `TEST_EMAIL_DOMAIN` | Domain of generated e-mails | `gmail.com` |

## How the pool size affects parallel runs

One test holds one agent while it runs, and the number of workers follows the number of logins in `AGENT_POOL_LOGINS`. With three logins the run uses three workers, so tests never queue for an agent.

To run wider, add more agent logins — the worker count grows with them.

## Adding a new environment

Add an entry to `environments` in `config/environments.ts` and run with `TEST_ENV=<name>`. URLs are taken from that entry everywhere, so nothing else has to change.
