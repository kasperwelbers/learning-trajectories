import { app } from "./app"

export { ProgrammeHub } from "./realtime/ProgrammeHub"
export { AnalysisWorkflow } from "./pipeline/workflow"

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>
