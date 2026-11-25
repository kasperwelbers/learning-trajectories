# Learning Trajectories — design plan

This document records the design of the Learning Trajectory Organizer: the successor of the
_TLO builder_ prototype (which should have been called _LTO_ builder). It explains **why** the app
works the way it does; the README explains how to run it.

## Lessons from the prototype

1. **Strict Bloom levels on outcomes caused endless debate.** "Does an LTO at _analyse_ also
   imply _understand_?" The new model drops the level from LTOs and ILOs. LTOs are phrased in
   Bloom style, but the _evidence_ determines at which levels an LTO is covered.
2. **Coordinators did not share an interpretation of Bloom indicators.** Having a dozen people
   draw ILO→LTO links by hand produced inconsistent mappings. The new model lets one AI do the
   linking with the same instructions for every course, and keeps humans in charge of the
   _narratives_ (trajectory coordinators) and of the _source documents_ (course coordinators).
3. **The course manual should be the source of truth.** It is the official document that already
   exists. Using it as input doubles as a quality check: if the AI cannot find something, the
   manual is unclear about it.

## Roles

| Role                      | Scope          | Can                                                                      |
| ------------------------- | -------------- | ------------------------------------------------------------------------ |
| Server admin              | everything     | create programmes, manage server admins                                  |
| Programme admin           | programme      | everything inside the programme                                          |
| Trajectory coordinator    | one trajectory | edit trajectory narrative, its LTOs and their justifications             |
| Course coordinator        | one course     | upload manuals/materials, run analysis, dispute links, point to evidence |
| Member (any of the above) | programme      | read everything in the programme                                         |
| Share link                | programme      | read-only access without login (committees, students)                    |

Login is by one-time code sent to the user's (university) email. Auth is isolated in
`worker/auth/` so an OIDC provider can be added later.

## Core concepts

- **Programme** — a study programme (e.g. BSc Communication Science). Has a _current academic
  year_, which is the default year shown everywhere.
- **Trajectory** — a learning trajectory with a title, colour and markdown narrative.
- **LTO** (learning trajectory outcome) — belongs to a trajectory; a Bloom-style statement
  without a fixed level, plus a markdown narrative explaining what it means and how it is built up.
- **Framework / indicator** — generic sets of indicators against which trajectory coordinators
  justify that an LTO is _achieved_ (seeded: Dublin descriptors and the three Bloom domains;
  programmes can add e.g. their exit qualifications). Justifications are written by humans.
- **Course** — stable identity (code, name) across years.
- **Course document** — per course per academic year, three kinds:
  - **Study guide** — the public course description, fetched by URL (e.g. the VU study guide).
    One per year. Gives early, public evidence and fills in metadata the manual lacks.
  - **Course manual** — one per year; the source of truth for the manual check.
  - **Supplementary material** — any number of files (rubrics, assignment instructions).

  Every piece of evidence records which kind of document it comes from, so views can show what
  is _explicit in the study guide_ versus only in the manual or other material.

- **Analysis** — the result of running the pipeline for one course-year.

## Bloom's taxonomy: three domains

| Domain      | Levels (low → high)                                              | Source                          |
| ----------- | ---------------------------------------------------------------- | ------------------------------- |
| Cognitive   | Remember, Understand, Apply, Analyse, Evaluate, Create           | Anderson & Krathwohl (2001)     |
| Affective   | Receiving, Responding, Valuing, Organising, Characterising       | Krathwohl, Bloom & Masia (1964) |
| Psychomotor | Imitation, Manipulation, Precision, Articulation, Naturalisation | Dave (1970)                     |

Levels are _not_ cumulative in the data: a level is covered only when there is evidence for that
level. Views may choose to show context, but never invent coverage.

**Flowers.** Every LTO shows one flower per domain with at least one covered level. Petals are
levels (low → high, clockwise from the top). A petal is filled in the domain colour when the level
is _tested_, drawn as an outline when it is only _taught_, and grey when not covered.

## Taught vs tested

