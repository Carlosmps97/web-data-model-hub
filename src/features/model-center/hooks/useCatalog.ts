'use client';

import { useEffect, useState } from 'react';
import { projectsService, canvasService } from '@/services';
import { buildCatalog, type CatalogRow } from '../lib/catalog';

/** Loads every project + its canvas once and flattens them into catalog rows. */
export function useCatalog() {
  const [catalog, setCatalog] = useState<CatalogRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const projects = await projectsService.listProjects();
        const canvases = await Promise.all(
          projects.map((p) => canvasService.getCanvas(p.id).catch(() => ({ tables: [], relationships: [] }))),
        );
        setCatalog(projects.flatMap((p, i) => buildCatalog(p, canvases[i].tables ?? [])));
      } catch (e) {
        console.error('Failed to build catalog', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return { catalog, loading };
}
