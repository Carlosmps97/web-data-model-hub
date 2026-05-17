'use client';

import React, { useState } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import Header from '@/components/layout/Header';

// ─── Nav ────────────────────────────────────────────────────────────────────

type SectionId =
  | 'getting-started'
  | 'model-editor'
  | 'adding-tables'
  | 'logical-physical'
  | 'domains'
  | 'views'
  | 'relationships'
  | 'canvas-tools'
  | 'ai-agent'
  | 'guidelines'
  | 'list-view'
  | 'canvas-view'
  | 'ddl-export'
  | 'save'
  | 'auto-arrange'
  | 'schemas-partitioning'
  | 'engine-capabilities'
  | 'dbml-reference'
  | 'technical-overview';

interface NavItem { id: SectionId; label: string; group: string }

const NAV: NavItem[] = [
  // Primeros pasos
  { id: 'getting-started',   label: 'Primeros Pasos',           group: 'Inicio' },
  { id: 'model-editor',      label: 'Editor de Modelos',        group: 'Inicio' },
  // Modelado
  { id: 'adding-tables',     label: 'Tablas y Columnas',        group: 'Modelado' },
  { id: 'logical-physical',  label: 'Nombres Lógico / Físico',  group: 'Modelado' },
  { id: 'domains',           label: 'Dominios y Subdominios',   group: 'Modelado' },
  { id: 'views',             label: 'Vistas SQL',               group: 'Modelado' },
  { id: 'relationships',     label: 'Relaciones (FK)',          group: 'Modelado' },
  // Canvas
  { id: 'canvas-view',       label: 'Diagrama ER (Canvas)',     group: 'Canvas' },
  { id: 'canvas-tools',      label: 'Herramientas del Canvas',  group: 'Canvas' },
  { id: 'auto-arrange',      label: 'Distribución Automática',  group: 'Canvas' },
  // Agente IA
  { id: 'ai-agent',          label: 'Agente IA — Chat',         group: 'Agente IA' },
  { id: 'guidelines',        label: 'Guidelines',               group: 'Agente IA' },
  // Flujos
  { id: 'list-view',         label: 'Vista de Lista',           group: 'Flujos' },
  { id: 'ddl-export',        label: 'Exportar DDL',             group: 'Flujos' },
  { id: 'save',              label: 'Guardar',                  group: 'Flujos' },
  // Referencia
  { id: 'schemas-partitioning', label: 'Esquemas y Partición',  group: 'Referencia' },
  { id: 'engine-capabilities',  label: 'Capacidades por Motor', group: 'Referencia' },
  { id: 'dbml-reference',       label: 'Referencia DBML',       group: 'Referencia' },
  { id: 'technical-overview',   label: 'Arquitectura Técnica',  group: 'Referencia' },
];

// ─── UI helpers ─────────────────────────────────────────────────────────────

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code style={{ background: '#eef2ff', color: '#4338ca', padding: '1px 6px', borderRadius: 4, fontFamily: 'JetBrains Mono, monospace', fontSize: '0.8em' }}>
      {children}
    </code>
  );
}

function CodeBlock({ children, lang = '' }: { children: string; lang?: string }) {
  return (
    <pre data-lang={lang || undefined} style={{ background: '#0f172a', color: '#94a3b8', borderRadius: 8, padding: '16px 20px', fontSize: '0.76rem', fontFamily: 'JetBrains Mono, monospace', overflowX: 'auto', lineHeight: 1.75, margin: '12px 0' }}>
      <code>{children.trim()}</code>
    </pre>
  );
}

