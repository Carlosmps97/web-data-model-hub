import { useState } from 'react';
import { ChevronLeft, Copy, ListChecks, Pencil, Plus, Save, Settings2, Star, Trash2, Wand2 } from 'lucide-react';
import Dialog from '@/components/ui/Dialog';
import Button from '@/components/ui/Button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { apiErrorMessage } from '@/services/http';
import type { UdpDefinition } from '@/features/standards/standards.service';
import {
  BUILTIN_ORIGIN, createDefaultProfile, createProfile, deleteProfile, listProfiles, profileProblemsOf, setDefaultProfile,
  updateProfile, validateProfile, type ProfileCatalog, type ProfileProblem, type UploadProfile, type UploadProfileBody,
} from '../upload.service';
import { emptyProfile, localProblems, toBody } from '../lib/profileDraft';
import ProfileEditor from './ProfileEditor';

type View = { t: 'list' } | { t: 'edit'; id: string | null; draft: UploadProfileBody };

/**
 * Administrador de perfiles de carga: lista (editar, duplicar,
 * marcar default, borrar, crear el built-in) y editor. Los problemas del
 * servidor (422) y los locales se muestran junto a su fila; guardar pasa
 * por `localProblems` primero (sin viaje) y por el 422 después.
 */
export default function ProfileManagerModal({ projectId, profiles, catalog, udpDefs, initial = 'list', onClose, onChanged, pushToast }: {
  projectId: string;
  profiles: UploadProfile[];
  catalog: ProfileCatalog;
  udpDefs: UdpDefinition[];
  initial?: 'list' | 'new';
  onClose: () => void;
  onChanged: (profiles: UploadProfile[]) => void;
  pushToast: (m: string, k?: 'err') => void;
}) {
  const [view, setView] = useState<View>(initial === 'new' ? { t: 'edit', id: null, draft: emptyProfile() } : { t: 'list' });
  const [problems, setProblems] = useState<ProfileProblem[]>([]);
  const [busy, setBusy] = useState(false);
  const [toDelete, setToDelete] = useState<UploadProfile | null>(null);

  const refresh = async () => { const list = await listProfiles(projectId); onChanged(list); return list; };
  const fail = (e: unknown, fallback: string) => pushToast(apiErrorMessage(e, fallback), 'err');

  const startEdit = (p: UploadProfile) => { setProblems([]); setView({ t: 'edit', id: p.id, draft: toBody(p) }); };
  const startNew = () => { setProblems([]); setView({ t: 'edit', id: null, draft: emptyProfile() }); };
  const duplicate = (p: UploadProfile) => {
    setProblems([]);
    setView({ t: 'edit', id: null, draft: { ...toBody(p), name: `Copy of ${p.name}`, isDefault: false } });
  };

  const save = async () => {
    if (view.t !== 'edit') return;
    const local = localProblems(view.draft);
    if (local.length) { setProblems(local); return; }
    setBusy(true);
    try {
      if (view.id) await updateProfile(projectId, view.id, view.draft);
      else await createProfile(projectId, view.draft);
      await refresh();
      setProblems([]);
      pushToast(view.id ? 'Profile saved' : 'Profile created');
      setView({ t: 'list' });
    } catch (e) {
      const server = profileProblemsOf(e);
      if (server.length) setProblems(server); else fail(e, "Couldn't save the profile.");
    } finally { setBusy(false); }
  };

  const check = async () => {
    if (view.t !== 'edit') return;
    const local = localProblems(view.draft);
    if (local.length) { setProblems(local); return; }
    setBusy(true);
    try {
      const { problems: server } = await validateProfile(projectId, view.draft);
      setProblems(server);
      pushToast(server.length ? `${server.length} problem${server.length === 1 ? '' : 's'} found` : 'Profile looks good');
    } catch (e) { fail(e, "Couldn't check the profile."); } finally { setBusy(false); }
  };

  const makeDefault = async (p: UploadProfile) => {
    setBusy(true);
    try { await setDefaultProfile(projectId, p.id); await refresh(); pushToast(`'${p.name}' is now the default profile`); }
    catch (e) { fail(e, "Couldn't set the default profile."); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!toDelete) return;
    setBusy(true);
    try { await deleteProfile(projectId, toDelete.id); await refresh(); pushToast(`Profile '${toDelete.name}' deleted`); setToDelete(null); }
    catch (e) { fail(e, "Couldn't delete the profile."); } finally { setBusy(false); }
  };
  const createBuiltin = async () => {
    setBusy(true);
    try {
      const { profile, warnings } = await createDefaultProfile(projectId);
      await refresh();
      pushToast(warnings.length ? `'${profile.name}' created with ${warnings.length} unmapped column${warnings.length === 1 ? '' : 's'} — review it` : `'${profile.name}' created`);
    } catch (e) { fail(e, "Couldn't create the default profile."); } finally { setBusy(false); }
  };

  const hasBuiltin = profiles.some((p) => p.origin === BUILTIN_ORIGIN);
  const editing = view.t === 'edit';

  const footer = editing ? (
    <>
      <span className="dmh-dialog-foot-left up-status">{problems.length ? `${problems.length} problem${problems.length === 1 ? '' : 's'} to fix` : 'Check the profile before saving.'}</span>
      <Button variant="secondary" icon={ChevronLeft} disabled={busy} onClick={() => { setProblems([]); setView({ t: 'list' }); }}>Back</Button>
      <Button variant="secondary" icon={ListChecks} disabled={busy} onClick={() => void check()}>Check profile</Button>
      <Button variant="primary" icon={Save} disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</Button>
    </>
  ) : (
    <>
      <span className="dmh-dialog-foot-left up-status">{profiles.length ? `${profiles.length} profile${profiles.length === 1 ? '' : 's'} in this project` : 'No profiles yet.'}</span>
      <Button variant="secondary" onClick={onClose} disabled={busy}>Close</Button>
      {!hasBuiltin && <Button variant="secondary" icon={Wand2} disabled={busy} onClick={() => void createBuiltin()}>Create default profile</Button>}
      <Button variant="primary" icon={Plus} disabled={busy} onClick={startNew}>New profile</Button>
    </>
  );

  return (
    <Dialog
      open title={editing ? (view.id ? 'Edit upload profile' : 'New upload profile') : 'Upload profiles'}
      subtitle={editing ? 'Map Excel columns to fields and UDPs, add rules, set policies' : 'Reusable ways of reading a workbook for this project'}
      icon={Settings2} onClose={busy ? () => {} : onClose} footer={footer} width={1040} backdrop="canvas" canvasTop={136}
    >
      {editing ? (
        <ProfileEditor projectId={projectId} draft={view.draft} catalog={catalog} udpDefs={udpDefs} problems={problems}
          onChange={(draft) => setView({ t: 'edit', id: view.id, draft })} pushToast={pushToast} />
      ) : profiles.length === 0 ? (
        <div className="up-pf-empty up-pf-empty--big">
          No upload profiles in this project yet. Create the default profile for <strong>Plantilla.xlsx</strong> or start a new one from scratch.
        </div>
      ) : (
        <div className="up-pf-list-wrap">
          <table className="up-pf-list">
            <thead><tr><th>Profile</th><th>Sheets</th><th>Mappings</th><th>Updated</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {profiles.map((p) => {
                const t = p.sheets?.tables; const c = p.sheets?.columns;
                const n = (t?.mappings?.length ?? 0) + (c?.mappings?.length ?? 0);
                return (
                  <tr key={p.id}>
                    <td>
                      <div className="up-pf-name">
                        <strong>{p.name}</strong>
                        {p.isDefault && <span className="dmh-pill dmh-pill--green"><Star aria-hidden />Default</span>}
                        {p.origin === BUILTIN_ORIGIN && <span className="dmh-pill dmh-pill--neutral">Built-in</span>}
                      </div>
                      {p.description && <div className="up-pf-desc">{p.description}</div>}
                    </td>
                    <td className="up-pf-sheets">
                      <code className="up-loc">{t?.name || '—'}{t?.headerRow ? ` · row ${t.headerRow}` : ''}</code>
                      <code className="up-loc">{c?.name || '—'}{c?.headerRow ? ` · row ${c.headerRow}` : ''}</code>
                    </td>
                    <td className="num">{n}</td>
                    <td className="up-pf-muted">{p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : '—'}{p.updatedBy ? ` · ${p.updatedBy}` : ''}</td>
                    <td className="up-pf-actions">
                      <button type="button" className="up-pf-iconbtn" title="Edit" aria-label={`Edit ${p.name}`} disabled={busy} onClick={() => startEdit(p)}><Pencil size={14} strokeWidth={1.8} aria-hidden /></button>
                      <button type="button" className="up-pf-iconbtn" title="Duplicate" aria-label={`Duplicate ${p.name}`} disabled={busy} onClick={() => duplicate(p)}><Copy size={14} strokeWidth={1.8} aria-hidden /></button>
                      <button type="button" className="up-pf-iconbtn" title="Set as default" aria-label={`Set ${p.name} as default`} disabled={busy || p.isDefault} onClick={() => void makeDefault(p)}><Star size={14} strokeWidth={1.8} aria-hidden /></button>
                      <button type="button" className="up-pf-iconbtn is-danger" title="Delete" aria-label={`Delete ${p.name}`} disabled={busy} onClick={() => setToDelete(p)}><Trash2 size={14} strokeWidth={1.8} aria-hidden /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog
        open={!!toDelete} title="Delete upload profile" variant="danger" confirmLabel="Delete" busy={busy}
        message={<>Delete profile <strong>{toDelete?.name}</strong>? Uploads validated with it will need another profile.</>}
        onConfirm={() => void remove()} onCancel={() => setToDelete(null)}
      />
    </Dialog>
  );
}
