# Learning Trajectories — design plan

This document records the design of the Learning Trajectory Organizer: the successor of the
*TLO builder* prototype (which should have been called *LTO* builder). It explains **why** the app
works the way it does; the README explains how to run it.

## Lessons from the prototype

1. **Strict Bloom levels on outcomes caused endless debate.** "Does an LTO at *analyse* also
   imply *understand*?" The new model drops the level from LTOs and ILOs. LTOs are phrased in
   Bloom style, but the *evidence* determines at which levels an LTO is covered.
2. **Coordinators did not share an interpretation of Bloom indicators.** Having a dozen people
   draw ILO→LTO links by hand produced inconsistent mappings. The new model lets one AI do the
   linking with the same instructions for every course, and keeps humans in charge of the
   *narratives* (trajectory coordinators) and of the *source documents* (course coordinators).
3. **The course manual should be the source of truth.** It is the official document that already
   exists. Using it as input doubles as a quality check: if the AI cannot find something, the
   manual is unclear about it.

## Roles

| Role | Scope | Can |
|---|---|---|
| Server admin | everything | create programmes, manage server admins |
| Programme admin | programme | everything inside the programme |
| Trajectory coordinator | one trajectory | edit trajectory narrative, its LTOs and their justifications |
| Course coordinator | one course | upload manuals/materials, run analysis, dispute links, point to evidence |
| Member (any of the above) | programme | read everything in the programme |
| Share link | programme | read-only access without login (committees, students) |

Login is by one-time code sent to the user's (university) email. Auth is isolated in
`worker/auth/` so an OIDC provider can be added later.

## Core concepts

- **Programme** — a study programme (e.g. BSc Communication Science). Has a *current academic
  year*, which is the default year shown everywhere.
- **Trajectory** — a learning trajectory with a title, colour and markdown narrative.
- **LTO** (learning trajectory outcome) — belongs to a trajectory; a Bloom-style statement
  without a fixed level, plus a markdown narrative explaining what it means and how it is built up.
- **Framework / indicator** — generic sets of indicators against which trajectory coordinators
  justify that an LTO is *achieved* (seeded: Dublin descriptors and the three Bloom domains;
  programmes can add e.g. their exit qualifications). Justifications are written by humans.
- **Course** — stable identity (code, name) across years.
- **Course document** — per course per academic year: exactly one **course manual** (required,
  the source of truth for metadata and learning statements) and any number of **supplementary
  materials** (rubrics, assignment instructions). Supplementary materials can provide evidence,
  which is always labelled as such.
- **Analysis** — the result of running the pipeline for one course-year.

## Bloom's taxonomy: three domains

| Domain | Levels (low → high) | Source |
|---|---|---|
| Cognitive | Remember, Understand, Apply, Analyse, Evaluate, Create | Anderson & Krathwohl (2001) |
| Affective | Receiving, Responding, Valuing, Organising, Characterising | Krathwohl, Bloom & Masia (1964) |
| Psychomotor | Imitation, Manipulation, Precision, Articulation, Naturalisation | Dave (1970) |

Levels are *not* cumulative in the data: a level is covered only when there is evidence for that
level. Views may choose to show context, but never invent coverage.

**Flowers.** Every LTO shows one flower per domain with at least one covered level. Petals are
levels (low → high, clockwise from the top). A petal is filled in the domain colour when the level
is *tested*, drawn as an outline when it is only *taught*, and grey when not covered.

## Taught vs tested

The AI does not decide whether something is tested; the document structure does. Every extracted
learning statement has a *kind*:

- `learning_goal` — from the learning objectives section.
- `activity` — what students do (lectures, practicals, projects).
- `assessment` — what is assessed and how.

A link at a given Bloom level is **tested** when its evidence includes an `assessment` statement,
or a `learning_goal` that the manual explicitly maps to an assessment (an assessment matrix).
Otherwise it is **taught**. Manuals that never state what is tested therefore show up as
"taught only", which is an honest signal for the course coordinator.

## The AI pipeline

All AI output is **extracted, not written**: values come with a verbatim quote and page number.
The only AI-written text is a short justification per link.

```
upload (R2, sha-256)
  └─ Workflow: AnalysisWorkflow(analysisId)
       1. per document: extract            (cached by sha256 + schema hash + prompt version)
            manual        → metadata fields (programme field schema) + statements + assessments
            supplementary → statements + rubrics
       2. verify quotes against the document text (fuzzy, whitespace/zero-width tolerant)
       3. link statements → LTOs per Bloom domain/level, with short justifications
       4. judge coordinator pointers (see below)
       5. store, mark analysis done, broadcast invalidation
```

