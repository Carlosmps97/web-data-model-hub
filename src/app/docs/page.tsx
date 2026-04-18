'use client';

import React, { useState } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import Header from '@/components/layout/Header';

type SectionId =
  | 'getting-started'
  | 'model-editor'
  | 'adding-tables'
  | 'list-view'
  | 'canvas-view'
  | 'auto-arrange'
  | 'global-canvas'
  | 'dbml-reference'
  | 'classification'
  | 'auto-save'
  | 'technical-overview'
  | 'declarative-model';

interface NavItem {
  id: SectionId;
  label: string;
  group: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'getting-started', label: 'Primeros Pasos', group: 'Guía de Usuario' },
  { id: 'model-editor', label: 'Editor de Modelos', group: 'Guía de Usuario' },
  { id: 'adding-tables', label: 'Agregar Tablas', group: 'Guía de Usuario' },
  { id: 'list-view', label: 'Vista de Lista', group: 'Guía de Usuario' },
  { id: 'canvas-view', label: 'Lienzo (Diagrama ER)', group: 'Guía de Usuario' },
  { id: 'auto-arrange', label: 'Distribución Automática', group: 'Guía de Usuario' },
  { id: 'global-canvas', label: 'Lienzo Global', group: 'Guía de Usuario' },
  { id: 'dbml-reference', label: 'Referencia DBML', group: 'Guía de Usuario' },
  { id: 'classification', label: 'Clasificación y Etiquetas', group: 'Guía de Usuario' },
  { id: 'auto-save', label: 'Guardado Automático', group: 'Guía de Usuario' },
  { id: 'technical-overview', label: 'Arquitectura', group: 'Referencia Técnica' },
  { id: 'declarative-model', label: 'Modelo Declarativo', group: 'Referencia Técnica' },
];

function Badge({ children, variant = 'default' }: { children: React.ReactNode; variant?: 'default' | 'pk' | 'fk' | 'sk' | 'info' | 'app' | 'domain' | 'sub' }) {
  const styles: Record<string, React.CSSProperties> = {
    default: { background: 'var(--color-bg-active)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-accent-tertiary)' },
    pk: { background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' },
    fk: { background: '#d1fae5', color: '#065f46', border: '1px solid #6ee7b7' },
    sk: { background: '#e0f2fe', color: '#0c4a6e', border: '1px solid #7dd3fc' },
    info: { background: 'rgba(70,129,137,0.1)', color: 'var(--color-accent-primary)', border: '1px solid var(--color-accent-tertiary)' },
    app: { background: '#ede9fe', color: '#5b21b6', border: '1px solid #c4b5fd' },
    domain: { background: '#fce7f3', color: '#9d174d', border: '1px solid #f9a8d4' },
    sub: { background: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa' },
  };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 'var(--radius-sm)',
      fontSize: 'var(--text-xs)', fontWeight: 600, lineHeight: 1.6,
      ...styles[variant],
    }}>
      {children}
    </span>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code style={{
      background: 'var(--color-bg-active)',
      color: 'var(--color-accent-primary)',
      padding: '1px 6px',
      borderRadius: 4,
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: '0.8em',
    }}>
      {children}
    </code>
  );
}

