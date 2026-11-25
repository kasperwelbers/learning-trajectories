# Parked ideas

Ideas that came up during design but are intentionally not built yet.

- **Canvas import.** Canvas can export a course as an `.imscc` (IMS Common Cartridge) zip with
  pages and files. Parsing that would let coordinators upload one file instead of collecting
  materials by hand. For now the course page explains how to download materials from Canvas.
- **OIDC login.** The university OIDC provider could replace or complement email codes. Auth is
  isolated in `worker/auth/` to make this a contained change.
- **Embeddings for matching ILOs across manual versions.** Not needed at current scale; the
  whole LTO set fits in one prompt.
- **Snapshots per academic year.** The system relies on good faith; showing the manual of the
  selected year is enough for now.
- **Course reports.** Extracted rubrics and assessments could feed yearly course reports.
- **Study-guide consistency check.** Compare learning goals in the online study guide with the
  course manual and flag differences.
- **Comments / discussion threads** on trajectories and LTOs (the prototype had these; disputes
  cover the main need for now).

## Ideas from the design discussion (November 2026)

### Questions instead of comments

The analysis should give coordinators a clear path to act on its results. Proposal: a
**questions** feature (rather than free comments), because a question says what is expected of
the person in charge and always has an answer path.

- Questions target a course, LTO or trajectory and are addressed to its coordinator(s).
- Authors: the AI (after an analysis) or any coordinator (e.g. a course coordinator asking a
  trajectory coordinator what an LTO means).
- AI-generated questions, phrased as questions, never as verdicts. Examples: "The manual does
  not say how objective 4 is assessed. Is it assessed, and if so, how?" or "The study guide
  mentions data visualisation but the manual does not. Is this still part of the course?"
- States: open → answered / marked irrelevant. Answers are kept and fed to the AI in later runs
  (as context, clearly separated from the documents, so the manual still stands on its own).
- Disputes on links could become one kind of question.

### A continuous "AI visitation committee"

Coordinators hold rich, qualitative knowledge, but not a shared understanding of formal
education guidelines and theory. The tool can supply that expert view reproducibly:

- **Reference documents at programme level**: previous visitation committee reports, faculty
  reports, the NVAO assessment framework
  (https://www.nvao.net/files/attachments/.117/Beoordelingskader_accreditatiestelsel_hoger_onderwijs_Nederland_2016_0.pdf),
  and results of earlier projects (e.g. the list of ILOs from the visible learning trajectories
  project). Simplest first step: upload them as programme documents the AI may consult.
- **Derived questions**: extract the questions a committee asked last time and answer them
  from the current analysis (with citations).
- **Retrieval**: answering free questions over all documents needs retrieval (embeddings in
  Cloudflare Vectorize + Workers AI embeddings). Only worth adding together with this feature.
- **LTO versions**: keep the history of LTO wording/narratives to show how trajectories evolve
  and to compare with what earlier committees saw.

### Local / university AI

The university Open WebUI server exposes an OpenAI-compatible API. Set `AI_BASE_URL` to its
`/api` endpoint, `AI_API_KEY` to its key and the model names accordingly. Check first whether
the chosen model supports structured output (JSON schema) and PDF input; if PDFs are not
supported, the pipeline needs a text-only mode (send extracted text instead of the file).
