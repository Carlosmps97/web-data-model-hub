'use client';

// ─────────────────────────────────────────────────────────────────────────────
// Docs page orchestrator.
//
// Slim composition: lays out the sticky `DocsSidebar` (with scroll-spy) on
// the left, and renders every section in the order defined by `nav.ts`.
//
// To add a new topic:
//   1. Append the id, label, and group to `_components/nav.ts`.
//   2. Create `_sections/<NewTopic>Section.tsx`, exporting a component that
//      wraps a `<SectionTitle id="<the-id>">…</SectionTitle>`.
//   3. Import + mount it below in the same order it appears in `NAV`.
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';
import AppLayout from '@/components/layout/AppLayout';
import Header from '@/components/layout/Header';
import { DocsSidebar } from './_components/DocsSidebar';

import { GettingStartedSection }        from './_sections/GettingStartedSection';
import { ModelEditorSection }           from './_sections/ModelEditorSection';
import { AddingTablesSection }          from './_sections/AddingTablesSection';
import { LogicalPhysicalSection }       from './_sections/LogicalPhysicalSection';
import { DomainsSection }               from './_sections/DomainsSection';
import { ViewsSection }                 from './_sections/ViewsSection';
import { RelationshipsSection }         from './_sections/RelationshipsSection';
import { CanvasViewSection }            from './_sections/CanvasViewSection';
import { CanvasToolsSection }           from './_sections/CanvasToolsSection';
import { AutoArrangeSection }           from './_sections/AutoArrangeSection';
import { AiAgentSection }               from './_sections/AiAgentSection';
import { GuidelinesSection }            from './_sections/GuidelinesSection';
import { ListViewSection }              from './_sections/ListViewSection';
import { DdlExportSection }             from './_sections/DdlExportSection';
import { SaveSection }                  from './_sections/SaveSection';
import { SchemasPartitioningSection }   from './_sections/SchemasPartitioningSection';
import { EngineCapabilitiesSection }    from './_sections/EngineCapabilitiesSection';
import { DbmlReferenceSection }         from './_sections/DbmlReferenceSection';
import { TechnicalOverviewSection }     from './_sections/TechnicalOverviewSection';

export default function DocsPage() {
  return (
    <AppLayout>
      <Header
        title="Documentación"
        subtitle="Guía completa de uso de Data Model Hub para modeladores de datos"
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '210px 1fr',
          gap: 24,
          padding: 24,
          maxWidth: 1140,
          margin: '0 auto',
          alignItems: 'start',
        }}
      >
        <DocsSidebar />

        <div style={{ minWidth: 0 }}>
          {/* ── Inicio ──────────────────────────────────────────────────── */}
          <GettingStartedSection />
          <ModelEditorSection />

          {/* ── Modelado ────────────────────────────────────────────────── */}
          <AddingTablesSection />
          <LogicalPhysicalSection />
          <DomainsSection />
          <ViewsSection />
          <RelationshipsSection />

          {/* ── Canvas ──────────────────────────────────────────────────── */}
          <CanvasViewSection />
          <CanvasToolsSection />
          <AutoArrangeSection />

          {/* ── Agente IA ───────────────────────────────────────────────── */}
          <AiAgentSection />
          <GuidelinesSection />

          {/* ── Flujos ──────────────────────────────────────────────────── */}
          <ListViewSection />
          <DdlExportSection />
          <SaveSection />

          {/* ── Referencia ──────────────────────────────────────────────── */}
          <SchemasPartitioningSection />
          <EngineCapabilitiesSection />
          <DbmlReferenceSection />
          <TechnicalOverviewSection />

          <div style={{ height: 48 }} />
        </div>
      </div>
    </AppLayout>
  );
}
