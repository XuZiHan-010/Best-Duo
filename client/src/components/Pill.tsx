import React from "react";

interface PillOption<T extends string | number> {
  value: T;
  label: string;
}

interface PillProps<T extends string | number> {
  options: PillOption<T>[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
  name: string;
}

export function Pill<T extends string | number>({
  options,
  value,
  onChange,
  disabled = false,
  name,
}: PillProps<T>) {
  const refs = React.useRef<Array<HTMLButtonElement | null>>([]);

  // Roving tabindex: only the active option is a Tab stop; arrow keys move
  // both focus and the selection across the rest, matching native radio
  // group behavior.
  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (disabled) return;
    let nextIndex: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") nextIndex = (index + 1) % options.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") nextIndex = (index - 1 + options.length) % options.length;
    else if (e.key === "Home") nextIndex = 0;
    else if (e.key === "End") nextIndex = options.length - 1;
    if (nextIndex === null) return;
    e.preventDefault();
    onChange(options[nextIndex].value);
    refs.current[nextIndex]?.focus();
  };

  return (
    <div className="pill" role="group" aria-label={name}>
      {options.map((opt, index) => {
        const isActive = value === opt.value;
        return (
          <button
            key={opt.value}
            ref={(el) => { refs.current[index] = el; }}
            type="button"
            className={`pill__item${isActive ? " pill__item--active" : ""}`}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => onKeyDown(e, index)}
            disabled={disabled}
            aria-pressed={isActive}
            tabIndex={isActive ? 0 : -1}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