function CodeBlock({ children, lang = '' }: { children: string; lang?: string }) {
  return (
    <pre style={{
      background: '#031926',
      color: '#9dbebb',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4) var(--space-5)',
      fontSize: 'var(--text-xs)',
      fontFamily: 'JetBrains Mono, monospace',
      overflowX: 'auto',
      lineHeight: 1.7,
      margin: 'var(--space-4) 0',
    }}>
      <code>{children.trim()}</code>
    </pre>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div style={{ overflowX: 'auto', margin: 'var(--space-4) 0' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
        <thead>
          <tr style={{ background: 'var(--color-bg-secondary)' }}>
            {headers.map((h) => (
              <th key={h} style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '2px solid var(--color-accent-tertiary)', fontWeight: 600, color: 'var(--color-text-primary)', whiteSpace: 'nowrap' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ borderBottom: '1px solid var(--color-bg-active)', background: i % 2 === 0 ? 'transparent' : 'var(--color-bg-surface)' }}>
              {row.map((cell, j) => (
                <td key={j} style={{ padding: '7px 12px', color: 'var(--color-text-secondary)', verticalAlign: 'top' }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Callout({ children, type = 'info' }: { children: React.ReactNode; type?: 'info' | 'tip' | 'note' }) {
  const colors = {
    info: { bg: 'rgba(70,129,137,0.08)', border: 'var(--color-accent-primary)', icon: 'ℹ' },
    tip: { bg: '#f0fdf4', border: '#22c55e', icon: '✓' },
    note: { bg: '#fffbeb', border: '#f59e0b', icon: '⚠' },
  };
  const c = colors[type];
  return (
    <div style={{ background: c.bg, borderLeft: `3px solid ${c.border}`, borderRadius: '0 var(--radius-md) var(--radius-md) 0', padding: 'var(--space-3) var(--space-4)', margin: 'var(--space-4) 0', display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
      <span style={{ fontWeight: 700, fontSize: 'var(--text-sm)', color: c.border, flexShrink: 0, marginTop: 1 }}>{c.icon}</span>
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>{children}</div>
    </div>
  );
}

function SectionTitle({ id, children }: { id: SectionId; children: React.ReactNode }) {
  return (
    <h2 id={id} style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 'var(--space-4)', paddingTop: 'var(--space-4)', borderBottom: '2px solid var(--color-bg-active)', paddingBottom: 'var(--space-3)' }}>
      {children}
    </h2>
  );
}

function SubTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--color-accent-primary)', marginTop: 'var(--space-5)', marginBottom: 'var(--space-2)' }}>
      {children}
    </h3>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.75, marginBottom: 'var(--space-3)' }}>{children}</p>;
}

function Ul({ items }: { items: React.ReactNode[] }) {
  return (
    <ul style={{ paddingLeft: 'var(--space-5)', margin: 'var(--space-2) 0 var(--space-4)', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map((item, i) => (
        <li key={i} style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.65 }}>{item}</li>
      ))}
    </ul>
  );
}

function Ol({ items }: { items: React.ReactNode[] }) {
  return (
    <ol style={{ paddingLeft: 'var(--space-5)', margin: 'var(--space-2) 0 var(--space-4)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((item, i) => (
        <li key={i} style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.65 }}>{item}</li>
      ))}
    </ol>
  );
}

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState<SectionId>('getting-started');

  const scrollTo = (id: SectionId) => {
    setActiveSection(id);
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const groups = Array.from(new Set(NAV_ITEMS.map((n) => n.group)));

  return (
    <AppLayout>
      <Header title="Documentación" subtitle="Manual de usuario y referencia técnica de Data Model Hub" />

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 'var(--space-6)', padding: 'var(--space-6)', maxWidth: 1100, margin: '0 auto', alignItems: 'start' }}>

        {/* Sticky sidebar nav */}
        <nav style={{ position: 'sticky', top: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {groups.map((group) => (
            <div key={group} style={{ marginBottom: 'var(--space-2)' }}>
              <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)', padding: '0 var(--space-3)' }}>
                {group}
              </div>
              {NAV_ITEMS.filter((n) => n.group === group).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => scrollTo(item.id)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: 'var(--space-2) var(--space-3)',
                    borderRadius: 'var(--radius-md)',
                    border: 'none', cursor: 'pointer',
                    fontSize: 'var(--text-sm)',
                    fontWeight: activeSection === item.id ? 600 : 400,
                    color: activeSection === item.id ? 'var(--color-accent-primary)' : 'var(--color-text-secondary)',
                    background: activeSection === item.id ? 'rgba(70,129,137,0.1)' : 'transparent',
                    transition: 'all var(--transition-fast)',
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* Content */}
        <div style={{ minWidth: 0 }}>

          {/* ── PRIMEROS PASOS ── */}
          <SectionTitle id="getting-started">Primeros Pasos</SectionTitle>

          <SubTitle>Crear tu Primer Proyecto</SubTitle>
          <Ol items={[
            <>Abre la aplicación en <Code>http://localhost:3000</Code></>,
            <>Haz clic en <strong>New Project</strong> (parte superior derecha)</>,
            <>Ingresa un nombre de proyecto (obligatorio) y una descripción opcional</>,
            <>Haz clic en <strong>Create Project</strong> — serás redirigido a la página de detalle del proyecto</>,
          ]} />

          <SubTitle>Crear un Modelo de Datos</SubTitle>
          <Ol items={[
            <>Dentro de un proyecto, haz clic en <strong>Create First Model</strong> (o <strong>New Model</strong> si ya existen modelos)</>,
            <>Ingresa un nombre para el modelo → <strong>Create Model</strong></>,
            <>El editor de modelos se abre en <strong>Vista de Lista</strong> por defecto</>,
          ]} />

          <Callout type="tip">
            Cada proyecto puede contener múltiples modelos. Usa los modelos para separar dominios lógicos (ej. un modelo por microservicio o producto de datos).
          </Callout>

          {/* ── EDITOR DE MODELOS ── */}
          <SectionTitle id="model-editor">Editor de Modelos</SectionTitle>

          <P>El editor de modelos tiene dos áreas principales:</P>
          <Ul items={[
            <><strong>Panel izquierdo</strong> — agrega tablas manualmente, pega código DBML o importa desde Excel</>,
            <><strong>Área de trabajo principal</strong> — alterna entre Vista de Lista y Vista de Lienzo mediante los botones en la parte superior derecha del encabezado</>,
          ]} />

          <SubTitle>Alternancia de Vista — Lista vs Lienzo</SubTitle>
          <Table
            headers={['Botón', 'Descripción']}
            rows={[
              ['List', 'Cuadrícula de tarjetas con todas las tablas, búsqueda, insignias de clasificación y filtros por etiqueta'],
              ['Canvas', 'Diagrama ER interactivo con posicionamiento por arrastre y conexiones de relaciones'],
            ]}
          />
          <P>La vista activa se resalta en color teal. Cambiar de vista no pierde datos ni posiciones en memoria.</P>

          <SubTitle>Motor de Base de Datos</SubTitle>
          <P>
            Usa el <strong>selector de motor</strong> (desplegable junto al nombre del modelo en el encabezado) para etiquetar el modelo con su plataforma de base de datos de destino. El motor seleccionado se muestra como una insignia de color y se guarda con el modelo.
          </P>
          <Table
            headers={['Motor', 'Color de insignia']}
            rows={[
              ['PostgreSQL', 'Azul-gris'], ['MySQL', 'Naranja'], ['SQL Server', 'Índigo'],
              ['Oracle', 'Rojo'], ['Snowflake', 'Azul cielo'], ['Databricks', 'Ámbar'],
              ['BigQuery', 'Azul'], ['Redshift', 'Coral'], ['SQLite', 'Verde'], ['MongoDB', 'Esmeralda'],
            ]}
          />

          {/* ── AGREGAR TABLAS ── */}
          <SectionTitle id="adding-tables">Agregar Tablas</SectionTitle>

          <SubTitle>Método 1 — Formulario Manual</SubTitle>
          <Ol items={[
            <>Haz clic en el botón <strong>+</strong> en el encabezado del panel izquierdo (o <strong>New Table</strong> en la Vista de Lista)</>,
            <>Completa los detalles de la tabla (ver campos abajo)</>,
            <>Haz clic en <strong>Add Table</strong> (o <strong>Update Table</strong> al editar una tabla existente)</>,
          ]} />
          <Table
            headers={['Campo', 'Obligatorio', 'Descripción']}
            rows={[
              ['Table Name', 'Sí', 'Identificador SQL, ej. user_accounts'],
              ['Functional Definition', 'No', 'Descripción de negocio en texto libre de lo que almacena esta tabla'],
              ['App Code', 'No', 'Aplicación o sistema dueño de esta tabla'],
              ['Domain', 'No', 'Dominio de negocio, ej. Ventas o Finanzas'],
              ['Subdomain', 'No', 'Agrupación más fina dentro del dominio, ej. Facturación'],
              ['Tags', 'No', 'Etiquetas libres; presiona Enter o , para agregar, × para eliminar'],
              ['Columns', 'No', 'Filas de: Nombre, Tipo, PK, FK, SK, Null, Descripción'],
            ]}
          />
          <P>Para columnas FK, una sección <strong>Foreign Key References</strong> aparece automáticamente — selecciona la tabla y columna destino.</P>

          <SubTitle>Método 2 — Editor DBML</SubTitle>
          <Ol items={[
            <>Haz clic en el botón <Code>&lt;&gt;</Code> en el panel izquierdo</>,
            <>Escribe DBML en el editor (ver la sección Referencia DBML abajo)</>,
            <>Haz clic en <strong>Apply DBML</strong> para analizar y crear/reemplazar tablas</>,
          ]} />
          <Callout type="note">
            Aplicar DBML reemplaza todas las tablas actuales del modelo. Exporta el estado actual primero si es necesario.
          </Callout>

          <SubTitle>Método 3 — Importación desde Excel</SubTitle>
          <Ol items={[
            <>Haz clic en el botón de carga (↑) en el panel izquierdo</>,
            <>Arrastra y suelta un archivo <Code>.xlsx</Code> o haz clic para explorar</>,
            <>Cada hoja/pestaña se convierte en una tabla: Columna A = nombres, Columna B = tipos, Columna C = descripciones</>,
            <>Revisa y edita en el modal de vista previa</>,
            <>Haz clic en <strong>Import N Tables</strong></>,
          ]} />
          <Callout type="info">
            La primera fila se omite automáticamente si parece un encabezado — verifica palabras como "column", "name", "columna", "nombre".
          </Callout>

          {/* ── VISTA DE LISTA ── */}
          <SectionTitle id="list-view">Vista de Lista</SectionTitle>

          <P>La Vista de Lista muestra cada tabla del modelo como una tarjeta, con metadatos de clasificación y chips de etiquetas para filtrado rápido.</P>

          <SubTitle>Búsqueda y Filtrado</SubTitle>
          <Ul items={[
            <><strong>Barra de búsqueda</strong> — filtra por nombre de tabla, descripción, código de app, dominio, subdominio o cualquier etiqueta (sin distinción de mayúsculas)</>,
            <><strong>Fila de pills de etiquetas</strong> — cuando existen etiquetas, haz clic en un pill para filtrar; haz clic de nuevo o en el pill activo para limpiar</>,
            <><strong>Contador</strong> — muestra tablas que coinciden vs total</>,
          ]} />

          <SubTitle>Anatomía de Tarjeta de Tabla</SubTitle>
          <Ul items={[
            <><strong>Encabezado</strong> — nombre de tabla + insignia de conteo de columnas</>,
            <><strong>Descripción</strong> — texto de definición funcional (si se proporcionó)</>,
            <><strong>Insignias de clasificación</strong>: <Badge variant="app">app</Badge> <Badge variant="domain">domain</Badge> <Badge variant="sub">sub</Badge> — chips de color mostrando los valores de clasificación</>,
            <><strong>Chips de etiquetas</strong> — haz clic en cualquier chip para activarlo como filtro de etiqueta</>,
            <><strong>Acciones</strong> — botones de lápiz (editar) y papelera (eliminar)</>,
          ]} />

          {/* ── VISTA DE LIENZO ── */}
          <SectionTitle id="canvas-view">Vista de Lienzo (Diagrama ER)</SectionTitle>

          <SubTitle>Navegación</SubTitle>
          <Table
            headers={['Acción', 'Entrada']}
            rows={[
              ['Desplazar', 'Arrastrar en área vacía del lienzo'],
              ['Zoom', 'Rueda del ratón'],
              ['Acercar / Alejar', 'Botones ± / lupa de la barra de controles'],
              ['Ajustar todas las tablas', 'Botón de ajuste de vista en la barra de controles'],
              ['Desplazar minimapa', 'Arrastrar dentro del minimapa superpuesto'],
            ]}
          />

          <SubTitle>Interacciones al Pasar el Cursor</SubTitle>
          <P>Pasa el cursor sobre cualquier bloque de tabla para:</P>
          <Ul items={[
            'Resaltar las conexiones de relaciones con una animación de flujo',
            'Atenuar todas las conexiones no relacionadas',
            'Resaltar las columnas específicas involucradas en la relación en ambas tablas',
            'Mostrar un tooltip en cada columna: nombre, tipo de dato, definición funcional y referencia FK',
          ]} />

          <SubTitle>Seleccionar Tablas</SubTitle>
          <Ul items={[
            <><strong>Clic en el cuerpo de tabla</strong> → lo selecciona (borde teal luminoso); <em>no</em> abre el formulario de edición</>,
            <><strong>Clic en el lienzo vacío</strong> → deselecciona</>,
            <>El resaltado por cursor tiene prioridad visual sobre la selección por clic</>,
          ]} />

          <SubTitle>Editar una Tabla desde el Lienzo</SubTitle>
          <Ol items={[
            <>Pasa el cursor sobre un nodo de tabla → aparece un <strong>ícono de engranaje ⚙</strong> en la esquina superior derecha</>,
            <>Haz clic en el engranaje → aparece un mini-menú con <strong>Edit</strong> y <strong>Delete</strong></>,
            <>Haz clic en <strong>Edit</strong> → el modal del formulario se abre con los datos actuales precargados</>,
            <>Realiza los cambios → <strong>Update Table</strong></>,
          ]} />
          <Callout type="info">
            Hacer clic en el cuerpo de la tabla solo la selecciona visualmente. El formulario de edición se abre exclusivamente a través del menú de engranaje.
          </Callout>

          <SubTitle>Mover Tablas</SubTitle>
          <P>Arrastra cualquier nodo de tabla para reubicarlo. Las posiciones son solo en memoria — al recargar el algoritmo de distribución las recalcula automáticamente. Las posiciones arrastradas dentro de una sesión se conservan hasta recargar la página.</P>

          {/* ── DISTRIBUCIÓN AUTOMÁTICA ── */}
          <SectionTitle id="auto-arrange">Distribución Automática</SectionTitle>

          <P>Haz clic en el <strong>ícono de cuadrícula</strong> en la barra de controles inferior para abrir el panel de Auto Arrange.</P>
          <Table
            headers={['Algoritmo', 'Ideal para']}
            rows={[
              ['Izquierda-Derecha (1)', 'Pipelines ETL y diagramas de linaje — capas topológicas de izquierda a derecha'],
              ['Copo de Nieve (2)', 'Esquemas estrella y almacenes de datos — tabla más conectada al centro'],
              ['Compacto (3)', 'Diagramas con pocas relaciones — cuadrícula ordenada por número de conexiones'],
            ]}
          />
          <Callout type="tip">
            Al aplicar cualquier distribución, el lienzo se ajusta automáticamente para mostrar todas las tablas. Las posiciones se conservan en memoria durante la sesión actual.
          </Callout>

          {/* ── LIENZO GLOBAL ── */}
          <SectionTitle id="global-canvas">Lienzo Global</SectionTitle>

          <P>Cada proyecto expone un <strong>Lienzo Global</strong> que renderiza todas las tablas de todos sus modelos en un diagrama combinado, con código de colores por modelo de origen.</P>
          <Ul items={[
            <>Accede mediante el enlace <strong>Global canvas</strong> en la tarjeta del proyecto en la página de Proyectos</>,
            <>La vista global es de solo lectura — no se pueden agregar ni editar tablas desde ella</>,
            <>Útil para una visión general de alto nivel de todo el panorama de datos del proyecto</>,
          ]} />

          {/* ── REFERENCIA DBML ── */}
          <SectionTitle id="dbml-reference">Referencia DBML</SectionTitle>

          <P>DBML (Database Markup Language) es el formato de texto soportado por el panel del Editor DBML. A continuación se muestra la sintaxis completa soportada por Data Model Hub.</P>

          <SubTitle>Tabla Básica</SubTitle>
          <CodeBlock lang="dbml">{`
Table users {
  id integer [pk, increment]
  username varchar(50) [not null]
  email varchar(100) [unique, note: 'Contact email']
  created_at timestamp
  Note: 'User account information'
}
          `}</CodeBlock>

          <SubTitle>Llaves Foráneas — Inline</SubTitle>
          <CodeBlock lang="dbml">{`
Table orders {
  id integer [pk]
  user_id integer [ref: > users.id]   // one-to-many
  Note: 'Customer orders'
}
          `}</CodeBlock>

          <SubTitle>Llaves Foráneas — Independientes</SubTitle>
          <CodeBlock lang="dbml">{`
Ref: orders.user_id > users.id
Ref: profiles.user_id - users.id    // one-to-one
Ref: products.id < order_items.product_id  // many-to-many
          `}</CodeBlock>

          <SubTitle>Referencia de Configuraciones de Columna</SubTitle>
          <Table
            headers={['Configuración', 'Significado']}
            rows={[
              ['pk', 'Llave Primaria'],
              ['sk', 'Llave Sustituta'],
              ['partition', 'Llave de Partición'],
              ['not null', 'Columna no nula'],
              ['unique', 'Restricción de unicidad'],
              ['increment', 'Auto-incremento / identidad'],
              ["default: 'x'", 'Valor predeterminado'],
              ["note: 'texto'", 'Definición funcional de la columna (tooltip)'],
              ['ref: > t.col', 'FK — uno a muchos (lado muchos aquí)'],
              ['ref: - t.col', 'FK — uno a uno'],
              ['ref: < t.col', 'FK — muchos a muchos (lado muchos allá)'],
            ]}
          />

          <SubTitle>Comentarios</SubTitle>
          <CodeBlock lang="dbml">{`
// Este es un comentario de una línea — ignorado por el analizador
          `}</CodeBlock>

          {/* ── CLASIFICACIÓN Y ETIQUETAS ── */}
          <SectionTitle id="classification">Clasificación y Etiquetas</SectionTitle>

          <P>
            Cada tabla puede llevar metadatos de clasificación opcionales que ayudan a organizar catálogos grandes y permiten el filtrado en la Vista de Lista.
            Ninguno de estos campos afecta el renderizado del diagrama ER.
          </P>

          <Table
            headers={['Campo', 'Insignia', 'Descripción']}
            rows={[
              ['Código de App', 'app', 'La aplicación o sistema responsable de esta tabla, ej. CRM, ERP, MDM'],
              ['Dominio', 'domain', 'Área de negocio de alto nivel, ej. Ventas, Finanzas, RRHH'],
              ['Subdominio', 'sub', 'Agrupación más fina dentro del dominio, ej. Facturación, Nómina, Leads'],
              ['Etiquetas', '(chips)', 'Etiquetas libres usadas para filtrado y agrupación ad-hoc'],
            ]}
          />

          <SubTitle>Cómo Funcionan las Etiquetas</SubTitle>
          <Ul items={[
            <>En el formulario de tabla, escribe una etiqueta y presiona <Code>Enter</Code> o <Code>,</Code> para agregarla como chip</>,
            <>Haz clic en la <strong>×</strong> de un chip para eliminarlo</>,
            <>En la Vista de Lista, todas las etiquetas de todas las tablas se muestran como pills debajo de la barra de búsqueda</>,
            <>Hacer clic en un pill de etiqueta filtra la lista a las tablas que la tienen; hacer clic de nuevo limpia el filtro</>,
            <>La barra de búsqueda también busca dentro del texto de las etiquetas</>,
          ]} />

          {/* ── GUARDADO AUTOMÁTICO ── */}
          <SectionTitle id="auto-save">Guardado Automático</SectionTitle>

          <P>
            Todos los cambios se guardan automáticamente <strong>2 segundos</strong> después de la última modificación.
            Un indicador <em>"Saving…"</em> aparece en el encabezado de la página mientras se está guardando.
            No se requiere ninguna acción manual de guardado.
          </P>
          <P>
            Los datos se almacenan en archivos JSON en el sistema de archivos del servidor bajo <Code>data/</Code>.
            Al recargar la página, el modelo se vuelve a obtener desde la API y todas las tablas y relaciones se restauran.
            Las posiciones de las tablas en el lienzo <em>no</em> se persisten — el algoritmo de distribución las recalcula en cada carga.
          </P>

          {/* ── ARQUITECTURA ── */}
          <SectionTitle id="technical-overview">Arquitectura</SectionTitle>

          <P>Data Model Hub es una aplicación unificada de <strong>Next.js (App Router)</strong> que sirve tanto el frontend React como una API REST desde el mismo proceso.</P>

          <SubTitle>Resumen de Capas</SubTitle>
          <Table
            headers={['Capa', 'Tecnología', 'Responsabilidad']}
            rows={[
              ['Componentes UI', 'React (Client Components)', 'Todas las vistas interactivas — lienzo, formularios, paneles, modales'],
              ['Gestión de Estado', 'Zustand v5', 'useModelStore (tablas, relaciones, CRUD, auto-guardado), useUIStore (selección, estado de paneles)'],
              ['Diagrama ER', '@xyflow/react v12', 'Lienzo drag-and-drop, nodos personalizados (erTable) y aristas (animatedER)'],
              ['Rutas de API', 'Next.js Route Handlers', '/api/projects, /api/models, /api/chat'],
              ['Almacenamiento', 'jsonStore.ts (Node.js fs)', 'Lee y escribe data/projects.json y data/models/{uuid}.json'],
            ]}
          />

          <SubTitle>Ciclo de Auto-Guardado</SubTitle>
          <P>
            Cada acción de escritura (agregar / actualizar / eliminar tabla o relación) se aplica inmediatamente al store de Zustand (actualización optimista).
            Un debounce de 2 segundos dispara <Code>saveModel()</Code> que llama a <Code>PUT /api/models/:id</Code>.
            La API escribe el JSON completo del modelo en disco y retorna el documento guardado.
          </P>

          <SubTitle>Migración de Almacenamiento</SubTitle>
          <P>
            La capa de almacenamiento está abstraida detrás de <Code>jsonStore.ts</Code>.
            Para migrar a una base de datos (Cosmos DB, PostgreSQL, SharePoint), implementa las mismas firmas de función en un nuevo archivo adaptador y reemplaza la importación en cada ruta de API — sin cambios en el frontend.
          </P>

          {/* ── MODELO DECLARATIVO ── */}
          <SectionTitle id="declarative-model">Modelo Declarativo de Datos</SectionTitle>

          <P>
            El modelo de datos de la aplicación se declara a través de interfaces TypeScript en <Code>src/types/model.ts</Code>.
            Estos tipos impulsan el contrato de la API, la forma del store de Zustand, el renderizado del lienzo y la validación de formularios.
          </P>

          <SubTitle>Tipos Principales</SubTitle>

          <CodeBlock lang="typescript">{`
// A project groups one or more DataModels
interface Project {
  id: string;           // UUID
  name: string;
  description?: string;
  createdAt: string;    // ISO 8601
  updatedAt: string;
}

// A DataModel belongs to a Project
interface DataModel {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  engine?: DatabaseEngine;    // target DB platform
  tables: TableModel[];
  relationships: Relationship[];
  createdAt: string;
  updatedAt: string;
}

// A TableModel represents a database table / entity
interface TableModel {
  id: string;
  name: string;
  schema?: string;
  columns: TableColumn[];
  functionalDefinition?: string;
  color?: string;
  // Classification metadata (for List view filtering)
  applicationCode?: string;
  domain?: string;
  subdomain?: string;
  tags?: string[];
}

// A column within a table
interface TableColumn {
  name: string;
  dataType: string;
  isPrimaryKey?: boolean;
  isSurrogateKey?: boolean;
  isPartitionKey?: boolean;
  isForeignKey?: boolean;
  foreignKeyRef?: { table: string; column: string };
  isNullable?: boolean;
  isUnique?: boolean;
  defaultValue?: string;
  functionalDefinition?: string;   // shown in canvas tooltip
}

// A directed relationship between two columns
interface Relationship {
  id: string;
  sourceTable: string;   // table name
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
  type: 'one-to-one' | 'one-to-many' | 'many-to-many';
}

// Supported target engines
type DatabaseEngine =
  | 'postgresql' | 'mysql' | 'sqlserver' | 'oracle'
  | 'snowflake' | 'databricks' | 'bigquery'
  | 'redshift' | 'sqlite' | 'mongodb';
          `}</CodeBlock>

          <SubTitle>Cómo DBML se Mapea a TableModel</SubTitle>
          <P>El parser DBML (<Code>src/features/table-editor/utils/</Code>) convierte texto DBML en <Code>TableModel[]</Code> y <Code>Relationship[]</Code> siguiendo estas reglas:</P>
          <Table
            headers={['Construcción DBML', 'Campo TypeScript']}
            rows={[
              ['Table name', 'TableModel.name'],
              ['Note: …', 'TableModel.functionalDefinition'],
              ['Column name', 'TableColumn.name'],
              ['Column type', 'TableColumn.dataType'],
              ['[pk]', 'TableColumn.isPrimaryKey = true'],
              ['[sk]', 'TableColumn.isSurrogateKey = true'],
              ['[partition]', 'TableColumn.isPartitionKey = true'],
              ['[not null]', 'TableColumn.isNullable = false'],
              ['[unique]', 'TableColumn.isUnique = true'],
              ['[increment]', 'TableColumn.defaultValue = "increment"'],
              ["[default: 'x']", "TableColumn.defaultValue = 'x'"],
              ["[note: 'x']", "TableColumn.functionalDefinition = 'x'"],
              ['[ref: > t.col]', 'TableColumn.isForeignKey = true + Relationship (uno a muchos)'],
              ['[ref: - t.col]', 'Relationship (uno a uno)'],
              ['[ref: < t.col]', 'Relationship (muchos a muchos)'],
              ['Ref: a.col > b.col', 'Entrada de Relationship independiente'],
            ]}
          />

          <SubTitle>Cómo el Lienzo Renderiza TableModel</SubTitle>
          <P>
            <Code>DiagramCanvasInner</Code> mapea cada <Code>TableModel</Code> a un nodo de React Flow de tipo <Code>erTable</Code>.
            Cada <Code>Relationship</Code> se convierte en una arista de React Flow de tipo <Code>animatedER</Code>.
            La prop <Code>data</Code> del nodo lleva el <Code>TableModel</Code> completo más estado derivado:
          </P>
          <Ul items={[
            <><Code>activeRelationColumns</Code> — nombres de columnas resaltados por hover/selección</>,
            <><Code>onEditTable</Code> / <Code>onDeleteTable</Code> — callbacks de la página al menú de engranaje</>,
            <><Code>isSelected</Code> — controla el borde teal luminoso</>,
          ]} />

          <Callout type="info">
            Las posiciones nunca se almacenan en <Code>TableModel</Code>. Viven solo en el estado en memoria de los nodos de React Flow y son recalculadas por el algoritmo de distribución en cada carga de página.
          </Callout>

          <div style={{ height: 'var(--space-12)' }} />
        </div>
      </div>
    </AppLayout>
  );
}
