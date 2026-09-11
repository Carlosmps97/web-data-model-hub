import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const src = (p: string) => resolve(__dirname, p);

describe('legado retirado (doc 75 D14)', () => {
  it.each([
    'features/governance', 'components/layout/AppLayout.tsx', 'components/layout/Header.tsx', 'components/layout/Sidebar.tsx',
    'store/useChangesetStore.ts', 'store/sessionChangesetBridge.ts', 'store/useIdentityStore.ts',
    'services/identity.service.ts', 'types/identity.ts', 'hooks',
  ])('%s no existe', (rel) => {
    expect(existsSync(src(rel))).toBe(false);
  });
});

// Doc 85 — bug de pantalla en blanco en Data Standards → Domains: la página
// usaba un componente del canvas que resolvía el proyecto con
// `sessionProjectId()` (throw sin proyecto activo) dentro de un useEffect ⇒ React
// desmontaba TODO el árbol. Data Standards es EXPLÍCITO por proyecto (recibe
// `projectId`): jamás depende del proyecto de la sesión ni del servicio de
// governance (atado al changeset/sesión); usa `naming.service`/`standards.service`.
describe('Data Standards es explícito por proyecto (doc 85)', () => {
  const dir = src('features/standards');
  const files = readdirSync(dir, { recursive: true, encoding: 'utf-8' })
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => join(dir, f));
  it('hay archivos que revisar', () => { expect(files.length).toBeGreaterThan(0); });
  it.each(files)('%s no importa governance.service ni sessionProjectId', (file) => {
    const code = readFileSync(file, 'utf-8');
    expect(code).not.toMatch(/services\/governance\.service/);
    expect(code).not.toMatch(/sessionProjectId/);
  });
});
