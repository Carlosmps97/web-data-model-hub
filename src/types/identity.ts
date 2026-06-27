/** Identidad del usuario en sesión (espeja el `Principal` del backend, Fase A). */
export interface Principal {
  email: string;
  username: string;
  display_name: string;
  source: string; // "local" | "databricks"
}
