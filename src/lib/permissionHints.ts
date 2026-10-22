/** Motivos de los botones deshabilitados por permisos (la regla la aplica el
 *  backend; la interfaz solo evita ofrecer lo que respondería 403). */

/** Exportar DDL o metadata exige el permiso `export`. */
export const NO_EXPORT_HINT = "Your role can't export DDL or metadata (export permission).";

interface PermissionUser {
  permissions?: Record<string, boolean> | null;
  projectIds?: string[] | null;
}

/** Motivo por el que el usuario no puede crear proyectos, o null si puede:
 *  crear exige `model.edit`, y quien tiene proyectos asignados (sin
 *  `admin.manage`) no crea proyectos nuevos (quedarían fuera de su alcance). */
export function newProjectBlock(user: PermissionUser | null | undefined): string | null {
  if (!user) return null;
  const perms = user.permissions ?? {};
  if (!perms['model.edit']) return "Your role can't create projects (model.edit).";
  if (!perms['admin.manage'] && (user.projectIds ?? []).length > 0) {
    return 'Your access is limited to the projects assigned to you: an administrator creates new projects.';
  }
  return null;
}
