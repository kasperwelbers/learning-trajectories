import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import type { WorkflowParams } from "../services/analysisRunner"

export class AnalysisWorkflow extends WorkflowEntrypoint<Env, WorkflowParams> {
  override async run(event: WorkflowEvent<WorkflowParams>, step: WorkflowStep): Promise<void> {
    await step.do("todo", async () => {
      console.log(event.payload)
    })
  }
}
