import type { Topic } from "@shared/topics"

function hub(env: Env, programmeId: string) {
  return env.PROGRAMME_HUB.get(env.PROGRAMME_HUB.idFromName(programmeId))
}

/** Tell everyone viewing the programme to refetch the given topics. Never throws. */
export async function broadcast(env: Env, programmeId: string, topics: Topic[]): Promise<void> {
  try {
    await hub(env, programmeId).broadcast(topics)
  } catch (error) {
    console.warn("[realtime] broadcast failed", error)
  }
}

/** Forward a WebSocket upgrade request to the programme's hub. */
export function connectToHub(env: Env, programmeId: string, request: Request): Promise<Response> {
  return hub(env, programmeId).fetch(request)
}
