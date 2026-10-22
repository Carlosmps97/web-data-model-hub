import React from 'react';

export type AvatarTone = 'blue' | 'purple' | 'green' | 'navy';

export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Iniciales a mostrar (p. ej. "MR"). Se recortan a 2 caracteres. */
  initials: string;
  /** Diámetro en px. Valor por defecto del diseño = 30. */
  size?: number;
  /** Tono de fondo. Por defecto, azul (#2E5BFF). */
  tone?: AvatarTone;
}

/**
 * Avatar: chip circular con iniciales. Por defecto del diseño: 30px, azul
 * (#2E5BFF), iniciales blancas. Se usa en filas de solicitudes, versiones,
 * revisores y comentarios. Quien lo usa lo envuelve en un <button> cuando
 * necesita abrir un menú.
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
