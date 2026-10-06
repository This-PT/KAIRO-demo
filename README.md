# Handover

Handover keeps a team's knowledge when developers leave. It reads Jira tickets (comments, changelog, linked issues) and turns each one into a structured record: **problem, root cause, what was done, rationale, rejected options and gotchas**, each backed by a quote from the ticket. A new hire can read the history instead of reverse-engineering it.

This repository is **Phase 1**. See [What is not built yet](#what-is-not-built-yet).

```
Jira ──► ingest ──► policy filter ──► AI summary ──► verify quotes ──► Task History UI
          (pages,    readable / restricted           (schema check,     (summary + link
        rate limits)  + secret redaction              evidence match)    to the source)
                          │
                          └─ restricted tickets: stored encrypted, never sent to an AI
```

## Quick start (no accounts needed)

You can run everything with the fake tickets in `fixtures/`: no Jira, no API keys.

**You need:** [Node.js](https://nodejs.org) 20 or newer, [pnpm](https://pnpm.io) (`npm i -g pnpm`), and [Docker Desktop](https://www.docker.com/products/docker-desktop/) running.

```bash
pnpm install
pnpm setup      # creates .env and generates ENCRYPTION_KEY and ADMIN_TOKEN (never overwrites your values)
pnpm infra      # starts Postgres + Redis in Docker and creates the database tables
pnpm demo       # optional: loads the fake tickets and summarizes them in one go
```

Then run the two servers in **two separate terminals**:

```bash
pnpm api        # terminal 1: http://127.0.0.1:4000
pnpm web        # terminal 2: http://localhost:3000
```

Open **http://localhost:3000**.

> **Windows PowerShell:** if `pnpm` fails with "running scripts is disabled", either run
> `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned` once, or type `pnpm.cmd` instead of `pnpm`.

If you skipped `pnpm demo`, do the same thing in the UI: **Connect & Policy** → **Sync projects** → tick **Enabled** → **Edit policy** (project default `readable`, plus label `hr-confidential` = `restricted`) → **Save rules** → **Ingest now**. Then open **Task History** (ticket summaries) and **Work Tree** (epics, stories and sub-tasks drawn as a graph, with links between tickets; restricted tickets appear as locked placeholders).

With the default `LLM_PROVIDER=mock` the summaries come from a small offline extractor (low confidence, problem field only). Use a real model for useful summaries: see [Choose the AI model](#choose-the-ai-model).

## One-command demo (the Shopfront team)

For a presentation, use the larger fake dataset: a shop team of 25 tickets with 4 epics, 5 people, real decisions and rejected options, thin tickets (to show confidence), a leaked-secret ticket (to show redaction), a prompt-injection ticket, and 2 restricted tickets.

```bash
pnpm demo:start             # starts Docker services, migrates, loads the data, starts the API and the web app
pnpm demo:start --readonly  # same, but visitors can only browse and ask questions
pnpm demo:start --mock      # offline summaries: free, but every ticket shows low confidence
```

Then open http://localhost:3000. The welcome page explains the app and offers questions to try. Without `--mock`, the 23 readable tickets are summarized by your configured model (roughly 25 cents with a mid-priced model; I measured about 3.5 minutes). Ports 3000 and 4000 must be free. Ctrl+C stops both servers. To only reload the data: `pnpm demo:showcase`.

Good questions to try: "Why did we choose Elasticsearch instead of Algolia?", "How did we stop customers being charged twice?", "What should I know before changing the login flow?", and then "What are the contractor hourly rates?" to see that restricted tickets are never used.

## Connect to real Jira

Handover uses a Jira Cloud API token with your email (HTTP Basic auth). OAuth is planned for a later phase.

1. Sign in to Atlassian and open **https://id.atlassian.com/manage-profile/security/api-tokens**.
2. Click **Create API token**, give it a name such as `handover`, choose an expiry, and **copy the token**. Atlassian shows it only once.
3. Edit `.env`:
   ```
   DEMO_MODE=false
   JIRA_BASE_URL=https://your-domain.atlassian.net
   JIRA_EMAIL=you@example.com            # the Atlassian account that owns the token
   JIRA_API_TOKEN=paste-the-token-here
   ```
4. Restart `pnpm api`. In the UI go to **Connect & Policy** → **Test connection**, then **Sync projects**.
5. For each project: set the policy, tick **Enabled**, click **Ingest now**.

Tips:
- The token can read whatever its owner can. Prefer a dedicated account that only has access to the projects you want to ingest.
- With `DEMO_MODE=false` and any `JIRA_*` value missing, the API refuses to start. It never silently falls back to fake data.
- Never commit `.env`. It is git-ignored, and `.env.example` contains no real values.

## Choose the AI model

Set `LLM_PROVIDER` in `.env`, then restart `pnpm api`.

| `LLM_PROVIDER` | Settings | Notes |
|---|---|---|
| `mock` (default) | none | Offline, free, deterministic. For demos and tests. |
| `openai` | `OPENAI_API_KEY`, `OPENAI_MODEL` | Strict JSON-schema output. Use any model that supports structured outputs. |
| `openai` + `OPENAI_BASE_URL` | same, plus the URL | Any OpenAI-compatible server (Gemini, Groq, local Ollama...). Free tiers exist; check their data terms before sending real tickets. |
| `anthropic` | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (for example `claude-opus-5-5`) | Uses the official SDK with structured output. |

You choose the model name; Handover does not hard-code one. Real providers are billed by the provider per token. **Only redacted text of readable tickets is ever sent**, and each request is recorded in the audit log.

To try a provider without Jira: set the provider variables, then run `pnpm demo --reset`. This sends the redacted fake tickets to that provider.

## Deploy on Render (free tier)

This runs the web app and the API **together in one container** (so only one thing has to wake up), with Render's free Postgres. It serves the read-only Shopfront demo behind a password. The demo summaries are stored in `fixtures/showcase-summaries.json`, so deploying makes **no AI calls**; only your visitors' chat questions do.

**What you get, honestly:** free, always reachable for about a month, but the service **sleeps after 15 minutes without visitors** and the first visit afterwards takes about a minute. The free database **expires 30 days after creation**. Check Render's [free tier terms](https://render.com/docs/free) before relying on them: they change.

### 1. Check for secrets, then put the project on GitHub
```bash
pnpm check:secrets      # must print OK: none of your secret values appear in files that would be uploaded
git init
git add .
git status              # .env must NOT be listed. If it is, stop.
git commit -m "Handover demo"
git branch -M main
```
Create an empty **private** repository on github.com, then:
```bash
git remote add origin https://github.com/YOUR-NAME/YOUR-REPO.git
git push -u origin main
```

### 2. Create the service on Render
1. Create a free account at render.com and connect your GitHub account.
2. **New > Blueprint**, pick your repository. Render reads `render.yaml` and proposes one web service (`handover`) and one database (`handover-db`), both on the free plan.
3. Render asks for the two secrets that are not in the file:
   - `APP_PASSWORD`: the password your mentor will type (at least 8 characters, preferably long).
   - `OPENAI_API_KEY`: your OpenAI key (needed only for the chat). Leave it out and chat answers will fail, everything else works.
4. Click **Apply**. The first build takes several minutes. When the deploy is live, open the `https://….onrender.com` link on the service page.

`ENCRYPTION_KEY` and `ADMIN_TOKEN` are generated by Render and kept between deploys. Do not change `ENCRYPTION_KEY` later: restricted tickets are encrypted with it.

### 3. Check it works
- `https://YOUR-SERVICE.onrender.com/healthz` shows `ok`.
- The site asks for your password, then shows the welcome page with 25 tickets.
- Ask AI: "What did we do?" answers with an overview and quotes.

### 4. Before you send the link
- Set a **monthly spending limit** in your OpenAI dashboard. The app caps chat at `CHAT_DAILY_LIMIT` (50) questions a day, but that is not a hard spending limit.
- Send the link and the password separately, and tell your mentor the first load after a pause can take a minute or two.
- When the assessment is over, delete the service and the database in the Render dashboard.

### If something goes wrong
- **Build fails**: open the deploy log. Send me the last lines.
- **"Cannot start: ..." in the logs**: the start script lists exactly which setting is missing or invalid (it never prints secret values).
- **Migration error mentioning `vector`**: Render's Postgres should support pgvector, but I could not test it on Render itself. Tell me and I will make that step optional.
- **Out of memory / restarts**: the free instance has 512 MB. I tested the image at that limit on my machine (see the section "What I tested"), but a real deployment can differ.

### What I tested, and what I could not
Tested locally: the image builds; it starts inside a 512 MB container against a clean Postgres; migrations and the demo data load without any AI call; the password gate, the read-only mode and the chat work in the container; the health endpoint answers. **Not tested: Render itself** (the blueprint, its free-tier limits, its wake-up behaviour, GitHub).

## Share a demo (read-only, password-protected)

Do not put the normal app on a public link: anyone could change rules or spend your AI key. Use demo mode instead.

1. In `.env` set:
   ```
   APP_PASSWORD=choose-a-long-password     # required before sharing; a production server refuses to serve without it
   DEMO_READONLY=true                      # visitors can browse and ask questions, nothing else
   CHAT_DAILY_LIMIT=100                    # max questions per day (default 200 in read-only mode)
   DEMO_MODE=true                          # fake fixture tickets
   ```
2. Generate good summaries once, with a real model (a few cents): `pnpm demo --reset`. Visitors then never trigger summarizing.
3. Build and start in production mode (stop `pnpm web` first; the dev server and the build share a folder):
   ```bash
   pnpm web:build
   pnpm api          # terminal 1
   pnpm web:prod     # terminal 2
   ```
4. Give the app a public address, for example with a Cloudflare quick tunnel (`cloudflared tunnel --url http://localhost:3000`). This prints an https link that works while your computer, Docker and both servers are running, and changes each time. Send people the link and the password separately.

What this gives you: a login page (password checked in constant time, 5 wrong guesses per client then a 15 minute lockout, plus a global limit), a signed session cookie (HttpOnly, SameSite=Strict, Secure over https, expires after 12 hours, invalidated if you change the password), no way to change data (the API returns 403 for every write except chat), conversations hidden from other visitors, and a daily cap on questions. Also set a monthly spending limit in your AI provider's dashboard.

Limits: one shared password for everyone (no individual accounts), the demo link is only as available as your computer, and the tunnel step is not something I could test here.

## How policy and privacy work

- **Rules** are per project and per label. A ticket is `readable` or `restricted`.
  - A restricted label always wins over a readable one.
  - A readable label overrides a restricted project default.
  - **With no rule, a ticket is restricted.**
- **Restricted tickets** are stored AES-256-GCM encrypted (`ENCRYPTION_KEY`), their title is replaced by `[Restricted]`, and they are never sent to an AI, shown in the UI, or searchable. If a rule change restricts a ticket, its old summaries are deleted.
- **Readable tickets** are redacted before storage and again before sending: API keys (Stripe, OpenAI-style, AWS, GitHub, Slack), private keys, JWTs, bearer tokens, `token=`/`password=` values and email addresses become `[REDACTED:type]`. Only counts of what was removed are kept, never the values.
- **Changing rules** re-runs the ingest automatically so stored visibility never goes stale.
- **Audit log** (`/audit` page, `AuditLog` table): every request to an AI model, with time, model, size, hash and the exact text sent. The row is written *before* the call.
- **Prompt injection:** ticket text is treated as untrusted data. It is placed between random delimiters, the model is told never to follow instructions inside it, output must match a strict schema, and every claim must be backed by a verbatim quote.

## Ask AI (chat)

The **Ask AI** page answers questions about past work using only the ingested tickets.

- **Retrieval first:** the question is turned into a Postgres full-text search over the verified summaries (plus ticket keys named in the question). Only **readable** tickets with a verified summary can ever be retrieved. Restricted tickets cannot be reached, even by naming their key.
- **Verified citations:** the model must cite tickets with quotes copied verbatim from the original (redacted) ticket text. Every quote is checked against the exact text that was sent, and a citation to any ticket that was not provided is rejected. One retry with feedback; if no citation survives, the answer is withheld and only the related tickets are shown.
- **Honest gaps:** if nothing relevant is found, the AI is not called at all. If the tickets do not answer the question, the model must say so.
- **Broad questions:** a question with no topic ("what did we do?", "summarize the project") cannot be searched by words, so the AI gets an overview sample instead: every epic plus a recent ticket from each, up to 10 tickets. It summarizes by theme and says it is based on a sample. If the tickets answer only part of a question, the model answers that part and says what is missing instead of refusing.
- **Safety:** secrets typed into a question are redacted before they reach the model, storage or the audit log. Ticket text is treated as untrusted data. A per-minute limit (20 questions) protects your AI bill. Every call is in the **AI Audit Log**, including which tickets were sent.
- **Limits:** search is keyword-based (no embeddings yet), answers are not streamed, and answer quality depends on summary quality. Conversations are saved in the database and are **private per browser**: each browser gets an anonymous id (an HttpOnly cookie set by the web server; the API only trusts it from there), and the sidebar and conversation links only work for the browser that created them. This is not an account: clearing cookies or switching browsers starts fresh, and you (the admin, with direct database or API access) can still read every question.

## The summary format

```
{ ticket, problem, root_cause,
  actions: [{what, source}], rationale,
  rejected_options: [{option, why_rejected}], gotchas: [],
  people: [], related: [],
  evidence: [{field, quote}],
  confidence: "high" | "medium" | "low",
  missing: [] }          // fields the ticket did not support
```

Rules enforced in the backend after the model answers:

1. The output must match the JSON schema exactly (no extra or missing fields).
2. A field the ticket does not support must be empty **and** listed in `missing`. Rationale is never invented.
3. Every non-empty content field needs an `evidence` quote, and **each quote must appear in the ticket text** (whitespace, case and curly quotes are ignored; nothing fuzzier). People and related keys must also appear in the ticket.
4. Failed checks trigger one retry with the specific problems. After that: a few bad quotes mean dropped quotes and one confidence level lower; a field with no valid support, or more than 25% bad quotes, means the summary is rejected and not shown.
5. Confidence is capped by what the ticket supports, whatever the model says: 3 missing fields cap it at medium and 4 or more force low. (Summaries stored before this rule keep their old rating until they are regenerated.)

## Environment variables

| Variable | Required | Meaning |
|---|---|---|
| `DATABASE_URL`, `REDIS_URL` | yes | Defaults match `docker-compose.yml`. |
| `ENCRYPTION_KEY` | yes | 32 bytes, base64. `pnpm setup` generates it. **If you lose it, restricted tickets cannot be decrypted.** |
| `ADMIN_TOKEN` | yes | Protects the API (12+ chars). `pnpm setup` generates it. |
| `DEMO_MODE` | no | `true` serves `fixtures/`; `false` uses Jira. |
| `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` | when `DEMO_MODE=false` | See [Connect to real Jira](#connect-to-real-jira). |
| `LLM_PROVIDER`, `OPENAI_*`, `ANTHROPIC_*` | no | See [Choose the AI model](#choose-the-ai-model). |
| `API_URL` | no | Where the web server finds the API. Default `http://127.0.0.1:4000`. |
| `PORT`, `WEB_ORIGIN`, `SUMMARIZE_CONCURRENCY` | no | API port (4000), allowed web origin, parallel summaries (2). |
| `APP_PASSWORD` | for sharing | Turns on the web login. Blank = open (development only; production refuses to serve). |
| `DEMO_READONLY`, `CHAT_DAILY_LIMIT` | no | Read-only public demo and its daily question cap. See [Share a demo](#share-a-demo-read-only-password-protected). |

## Project layout

```
packages/
  core/        shared types, summary schema, ticket text rendering
  connectors/  Connector interface; Jira client (pagination, 429 backoff) and fixture connector
  policy/      readable/restricted rules and secret redaction (pure functions)
  ingest/      backfill pipeline, encryption, idempotent storage
  ai/          prompt, providers (openai/anthropic/mock), schema validation, evidence verification, summarize job
  db/          Prisma schema and migrations (Postgres + pgvector installed, unused in Phase 1)
apps/
  api/         Fastify API + BullMQ workers (ingest, summarize)
  web/         Next.js: Task History, Work Tree, Ask AI, Connect & Policy, AI Audit Log
fixtures/showcase/ 25 fake tickets for the Shopfront demo
  fixtures/jira/ 10 fake tickets (2 epics, stories, a sub-task, a leaked key, an HR-confidential one, a prompt-injection attempt)
```

## Testing

```bash
pnpm infra                         # Postgres and Redis must be running
pnpm test                          # all tests (loads .env for you)
pnpm typecheck
```

Tests run against their own database, `handover_test`, which is created and migrated automatically on the first run. Your real and demo data in `handover` is never touched, and every test file refuses to run if `DATABASE_URL` does not point at a database whose name ends in `_test`.

Policy filter, redaction, evidence verification and schema validation were written test-first.

## Security notes

- Secrets live only in environment variables. The Jira token and AI keys never reach the browser.
- The web server holds `ADMIN_TOKEN` and forwards browser requests to the API through a proxy that allows only known paths and, for writes, requires a custom header and a same-origin check.
- Ticket and AI text is rendered as plain text, and only `http(s)` links are clickable.
- The API listens on `127.0.0.1` only, and Docker publishes Postgres and Redis on `127.0.0.1` only, so nothing else on your network can reach them. Change the default database password if you ever expose the machine.

## Known limitations

Please read these before using real data.

- **Not yet tested against real services.** Jira, OpenAI and Anthropic code is tested against mocked responses shaped like their APIs. Expect to fix small differences on the first live run.
- **Redaction is pattern-based.** It misses secrets written in plain words ("the password is hunter2") or in unusual formats. The restricted default and label rules are your main protection, so restrict sensitive projects and labels.
- **Quote checking proves the words are in the ticket, not that the model understood them.** A correctly quoted sentence can still be misread. Treat summaries as a reading aid and follow the source link when it matters.
- **No individual user accounts.** There is one shared password (`APP_PASSWORD`). Without it, anyone who can reach the web app has full access, so keep it on localhost.
- Only Jira Cloud with an API token. Only linked-issue metadata is used, linked tickets are not followed.
- A failed ingest restarts from the beginning; unchanged tickets are skipped, so this is cheap.

## Troubleshooting

| Problem | Fix |
|---|---|
| "This site can't be reached" on localhost:3000 | Both `pnpm api` and `pnpm web` must be running, in separate terminals. |
| `pnpm` blocked in PowerShell | `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`, or use `pnpm.cmd`. |
| `docker` errors / cannot connect to database | Start Docker Desktop, then `pnpm infra`. |
| "Can't reach database server at `localhost:5432`" although Docker shows Postgres running | Docker Desktop's IPv6 forwarding can break (`localhost` resolves to `::1`). Use `127.0.0.1` in `DATABASE_URL` and `REDIS_URL` (the defaults now do), run `docker compose up -d`, then restart `pnpm api`. |
| History page shows "Something went wrong" | The API is not running, or `ADMIN_TOKEN` is missing from `.env`. |
| API exits with "Missing JIRA_..." | Set the three Jira variables, or set `DEMO_MODE=true`. |
| Port 3000 or 4000 already in use | Stop the old process, or change `PORT` / run `next dev -p <port>` and update `WEB_ORIGIN`. |
| History is empty | Nothing has been ingested yet. Run `pnpm demo --reset`, or ingest a project from Connect & Policy. |
| Sync/ingest buttons say the project is not enabled | Tick **Enabled** on the project first. |

## What is not built yet

GitHub connector, embeddings-based search, streaming answers, billing, multi-tenant, OAuth, user login. The connector interface (`packages/connectors/src/types.ts`) is where GitHub will plug in.
