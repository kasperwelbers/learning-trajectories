# Learning Trajectories

A tool for study programmes to describe their learning trajectories and see, with evidence, how
the courses build them up.

- **Trajectory coordinators** write the trajectories, their learning trajectory outcomes (LTOs)
  and rich narratives, and justify per framework (Dublin descriptors, Bloom, exit qualifications)
  that each LTO is achieved.
- **Course coordinators** add their course's study guide page and course manual (plus optional
  rubrics and other material). An AI extracts what students learn, do and are assessed on, quotes
  it verbatim with page numbers, and links it to the LTOs at Bloom levels. Coordinators can
  dispute links or point the AI to evidence it missed. The same analysis checks whether the
  manual is clear about everything the programme requires.
- **Everyone**, including visitation committees and students via share links, sees the result:
  Bloom flowers per LTO, a heatmap of where outcomes are taught and tested, a course × LTO
  matrix, the journey through each trajectory, and a printable programme report.

The design and the reasoning behind it are in [docs/redesign-plan.md](docs/redesign-plan.md);
ideas for later are in [docs/ideas.md](docs/ideas.md).

## Tech stack

| Layer           | Technology                                                                         |
| --------------- | ---------------------------------------------------------------------------------- |
| Frontend        | React 19, Vite, Tailwind CSS 4, TanStack Router + Query, TipTap (markdown editing) |
| API             | Hono on Cloudflare Workers, zod validation                                         |
| Data            | Cloudflare D1 (Drizzle ORM), R2 for documents and images                           |
| Background jobs | Cloudflare Workflows                                                               |
| Real-time       | A Durable Object per programme that broadcasts cache invalidations over WebSockets |
| AI              | Any OpenAI-compatible endpoint (default: Gemini) or Anthropic                      |

## Local development

Requirements: Node.js 22+ and pnpm.

```bash
pnpm install
```

```bash
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars`: set `AI_API_KEY` (a Gemini API key by default) and put your own e-mail address
in `ADMIN_EMAILS`. With `LOG_OTP_CODES=true` login codes are printed in the terminal, so no
e-mail setup is needed locally.

```bash
pnpm db:migrate
```

```bash
pnpm dev
```

Open http://localhost:5173, log in with the address from `ADMIN_EMAILS`, and create a programme.
A good first run:

1. **Settings → Import → Import LTOs from CSV** with `data/ltos.csv`.
2. **Settings → Import → Import courses from web pages** with the programme's study guide URL,
   e.g. `https://studiegids.vu.nl/en/Bachelor/2026-2027/communication-science`.
3. **Courses → Fetch study guides**, then upload course manuals on the course pages.

The Vite dev server runs the Worker itself (via `@cloudflare/vite-plugin`), including D1, R2,
the Durable Object and Workflows, with local state in `.wrangler/`.

### Checks

```bash
pnpm check
```

This runs the TypeScript compiler, ESLint (strict, type-aware, no `any`) and the unit tests.

### Trying prompts on real documents

`scripts/try-pipeline.ts` runs extraction and linking on local files without the app, which is
the quickest way to tune prompts:

```bash
AI_API_KEY=... pnpm try-pipeline path/to/manual.pdf --guide https://studiegids.vu.nl/en/courses/2025-2026/S_AIS
```

### Sandboxed environments

If the local Workers runtime cannot reach the internet (some cloud sandboxes only allow traffic
through an HTTP proxy), run `pnpm dev:relay` in a second terminal and add
`OUTBOUND_RELAY=http://127.0.0.1:8790` to `.dev.vars`. Never set this in production.

## Configuration

Variables live in `wrangler.jsonc` (`vars`); secrets are set with `wrangler secret put`.

| Name                  | Purpose                                                                           |
| --------------------- | --------------------------------------------------------------------------------- |
| `AI_API_KEY` (secret) | API key of the AI provider                                                        |
| `AI_PROVIDER`         | `openai-compatible` (Gemini, Cloudflare AI Gateway, Open WebUI, …) or `anthropic` |
| `AI_BASE_URL`         | Base URL of the provider's API                                                    |
| `AI_MODEL_EXTRACT`    | Model that extracts information from documents (default `gemini-flash-latest`)    |
| `AI_MODEL_LINK`       | Model that links evidence to LTOs (default `gemini-pro-latest`)                   |
| `ADMIN_EMAILS`        | Comma-separated addresses that become server admins on login                      |
| `EMAIL_FROM`          | Sender address for login codes (Cloudflare Email Service)                         |
| `LOG_OTP_CODES`       | `true` prints login codes to the log; development only                            |

To route AI calls through **Cloudflare AI Gateway** (logging, caching, spend limits), set
`AI_BASE_URL` to the gateway's OpenAI-compatible endpoint for your provider. The model needs to
support structured output (JSON schema); for PDFs it also needs native PDF input.

## Deploying to Cloudflare

```bash
pnpm wrangler login
```

```bash
pnpm wrangler d1 create learning-trajectories
```

Copy the printed `database_id` into `wrangler.jsonc`.

```bash
pnpm wrangler r2 bucket create learning-trajectories-files
```

```bash
pnpm wrangler secret put AI_API_KEY
```

Set `ADMIN_EMAILS` and `EMAIL_FROM` in `wrangler.jsonc` (the sender domain must be set up in
Cloudflare Email Service), then:

```bash
pnpm db:migrate:remote
```

```bash
pnpm run deploy
```

Run `pnpm db:migrate:remote` again whenever a deploy includes new migrations
(`pnpm db:generate` creates them from `worker/db/schema.ts`).

## Project structure

```
shared/       Types and logic used by both sides: Bloom taxonomy, extraction field types,
              coverage aggregation, roles, the API contract (zod schemas + response types)
worker/       Cloudflare Worker
  routes/     Hono routes per resource
  auth/       E-mail login codes, sessions, share-link cookies
  ai/         Provider-independent LLM client (OpenAI-compatible, Anthropic)
  pipeline/   Extraction, quote verification, linking, pointer judging, the Workflow
  services/   Queries shared by routes (course facts, staleness, study guide fetching)
  realtime/   ProgrammeHub Durable Object (invalidation broadcasts)
  db/         Drizzle schema and helpers
frontend/src/
  api/        Typed fetch client, query keys, queries and mutations
  components/ UI primitives, layout, markdown editor, Bloom flowers, evidence
  features/   Pages: programme, trajectories, courses, settings, views
migrations/   D1 migrations (generated by drizzle-kit)
scripts/      Prompt-tuning script and the development relay
data/         LTOs from the prototype, for import
docs/         Design plan and parked ideas
```
