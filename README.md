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
- **AI Chat panel** — UI shell ready for agent backend integration
- **Project organization** — multiple projects, each with their own data model
- **Auto-save** — 2-second debounce persistence to local JSON files
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

### Installation

```bash
git clone https://github.com/Carlosmps97/web-data-model-hub.git
cd web-data-model-hub
npm install
cp .env.example .env   # or create .env manually
```

### Development

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
│   │   ├── api/                    # REST API routes (projects, models, chat)
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
│   │   ├── chat-agent/             # AI chat panel (shell)
│   │   └── projects/               # Project CRUD UI
│   ├── lib/
│   │   └── storage/jsonStore.ts    # JSON file persistence service
│   ├── store/
│   │   ├── useModelStore.ts        # Tables, relationships, auto-save
│   │   └── useUIStore.ts           # Selected table, panel state
│   ├── types/model.ts              # Project, TableModel, TableColumn, Relationship
│   └── utils/dbmlParser.ts         # DBML parse + generate
├── data/                           # Local JSON storage (gitignored)
│   ├── projects.json
│   └── models/{uuid}.json
└── doc/                            # Full documentation
```

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
