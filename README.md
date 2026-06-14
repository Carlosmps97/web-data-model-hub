# Data Model Hub

A professional web application for designing, visualizing, and governing data models across multiple projects. Built with **Next.js 16** and **React 19**, with a **hand-rolled ER canvas** (no diagram library) and the **"Aurora"** design system. Single light theme, no Tailwind — the UI is styled entirely with CSS custom properties.

## Table of Contents

- [Overview](#overview)
- [Hierarchy](#hierarchy)
- [Features](#features)
- [Technology Stack](#technology-stack)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Usage Guide](#usage-guide)
- [Documentation](#documentation)

## Overview

Data Model Hub organizes work as **Project → Model (level) → Domain → Table → Columns + Views**. Each project has a **single, scope-driven ER canvas**. Teams design schemas manually, by inheriting from existing tables, from DBML, or by importing Excel; browse everything in a cross-project catalog (Model Center); and export engine-specific DDL.

The frontend **exposes no API routes of its own** — it talks directly to the platform backend [`backend-data-model-hub`](../backend-data-model-hub) (FastAPI + Cosmos DB) over CORS with the `modeler-auth` cookie. A Next.js proxy (`proxy.ts`) verifies the session JWT on every navigation.

## Hierarchy

| Level | What it is |
|-------|-----------|
| **Project** | A data repository (e.g. "Lakehouse"). Owns its engines, levels and domains; the unit of access; has one canvas. |
| **Model (level)** | A layer of the project — RDV·UDV·DDV, or any you define. Its order drives the left→right bands on the canvas and cross-layer adjacency. |
| **Domain** | A data product (Finanzas, Clientes…). **Vertical**: the same domain spans several levels. Carries owner, steward, sensitivity, subdomains. |
| **Table** | Lives in one level and (optionally) one domain; inherits the domain's color; embeds role-specific SQL **views**. |

## Features

- **Hand-rolled ER canvas** — custom pan/zoom, drag, fit-to-screen, mini-map (no React Flow / ELK).
- **Scope** — an editing safety boundary `{levels, domains}` that filters which tables are visible and editable. Presets (whole model · a level · a domain) plus a custom Models×Domains matrix.
- **Connect mode + cardinality** — click a source column, then a target column on another table; pick `1:1 / 1:N / N:N`. The source column becomes an FK.
- **Cross-layer awareness** — relationships between adjacent levels show a teal `A→B` label; non-adjacent "skips" render amber/dashed with a warning.
- **Animated flow on hover/selection** — connected columns highlight and the active wire "flows"; unrelated wires dim.
- **Auto-arrange** — three height-aware masonry layouts (By model · Snowflake · Compact) that never overlap, regardless of column-count spread.
- **Inspector** — per-table panel with Columns / **Views (SQL by role)** / Links tabs, plus governance badges (level, domain, owner/steward).
- **Four table-ingestion paths** — manual form · from existing tables (inherit columns) · DBML editor · Excel (`.xlsx`) import.
- **Role-specific SQL views** — projections per role with masking (`sha256`, `regexp_replace`…) and `WHERE` filters; exported with the DDL.
- **DDL export** — `CREATE TABLE` + PK + `ALTER … ADD FOREIGN KEY` (+ optional `CREATE VIEW`), by scope or whole model, per engine.
- **Model Center** — a cross-project catalog (Overview · Tables · Views · Columns) with model-health governance (tables without PK, without domain, without a view, PII columns).
- **In-app Help Center** — action-oriented articles plus a quick-help drawer ("?").
- **Users & permissions** — roles (admin/editor/viewer) and per-project `view`/`edit` grants.
- **Auto-save** — 800 ms debounced persistence of tables and relationships (node positions are per-session, recomputed by the layouts on open).
- **AI Modeling Agent (decoupled)** — the `chat-agent` feature targets the separate [`app-agents-modeler`](../app-agents-modeler) service; the editor's "AI Agent" button is currently a placeholder and will be reconnected in a future version.

## Technology Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| Next.js (App Router, Turbopack) | 16.2.3 | UI + SSR + `proxy.ts` auth middleware (no API routes) |
| React | 19.2.4 | Component rendering |
| TypeScript | ^5 | Type safety throughout |
| Zustand | ^5.0.12 | Client-side state (`useProjectStore`, `useAuthStore`, `useUIStore`) |
| jose | ^6.2.3 | JWT verify in the Edge proxy (HS256, shared `AUTH_SECRET`) |
| sonner | ^2.0.7 | Toasts |
| SheetJS (xlsx) | ^0.18.5 | Excel parsing |
| uuid | ^13.0.0 | Stable entity / column ids |
| next/font | — | Manrope (UI) + JetBrains Mono (data types / SQL) |

> No Tailwind, no React Flow, no CodeMirror, no ELK — the ER canvas, DBML editor, and design system are all in-house.

## Getting Started

### Prerequisites

- Node.js 20+ and npm
- The platform backend (Python 3.12): [`backend-data-model-hub`](../backend-data-model-hub) on `http://localhost:8000` — auth, projects, canvas, persistence.
- *(Optional, forthcoming)* the agent service [`app-agents-modeler`](../app-agents-modeler) for the AI chat.

### Installation

```bash
cd web-data-model-hub
npm install
cp .env.example .env
```

Set in `.env`:

- `NEXT_PUBLIC_API_URL=http://localhost:8000` — platform backend (auth + persistence).
- `NEXT_PUBLIC_AGENT_API_URL=http://localhost:8001` — agent service (optional; only used once the AI chat is reconnected).
- `AUTH_SECRET=...` — **must match** `AUTH_SECRET` in `backend-data-model-hub/.env`.

`NEXT_PUBLIC_*` URLs are browser-visible: the frontend calls FastAPI directly. Auth to the platform backend uses the `modeler-auth` cookie (sent cross-origin via `credentials: 'include'`).

### Development

```bash
# Terminal 1 — platform backend
cd ../backend-data-model-hub
source .venv/bin/activate
uvicorn api.main:app --reload --port 8000

# Terminal 2 — frontend
cd ../web-data-model-hub
npm run dev          # → http://localhost:3000
```

Open `http://localhost:3000` → `/login`. On the very first run the backend bootstraps `admin / dogadmin2019` — change the password from **Users** right away.

### Production Build

```bash
npm run build
npm start
```

## Project Structure

```
web-data-model-hub/
├── proxy.ts                          # Next 16 middleware (export `proxy`) — JWT verify + redirect
├── src/
│   ├── app/                          # App Router (NO /api routes)
│   │   ├── layout.tsx                # fonts + favicon (icon.png / apple-icon.png = logo-dog)
│   │   ├── page.tsx                  # Model Center (cross-project catalog)
│   │   ├── login/page.tsx
│   │   ├── projects/page.tsx                       # projects list
│   │   ├── projects/[projectId]/page.tsx           # hub: Models (levels) + Domains
│   │   ├── projects/[projectId]/editor/page.tsx    # editor (canvas + rail + inspector)
│   │   ├── docs/page.tsx             # in-app Help Center
│   │   ├── admin/users/page.tsx      # users + permissions
│   │   └── globals.css               # Aurora design system (CSS variables + components)
│   ├── components/
│   │   ├── layout/                   # AppLayout, Sidebar (64px rail), Header
│   │   └── ui/                       # Icon, Modal, ConfirmDialog, …
│   ├── features/
│   │   ├── diagram/                  # ERCanvas, Inspector, ScopeControl, layout/layouts, builders
│   │   ├── table-editor/             # TablesListView, TableForm, CreateFromSqlModal, DBMLModal
│   │   ├── views/                    # ViewForm (SQL by role)
│   │   ├── ddl/                      # generators, DDLPreviewModal
│   │   ├── levels/  · domains/       # LevelModal · DomainModal (project hub CRUD)
│   │   ├── engines/                  # engines, EngineBadge, EngineSelect
│   │   ├── excel-import/             # ExcelImportModal + service
│   │   ├── admin-users/ · projects/  # UserFormModal · CreateProjectModal
│   │   ├── help/                     # Help Center content + drawer
│   │   └── chat-agent/               # DECOUPLED — targets app-agents-modeler; compiles via legacyModel.ts
│   ├── store/                        # useProjectStore · useAuthStore · useUIStore
│   ├── services/                     # http, auth, projects, canvas, admin
│   ├── types/model.ts                # Project, ModelLevel, Domain, Table, View, Relationship, TableColumn
│   ├── lib/                          # hierarchy.ts (scope/layerGap), columnRef.ts, tags.ts, auth/permissions.ts
│   └── server/auth/jwt.ts            # signAuthToken / verifyAuthToken (jose)
└── doc/                              # Full documentation
```

Persistence: projects, tables, relationships and users live in **Cosmos DB** via `backend-data-model-hub` (`projects`, `project_tables`, `project_relationships`, `users`). The frontend keeps no local store.

## Usage Guide

### Create a project and open the canvas

1. **Projects → New project** (admin), name it.
2. In the project **hub**, add **Models (levels)** and **Domains**.
3. **Open canvas**, or click a level/domain card to open the editor with that scope applied.

### Add tables — four paths

- **Manual form** — sidebar `New → New table`: name, schema, level, domain, subdomain, and columns with PK/FK/SK toggles, Nullable, and type.
- **From existing tables** — inherit columns from up to two parent tables; optionally keep an FK to each parent.
- **DBML editor** — write/paste DBML; **Apply replaces the canvas**.

```dbml
Table users {
  id integer [pk]
  email varchar(100) [not null]
}
Table orders {
  id integer [pk]
  user_id integer [ref: > users.id]
}
```

- **Excel import** — drop an `.xlsx`; each sheet → one table (A = name, B = type, C = definition). **Adds** to existing tables.

### Canvas controls

| Action | How |
|--------|-----|
| Pan | Drag empty canvas |
| Zoom | Mouse wheel · dock − / + |
| Select / edit table | Click / double-click a node |
| Move table | Drag the header |
| Connect | Dock → Connect, then click source column → target column |
| Auto-arrange | Dock → Auto-organize → By model · Snowflake · Compact |
| Fit to screen | Dock → fit |
| Edit / recolor / delete | Node gear menu |

### Export DDL

Top bar **Export** → toggle *Only current scope* / *Include views* → **Copy DDL**.

## Documentation

| File | Contents |
|------|----------|
| [doc/architecture.md](doc/architecture.md) | Frontend architecture, structure, tech decisions |
| [doc/data-flow.md](doc/data-flow.md) | Login, ingestion flows, canvas autosave, scope, DDL |
| [doc/api-reference.md](doc/api-reference.md) | Backend endpoints consumed + shared types |
| [doc/design-system.md](doc/design-system.md) | Aurora tokens, typography, CSS classes |
| [doc/user-guide.md](doc/user-guide.md) | Detailed usage instructions |
| [doc/deployment.md](doc/deployment.md) | Environment setup and deployment |

## License

Proprietary software.
