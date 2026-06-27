import { useEffect } from 'react';
import { useIdentityStore } from '@/store/useIdentityStore';

/** Carga la identidad (`/api/me`) al montar y la expone. Llamar una vez cerca
 *  de la raíz (App); los componentes leen `useIdentityStore` cuando la necesiten. */
export function useIdentity() {
  const principal = useIdentityStore((s) => s.principal);
  const loading = useIdentityStore((s) => s.loading);
  const loadIdentity = useIdentityStore((s) => s.loadIdentity);
  useEffect(() => {
    loadIdentity();
  }, [loadIdentity]);
  return { principal, loading };
}
