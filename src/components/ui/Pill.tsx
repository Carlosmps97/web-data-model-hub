import React from 'react';

export type PillTone = 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'neutral';

export interface PillProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Color tone. Maps to a soft tint bg + colored text (per design pills). */
  tone?: PillTone;
}

/**
 * Pill — fully-rounded (999px) status/label pill with a soft tinted fill.
 * e.g. "Editing · v15" (blue), "published" (green), "in-review" (amber).
 */
export default function Pill({ tone = 'neutral', className, children, ...rest }: PillProps) {
  const cls = ['dmh-pill', `dmh-pill--${tone}`, className].filter(Boolean).join(' ');
  return (
    <span className={cls} {...rest}>
      {children}
    </span>
  );
}
