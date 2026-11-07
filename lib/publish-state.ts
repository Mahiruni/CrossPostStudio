export type PublishState = {
  attemptId: string;
  updatedAt: string;
  startedAt: string;
  progress: number;
  stage: string;
  phase: "starting" | "uploading" | "finishing" | "processing" | "submitting" | "review" | "interrupted" | "error" | "done";
  sessionId?: string;
  startOffset?: number;
  endOffset?: number;
  finishConfirmed?: boolean;
  error?: string;
};

export const LEASE_MS = 90_000;
export function parsePublishState(raw: string | null | undefined): PublishState | null {
  if (!raw) return null;
  try {
    const state = JSON.parse(raw) as PublishState;
    if (!state || typeof state.attemptId !== "string" || !Number.isFinite(Date.parse(state.updatedAt)) || !Number.isFinite(Date.parse(state.startedAt))) return null;
    return { ...state, progress: Math.max(0, Math.min(100, Number(state.progress) || 0)) };
  } catch { return null; }
}
export function isActivePublish(state: PublishState | null, now = Date.now()): boolean {
  return Boolean(state && ["starting", "uploading", "finishing", "submitting"].includes(state.phase) && now >= Date.parse(state.updatedAt) && now - Date.parse(state.updatedAt) < LEASE_MS);
}
export function normalizedMessage(value: string): string { return value.replace(/\r\n?/g, "\n").trim(); }
export function uploadRange(start: unknown, end: unknown, total: number): {start:number;end:number} {
  const a = Number(start), b = Number(end);
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 0 || b < a || b > total || (a < total && a === b)) throw new Error("Facebook returned an invalid upload range. Your original file is safe.");
  return { start: a, end: b };
}
export function videoReady(status?: { video_status?: string; publishing_phase?: { status?: string } }, published?: boolean): boolean {
  return status?.video_status === "ready" && published !== false;
}
