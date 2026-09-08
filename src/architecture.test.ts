import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
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
