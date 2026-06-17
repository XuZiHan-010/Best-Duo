import React, { useEffect, useState } from "react";
import { formatMmSs } from "../lib/timeFmt.js";

interface CountdownTimerProps {
  deadline: number;
  warnThresholdMs?: number;
  dangerThresholdMs?: number;
  className?: string;
}

export function CountdownTimer({
  deadline,
  warnThresholdMs = 30_000,
  dangerThresholdMs = 2_000,
  className,
}: CountdownTimerProps) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, deadline - Date.now())
  );

  // requestAnimationFrame instead of a fixed setInterval — the displayed
  // seconds only change at whole-second boundaries, but driving the check
  // from rAF (rather than polling every 500ms) keeps that boundary crossing
  // as close to on-time as the screen's own refresh, and pauses for free
  // when the tab isn't visible.
  useEffect(() => {
    let frameId: number;
    let lastShownMs = -1;
    const tick = () => {
      const ms = Math.max(0, deadline - Date.now());
      const shownSeconds = Math.ceil(ms / 1000);
      if (shownSeconds !== lastShownMs) {
        lastShownMs = shownSeconds;
        setRemaining(ms);
      }
      if (ms > 0) frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [deadline]);

  const isWarn   = remaining <= warnThresholdMs;
  const isDanger = remaining <= dangerThresholdMs;

  return (
    <span
      className={[
        "countdown-timer",
        isWarn   ? "countdown-timer--warn"   : "",
        isDanger ? "countdown-timer--danger" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-live="polite"
      aria-label={`剩余时间 ${formatMmSs(remaining)}`}
    >
      {formatMmSs(remaining)}
    </span>
  );
}
