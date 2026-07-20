import React from 'react';

export type AvatarTone = 'blue' | 'purple' | 'green' | 'navy';

export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Initials to render (e.g. "MR"). Truncated to 2 chars. */
  initials: string;
  /** Diameter in px. Design default = 30. */
  size?: number;
  /** Background tone. Default blue (#2E5BFF). */
  tone?: AvatarTone;
}

/**
 * Avatar — circular initials chip. Design default: 30px, blue (#2E5BFF),
 * white initials. Used in the TopNav (current sim user) and on request/version
 * rows. Render as a <button> from the caller when it needs to open a menu.
 */
export default function Avatar({ initials, size = 30, tone = 'blue', className, style, ...rest }: AvatarProps) {
  const text = (initials || '?').slice(0, 2).toUpperCase();
  const cls = ['dmh-avatar', `dmh-avatar--${tone}`, className].filter(Boolean).join(' ');
  return (
    <span
      className={cls}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4), ...style }}
      aria-hidden
      {...rest}
    >
      {text}
    </span>
  );
}
