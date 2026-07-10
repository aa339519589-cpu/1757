import { findInvokableRuns, findPollableRuns } from "./repository";
import { invokeRun, pollRun } from "./run-engine";

const intervalMs = Math.max(300, Number(process.env.RUN_WORKER_INTERVAL_MS ?? 700));
let stopping = false;

async function tick(): Promise<void> {
  const invoke = findInvokableRuns(3).map((run) => invokeRun(run.id));
  const poll = findPollableRuns(6).map((run) => pollRun(run.id));
  await Promise.allSettled([...invoke, ...poll]);
}

async function start(): Promise<void> {
  console.log("Relay run worker started");
  while (!stopping) {
    try {
      await tick();
    } catch {
      console.error("Relay run worker tick failed");
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

process.once("SIGINT", () => { stopping = true; });
process.once("SIGTERM", () => { stopping = true; });

void start();
