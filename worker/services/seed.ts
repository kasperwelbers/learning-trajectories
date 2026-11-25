import { BLOOM, BLOOM_DOMAINS } from "@shared/bloom"
import { DEFAULT_CUSTOM_FIELDS, SYSTEM_FIELDS } from "@shared/fields"
import type { Db } from "../db/client"
import { extractionFields, frameworks, indicators } from "../db/schema"

interface FrameworkSeed {
  name: string
  description: string
  indicators: { code: string; name: string; description: string }[]
}

const DUBLIN: FrameworkSeed = {
  name: "Dublin descriptors",
  description:
    "The Dublin descriptors describe what a bachelor's graduate is expected to be able to do. Explain how achieving this LTO contributes to each descriptor.",
  indicators: [
    {
      code: "D1",
      name: "Knowledge and understanding",
      description:
        "Has demonstrated knowledge and understanding in a field of study that builds upon general secondary education and is supported by advanced textbooks, including some aspects informed by knowledge of the forefront of the field.",
    },
    {
      code: "D2",
      name: "Applying knowledge and understanding",
      description:
        "Can apply knowledge and understanding in a manner that indicates a professional approach, and has competences typically demonstrated through devising and sustaining arguments and solving problems.",
    },
    {
      code: "D3",
      name: "Making judgements",
      description:
        "Has the ability to gather and interpret relevant data to inform judgements that include reflection on relevant social, scientific or ethical issues.",
    },
    {
      code: "D4",
      name: "Communication",
      description:
        "Can communicate information, ideas, problems and solutions to both specialist and non-specialist audiences.",
    },
    {
      code: "D5",
      name: "Learning skills",
      description:
        "Has developed those learning skills needed to undertake further study with a high degree of autonomy.",
    },
  ],
}

const BLOOM_FRAMEWORK: FrameworkSeed = {
  name: "Bloom's taxonomy",
  description:
    "Explain at which levels this LTO should be achieved by graduation, and whether the courses (see the flowers) together achieve that.",
  indicators: BLOOM_DOMAINS.map((domain) => ({
    code: BLOOM[domain].label.slice(0, 1),
    name: BLOOM[domain].label,
    description: `${BLOOM[domain].description} Levels: ${BLOOM[domain].levels
      .map((l) => l.label)
      .join(", ")}.`,
  })),
}

/** Default frameworks and extraction fields for a new programme. */
export async function seedProgramme(db: Db, programmeId: string): Promise<void> {
  for (const [position, seed] of [DUBLIN, BLOOM_FRAMEWORK].entries()) {
    const framework = await db
      .insert(frameworks)
      .values({
        programmeId,
        name: seed.name,
        description: seed.description,
        position,
      })
      .returning({ id: frameworks.id })
      .get()
    await db.insert(indicators).values(
      seed.indicators.map((indicator, i) => ({
        ...indicator,
        programmeId,
        frameworkId: framework.id,
        position: i,
      })),
    )
  }
  const fields = [
    ...SYSTEM_FIELDS.map((f) => ({ ...f, system: true })),
    ...DEFAULT_CUSTOM_FIELDS.map((f) => ({ ...f, system: false })),
  ]
  await db
    .insert(extractionFields)
    .values(fields.map((field, position) => ({ ...field, programmeId, position })))
}