function DocTable({ headers, rows }: { headers: string[]; rows: (string | React.ReactNode)[][] }) {
  return (
    <div style={{ overflowX: 'auto', margin: '12px 0' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
        <thead>
          <tr style={{ background: '#f8fafc' }}>
            {headers.map((h) => (
              <th key={h} style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '2px solid #e2e8f0', fontWeight: 600, color: '#1e293b', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'transparent' : '#f8fafc' }}>
              {row.map((cell, j) => (
                <td key={j} style={{ padding: '7px 12px', color: '#475569', verticalAlign: 'top' }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Callout({ children, type = 'info' }: { children: React.ReactNode; type?: 'info' | 'tip' | 'warning' }) {
  const cfg = {
    info:    { bg: '#eef2ff', border: '#6366f1', icon: 'ℹ', color: '#4338ca' },
    tip:     { bg: '#f0fdf4', border: '#22c55e', icon: '✓', color: '#15803d' },
    warning: { bg: '#fffbeb', border: '#f59e0b', icon: '⚠', color: '#b45309' },
  }[type];
  return (
    <div style={{ background: cfg.bg, borderLeft: `3px solid ${cfg.border}`, borderRadius: '0 8px 8px 0', padding: '10px 16px', margin: '12px 0', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <span style={{ fontWeight: 700, fontSize: '0.82rem', color: cfg.color, flexShrink: 0, marginTop: 1 }}>{cfg.icon}</span>
      <div style={{ fontSize: '0.82rem', color: '#475569', lineHeight: 1.65 }}>{children}</div>
    </div>
  );
}

function SectionTitle({ id, children }: { id: SectionId; children: React.ReactNode }) {
  return (
    <h2 id={id} style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1e293b', marginBottom: 14, paddingTop: 16, borderBottom: '2px solid #e2e8f0', paddingBottom: 10, scrollMarginTop: 16 }}>
      {children}
    </h2>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  return <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: '#4f46e5', marginTop: 20, marginBottom: 6 }}>{children}</h3>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: '0.85rem', color: '#475569', lineHeight: 1.75, marginBottom: 10 }}>{children}</p>;
}

function Ul({ items }: { items: React.ReactNode[] }) {
  return (
    <ul style={{ paddingLeft: 20, margin: '6px 0 12px', display: 'flex', flexDirection: 'column', gap: 5 }}>
      {items.map((it, i) => <li key={i} style={{ fontSize: '0.85rem', color: '#475569', lineHeight: 1.65 }}>{it}</li>)}
    </ul>
  );
}

function Ol({ items }: { items: React.ReactNode[] }) {
  return (
    <ol style={{ paddingLeft: 20, margin: '6px 0 12px', display: 'flex', flexDirection: 'column', gap: 7 }}>
      {items.map((it, i) => <li key={i} style={{ fontSize: '0.85rem', color: '#475569', lineHeight: 1.65 }}>{it}</li>)}
    </ol>
  );
}

function FlowDiagram({ steps }: { steps: { icon: string; title: string; desc: string }[] }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0, margin: '14px 0', overflowX: 'auto', paddingBottom: 4 }}>
      {steps.map((s, i) => (
        <React.Fragment key={i}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 100, maxWidth: 130, textAlign: 'center' }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: '#eef2ff', border: '2px solid #c7d2fe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', marginBottom: 6 }}>
              {s.icon}
            </div>
            <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#1e293b', lineHeight: 1.3 }}>{s.title}</span>
            <span style={{ fontSize: '0.65rem', color: '#64748b', marginTop: 2, lineHeight: 1.3 }}>{s.desc}</span>
          </div>
          {i < steps.length - 1 && (
            <div style={{ flexShrink: 0, paddingTop: 12, color: '#94a3b8', fontSize: '1.2rem', margin: '0 4px' }}>→</div>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function DocsPage() {
  const [active, setActive] = useState<SectionId>('getting-started');
  const groups = [...new Set(NAV.map((n) => n.group))];

  const scrollTo = (id: SectionId) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <AppLayout>
      <Header crumbs={[{ label: 'Documentación' }]} />

      <div style={{ display: 'grid', gridTemplateColumns: '210px 1fr', gap: 24, padding: 24, maxWidth: 1140, margin: '0 auto', alignItems: 'start' }}>

        {/* ── Sidebar nav ── */}
        <nav style={{ position: 'sticky', top: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {groups.map((group) => (
            <div key={group} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94a3b8', marginBottom: 4, padding: '0 10px' }}>
                {group}
              </div>
              {NAV.filter((n) => n.group === group).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => scrollTo(item.id)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '5px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                    fontSize: '0.82rem',
                    fontWeight: active === item.id ? 600 : 400,
                    color: active === item.id ? '#4f46e5' : '#475569',
                    background: active === item.id ? '#eef2ff' : 'transparent',
                    transition: 'all 0.12s',
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* ── Content ── */}
        <div style={{ minWidth: 0 }}>

          {/* ═══════════════════════════════════════
              INICIO
          ═══════════════════════════════════════ */}

          <SectionTitle id="getting-started">Primeros Pasos</SectionTitle>
          <P>Data Model Hub es una plataforma web para diseñar modelos de datos ER (Entidad-Relación) de forma visual e interactiva, con asistencia de un agente IA que genera tablas y DDL a partir de descripción en lenguaje natural o archivos Excel.</P>

          <FlowDiagram steps={[
            { icon: '📁', title: 'Crear Proyecto', desc: 'Agrupa modelos' },
            { icon: '📐', title: 'Crear Modelo', desc: 'Seleccioná el motor DB' },
            { icon: '🗂️', title: 'Agregar Tablas', desc: 'Manual o con IA' },
            { icon: '🔗', title: 'Definir Relaciones', desc: 'FK entre columnas' },
            { icon: '💾', title: 'Exportar DDL', desc: 'SQL ejecutable' },
          ]} />

          <Sub>Crear un Proyecto</Sub>
          <Ol items={[
            <>En la pantalla principal, hacé click en <strong>New Project</strong></>,
            <>Ingresá nombre (obligatorio) y descripción (opcional)</>,
            <>Click en <strong>Create Project</strong> — te redirige al detalle del proyecto</>,
          ]} />

          <Sub>Crear un Modelo de Datos</Sub>
          <Ol items={[
            <>Dentro del proyecto, click en <strong>Create First Model</strong> (o <strong>New Model</strong>)</>,
            <>Ingresá un nombre → <strong>Create Model</strong></>,
            <>El editor se abre en Vista de Lista por defecto</>,
          ]} />

          <Callout type="tip">
            Cada proyecto puede tener múltiples modelos. Usá un modelo por dominio, sistema o solución de datos para mantener el diseño organizado.
          </Callout>

          {/* ─────── */}

          <SectionTitle id="model-editor">Editor de Modelos</SectionTitle>
          <P>El editor tiene dos filas en el encabezado y un área de trabajo central que alterna entre Vista de Lista y Canvas.</P>

          <Sub>Fila Superior — Identidad</Sub>
          <Ul items={[
            <><strong>‹ Volver</strong> — regresa a la lista de modelos del proyecto</>,
            <><strong>Breadcrumb</strong> — <Code>Proyectos › Proyecto › Modelo</Code>, cada nivel es clickable</>,
            <><strong>Selector de motor</strong> — Databricks SQL / PostgreSQL / MySQL / SQL Server / CosmosDB</>,
          ]} />

          <Sub>Fila Inferior — Toolbar de Acciones</Sub>
          <DocTable
            headers={['Botón', 'Qué hace']}
            rows={[
              ['List / Canvas', 'Alterna entre la cuadrícula de tarjetas y el diagrama ER interactivo'],
              ['Dominios', 'Abre el gestor de dominios y subdominios del modelo (con badge contador)'],
              ['Nueva Vista', 'Crea una vista SQL derivada de una tabla física (habilitado cuando hay tablas)'],
              ['Import Excel', 'Sube un .xlsx; cada hoja se convierte en una tabla'],
              ['Guardar', 'Guarda el modelo manualmente. Se resalta en ámbar cuando hay cambios sin guardar'],
              ['Export DDL', 'Genera el DDL completo del modelo y abre el modal de descarga'],
              ['AI Agent', 'Abre/cierra el panel del agente IA (perrito) para modelado asistido'],
            ]}
          />

          <Callout type="info">
            El modelo <strong>no se guarda automáticamente</strong>. El botón <strong>Guardar</strong> se pone en ámbar cuando hay cambios pendientes. Guardá antes de cerrar el navegador.
          </Callout>

          {/* ═══════════════════════════════════════
              MODELADO
          ═══════════════════════════════════════ */}

          <SectionTitle id="adding-tables">Tablas y Columnas</SectionTitle>
          <P>Las tablas son la unidad base del modelo. Cada tabla tiene propiedades físicas (SQL) y opcionales lógicas (negocio).</P>

          <Sub>Abrir el formulario de tabla</Sub>
          <Ul items={[
            <>En Vista Lista: botón <strong>+ Nueva Tabla</strong> o ícono de edición en cada tarjeta</>,
            <>En Vista Canvas: engranaje ⚙ en el encabezado de cualquier nodo → <strong>Edit</strong></>,
          ]} />

          <Sub>Pestaña General</Sub>
          <DocTable
            headers={['Campo', 'Req.', 'Descripción']}
            rows={[
              ['Nombre de Entidad (lógico)', 'No', 'Nombre de negocio (ej. "Cliente"). Visible en vista lógica del canvas.'],
              ['Schema', 'Sí', 'Namespace SQL (ej. bcp_ddv_crm). Se auto-completa con el default del motor.'],
              ['Nombre de Tabla (físico)', 'Sí', 'Identificador SQL (ej. HD_CLIENTE). Preview en vivo: schema.tabla.'],
              ['Definición Funcional', 'No', 'Descripción de negocio. Aparece en tooltips y se emite como COMMENT en el DDL.'],
              ['Dominio / Subdominio', 'No', 'Selector del catálogo de dominios. Al elegir, hereda schema y tags definidos en el dominio.'],
            ]}
          />

          <Sub>Pestaña Columns</Sub>
          <P>Cada columna es una tarjeta con:</P>
          <Ul items={[
            <><strong>Nombre físico</strong> — identificador SQL</>,
            <><strong>Nombre lógico</strong> — atributo de negocio (ej. "Código de Cliente"). Se muestra en vista lógica.</>,
            <><strong>Tipo de dato</strong> — selector con todos los tipos canónicos</>,
            <><strong>Chips de constraint</strong>: PK · FK · SK · UNIQUE · NOT NULL (toggleables, con colores semánticos)</>,
            <><strong>Campos inline</strong>: Length · Scale · Default · Definición funcional</>,
            <><strong>Banner FK</strong>: cuando FK está activo, aparece un selector de tabla.columna referenciada</>,
          ]} />

          <Callout type="tip">
            Activar PK implica NOT NULL automáticamente. Length aparece para varchar/char/nvarchar; Scale para decimal/numeric.
          </Callout>

          <Sub>Pestaña Partitioning</Sub>
          <DocTable
            headers={['Campo', 'Descripción']}
            rows={[
              ['Strategy', 'NONE · RANGE · LIST · HASH · DATE · BUCKET (filtrado según motor)'],
              ['Partition Columns', 'Columnas que dirigen la partición (chips seleccionables)'],
              ['Buckets', 'Para estrategia HASH/BUCKET'],
              ['Granularity', 'Para DATE: DAY / MONTH / YEAR / HOUR'],
              ['Clustering Columns', 'Solo Databricks — Z-ORDER (clustering adicional sobre la partición)'],
            ]}
          />

          <Sub>Pestaña Metadata</Sub>
          <DocTable
            headers={['Campo', 'Uso']}
            rows={[
              ['Application Code', 'Sistema dueño de la tabla (CRM, ERP, MDM…)'],
              ['Domain / Subdomain', 'Clasificación de negocio (se sincroniza con el catálogo de dominios)'],
              ['Tags', 'Etiquetas libres para filtrado. Enter o coma para agregar.'],
            ]}
          />

          {/* ─────── */}

          <SectionTitle id="logical-physical">Nombres Lógico / Físico</SectionTitle>
          <P>La plataforma distingue dos capas de nomenclatura en tablas y columnas:</P>

          <DocTable
            headers={['Capa', 'Qué es', 'Ejemplo']}
            rows={[
              ['Físico', 'Nombre SQL real, el que va en el DDL y en la BD', 'HD_CLIENTE, CODCLI, VARCHAR(20)'],
              ['Lógico', 'Nombre de negocio / entidad, sin restricciones SQL', 'Cliente, Código de Cliente, Texto corto'],
            ]}
          />

          <P>En el canvas, los nodos de tabla muestran el nombre físico (<Code>schema.TABLA</Code>). Los <strong>nodos de Vista</strong> tienen una visión lógica de los datos (ver sección Vistas SQL).</P>

          <Callout type="info">
            El nombre lógico es opcional. Si se define, se usa en las vistas y como contexto para el agente IA.
          </Callout>

          {/* ─────── */}

          <SectionTitle id="domains">Dominios y Subdominios</SectionTitle>
          <P>El catálogo de dominios permite definir áreas de negocio reutilizables con <strong>defaults heredables</strong> por las tablas asignadas.</P>

          <Sub>¿Para qué sirven?</Sub>
          <Ul items={[
            <>Organizar tablas por área de negocio (Campañas CRM, Ofertas, Clientes…)</>,
            <>Heredar automáticamente el <strong>schema</strong> y los <strong>tags</strong> al asignar un dominio/subdominio a una tabla</>,
            <>Filtrar y agrupar en la Vista de Lista (By domain)</>,
            <>Dar contexto al agente IA para que use los schemas correctos al generar tablas</>,
          ]} />

          <Sub>Gestionar Dominios</Sub>
          <Ol items={[
            <>Click en el botón <strong>Dominios</strong> del toolbar (con badge contador)</>,
            <>En el panel izquierdo del modal, click en <strong>Nuevo</strong></>,
            <>Completá: nombre, código de abreviatura, descripción, color identificador</>,
            <>En <em>Defaults heredables</em>: schema por defecto, tags por defecto</>,
            <>Click en <strong>Crear dominio</strong></>,
            <>Para agregar subdominios, expandí el dominio creado y usá la fila inferior</>,
          ]} />

          <Sub>Herencia de Defaults</Sub>
          <P>Cuando asignás un dominio o subdominio a una tabla en el <strong>TableForm</strong>:</P>
          <Ul items={[
            <>El schema del dominio se aplica automáticamente (si el schema actual es el default del motor)</>,
            <>Los tags del dominio se agregan a la tabla</>,
            <>Si el subdominio tiene su propio schema, éste sobreescribe el del dominio</>,
          ]} />

          <Callout type="tip">
            Los subdominios son más específicos que los dominios. Usá dominios para el área general (ej. "Campañas") y subdominios para la solución específica (ej. "Campañas Digital", "Campañas Físico").
          </Callout>

          {/* ─────── */}

          <SectionTitle id="views">Vistas SQL (Capa Lógica)</SectionTitle>
          <P>Las <strong>vistas SQL</strong> son la capa lógica del modelo: entidades derivadas de tablas físicas con transformaciones, renombrado de columnas y filtros.</P>

          <Sub>Tipos de Vista</Sub>
          <DocTable
            headers={['Tipo', 'Uso típico', 'Ejemplo']}
            rows={[
              ['Técnica (TECH)', 'ETL interno, auditoría, staging', 'VW_CLIENTE_STAGING'],
              ['De usuario (USER)', 'Nombres limpios para usuarios finales, sin columnas técnicas', 'VW_CLIENTE'],
              ['De negocio (BIZ)', 'KPIs, métricas, transformaciones para analistas', 'VW_CLIENTES_ACTIVOS_MES'],
            ]}
          />

          <Sub>Crear una Vista</Sub>
          <Ol items={[
            <>Click en <strong>Nueva Vista</strong> en el toolbar (requiere que existan tablas)</>,
            <>En pestaña <strong>General</strong>: elegí la tabla física origen, el tipo de vista, schema y nombre</>,
            <>En pestaña <strong>Columnas</strong>: seleccioná qué columnas incluir, definí aliases y expresiones SQL</>,
            <>En pestaña <strong>Filtros</strong>: agregá una cláusula WHERE, o activá "Query personalizado" para escribir SQL completo</>,
            <>Click en <strong>Crear vista</strong></>,
          ]} />

          <Sub>Configuración de Columnas</Sub>
          <DocTable
            headers={['Campo', 'Descripción', 'Ejemplo']}
            rows={[
              ['Incluir (checkbox)', 'Si la columna aparece en la vista o se omite', '☑ CODCLI'],
              ['Alias', 'Nombre que expondrá la vista (renombrado)', 'CODCLI → codigo_cliente'],
              ['Expresión SQL (fx)', 'Transformación aplicada sobre la columna', 'CAST(MTOSALDO AS DECIMAL(21,4))'],
            ]}
          />

          <P>Ejemplos de expresiones SQL válidas:</P>
          <CodeBlock lang="sql">{`
-- Cast de tipo
CAST(col_monto AS DECIMAL(21,4))

-- Máscara condicional
CASE WHEN clasificacion = 'DAC' THEN 'CONFIDENCIAL' ELSE valor END

-- Concatenación
CONCAT(cod_pais, '-', cod_region)

-- Coalesce con default
COALESCE(nombre_comercial, nombre_legal, 'SIN NOMBRE')

-- Formato de fecha
DATE_FORMAT(fec_registro, 'yyyy-MM')
          `}</CodeBlock>

          <Sub>Filtro WHERE</Sub>
          <P>En la pestaña Filtros, escribí solo la condición (sin el keyword WHERE):</P>
          <CodeBlock lang="sql">{`
flg_eliminado = 0 AND estado = 'ACTIVO' AND fec_rutina >= CURRENT_DATE - 30
          `}</CodeBlock>

          <Sub>Query Personalizado</Sub>
          <P>Para vistas con lógica compleja (JOINs, subqueries), activá el toggle <strong>Query personalizado</strong> y escribí el SQL completo:</P>
          <CodeBlock lang="sql">{`
CREATE OR REPLACE VIEW bcp_ddv_crm.VW_CLIENTES_OFERTA AS
SELECT
  c.CODCLI,
  c.NOMCLI,
  o.CODOFERTA,
  CAST(o.MTOOFERTA AS DECIMAL(21,4)) AS monto_oferta
FROM bcp_ddv_crm.HD_CLIENTE c
INNER JOIN bcp_ddv_crm.HD_OFERTA o ON c.CODCLI = o.CODCLI
WHERE c.flg_eliminado = 0 AND o.estado = 'VIGENTE'
          `}</CodeBlock>

          <Sub>Vistas en el Canvas</Sub>
          <P>Las vistas aparecen en el canvas como nodos con <strong>borde punteado</strong>, badge de tipo coloreado, y una arista punteada que las conecta con su tabla origen.</P>
          <Ul items={[
            <>Las columnas con alias muestran <Code>col_origen → alias</Code></>,
            <>Las columnas con expresión muestran el badge <Code>fx</Code></>,
            <>Un badge <Code>WHERE</Code> en el footer indica que tiene filtro activo</>,
            <>Click en el ícono de lápiz del nodo para editar la vista</>,
          ]} />

          {/* ─────── */}

          <SectionTitle id="relationships">Relaciones (FK)</SectionTitle>
          <P>Las relaciones conectan columnas entre tablas, representando las foreign keys del modelo.</P>

          <Sub>Crear relaciones desde el formulario de tabla</Sub>
          <Ol items={[
            <>Abrí el TableForm de la tabla que tendrá la FK</>,
            <>En la columna correspondiente, activá el chip <strong>FK</strong></>,
            <>Aparece el banner FK: seleccioná la tabla de referencia y la columna</>,
            <>Guardá la tabla — la relación aparece como arista en el canvas</>,
          ]} />

          <Sub>Crear relaciones directamente en el canvas</Sub>
          <P>Ver la sección <strong>Herramientas del Canvas</strong> para el flujo visual de drag-and-drop.</P>

          <Sub>Tipos de relación</Sub>
          <DocTable
            headers={['Tipo', 'Notación', 'Significado']}
            rows={[
              ['Uno a uno', '1 : 1', 'Cada registro tiene un único correspondiente en ambas tablas'],
              ['Uno a muchos', '1 : N', 'Un registro puede relacionarse con múltiples (el más común)'],
              ['Muchos a muchos', 'N : M', 'Múltiples registros en ambos lados (generalmente necesita tabla intermedia)'],
            ]}
          />

          {/* ═══════════════════════════════════════
              CANVAS
          ═══════════════════════════════════════ */}

          <SectionTitle id="canvas-view">Diagrama ER (Canvas)</SectionTitle>
          <P>El canvas es el diagrama interactivo que muestra todas las tablas y vistas del modelo con sus relaciones.</P>

          <Sub>Navegación</Sub>
          <DocTable
            headers={['Acción', 'Cómo']}
            rows={[
              ['Desplazar', 'Arrastrar en espacio vacío del canvas'],
              ['Zoom', 'Rueda del mouse · botones ± en barra inferior'],
              ['Ajustar todo', 'Botón de ajuste de vista en la barra inferior'],
              ['Minimapa', 'Panel inferior derecho — arrastrable y zoomeable'],
            ]}
          />

          <Sub>Nodos de Tabla (borde sólido)</Sub>
          <Ul items={[
            <><strong>Header coloreado</strong>: nombre físico (<Code>schema.TABLA</Code>), badge de conteo de columnas, engranaje ⚙</>,
            <><strong>Columnas</strong>: ícono PK/FK/SK/PT + nombre + tipo de dato</>,
            <><strong>Footer</strong>: definición funcional (primeros 45 caracteres)</>,
            <><strong>Hover</strong>: resalta las aristas de relaciones conectadas y las columnas involucradas en ambos nodos</>,
            <><strong>Tooltip de columna</strong>: nombre lógico/físico, tipo, FK referenciada</>,
          ]} />

          <Sub>Nodos de Vista (borde punteado)</Sub>
          <Ul items={[
            <><strong>Badge de tipo</strong>: TECH (azul) · USER (teal) · BIZ (violeta)</>,
            <><strong>Nombre lógico</strong> como etiqueta principal, nombre físico en gris pequeño</>,
            <><strong>Flecha punteada</strong>: conecta la vista con su tabla física origen</>,
            <><strong>Indicadores</strong>: badge <Code>fx</Code> por columna con expresión, badge <Code>WHERE</Code> en footer</>,
          ]} />

          <Sub>Editar desde el canvas</Sub>
          <Ul items={[
            <><strong>Tablas</strong>: hover → ícono ⚙ → Edit → formulario completo</>,
            <><strong>Vistas</strong>: ícono de lápiz en el header del nodo → ViewForm</>,
            <><strong>Mover nodos</strong>: arrastrar libremente (posiciones en memoria de sesión)</>,
          ]} />

          {/* ─────── */}

          <SectionTitle id="canvas-tools">Herramientas del Canvas</SectionTitle>
          <P>El canvas tiene una <strong>barra de herramientas flotante</strong> en el lado izquierdo con dos modos:</P>

          <Sub>Herramienta Seleccionar (↖)</Sub>
          <Ul items={[
            <>Modo por defecto al entrar al canvas</>,
            <>Click en nodos para seleccionarlos visualmente</>,
            <>Drag en espacio vacío para desplazar la vista</>,
            <>Drag en un nodo de tabla para moverlo</>,
          ]} />

          <Sub>Herramienta Conectar (🔗)</Sub>
          <P>Para crear una relación visual entre dos columnas de tablas distintas:</P>
          <Ol items={[
            <>Click en el ícono de enlace en la barra lateral para activar modo Conectar</>,
            <>Los handles de columnas se vuelven visibles como círculos índigo en cada columna</>,
            <>Arrastrá desde el handle de una columna hacia el handle de otra columna en otra tabla</>,
            <>Al soltar, aparece un selector centrado: elegí el tipo de relación (1:1 / 1:N / N:M)</>,
            <>Click en <strong>Cancelar</strong> si querés descartar la conexión</>,
            <>La relación se crea y aparece como arista animada en el canvas</>,
          ]} />

          <Callout type="tip">
            Solo podés conectar columnas de <strong>tablas físicas</strong> entre sí. No es posible hacer FK desde/hacia vistas (las vistas no tienen FK propias en SQL).
          </Callout>

          <Sub>Borrar una Relación desde el Canvas</Sub>
          <Ol items={[
            <>Hacé click sobre cualquier arista (línea de relación) para seleccionarla</>,
            <>Presioná la tecla <Code>Delete</Code></>,
            <>La relación se elimina del canvas y del modelo</>,
          ]} />

          <Callout type="warning">
            Borrar una relación desde el canvas elimina la FK del modelo. Si también tenías el chip FK marcado en la columna, deberás desmarcarlo manualmente en el formulario de tabla para mantener consistencia.
          </Callout>

          {/* ─────── */}

          <SectionTitle id="auto-arrange">Distribución Automática</SectionTitle>
          <P>Click en el <strong>ícono de cuadrícula</strong> en la barra inferior del canvas para abrir el selector de algoritmo:</P>
          <DocTable
            headers={['Algoritmo', 'Cuándo usar']}
            rows={[
              ['Izquierda-Derecha', 'Pipelines ETL y lineajes — capas topológicas de izquierda a derecha'],
              ['Copo de Nieve', 'Esquemas estrella — tabla más conectada al centro, dimensiones alrededor'],
              ['Compacto', 'Diagramas con pocas relaciones — cuadrícula ordenada por densidad de conexiones'],
            ]}
          />

          {/* ═══════════════════════════════════════
              AGENTE IA
          ═══════════════════════════════════════ */}

          <SectionTitle id="ai-agent">Agente IA — Chat</SectionTitle>
          <P>El <strong>AI Modeler</strong> es un asistente que genera tablas, columnas, tipos de dato y DDL a partir de tu descripción. Conoce las convenciones y lineamientos corporativos si se los proveés.</P>

          <Sub>Abrir el panel</Sub>
          <P>Click en el botón <strong>AI Agent</strong> (con el perrito 🐕) en el toolbar. El panel se abre a la derecha del canvas o de la lista.</P>

          <Sub>Ciclo de una conversación</Sub>
          <FlowDiagram steps={[
            { icon: '📝', title: 'Describís', desc: 'Texto libre o Excel' },
            { icon: '🐕', title: 'Piensa', desc: 'Consulta lineamientos' },
            { icon: '🔍', title: 'Analiza', desc: 'Revisa catálogo' },
            { icon: '🎯', title: 'Responde', desc: 'Tablas + DDL + QA' },
            { icon: '✅', title: 'Aplicás', desc: 'Al canvas (2 pasos)' },
          ]} />

          <Sub>Enviar un mensaje</Sub>
          <Ul items={[
            <><strong>Texto libre</strong>: describí el modelo que necesitás ("Necesito modelar la tabla de campañas CRM con sus tipos de oferta y canales de distribución")</>,
            <><strong>Excel (.xlsx)</strong>: click en el clip 📎 para adjuntar un archivo con tus tablas ya definidas</>,
            <><strong>Combinación</strong>: texto + Excel en el mismo turno para contexto adicional</>,
            <>Presioná <Code>Enter</Code> para enviar · <Code>Shift+Enter</Code> para nueva línea</>,
          ]} />

          <Sub>Estados del agente (animaciones)</Sub>
          <DocTable
            headers={['Estado', 'Imagen', 'Qué significa']}
            rows={[
              ['Pensando', 'Perrito con lupa mirando hacia arriba', 'Procesando tu solicitud y elaborando el modelo'],
              ['Analizando', 'Perrito buscando con lupa', 'Revisando lineamientos y catálogo corporativo'],
              ['Listo', 'Perrito feliz con las manos arriba', 'Modelo generado correctamente'],
              ['Error', 'Perrito sudado y asustado', 'Algo salió mal (ver mensaje de error en el chat)'],
            ]}
          />

          <Sub>Resultado del agente</Sub>
          <P>Cada respuesta exitosa incluye un bloque colapsable con:</P>
          <Ul items={[
            <><strong>Tablas generadas</strong>: nombre, columnas con tipos y definiciones</>,
            <><strong>Relaciones</strong>: FK declaradas entre tablas</>,
            <><strong>QA Score</strong>: puntaje de calidad (0-100) y detalles de validaciones</>,
            <><strong>DDL</strong>: código SQL ejecutable, con botón de copiar</>,
            <><strong>Guidelines aplicadas</strong>: resumen de qué lineamientos respetó el agente</>,
          ]} />

          <Sub>Aplicar el modelo al canvas</Sub>
          <Ol items={[
            <>Click en <strong>Aplicar al canvas</strong> → aparece un aviso de confirmación</>,
            <>Click en <strong>Confirmar y aplicar</strong> para reemplazar las tablas/relaciones del canvas</>,
            <>Click en <strong>Cancelar</strong> si querés seguir conversando antes de aplicar</>,
          ]} />

          <Callout type="warning">
            Aplicar reemplaza <strong>todas</strong> las tablas y relaciones del canvas. Guardá el modelo antes si querés preservar el estado anterior.
          </Callout>

          <Sub>Conversación multi-turno</Sub>
          <P>El agente recuerda el historial y el último modelo generado en la sesión. Podés refinarlo progresivamente:</P>
          <Ul items={[
            <>"Agregá una tabla de auditoría con los campos estándar"</>,
            <>"Cambiá el tipo de dato de MTOOFERTA a DECIMAL(21,4)"</>,
            <>"Agregá las columnas técnicas obligatorias (FecRutina, FlgEliminado, etc.)"</>,
          ]} />

          <Sub>Nueva sesión</Sub>
          <P>Click en el ícono ↺ (rotación) en el header del panel. Esto:</P>
          <Ul items={[
            <>Limpia el historial visual del chat en pantalla</>,
            <>Libera la sesión en el backend (memoria liberada)</>,
            <>Genera un nuevo ID de sesión para el próximo mensaje</>,
            <>El canvas <strong>no se modifica</strong> — el modelo que construiste queda intacto</>,
          ]} />

          {/* ─────── */}

          <SectionTitle id="guidelines">Guidelines</SectionTitle>
          <P>Los <strong>lineamientos</strong> son archivos con las convenciones corporativas de modelado (nomenclatura, tipos de dato, columnas obligatorias, etc.). El agente los aplica automáticamente en cada turno de la conversación.</P>

          <Sub>Cargar guidelines</Sub>
          <Ol items={[
            <>En el panel del agente, click en <strong>Subir</strong> (sección Guidelines, sobre el área de mensajes)</>,
            <>Seleccioná el archivo (soporta: PDF, DOCX, MD, JSON, XLSX, TXT)</>,
            <>El agente procesará el archivo y lo cacheará para todos los turnos de la sesión</>,
          ]} />

          <Callout type="info">
            Las guidelines son por sesión — si iniciás una nueva sesión (↺), deberás volver a cargarlas. El contenido nunca se persiste en disco.
          </Callout>

          <Sub>Qué incluir en los lineamientos</Sub>
          <Ul items={[
            <>Prefijos de tablas por dominio (ej. HD_ para históricas, DM_ para dimensiones)</>,
            <>Abreviaturas estándar del glosario (COD = Código, CLI = Cliente, MTO = Monto…)</>,
            <>Dominios padres y sus tipos de dato (Monto → DECIMAL(21,4), Nombre → VARCHAR(256))</>,
            <>Columnas técnicas obligatorias (FecRutina, FlgEliminado, FecActualizacionRegistro…)</>,
            <>Convenciones de partición y clustering para el motor</>,
          ]} />

          {/* ═══════════════════════════════════════
              FLUJOS
          ═══════════════════════════════════════ */}

          <SectionTitle id="list-view">Vista de Lista</SectionTitle>
          <P>La Vista de Lista muestra todas las tablas del modelo como tarjetas con metadatos de clasificación.</P>

          <Sub>Búsqueda y Filtros</Sub>
          <Ul items={[
            <><strong>Búsqueda</strong>: filtra por nombre de tabla, schema, dominio, subdominio, código de app, definición o etiquetas</>,
            <><strong>Tags</strong>: click en cualquier chip de etiqueta para filtrar por esa tag</>,
            <><strong>Group by</strong>: By schema · By domain · Flat (sin agrupación)</>,
          ]} />

          <Sub>Acciones por tabla</Sub>
          <DocTable
            headers={['Ícono', 'Acción']}
            rows={[
              ['↓', 'Descargar DDL de esa tabla específica'],
              ['✏', 'Editar tabla (abre el TableForm)'],
              ['🗑', 'Eliminar tabla (con confirmación)'],
            ]}
          />

          {/* ─────── */}

          <SectionTitle id="ddl-export">Exportar DDL</SectionTitle>
          <P>El DDL generado es SQL ejecutable adaptado al motor del modelo. Tres niveles de granularidad:</P>
          <DocTable
            headers={['Scope', 'Cómo', 'Resultado']}
            rows={[
              ['Modelo completo', 'Botón Export DDL en el toolbar', 'CREATE SCHEMA + todas las tablas + ALTER TABLE FKs al final'],
              ['Por dominio', 'Ícono ↓ junto al header de grupo en Vista Lista', 'Solo tablas del dominio/schema seleccionado'],
              ['Una tabla', 'Ícono ↓ en la tarjeta de cada tabla', 'CREATE TABLE de esa tabla con sus FKs'],
            ]}
          />

          <Sub>Opciones del modal DDL</Sub>
          <Ul items={[
            <><strong>Emit schemas</strong>: incluye <Code>CREATE SCHEMA IF NOT EXISTS</Code> al inicio</>,
            <><strong>Emit foreign keys</strong>: agrega <Code>ALTER TABLE ADD CONSTRAINT FOREIGN KEY</Code> al final</>,
            <><strong>Emit comments</strong>: emite <Code>COMMENT ON TABLE/COLUMN</Code> con las definiciones funcionales</>,
            <><strong>Copy</strong>: copia al portapapeles · <strong>Download</strong>: descarga como <Code>.sql</Code></>,
          ]} />

          {/* ─────── */}

          <SectionTitle id="save">Guardar</SectionTitle>
          <P>El modelo se guarda <strong>solo cuando hacés click en el botón Guardar</strong>. No hay auto-guardado.</P>

          <Sub>Estados del botón Guardar</Sub>
          <DocTable
            headers={['Estado', 'Apariencia', 'Qué significa']}
            rows={[
              ['Sin cambios', 'Gris claro · ícono ✓ verde · "Guardado"', 'El modelo está sincronizado con lo persistido en disco'],
              ['Cambios pendientes', 'Fondo ámbar · negrita · "Guardar"', 'Hay tablas, relaciones o vistas modificadas sin guardar'],
              ['Guardando', 'Spinner girando · "Guardando…"', 'El request de guardado está en vuelo'],
            ]}
          />

          <Callout type="warning">
            Cerrar el navegador o navegar fuera del editor sin guardar <strong>perderá todos los cambios</strong>. El botón ámbar es la señal de que hay trabajo sin persistir.
          </Callout>

          <P>El botón Guardar se habilita (ámbar) al:</P>
          <Ul items={[
            <>Agregar, editar o eliminar una tabla</>,
            <>Crear, modificar o eliminar una relación (desde formulario o desde el canvas)</>,
            <>Agregar o editar una vista SQL</>,
            <>Crear o modificar dominios del catálogo</>,
            <>Aplicar un modelo generado por el agente al canvas</>,
            <>Cambiar el motor de BD del modelo</>,
          ]} />

          {/* ═══════════════════════════════════════
              REFERENCIA
          ═══════════════════════════════════════ */}

          <SectionTitle id="schemas-partitioning">Esquemas y Particionamiento</SectionTitle>

          <Sub>Schemas SQL</Sub>
          <P>Cada tabla pertenece a un schema (namespace). El default del motor se usa si no se especifica. La Vista de Lista agrupa por schema y el canvas muestra el prefijo <Code>schema.TABLA</Code>.</P>

          <Sub>Estrategias de Particionamiento</Sub>
          <DocTable
            headers={['Strategy', 'DDL emitido', 'Motores']}
            rows={[
              ['NONE', '(sin cláusula)', 'Todos'],
              ['RANGE', 'PARTITION BY RANGE (col)', 'PostgreSQL, Oracle, Databricks'],
              ['LIST', 'PARTITION BY LIST (col)', 'PostgreSQL, Oracle, Databricks'],
              ['HASH', 'PARTITION BY HASH (col)', 'PostgreSQL, Oracle, MySQL'],
              ['BUCKET', 'PARTITIONED BY (col)', 'Databricks'],
              ['DATE', 'PARTITION BY (col) -- con granularidad', 'Reservado para BigQuery (futuro)'],
            ]}
          />

          {/* ─────── */}

          <SectionTitle id="engine-capabilities">Capacidades por Motor</SectionTitle>

          <Sub>Mapeo de Tipos Canónicos</Sub>
          <DocTable
            headers={['Canónico', 'PostgreSQL', 'SQL Server', 'Databricks SQL', 'MySQL']}
            rows={[
              ['integer',   'INTEGER',         'INT',           'INT',       'INT'],
              ['bigint',    'BIGINT',          'BIGINT',        'BIGINT',    'BIGINT'],
              ['decimal',   'NUMERIC',         'DECIMAL',       'DECIMAL',   'DECIMAL'],
              ['varchar',   'VARCHAR',         'NVARCHAR',      'STRING',    'VARCHAR'],
              ['text',      'TEXT',            'NVARCHAR(MAX)', 'STRING',    'TEXT'],
              ['boolean',   'BOOLEAN',         'BIT',           'BOOLEAN',   'TINYINT(1)'],
              ['date',      'DATE',            'DATE',          'DATE',      'DATE'],
              ['timestamp', 'TIMESTAMP',       'DATETIME2',     'TIMESTAMP', 'DATETIME'],
              ['json',      'JSONB',           'NVARCHAR(MAX)', 'STRING',    'JSON'],
              ['array',     'JSONB',           'NVARCHAR(MAX)', 'ARRAY<STRING>', 'JSON'],
              ['struct',    'JSONB',           'NVARCHAR(MAX)', 'STRUCT',    'JSON'],
            ]}
          />

          <Callout type="tip">
            Si escribís un tipo con paréntesis ya dialect-specific (ej. <Code>VARCHAR2(50)</Code>, <Code>DECIMAL(21,4)</Code>), el generador DDL lo respeta sin remapear.
          </Callout>

          {/* ─────── */}

          <SectionTitle id="dbml-reference">Referencia DBML</SectionTitle>
          <P>DBML (Database Markup Language) es el formato de texto del panel Code en el canvas. Permite escribir el modelo en código y sincronizarlo visualmente.</P>

          <Sub>Sintaxis básica</Sub>
          <CodeBlock lang="dbml">{`
Table HD_CLIENTE {
  CODCLI varchar(20) [pk, not null, note: 'Código único del cliente']
  NOMCLI varchar(256)
  FECRUTINA date
  FLGREGELIMINADO char(1) [default: '0']
  Note: 'Tabla maestra de clientes'
}

Table bcp_ddv_crm.HD_ORDEN {    // schema.nombre
  CODORDEN varchar(20) [pk]
  CODCLI varchar(20) [ref: > HD_CLIENTE.CODCLI]
  MTOORDEN decimal(21,4)
}
          `}</CodeBlock>

          <Sub>Configuraciones de columna</Sub>
          <DocTable
            headers={['Setting', 'Efecto']}
            rows={[
              ['pk', 'Primary Key'],
              ['not null', 'NOT NULL en DDL'],
              ['unique', 'Constraint UNIQUE'],
              ["default: 'x'", 'Valor por defecto'],
              ["note: 'texto'", 'Definición funcional (tooltip + DDL COMMENT)'],
              ['ref: > tabla.col', 'FK uno-a-muchos (el lado muchos está aquí)'],
              ['ref: - tabla.col', 'FK uno-a-uno'],
              ['ref: < tabla.col', 'FK muchos-a-muchos'],
            ]}
          />

          <Sub>FK entre schemas</Sub>
          <CodeBlock lang="dbml">{`
// FK calificada con schema
Table bcp_ddv_crm.HD_DETALLE {
  CODCLI varchar(20) [ref: > bcp_ddv_crm.HD_CLIENTE.CODCLI]
}
          `}</CodeBlock>

          <Callout type="warning">
            Aplicar DBML desde el editor Code <strong>reemplaza todas las tablas actuales</strong> del modelo. Exportá el DDL antes si querés conservar el estado.
          </Callout>

          {/* ─────── */}

          <SectionTitle id="technical-overview">Arquitectura Técnica</SectionTitle>
          <P>Data Model Hub es un sistema de dos componentes que se comunican vía HTTP:</P>

          <Sub>Frontend (Next.js :3000)</Sub>
          <DocTable
            headers={['Capa', 'Tecnología', 'Responsabilidad']}
            rows={[
              ['UI / Canvas', 'React + @xyflow/react v12', 'Diagrama ER interactivo, TableNode, ViewNode, herramientas'],
              ['Estado', 'Zustand', 'useModelStore (tablas, relaciones, vistas, dominios, guardado), useUIStore, useAgentStore'],
              ['API proxy', 'Next.js Route Handlers', '/api/projects, /api/models, /api/agent/* (proxy al backend)'],
              ['Persistencia', 'JSON en filesystem', 'data/projects.json + data/models/{uuid}.json (incluyendo views, domainCatalog)'],
            ]}
          />

          <Sub>Backend (FastAPI :8000)</Sub>
          <DocTable
            headers={['Componente', 'Responsabilidad']}
            rows={[
              ['ConversationStore', 'Memoria en RAM por conversation_id (UUID v4). Historial, guidelines, último modelo.'],
              ['Pipeline', 'prepare_input → ExecutorAgent → extract_model → QAValidatorAgent → format_output'],
              ['ExecutorAgent', 'Genera modelo + DDL aplicando lineamientos (Azure AI Foundry · GPT-4o)'],
              ['QAValidatorAgent', 'Estandariza nombres vs catálogo corporativo, calcula quality_score'],
              ['knowledge_base_tools', 'Carga y cachea guidelines por sesión (ContextVar)'],
              ['catalog_tools', 'CRUD sobre column_catalog.json con similitud Jaccard'],
            ]}
          />

          <Sub>Flujo completo de un turno de modelado</Sub>
          <CodeBlock>{`
[Usuario] → escribe en el chat del frontend
    ↓
[Frontend] POST /api/agent/conversations/{id}/model
    ↓ (proxy Next.js)
[Backend FastAPI] POST /api/conversations/{id}/model
    ↓
ConversationStore → inyecta history + last_model en el payload
    ↓
run_modeling_pipeline:
  prepare_input → construye prompt enriquecido
  ExecutorAgent → genera tablas + DDL (consulta guidelines)
  extract_model → limpia JSON, prepara prompt QA
  QAValidatorAgent → estandariza vs catálogo, calcula score
  format_output → JSON final
    ↓
response_builder → mapea a ModelingResponseAPI
    ↓
[Frontend] muestra resultado en el chat con el perrito
    ↓
[Usuario] → "Aplicar al canvas" (2 pasos) → tablas en el canvas
    ↓
[Usuario] → click Guardar → PUT /api/models/{id} → JSON en disco
          `}</CodeBlock>

          <Sub>Persistencia del modelo</Sub>
          <P>Cada modelo se guarda como un archivo JSON en <Code>data/models/{'{uuid}'}.json</Code> con la estructura completa:</P>
          <CodeBlock lang="json">{`
{
  "id": "uuid",
  "projectId": "uuid",
  "name": "Modelo CRM",
  "engine": "databricks_sql",
  "tables": [ { "id", "schema", "name", "logicalName", "columns", ... } ],
  "relationships": [ { "id", "sourceTable", "sourceColumn", ... } ],
  "views": [ { "id", "name", "sourceTableId", "viewType", "columns", "whereClause", ... } ],
  "domainCatalog": [ { "id", "name", "code", "color", "subdomains", "defaults" } ],
  "createdAt": "ISO 8601",
  "updatedAt": "ISO 8601"
}
          `}</CodeBlock>

          <div style={{ height: 48 }} />
        </div>
      </div>
    </AppLayout>
  );
}
