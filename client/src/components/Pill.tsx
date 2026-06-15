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
  return (
    <div className="pill" role="group" aria-label={name}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`pill__item${value === opt.value ? " pill__item--active" : ""}`}
          onClick={() => onChange(opt.value)}
          disabled={disabled}
          aria-pressed={value === opt.value}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
