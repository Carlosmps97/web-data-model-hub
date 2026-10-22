import React from 'react';
import type { LucideIcon } from 'lucide-react';

export type ButtonVariant = 'primary' | 'success' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'sm';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Variante visual. primary = azul, success = verde, secondary = blanco + borde. */
  variant?: ButtonVariant;
  /** md = 36px de alto (por defecto del diseño), sm = compacto. */
  size?: ButtonSize;
  /** Ícono lucide al inicio. */
  icon?: LucideIcon;
  /** Ícono lucide al final. */
  iconRight?: LucideIcon;
}

/**
 * Button: botón del sistema de diseño.
 * primary (azul #2E5BFF) · success (verde #16A37B) · secondary (blanco, borde #DDE2EC).
 * Alto por defecto 36px, radio 9. Usa tokens; solo tema claro.
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
