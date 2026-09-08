import { useMemo, useState } from 'react';
import { Check, Database, Search } from 'lucide-react';
import type { Project } from '@/types/model';
import { sortProjects, type ProjectMeta } from '@/lib/projects';

/**
 * ProjectPicker (doc 75 D8) — lista de proyectos A–Z con su producción vigente
 * y los drafts propios; una sola selección. Reusa el lenguaje de las tarjetas
 * del Open model (`dmh-openmodel-opt`).
 */
export default function ProjectPicker({ projects, meta = {}, selectedId, onSelect, filterable = true }: {
  projects: Project[];
  meta?: Record<string, ProjectMeta>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  filterable?: boolean;
}) {
  const [q, setQ] = useState('');
  const rows = useMemo(() => sortProjects(
    projects.filter((p) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()))), [projects, q]);
  return (
    <div className="dmh-projpick">
      {filterable && projects.length > 8 && (
        <div className="dmh-projpick-filter">
          <Search size={13} aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter projects…" aria-label="Filter projects" />
        </div>
      )}
      <div className="dmh-projpick-list" role="listbox" aria-label="Projects">
        {rows.map((p) => {
          const m = meta[p.id];
          const on = p.id === selectedId;
          return (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={on}
              className={`dmh-openmodel-opt dmh-projpick-opt${on ? ' is-selected' : ''}`}
              onClick={() => onSelect(p.id)}
            >
              <span className="dmh-openmodel-ico dmh-openmodel-ico--blue">
                <Database size={19} strokeWidth={1.5} aria-hidden />
              </span>
              <span className="dmh-openmodel-main">
                <span className="dmh-openmodel-name">{p.name}</span>
                <span className="dmh-openmodel-desc">
                  {p.description ? `${p.description} · ` : ''}
                  {m?.production ? `Production ${m.production}` : 'No production yet'}
                  {m && m.drafts > 0 ? ` · ${m.drafts} draft${m.drafts === 1 ? '' : 's'} (yours)` : ''}
                </span>
              </span>
              <span className="dmh-openmodel-radio">{on && <Check size={14} strokeWidth={2.2} aria-hidden />}</span>
            </button>
          );
        })}
        {rows.length === 0 && <div className="dmh-openmodel-nodrafts">No projects match.</div>}
      </div>
    </div>
  );
}
