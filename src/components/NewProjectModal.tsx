import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Copy, FolderPlus, Sparkles } from 'lucide-react';

import { Button, Dialog } from '@/components/ui';
import SearchSelect from '@/features/modeler/components/SearchSelect';
import { sortProjects } from '@/lib/projects';
import { apiErrorMessage, isConflictError } from '@/services/http';
import { createProject, listProjects } from '@/services/projects.service';
import { getStandardsSummary, STANDARDS_BLOCKS, type StandardsBlock, type StandardsSummary } from '@/features/standards/standards.service';
import { runBlocking } from '@/store/useBusyStore';
import type { Project } from '@/types/model';

type Origin = 'empty' | 'copy';

/**
 * NewProjectModal (doc 75 D15) — crea un proyecto vacío o copiando bloques de
 * Data Standards de otro proyecto (foto, sin vínculo). La creación es la única
 * operación directa sobre un proyecto; renombrar/borrar van por draft.
 */
export default function NewProjectModal({ open, onClose, onCreated }: {
  open: boolean;
  onClose: () => void;
  onCreated: (p: Project) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [origin, setOrigin] = useState<Origin>('empty');
  const [projects, setProjects] = useState<Project[]>([]);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<Set<StandardsBlock>>(new Set(STANDARDS_BLOCKS.map((b) => b.key)));
  const [summary, setSummary] = useState<StandardsSummary | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(''); setDescription(''); setOrigin('empty'); setSourceId(null); setNameError(null);
    setBlocks(new Set(STANDARDS_BLOCKS.map((b) => b.key)));
    listProjects().then((ps) => setProjects(sortProjects(ps))).catch(() => setProjects([]));
  }, [open]);

  useEffect(() => {
    setSummary(null);
    if (!sourceId) return;
    let cancelled = false;
    getStandardsSummary(sourceId).then((s) => { if (!cancelled) setSummary(s); }).catch(() => {});
    return () => { cancelled = true; };
  }, [sourceId]);

  const source = useMemo(() => projects.find((p) => p.id === sourceId) ?? null, [projects, sourceId]);
  const ddlWithoutUdp = blocks.has('ddl') && !blocks.has('udp');
  const canCreate = name.trim().length > 0 && (origin === 'empty' || (!!sourceId && blocks.size > 0));

  const countOf = (b: StandardsBlock): string => {
    if (!summary) return '';
    if (b === 'naming') return summary.naming ? 'table + column rules' : '—';
    const n = b === 'ddl' ? summary.rules : summary[b];
    return `${n.toLocaleString('en-US')} item${n === 1 ? '' : 's'}`;
  };

  const toggleBlock = (b: StandardsBlock) => setBlocks((prev) => {
    const next = new Set(prev);
    if (next.has(b)) next.delete(b); else next.add(b);
    return next;
  });

  const create = async () => {
    if (!canCreate) return;
    setNameError(null);
    const copy = origin === 'copy' && source ? { projectId: source.id, blocks: [...blocks] } : undefined;
    try {
      const p = await runBlocking(
        'Creating project…',
        () => createProject({ name: name.trim(), description: description.trim() || undefined, copyFrom: copy }),
        copy ? `Copying standards from «${source!.name}»` : undefined,
      );
      toast.success(`Project «${p.name}» created${copy ? ` with standards copied from «${source!.name}»` : ''}.`);
      onCreated(p);
    } catch (err) {
      const msg = apiErrorMessage(err, 'Could not create the project.');
      if (isConflictError(err)) setNameError(msg); else toast.error(msg);
    }
  };

  const footer = (
    <>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button variant="primary" icon={FolderPlus} onClick={() => void create()} disabled={!canCreate}>Create project</Button>
    </>
  );

  return (
    <Dialog open={open} title="New project" subtitle="An independent project with its own catalog, Data Standards and versions"
      icon={FolderPlus} onClose={onClose} footer={footer} width={620}>
      <div className="dmh-newproj">
        <label className="dmh-newproj-field">
          <span className="dmh-newproj-label">Name</span>
          <input className="rd-input" value={name} onChange={(e) => { setName(e.target.value); setNameError(null); }}
            placeholder="e.g. Modelo DDV" autoFocus aria-invalid={!!nameError} />
          {nameError && <span className="dmh-newproj-error">{nameError}</span>}
        </label>
        <label className="dmh-newproj-field">
          <span className="dmh-newproj-label">Description <span className="dmh-newproj-opt">optional</span></span>
          <textarea className="rd-input dmh-newproj-desc" value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="What this project models" rows={2} />
        </label>

        <div className="dmh-newproj-section">Data Standards</div>
        <div className="dmh-openmodel">
          <button type="button" className={`dmh-openmodel-opt${origin === 'empty' ? ' is-selected' : ''}`} onClick={() => setOrigin('empty')}>
            <span className="dmh-openmodel-ico dmh-openmodel-ico--blue"><Sparkles size={21} strokeWidth={1.5} aria-hidden /></span>
            <span className="dmh-openmodel-main">
              <span className="dmh-openmodel-name">Start empty</span>
              <span className="dmh-openmodel-desc">No glossary, domains, UDPs or DDL rules yet — naming rules use the corporate defaults.</span>
            </span>
            <span className="dmh-openmodel-radio">{origin === 'empty' && <span className="dot" />}</span>
          </button>
          <button type="button" className={`dmh-openmodel-opt${origin === 'copy' ? ' is-selected' : ''}`} onClick={() => setOrigin('copy')}
            disabled={projects.length === 0}>
            <span className="dmh-openmodel-ico dmh-openmodel-ico--purple"><Copy size={21} strokeWidth={1.5} aria-hidden /></span>
            <span className="dmh-openmodel-main">
              <span className="dmh-openmodel-name">Copy from another project</span>
              <span className="dmh-openmodel-desc">
                {projects.length === 0
                  ? 'There is no project to copy from yet.'
                  : 'A one-time copy of the selected blocks. Later changes in either project do not propagate.'}
              </span>
              {origin === 'copy' && (
                <span className="dmh-newproj-copy" onClick={(e) => e.stopPropagation()}>
                  <span className="dmh-newproj-copyrow">
                    <span className="dmh-newproj-label">Source project</span>
                    <SearchSelect
                      options={projects.map((p) => ({ value: p.id, label: p.name }))}
                      valueLabel={source?.name ?? ''}
                      placeholder="Choose a project…"
                      onPick={(v) => setSourceId(v || null)}
                    />
                  </span>
                  <span className="dmh-newproj-blocks">
                    {STANDARDS_BLOCKS.map((b) => (
                      <label key={b.key} className="dmh-newproj-block">
                        <input type="checkbox" checked={blocks.has(b.key)} onChange={() => toggleBlock(b.key)} />
                        <span>{b.label}</span>
                        {sourceId && <span className="dmh-newproj-count">{countOf(b.key)}</span>}
                      </label>
                    ))}
                  </span>
                  {ddlWithoutUdp && (
                    <span className="dmh-newproj-warn" role="note">
                      <AlertTriangle size={13} aria-hidden />
                      DDL rules reference UDPs: copied without the UDP definitions, they arrive as stale until you re-bind them.
                    </span>
                  )}
                </span>
              )}
            </span>
            <span className="dmh-openmodel-radio">{origin === 'copy' && <span className="dot" />}</span>
          </button>
        </div>
      </div>
    </Dialog>
  );
}
