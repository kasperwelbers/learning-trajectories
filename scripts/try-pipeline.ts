/**
 * Run the extraction and linking prompts on local documents, without the app.
 * Useful for tuning prompts against real course material.
 *
 *   AI_API_KEY=... pnpm try-pipeline manual.pdf [--guide https://studiegids.vu.nl/en/courses/2026-2027/S_AIS] [--lto AS1,PC1]
 *
 * LTOs are read from data/ltos.csv. Results are written to scripts/out/.
 * Environment: AI_API_KEY (required), AI_BASE_URL, AI_MODEL_EXTRACT, AI_MODEL_LINK.
 * Behind a proxy, run with NODE_USE_ENV_PROXY=1.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { basename, extname } from "node:path"
import { parseArgs } from "node:util"
import Papa from "papaparse"
import { z } from "zod"
import type { DocumentKind } from "../shared/evidence.ts"
import { DEFAULT_CUSTOM_FIELDS, SYSTEM_FIELDS } from "../shared/fields.ts"
import { OpenAiCompatibleClient } from "../worker/ai/openaiCompatible.ts"
import {
  LlmRequestError,
  type GenerateRequest,
  type GenerateResult,
  type LlmClient,
} from "../worker/ai/types.ts"
import {
  assembleExtractions,
  buildLinks,
  toLinkingStatements,
  type ExtractedDocument,
} from "../worker/pipeline/assemble.ts"
import { documentPages } from "../worker/pipeline/documentText.ts"
import { extractDocument } from "../worker/pipeline/extract.ts"
import { linkLto, type LinkingLto } from "../worker/pipeline/link.ts"
import { DocumentMatcher } from "../worker/pipeline/verify.ts"
import { fetchStudyGuideText } from "../worker/pipeline/studyGuideText.ts"

const env = z
  .object({
    AI_API_KEY: z.string().min(1),
    AI_BASE_URL: z.string().default("https://generativelanguage.googleapis.com/v1beta/openai"),
    AI_MODEL_EXTRACT: z.string().default("gemini-flash-latest"),
    AI_MODEL_LINK: z.string().default("gemini-pro-latest"),
  })
  .parse(process.env)

const ltoRow = z.object({
  trajectory: z.string(),
  name: z.string(),
  outcome: z.string(),
})

async function loadLtos(only: string[]): Promise<LinkingLto[]> {
  const csv = await readFile(new URL("../data/ltos.csv", import.meta.url), "utf8")
  const rows = Papa.parse<unknown>(csv, {
    header: true,
    skipEmptyLines: true,
  }).data
  const ltos = rows.map((row, i) => {
    const r = ltoRow.parse(row)
    return {
      id: i + 1,
      code: r.name.trim(),
      title: r.outcome.trim(),
      narrative: "",
      trajectory: { name: r.trajectory.trim(), narrative: "" },
    }
  })
  return only.length > 0 ? ltos.filter((l) => only.includes(l.code)) : ltos
}

interface InputDocument {
  id: number
  kind: DocumentKind
  filename: string
  content: { type: "pdf"; data: Uint8Array } | { type: "text"; text: string }
  pages: string[]
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { guide: { type: "string" }, lto: { type: "string" } },
  })
  const client = withRetries(new OpenAiCompatibleClient(env.AI_BASE_URL, env.AI_API_KEY))
  const fields = [...SYSTEM_FIELDS, ...DEFAULT_CUSTOM_FIELDS]
  const ltos = await loadLtos(values.lto ? values.lto.split(",") : [])

  const docs: InputDocument[] = []
  if (values.guide) {
    const text = await fetchStudyGuideText(values.guide)
    docs.push({
      id: docs.length + 1,
      kind: "study_guide",
      filename: "study guide",
      content: { type: "text", text },
      pages: [text],
    })
  }
  for (const file of positionals) {
    const bytes = new Uint8Array(await readFile(file))
    docs.push({
      id: docs.length + 1,
      kind: "manual",
      filename: basename(file),
      content: { type: "pdf", data: bytes },
      pages: await documentPages(bytes, "application/pdf"),
    })
  }
  if (docs.length === 0) throw new Error("Pass a PDF and/or --guide URL")

  const extracted: ExtractedDocument[] = []
  for (const doc of docs) {
    const started = Date.now()
    const { extraction } = await extractDocument(client, {
      kind: doc.kind,
      filename: doc.filename,
      content: doc.content,
      fields: doc.kind === "supplementary" ? [] : fields,
      model: env.AI_MODEL_EXTRACT,
    })
    console.log(
      `▶ extracted ${doc.kind} ${doc.filename} in ${((Date.now() - started) / 1000).toFixed(1)}s`,
    )
    extracted.push({
      documentId: doc.id,
      kind: doc.kind,
      extraction,
      matcher: new DocumentMatcher(doc.pages),
    })
  }
  const assembled = assembleExtractions(extracted, fields)
  for (const f of assembled.fields) {
    console.log(
      `  ${f.key.padEnd(20)} ${f.status.padEnd(8)} ${(f.source ?? "-").padEnd(12)} ${JSON.stringify(f.value)} [${f.verification}]`,
    )
  }
  for (const s of assembled.statements) {
    console.log(
      `  [${s.ordinal}] ${s.kind.padEnd(13)} doc${s.documentId} p${s.page ?? "-"} ${s.verification.padEnd(11)} ${s.quote.slice(0, 80)}`,
    )
  }

  const kinds = new Map(docs.map((d) => [d.id, d.kind]))
  const course = {
    key: 1,
    code: String(assembled.fields.find((f) => f.key === "course_code")?.value ?? "COURSE"),
    name: String(assembled.fields.find((f) => f.key === "course_name")?.value ?? "Course"),
    statements: toLinkingStatements(assembled.statements, kinds),
  }
  const started = Date.now()
  const proposed = []
  for (let i = 0; i < ltos.length; i += 5) {
    const batch = await Promise.all(
      ltos.slice(i, i + 5).map((lto) => linkLto(client, env.AI_MODEL_LINK, lto, [course])),
    )
    proposed.push(...batch.flatMap((b) => b.links))
  }
  const byOrdinal = new Map(assembled.statements.map((s) => [s.ordinal, s]))
  const links = buildLinks(proposed, (id) => byOrdinal.get(id), kinds)
  console.log(
    `▶ linked ${ltos.length} LTOs in ${((Date.now() - started) / 1000).toFixed(1)}s: ${links.length} links`,
  )
  for (const link of links) {
    const lto = ltos.find((l) => l.id === link.ltoId)
    console.log(
      `  ${(lto?.code ?? "?").padEnd(8)} ${link.ref.domain}/${link.ref.level.padEnd(12)} ${link.tested ? "tested" : "taught"} [${link.sources.join("+")}] conf ${link.confidence.toFixed(2)} [${link.statementOrdinals.join(",")}] ${link.justification}`,
    )
  }
  const outDir = new URL("./out/", import.meta.url)
  await mkdir(outDir, { recursive: true })
  const name = positionals[0] ? basename(positionals[0], extname(positionals[0])) : course.code
  await writeFile(new URL(`${name}.json`, outDir), JSON.stringify({ assembled, links }, null, 2))
}

/** In the app, workflow steps retry; here we retry transient provider errors ourselves. */
function withRetries(inner: LlmClient, attempts = 4): LlmClient {
  return {
    async generate<T>(request: GenerateRequest<T>): Promise<GenerateResult<T>> {
      for (let attempt = 1; ; attempt++) {
        try {
          return await inner.generate(request)
        } catch (error) {
          if (!(error instanceof LlmRequestError && error.retryable) || attempt >= attempts)
            throw error
          console.warn(`  (retrying after ${error.status})`)
          await new Promise((resolve) => setTimeout(resolve, 5000 * attempt))
        }
      }
    },
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
