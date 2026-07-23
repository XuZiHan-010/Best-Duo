// superseded：讨论发言在途时真人又发了新消息，请求被取代（P1-2）；
// 归类为 cancelled（classifyModelError），不推进失败熔断。
export type ModelAbortReason =
  | "deadline"
  | "phase_changed"
  | "turn_changed"
  | "attempt_changed"
  | "superseded"
  | "shutdown";

export const abortModelRequest = (controller: AbortController, reason: ModelAbortReason) => {
  if (!controller.signal.aborted) controller.abort(reason);
};

export const modelAbortReason = (signal?: AbortSignal): ModelAbortReason | null => {
  if (!signal?.aborted) return null;
  const reason = signal.reason;
  return reason === "deadline" ||
    reason === "phase_changed" ||
    reason === "turn_changed" ||
    reason === "attempt_changed" ||
    reason === "superseded" ||
    reason === "shutdown"
    ? reason
    : "phase_changed";
};
