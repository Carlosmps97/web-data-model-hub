# Data Model Hub

A professional web application for designing, visualizing, and managing Entity-Relationship (ER) data models across multiple projects. Built with **Next.js 16**, **React 19**, and **@xyflow/react v12** for interactive diagram visualization.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Technology Stack](#technology-stack)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Usage Guide](#usage-guide)
- [Documentation](#documentation)

## Overview

Data Model Hub provides an interactive canvas where teams can design, visualize, and share database schemas. It supports three ingestion methods (manual form, DBML code editor, Excel import), smart ER edge routing, animated relationship flows, and three auto-arrange layout algorithms.

## Features

- **Interactive ER canvas** — drag-and-drop table blocks, snap-to-grid, mini-map
- **Smart edge routing** — wires auto-route left/right or same-side based on node positions; parallel edges are offset to prevent visual overlap
- **Animated flow on hover** — hovering over a table highlights connected edges with a flow animation and dims unrelated wires
- **Column highlights** — connected columns glow when a table is hovered or selected
- **Auto-arrange layouts** — Left-right (topological), Snowflake (radial), Compact (grid)
- **Column functional definitions** — describe each column's business purpose, shown on hover tooltip
- **Table functional definitions** — displayed in table footer on the canvas
- **Manual table editor** — full column CRUD with PK, FK, SK, Partition key toggles and FK references
- **DBML code editor** — write table definitions using DBML syntax with live parse feedback
- **Excel (.xlsx) import** — each sheet becomes a table; preview and edit before confirming
- **AI Modeling Agent** — per-model conversational chat connected to the `app-agents-modeler` FastAPI service (Microsoft Agent Framework + Azure AI Foundry). Supports multi-turn refinement, custom guidelines upload (PDF/DOCX/MD/XLSX/JSON/TXT), DDL generation, and QA reports. Every generated model can be applied to the canvas in one click.
- **Project organization** — multiple projects, each with their own data model
- **Auto-save** — 2-second debounce persistence of tables and relationships (positions are computed at runtime, not persisted)
- **Light theme** — cream/teal color palette based on CSS custom properties

## Technology Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| Next.js (App Router) | 16.2.3 | Full-stack framework — UI + API routes |
| React | 19.2.4 | Component rendering |
| TypeScript | — | Type safety throughout |
| @xyflow/react | ^12.10.2 | ER diagram canvas and edge rendering |
| Zustand | ^5.0.12 | Client-side state management |
| SheetJS (xlsx) | ^0.18.5 | Excel file parsing |
| CodeMirror | — | DBML code editor |
| uuid | ^13.0.0 | UUID generation for entities |

## Getting Started

### Prerequisites

- Node.js 18+
- npm
- Two sibling backends (Python 3.12) for full functionality:
  - [`backend-data-model-hub`](../backend-data-model-hub) on `http://localhost:8000` — auth, projects, models, persistence.
  - [`app-agents-modeler`](../app-agents-modeler) on `http://localhost:8001` — AI chat agent (optional; the chat panel surfaces a clear error if unreachable).

### Installation

```bash
git clone https://github.com/Carlosmps97/web-data-model-hub.git
cd web-data-model-hub
npm install
cp .env.example .env   # or create .env manually
```

Edit `.env` and set:

- `NEXT_PUBLIC_API_URL=http://localhost:8000` — platform backend (auth + persistence).
- `NEXT_PUBLIC_AGENT_API_URL=http://localhost:8001` — agent service (AI chat).
- `AUTH_SECRET=...` — must match `AUTH_SECRET` in `backend-data-model-hub/.env`.

Both API URLs are **public** (browser-visible): the frontend calls each
FastAPI directly, no Next.js proxy. Auth to the platform backend is done
via the `modeler-auth` cookie; the agent service uses CORS allowlist only
(no cookies).

### Development

Run each backend in its own terminal:

```bash
# Terminal 1 — platform backend (auth, projects, models)
cd ../backend-data-model-hub
source .venv/bin/activate
uvicorn api.main:app --reload --port 8000

# Terminal 2 — agent service (optional, only needed for the AI chat)
cd ../app-agents-modeler
source .venv/bin/activate
uvicorn api.main:app --reload --port 8001
```

Then, in another terminal, run the Next.js app:

```bash
npm run dev
# → http://localhost:3000
```

### Production Build

```bash
npm run build
npm start
```

## Project Structure

```
web-data-model-hub/
├── src/
│   ├── app/                        # Next.js App Router
│   │   ├── api/                    # Next.js route handlers (auth helpers,
│   │   │                           #   server actions). Domain APIs live
│   │   │                           #   in the FastAPI backends — no proxies.
│   │   ├── projects/[projectId]/   # Diagram editor page
│   │   ├── layout.tsx              # Root layout
│   │   ├── page.tsx                # Dashboard (project list)
│   │   └── globals.css             # Design system (CSS variables + components)
│   ├── components/
│   │   └── layout/                 # AppLayout, Sidebar, Header
│   ├── features/
│   │   ├── diagram/
│   │   │   ├── components/
│   │   │   │   ├── DiagramCanvas.tsx      # React Flow canvas + hover/selection logic
│   │   │   │   ├── TableNode.tsx          # Custom ER node with tooltips
│   │   │   │   ├── AnimatedEdge.tsx       # Smart-routed, animated edge component
│   │   │   │   └── AutoArrangePopover.tsx # Layout algorithm picker UI
│   │   │   └── utils/
│   │   │       └── layoutAlgorithms.ts    # Left-right, Snowflake, Compact layouts
│   │   ├── table-editor/           # Manual form + DBML editor
│   │   ├── excel-import/           # Excel upload, parse, preview
│   │   ├── chat-agent/             # AI chat panel — self-contained feature:
│   │   │   ├── components/         # ChatPanel, GuidelinesUploader, ModelResultBlock,
│   │   │   │                       #   AgentDogState
│   │   │   ├── hooks/              # useAgentConversation
│   │   │   ├── lib/                # types.ts (HTTP contract), mapping.ts (agent ↔ canvas)
│   │   │   ├── services/           # agent.service.ts (HTTP client, no cookies)
│   │   │   ├── store/              # useAgentStore (volatile, scoped by modelId)
│   │   │   ├── config.ts           # AGENT_API_BASE from NEXT_PUBLIC_AGENT_API_URL
│   │   │   └── index.ts            # Public barrel — external code MUST import here
│   │   └── projects/               # Project CRUD UI
│   ├── lib/
│   │   └── columnRef.ts            # Column reference helpers
│   ├── store/
│   │   ├── useModelStore.ts        # Tables, relationships, auto-save
│   │   ├── useUIStore.ts           # Selected table, panel state
│   │   └── useAuthStore.ts         # Authenticated user (cookie session)
│   ├── types/model.ts              # Project, TableModel, TableColumn, Relationship
│   └── utils/dbmlParser.ts         # DBML parse + generate
└── doc/                            # Full documentation
```

Persistence: all projects, models, tables, and users live in **Cosmos DB**
through `backend-data-model-hub`. The frontend keeps no local JSON store.

## Usage Guide

### Creating a Project

1. From the dashboard click **New Project**
2. Enter name + optional description → **Create Project**
3. You are redirected to the diagram editor

### Adding Tables — 3 methods

**Manual form** — click `+` in the sidebar, fill in table name, columns (with type, PK/FK/SK/Null toggles), per-column functional definitions, and FK references.

**DBML editor** — click the `<>` button, write DBML syntax, click **Apply DBML**:

```dbml
Table users {
  id integer [pk, increment]
  username varchar(50) [not null]
  email varchar(100) [unique, note: 'Contact email']
  created_at timestamp
  Note: 'User account information'
}

Table orders {
  id integer [pk]
  user_id integer [ref: > users.id]
  total decimal(10,2)
  status varchar(20) [default: 'pending']
}
```

**Excel import** — click the upload button, drop a `.xlsx` file. Each sheet → one table (col A = names, col B = types, col C = definitions).

**AI Agent** — open a model, click the **AI Agent** button to reveal the chat panel. Describe what you want to model in natural language and/or attach an Excel file; optionally upload organization-specific modeling guidelines so the agent respects them on every turn. Each response is rendered inline with its table list, relationship list, QA report and generated DDL. Click **Aplicar al canvas** to replace the current canvas tables and relationships with the generated model.

### Canvas Controls

| Action | How |
|--------|-----|
| Pan | Drag empty canvas |
| Zoom | Mouse wheel |
| Select table | Click a node |
| Hover table | Highlights edges + columns |
| Move table | Drag the node |
| Auto-arrange | Click the grid icon in controls bar → choose algorithm |
| Fit view | Controls bar zoom-fit button |

## Documentation

| File | Contents |
|------|----------|
| [doc/architecture.md](doc/architecture.md) | System architecture, component tree, tech decisions |
| [doc/data-flow.md](doc/data-flow.md) | Ingestion flows, persistence, canvas sync |
| [doc/api-reference.md](doc/api-reference.md) | REST API endpoints and data types |
| [doc/design-system.md](doc/design-system.md) | Color palette, typography, CSS variables |
| [doc/user-guide.md](doc/user-guide.md) | Detailed usage instructions |
| [doc/deployment.md](doc/deployment.md) | Environment setup and deployment |

## License

Proprietary software.