The AI does not decide whether something is tested; the document structure does. Every extracted
learning statement has a _kind_:

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
new manual / study guide page (R2, sha-256)
  └─ Workflow "analysis" (one course-year)
       1. per document: text layer (cached in R2 by sha-256) for quote verification
       2. per document: extract   (cached by sha-256 + prompt version + model + field schema)
            manual, study guide → metadata fields + statements + assessments + rubrics
            supplementary       → statements + rubrics
       3. assemble + verify quotes (fuzzy, tolerant of broken PDF text layers)
       4. link: one call per LTO (in parallel batches), each judging only that LTO
       5. judge coordinator pointers
       6. save everything in one D1 batch; broadcast invalidations

LTO or trajectory narrative edited
  └─ Workflow "relink" (one LTO): waits 2 minutes (a newer edit supersedes it), then re-links
     that LTO across all analysed courses (one call per year, at most 12 courses per call)
```

**One LTO per linking call.** Each call sees one LTO with its own trajectory narrative and
nothing about the other LTOs. The judgement for a course × LTO therefore does not depend on which
other LTOs exist, and an LTO edit only re-links that LTO. Judging LTOs in isolation made the
model more generous, so the prompt has a gating stage: per course it first states whether the
course addresses the LTO's _core subject_ (generic skills such as critical thinking only count
when they are the subject of the LTO); links for rejected courses are discarded.

**Staleness** is tracked per analysis × LTO (`link_runs` stores the LTO's hash at link time) and
per analysis for documents (`documents_hash`).

- PDFs are sent to the model natively (page-aware, no lossy text extraction); DOCX/HTML/text are
  converted to text first. Study guide pages are stored as their main text, so re-fetching an
  unchanged page does not trigger a new extraction.
- Quote verification uses the PDF text layer; unverifiable quotes are flagged, not dropped.
- Metadata comes from the manual; where it is silent, the study guide fills in, labelled with
  its source. The manual check only counts what the manual itself states.
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

| Concern                   | Choice                                                                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Hosting                   | One Cloudflare Worker serving API + static assets                                                                                      |
| Dev server                | Vite with `@cloudflare/vite-plugin` (worker runs in workerd inside Vite)                                                               |
| API                       | Hono, zod validation, typed client via `hono/client`                                                                                   |
| Client data               | TanStack Query, one query key per resource (`shared/queryKeys.ts`)                                                                     |
| Real-time                 | `ProgrammeHub` Durable Object per programme: broadcasts _invalidation_ messages and job progress only — data always flows through REST |
| Concurrent edits          | Optimistic concurrency: editable rows carry a `version`; stale writes get HTTP 409                                                     |
| Database                  | D1 via Drizzle                                                                                                                         |
| Files                     | R2 (`FILES` bucket): course documents and narrative images                                                                             |
| Background work           | Cloudflare Workflows (durable steps, retries)                                                                                          |
| Outbound HTTP (sandboxes) | Optional `OUTBOUND_RELAY`, development only (see `worker/outbound.ts`)                                                                 |
| Routing                   | TanStack Router, code-based route tree, typed search params (`?year=`)                                                                 |
| Editing                   | TipTap WYSIWYG that reads and writes markdown; images uploaded to R2                                                                   |
| Rendering markdown        | react-markdown + remark-gfm                                                                                                            |

### Why not the prototype's sync model

The prototype pushed full project state over a WebSocket and accepted writes over the same
socket. That made caching impossible, every change re-sent whole tables, errors were hard to
attribute to a request, and public read-only views needed a live socket. Now every resource is a
cacheable GET, mutations are ordinary requests with proper status codes, and the socket is only a
hint to refetch.

## Views

All views take an academic year (default: programme's current year) and work with share links.

1. **Trajectory journey** — per trajectory, courses on a timeline (programme year × period) with
   the flowers they contribute, and the flower reached at the end.
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
data/       Seed data (LTOs from the prototype; import in Settings → Import)
docs/       This plan and parked ideas
```
