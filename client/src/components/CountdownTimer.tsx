import React, { useEffect, useState } from "react";
import { formatMmSs } from "../lib/timeFmt.js";

interface CountdownTimerProps {
  deadline: number;            // Date.now() 毫秒时间戳
  warnThresholdMs?: number;    // 默认 30000（最后 30s 转警告色）
  dangerThresholdMs?: number;  // 默认 2000（最后 2s 闪烁）
}

export function CountdownTimer({
  deadline,
  warnThresholdMs = 30_000,
  dangerThresholdMs = 2_000,
}: CountdownTimerProps) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, deadline - Date.now())
  );

  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, deadline - Date.now()));
    const id = setInterval(tick, 500);
    tick();
    return () => clearInterval(id);
  }, [deadline]);

  const isWarn   = remaining <= warnThresholdMs;
  const isDanger = remaining <= dangerThresholdMs;

  return (
    <span
      className={[
        "countdown-timer",
        isWarn   ? "countdown-timer--warn"   : "",
        isDanger ? "countdown-timer--danger" : "",
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
