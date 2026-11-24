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
