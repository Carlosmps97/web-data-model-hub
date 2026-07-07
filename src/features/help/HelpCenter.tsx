import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowRight, BarChart3, BookMarked, GitPullRequest, Home, Mail,
  Network, Search, ShieldCheck, X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  CONCEPTS, FAQ, MODULES, STEPS, SUPPORT, UI, type Lang, type ModuleDoc,
} from './helpContent';
import { openTechnicalDocPdf } from './technicalDoc';

const MOD_ICON: Record<string, typeof Home> = {
  home: Home, canvas: Network, standards: BookMarked, reporting: BarChart3,
  admin: ShieldCheck, workflow: GitPullRequest,
};
const green = '#0E8C6A', navy = '#1A2B4A', blue = '#2E5BFF', ink = '#3A4658', muted = '#6B7689', soft = '#8A93A5';

export default function HelpCenter({ onClose }: { onClose: () => void }) {
  const [lang, setLang] = useState<Lang>('es');
  const [q, setQ] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const t = lang === 'es' ? UI.es : UI.en;
  const L = (en: string, es: string) => (lang === 'es' ? es : en);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const modules = useMemo(() => {
    if (!q.trim()) return MODULES;
    const needle = q.toLowerCase();
    return MODULES.filter((m) => {
      const hay = [m.card.titleEn, m.card.titleEs, m.card.blurbEn, m.card.blurbEs,
        ...m.card.bulletsEn, ...m.card.bulletsEs].join(' ').toLowerCase();
      return hay.includes(needle);
    });
  }, [q]);

  const scrollTo = (id: string) => document.getElementById(`help-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const onPdf = () => { if (!openTechnicalDocPdf(lang)) toast.error(L('Allow pop-ups to open the PDF.', 'Habilitá los pop-ups para abrir el PDF.')); };
  const onContact = () => { window.location.href = `mailto:${SUPPORT.email}?subject=${encodeURIComponent('Data Model Hub — ' + L('Support', 'Soporte'))}`; };

  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(16,27,48,0.42)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 };
  const panel: React.CSSProperties = { width: '100%', maxWidth: 1200, height: '100%', maxHeight: 900, background: '#fff', borderRadius: 16, boxShadow: '0 24px 70px rgba(16,27,48,0.28)', overflow: 'hidden', display: 'flex', flexDirection: 'column' };

  return createPortal(
    <div style={overlay} onClick={onClose} role="presentation">
      <div style={panel} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t.title}>
        {/* header */}
        <div style={{ flex: 'none', height: 58, display: 'flex', alignItems: 'center', gap: 14, padding: '0 20px', borderBottom: '1px solid #EAEDF2' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 700, color: navy, fontSize: 15 }}>
            <span style={{ width: 28, height: 28, borderRadius: 8, background: '#E4F6EF', color: green, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>?</span>
            Data Model Hub · {L('Help', 'Ayuda')}
          </span>
          <span style={{ flex: 1 }} />
          {/* selector de idioma (solo esta sección) */}
          <div style={{ display: 'inline-flex', border: '1px solid #E2E6EE', borderRadius: 8, overflow: 'hidden' }}>
            {(['en', 'es'] as const).map((lg) => (
              <button key={lg} onClick={() => setLang(lg)} style={{ height: 32, padding: '0 12px', border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 700, background: lang === lg ? green : '#fff', color: lang === lg ? '#fff' : '#56607A' }}>
                {lg === 'en' ? 'EN' : 'ES'}
              </button>
            ))}
          </div>
          <button onClick={onClose} aria-label={t.close} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: soft, display: 'inline-flex' }}><X size={20} /></button>
        </div>

        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {/* sidebar / TOC */}
          <div style={{ width: 256, flex: 'none', borderRight: '1px solid #EAEDF2', background: '#FAFBFC', padding: '18px 16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: '#9AA3B2' }} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.search}
                style={{ width: '100%', height: 36, border: '1px solid #E6EAF0', borderRadius: 9, padding: '0 12px 0 32px', fontFamily: 'inherit', fontSize: 12.5, color: navy, background: '#fff', outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <TocGroup title={t.tocStart}>
              <TocLink onClick={() => scrollTo('firststeps')}>{t.tocFirst}</TocLink>
              <TocLink onClick={() => scrollTo('concepts')}>{t.tocConcepts}</TocLink>
            </TocGroup>
            <TocGroup title={t.tocModules}>
              {MODULES.map((m) => (
                <TocLink key={m.id} dot onClick={() => scrollTo(`mod-${m.id}`)}>{L(m.card.titleEn, m.card.titleEs)}</TocLink>
              ))}
            </TocGroup>
          </div>

          {/* main */}
          <div ref={scrollRef} style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
            {/* hero */}
            <div style={{ padding: '30px 40px 24px', background: 'linear-gradient(180deg,#F6F9FE 0%,#FFF 100%)', borderBottom: '1px solid #EFF2F7' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: green, background: '#E4F6EF', borderRadius: 999, padding: '4px 11px', marginBottom: 14 }}>{t.badge}</span>
              <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: navy, letterSpacing: '-0.02em' }}>{t.title}</h1>
              <p style={{ margin: '10px 0 0', fontSize: 14, lineHeight: 1.6, color: '#56607A', maxWidth: 720 }}>{t.hero}</p>
              <button onClick={() => scrollTo('firststeps')} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 40, padding: '0 18px', marginTop: 18, borderRadius: 9, background: green, color: '#fff', border: 'none', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>
                {t.startNow}<ArrowRight size={15} />
              </button>
            </div>

            <div style={{ padding: '28px 40px 42px' }}>
              {/* primeros pasos */}
              <div id="help-firststeps" style={{ scrollMarginTop: 12 }}>
                <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700, color: navy }}>{t.firstSteps}</h2>
                <p style={{ margin: '0 0 16px', fontSize: 13, color: soft }}>{t.firstStepsSub}</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 }}>
                  {STEPS.map((s, i) => (
                    <div key={i} style={{ border: '1px solid #EAEDF2', borderRadius: 12, padding: 16, background: '#fff' }}>
                      <div style={{ width: 30, height: 30, borderRadius: 8, background: s.accent ? green : navy, color: '#fff', fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>{i + 1}</div>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: navy, marginBottom: 4 }}>{L(s.titleEn, s.titleEs)}</div>
                      <div style={{ fontSize: 12, lineHeight: 1.5, color: muted }}>{L(s.bodyEn, s.bodyEs)}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* conceptos */}
              <div id="help-concepts" style={{ scrollMarginTop: 12, marginTop: 30, background: '#FAFBFC', border: '1px solid #EAEDF2', borderRadius: 13, padding: '22px 24px' }}>
                <h2 style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 700, color: navy }}>{t.concepts}</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 22 }}>
                  {CONCEPTS.map((c, i) => (
                    <div key={i}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: navy, marginBottom: 3 }}>{L(c.titleEn, c.titleEs)}</div>
                      <div style={{ fontSize: 12, lineHeight: 1.55, color: muted }}>{L(c.bodyEn, c.bodyEs)}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* módulos */}
              <h2 style={{ margin: '32px 0 4px', fontSize: 18, fontWeight: 700, color: navy }}>{t.modules}</h2>
              <p style={{ margin: '0 0 16px', fontSize: 13, color: soft }}>{t.modulesSub}</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 16 }}>
                {modules.map((m) => <ModuleCard key={m.id} m={m} lang={lang} />)}
              </div>
              {modules.length === 0 && <div style={{ padding: 24, color: soft, fontSize: 13 }}>{L('No results.', 'Sin resultados.')}</div>}

              {/* FAQ */}
              <h2 style={{ margin: '32px 0 14px', fontSize: 18, fontWeight: 700, color: navy }}>{t.faq}</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 14 }}>
                {FAQ.map((f, i) => (
                  <div key={i} style={{ border: '1px solid #EAEDF2', borderRadius: 12, padding: '16px 18px' }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: navy, marginBottom: 4 }}>{L(f.qEn, f.qEs)}</div>
                    <div style={{ fontSize: 12, lineHeight: 1.55, color: muted }}>{L(f.aEn, f.aEs)}</div>
                  </div>
                ))}
              </div>

              {/* soporte */}
              <div style={{ marginTop: 24, background: navy, borderRadius: 13, padding: '22px 26px', display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>{t.supportTitle}</div>
                  <div style={{ fontSize: 12.5, color: '#AEB6C4', marginTop: 3 }}>{t.supportBlurb}</div>
                  <div style={{ fontSize: 12.5, color: '#fff', marginTop: 8 }}>
                    {SUPPORT.name} · <a href={`mailto:${SUPPORT.email}`} style={{ color: '#7FE0C0', textDecoration: 'none' }}>{SUPPORT.email}</a>
                  </div>
                </div>
                <button onClick={onContact} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 40, padding: '0 18px', borderRadius: 9, background: '#fff', color: navy, border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  <Mail size={15} />{t.contact}
                </button>
                <button onClick={onPdf} title={t.downloadHint} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 40, padding: '0 18px', borderRadius: 9, background: 'rgba(255,255,255,0.12)', color: '#fff', border: '1px solid rgba(255,255,255,0.18)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  {t.techDocs}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function TocGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#AEB6C4', padding: '0 8px', marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}
function TocLink({ children, onClick, dot }: { children: React.ReactNode; onClick: () => void; dot?: boolean }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, color: '#3A4658', borderRadius: 8, padding: '8px 10px', fontFamily: 'inherit' }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: blue, flex: 'none' }} />}{children}
    </button>
  );
}

function ModuleCard({ m, lang }: { m: ModuleDoc; lang: Lang }) {
  const L = (en: string, es: string) => (lang === 'es' ? es : en);
  const Icon = MOD_ICON[m.id] ?? Home;
  return (
    <div id={`help-mod-${m.id}`} style={{ scrollMarginTop: 12, border: '1px solid #EAEDF2', borderRadius: 13, padding: '18px 20px', background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 11 }}>
        <span style={{ width: 34, height: 34, borderRadius: 9, background: '#EAF0FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
          <Icon size={17} color={blue} strokeWidth={1.6} />
        </span>
        <span style={{ fontSize: 14.5, fontWeight: 700, color: navy }}>{L(m.card.titleEn, m.card.titleEs)}</span>
      </div>
      <div style={{ fontSize: 12.5, lineHeight: 1.55, color: muted, marginBottom: 10 }}>{L(m.card.blurbEn, m.card.blurbEs)}</div>
      <ul style={{ margin: 0, paddingLeft: 17, fontSize: 12, lineHeight: 1.7, color: '#56607A' }}>
        {(lang === 'es' ? m.card.bulletsEs : m.card.bulletsEn).map((b, i) => <li key={i}>{b}</li>)}
      </ul>
    </div>
  );
}
