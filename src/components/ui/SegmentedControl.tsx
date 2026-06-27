import React from 'react';
import type { LucideIcon } from 'lucide-react';

export interface SegmentOption<T extends string = string> {
  value: T;
  label: string;
  icon?: LucideIcon;
}

export interface SegmentedControlProps<T extends string = string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  /** Accessible group label. */
  'aria-label'?: string;
}

/**
 * SegmentedControl — pill-group toggle (e.g. UDP Per column / Per table,
 * separator / case selectors). Active segment = white fill + blue text on a
 * subtle tray. Controlled.
 */
export default function SegmentedControl<T extends string = string>({
  options,
  value,
  onChange,
  className,
  'aria-label': ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <div className={['dmh-seg', className].filter(Boolean).join(' ')} role="tablist" aria-label={ariaLabel}>
      {options.map((opt) => {
        const Icon = opt.icon;
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={['dmh-seg-btn', active ? 'is-active' : ''].filter(Boolean).join(' ')}
            onClick={() => onChange(opt.value)}
          >
            {Icon && <Icon size={14} strokeWidth={1.6} aria-hidden />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
