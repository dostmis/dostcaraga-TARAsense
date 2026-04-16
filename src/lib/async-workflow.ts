import { randomUUID } from "crypto";

type BackgroundTaskOptions = {
  traceId?: string;
  metadata?: Record<string, unknown>;
};

function normalizeTaskLabel(taskName: string) {
  return taskName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { message: String(error) };
}

export function createWorkflowTraceId(prefix: string) {
  const safePrefix = normalizeTaskLabel(prefix) || "workflow";
  return `${safePrefix}-${randomUUID().slice(0, 8)}`;
}

export function runInBackground(taskName: string, task: () => Promise<void>, options?: BackgroundTaskOptions) {
  const traceId = options?.traceId ?? createWorkflowTraceId(taskName);

  queueMicrotask(() => {
    const startedAt = Date.now();

    void Promise.resolve()
      .then(task)
      .then(() => {
        console.info(`[workflow] ${taskName} completed`, {
          traceId,
          durationMs: Date.now() - startedAt,
          ...(options?.metadata ?? {}),
        });
      })
      .catch((error) => {
        console.error(`[workflow] ${taskName} failed`, {
          traceId,
          durationMs: Date.now() - startedAt,
          ...(options?.metadata ?? {}),
          error: serializeError(error),
        });
      });
  });

  return traceId;
}
