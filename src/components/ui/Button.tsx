import React from 'react';
import type { LucideIcon } from 'lucide-react';

export type ButtonVariant = 'primary' | 'success' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'sm';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual variant. primary = blue, success = green, secondary = white + border. */
  variant?: ButtonVariant;
  /** md = 36px tall (design default), sm = compact. */
  size?: ButtonSize;
  /** Leading lucide icon. */
  icon?: LucideIcon;
  /** Trailing lucide icon. */
  iconRight?: LucideIcon;
}

/**
 * Button — design-system button (DMH-Erwin).
 * primary (blue #2E5BFF) · success (green #16A37B) · secondary (white, border #DDE2EC).
 * Default height 36px, radius 9. Uses tokens; light-only.
 */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', icon: Icon, iconRight: IconRight, className, children, type = 'button', ...rest },
  ref,
) {
  const cls = ['dmh-btn', `dmh-btn--${variant}`, size === 'sm' ? 'dmh-btn--sm' : '', className]
    .filter(Boolean)
    .join(' ');
  const iconSize = size === 'sm' ? 14 : 15;
  return (
    <button ref={ref} type={type} className={cls} {...rest}>
      {Icon && <Icon size={iconSize} strokeWidth={1.6} aria-hidden />}
      {children != null && <span>{children}</span>}
      {IconRight && <IconRight size={iconSize} strokeWidth={1.6} aria-hidden />}
    </button>
  );
});

export default Button;
