/**
 * Run the extraction and linking prompts on local documents, without the app.
 * Useful for tuning prompts against real course manuals.
 *
 *   AI_API_KEY=... pnpm try-pipeline path/to/manual.pdf [more.pdf ...]
 *
 * LTOs are read from data/ltos.csv. Results are written to scripts/out/.
 * Environment: AI_API_KEY (required), AI_BASE_URL, AI_MODEL_EXTRACT, AI_MODEL_LINK.
 * Behind a proxy, run with NODE_USE_ENV_PROXY=1.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { basename, extname, join } from "node:path"
import Papa from "papaparse"
import { z } from "zod"
import { DEFAULT_CUSTOM_FIELDS, SYSTEM_FIELDS } from "../shared/fields.ts"
import { OpenAiCompatibleClient } from "../worker/ai/openaiCompatible.ts"
import { documentPages } from "../worker/pipeline/documentText.ts"
import { extractDocument } from "../worker/pipeline/extract.ts"
import { linkStatements, type LinkingLto, type LinkingStatement } from "../worker/pipeline/link.ts"
import { DocumentMatcher } from "../worker/pipeline/verify.ts"

const env = z
  .object({
    AI_API_KEY: z.string().min(1),
    AI_BASE_URL: z.string().default("https://generativelanguage.googleapis.com/v1beta/openai"),
    AI_MODEL_EXTRACT: z.string().default("gemini-flash-latest"),
    AI_MODEL_LINK: z.string().default("gemini-pro-latest"),
  })
  .parse(process.env)

const ltoRow = z.object({ trajectory: z.string(), name: z.string(), outcome: z.string() })

async function loadLtos(): Promise<LinkingLto[]> {
  const csv = await readFile(new URL("../data/ltos.csv", import.meta.url), "utf8")
  const rows = Papa.parse<unknown>(csv, { header: true, skipEmptyLines: true }).data
  return rows.map((row, i) => {
    const r = ltoRow.parse(row)
    return {
      id: i + 1,
      code: r.name.trim(),
      title: r.outcome.trim(),
      narrative: "",
      trajectory: { name: r.trajectory.trim(), narrative: "" },
    }
  })
}

async function main(): Promise<void> {
  const files = process.argv.slice(2)
  if (files.length === 0) throw new Error("Pass one or more PDF files")
  const client = new OpenAiCompatibleClient(env.AI_BASE_URL, env.AI_API_KEY)
  const fields = [...SYSTEM_FIELDS, ...DEFAULT_CUSTOM_FIELDS]
  const ltos = await loadLtos()
  const outDir = new URL("./out/", import.meta.url)
  await mkdir(outDir, { recursive: true })

  for (const file of files) {
    const name = basename(file, extname(file))
    const bytes = new Uint8Array(await readFile(file))
    console.log(`\n▶ ${name}: extracting with ${env.AI_MODEL_EXTRACT} …`)
    let started = Date.now()
    const { extraction, model } = await extractDocument(client, {
      kind: "manual",
      filename: basename(file),
      content: { type: "pdf", data: bytes },
      fields,
      model: env.AI_MODEL_EXTRACT,
    })
    console.log(`  done in ${((Date.now() - started) / 1000).toFixed(1)}s (${model})`)

    const matcher = new DocumentMatcher(await documentPages(bytes, "application/pdf"))
    const verification = { verified: 0, approximate: 0, unverified: 0 }
    const unverified: string[] = []
    for (const s of extraction.statements) {
      const v = matcher.verify(s.quote)
      verification[v]++
      if (v === "unverified") unverified.push(s.quote)
    }
    if (extraction.kind === "manual") {
      for (const [key, answer] of Object.entries(extraction.fields)) {
        console.log(`  ${key.padEnd(20)} ${answer.status.padEnd(8)} ${JSON.stringify(answer.value)}  [${answer.quote ? matcher.verify(answer.quote) : "-"}]`)
      }
    }
    console.log(`  statements: ${extraction.statements.length} (${JSON.stringify(verification)})`)
    for (const q of unverified) console.log(`    unverified: ${q.slice(0, 100)}`)

    const statements: LinkingStatement[] = extraction.statements.map((s, i) => ({
      id: i + 1,
      kind: s.kind,
      section: s.section,
      context: s.context,
      quote: s.quote,
      assessedBy: s.assessed_by,
      source: "manual",
    }))
    console.log(`  linking with ${env.AI_MODEL_LINK} …`)
    started = Date.now()
    const course = extraction.kind === "manual"
      ? { code: String(extraction.fields.course_code?.value ?? name), name: String(extraction.fields.course_name?.value ?? name) }
      : { code: name, name }
    const { links } = await linkStatements(client, env.AI_MODEL_LINK, course, ltos, statements)
    console.log(`  done in ${((Date.now() - started) / 1000).toFixed(1)}s: ${links.length} links`)
    for (const link of links) {
      const lto = ltos.find((l) => l.id === link.ltoId)
      console.log(`    ${lto?.code.padEnd(8)} ${link.ref.domain}/${link.ref.level.padEnd(12)} conf ${link.confidence.toFixed(2)} [${link.statementIds.join(",")}] ${link.justification}`)
    }
    await writeFile(join(outDir.pathname, `${name}.json`), JSON.stringify({ extraction, links }, null, 2))
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
