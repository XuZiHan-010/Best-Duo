import React, { useEffect, useRef } from "react";
import type { PendingHint, HintMarkers } from "@take-time/shared";
import { CountdownTimer } from "./CountdownTimer.js";
import { adapter } from "../socket/adapter.js";

interface HintPromptProps {
  pendingHint: PendingHint;
  hintMarkers: HintMarkers;
}

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function HintPrompt({ pendingHint, hintMarkers }: HintPromptProps) {
  const noRef  = useRef<HTMLButtonElement>(null);
  const yesRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const hintLeft = hintMarkers.total - hintMarkers.used;

  // Focus "不翻" (No) on mount — the safer default
  useEffect(() => {
    noRef.current?.focus();
  }, []);

  // Generic focus trap: Tab / Shift+Tab cycles across whatever is actually
  // focusable inside the dialog (not just a hard-coded yes/no pair), so it
  // keeps working if the dialog's content grows.
  // Esc is intentionally blocked (no handler → default browser Esc has no effect on non-dialog)
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      .filter((el) => !el.hasAttribute("disabled"));
    if (focusable.length === 0) return;
    e.preventDefault();
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const current = document.activeElement as HTMLElement;
    const currentIndex = focusable.indexOf(current);
    const next = e.shiftKey
      ? (currentIndex <= 0 ? last : focusable[currentIndex - 1])
      : (currentIndex === -1 || currentIndex === focusable.length - 1 ? first : focusable[currentIndex + 1]);
    next.focus();
  };

  const decide = (decision: "yes" | "no") => {
    adapter.hintDecide({ decision });
  };

  const canReveal = hintLeft > 0;

  return (
    <div
      className="hint-prompt-backdrop"
      // Board behind is inert via CSS pointer-events:none — no JS inert needed
    >
      <div
        ref={dialogRef}
        className="hint-prompt"
        role="dialog"
        aria-modal="true"
        aria-label="提示决策"
        onKeyDown={onKeyDown}
      >
        <p className="hint-prompt__title">翻开这张牌示意队友？</p>

        <div className="hint-prompt__markers" aria-label={`剩余提示标记 ${hintLeft} 个`}>
          {Array.from({ length: hintMarkers.total }).map((_, i) => (
            <span
              key={i}
              className={i < hintLeft ? "hint-prompt__dot" : "hint-prompt__dot hint-prompt__dot--used"}
              aria-hidden="true"
            >
              {i < hintLeft ? "◆" : "◇"}
            </span>
          ))}
          <span className="hint-prompt__markers-count">剩余 {hintLeft} / {hintMarkers.total}</span>
        </div>

        {!canReveal && (
          <p className="hint-prompt__no-markers">提示标记已用完，无法翻牌</p>
        )}

        <div className="hint-prompt__timer-row" aria-live="polite">
          <span className="hint-prompt__timer-label">自动关闭</span>
          <CountdownTimer
            deadline={pendingHint.deadline}
            warnThresholdMs={3000}
            dangerThresholdMs={1500}
            className="hint-prompt__timer"
          />
        </div>

        <div className="hint-prompt__actions">
          <button
            ref={yesRef}
            className="btn btn--primary hint-prompt__btn-yes"
            onClick={() => decide("yes")}
            disabled={!canReveal}
            aria-label="翻开牌"
          >
            翻开
          </button>
          <button
            ref={noRef}
            className="btn btn--ghost hint-prompt__btn-no"
            onClick={() => decide("no")}
            aria-label="不翻开"
          >
            不翻
          </button>
        </div>
      </div>
    </div>
  );
}