- PDFs are sent to the model natively (page-aware, no lossy text extraction); DOCX/HTML/text are
  converted to text first.
- Quote verification uses the PDF text layer; unverifiable quotes are flagged, not dropped.
- When an LTO narrative changes, analyses record the hash of the LTO set they were linked
  against, so stale analyses are visible and can be re-linked in bulk.
- Providers sit behind a small `LlmClient` interface. Default: Gemini via its OpenAI-compatible
  endpoint (prepaid key), optionally routed through Cloudflare AI Gateway for logging, caching and
  spend limits. An Anthropic adapter is included.

### Extraction fields

Each programme has a list of extraction fields: `key`, `label`, `type`, `prompt`, `required`.
Types: `string`, `number`, `boolean`, `factor` (fixed list of values) and `array` of any of these.
System fields (code, name, year, periods, EC, level, coordinators, examiner, language) are always
present because the standard views need them; their prompts can be tuned but they cannot be
removed. The structured-output JSON schema is generated from this list. Every field returns
`{ value, status: found | unclear | missing, quote, page }`. Required fields drive the
**manual health** check; a cross-course table shows consistency (e.g. whether every course has
an AI statement).

### Coordinator feedback without manual edits

AI results are not edited by hand. Instead course coordinators can:

- **Dispute** a link (course × LTO × level, or the whole LTO) with a note. Disputes persist across
  re-runs and are shown next to the link ("previously disputed — still present" / "resolved").
- **Point and judge** — point at an LTO plus a passage in one of the course's documents. The AI
  judges with the same rules whether the passage supports the LTO and at which level. The result
  is shown as a coordinator-pointed link, visibly distinct from links the AI found on its own.

There are deliberately no free-text instructions to the AI: the manual should stand on its own.

## Architecture

| Concern | Choice |
|---|---|
| Hosting | One Cloudflare Worker serving API + static assets |
| Dev server | Vite with `@cloudflare/vite-plugin` (worker runs in workerd inside Vite) |
| API | Hono, zod validation, typed client via `hono/client` |
| Client data | TanStack Query, one query key per resource (`shared/queryKeys.ts`) |
| Real-time | `ProgrammeHub` Durable Object per programme: broadcasts *invalidation* messages and job progress only — data always flows through REST |
| Concurrent edits | Optimistic concurrency: editable rows carry a `version`; stale writes get HTTP 409 |
| Database | D1 via Drizzle |
| Files | R2 (`FILES` bucket): course documents and narrative images |
| Background work | Cloudflare Workflows (durable steps, retries) |
| Routing | TanStack Router, code-based route tree, typed search params (`?year=`) |
| Editing | TipTap WYSIWYG that reads and writes markdown; images uploaded to R2 |
| Rendering markdown | react-markdown + remark-gfm |

### Why not the prototype's sync model

The prototype pushed full project state over a WebSocket and accepted writes over the same
socket. That made caching impossible, every change re-sent whole tables, errors were hard to
attribute to a request, and public read-only views needed a live socket. Now every resource is a
cacheable GET, mutations are ordinary requests with proper status codes, and the socket is only a
hint to refetch.

## Views

All views take an academic year (default: programme's current year) and work with share links.

1. **Trajectory journey** — per trajectory, courses on a timeline (year × period) with the
   flowers they contribute.
2. **LTO × Bloom heatmap** — rows LTOs, columns domain levels; cells show courses that teach/test.
3. **Course × LTO matrix** — what each course contributes, highest level and tested marker.
4. **LTO detail** — narrative, justifications per framework, contributing courses per level with
   quotes and AI justifications, disputes.
5. **Course metadata table** — courses × extraction fields, coloured by found/unclear/missing.
6. **Programme report** — printable (print CSS → PDF) overview for visitation committees.

## Repository layout

```
shared/     Pure TypeScript used by worker and frontend (domain types, Bloom, field types,
            zod API schemas, query keys, coverage aggregation)
worker/     Cloudflare Worker: Hono app, routes, auth, db, ai, pipeline, realtime hub
frontend/   React app
migrations/ D1 migrations
scripts/    Developer scripts (e.g. run the extraction prompt on a local PDF)
data/       Seed data (LTOs from the prototype)
docs/       This plan and parked ideas
```
