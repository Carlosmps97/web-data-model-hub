# Data Model Hub

A professional web application for designing, visualizing, and managing Entity-Relationship (ER) data models across multiple project solutions. Built with Next.js, React, and React Flow (@xyflow/react) for interactive diagram visualization.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Technology Stack](#technology-stack)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Usage Guide](#usage-guide)
- [Documentation](#documentation)

## Overview

Data Model Hub provides an interactive platform where users can create, visualize, and manage database schemas through an intuitive drag-and-drop interface. The application supports three data ingestion methods: manual table creation, Excel file import, and a DBML code editor.

## Features

- Interactive ER diagram canvas with draggable table blocks
- Visual relationship flow lines between foreign keys
- Manual table creation with column editor (PK, FK, SK, Partition keys)
- DBML syntax editor for code-based table definition
- Excel (.xlsx) file import with multi-sheet support
- AI Chat interface (shell for future agent integration)
- Project-based model organization
- Auto-save with local JSON persistence
- Professional dark theme with custom color palette
- Mini-map, zoom controls, snap-to-grid alignment

## Technology Stack

| Technology | Purpose |
|------------|---------|
| Next.js 16 (App Router) | Full-stack framework (frontend + API routes) |
| React 19 | UI component library |
| TypeScript | Type safety |
| @xyflow/react (React Flow v12) | Graph rendering engine for ER diagrams |
| Zustand | Lightweight state management |
| SheetJS (xlsx) | Client-side Excel file parsing |
| CodeMirror | Code editor for DBML syntax |

## Getting Started

### Prerequisites

- Node.js 18 or later
- npm

### Installation

```bash
# Clone the repository
git clone https://github.com/Carlosmps97/web-data-model-hub.git
cd web-data-model-hub

# Install dependencies
npm install

# Create environment file (copy from .env.example or create manually)
cp .env.example .env
```

### Development

```bash
# Start the development server
npm run dev
```

The application will be available at `http://localhost:3000`.

### Build

```bash
# Create a production build
npm run build

# Start the production server
npm start
```

## Project Structure

```
web-data-model-hub/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/                # API Routes (projects, models, chat)
│   │   ├── projects/           # Diagram page
│   │   ├── layout.tsx          # Root layout
│   │   ├── page.tsx            # Home page (dashboard)
│   │   └── globals.css         # Design system
│   ├── components/             # Shared UI components
│   │   └── layout/             # AppLayout, Sidebar, Header
│   ├── features/               # Feature modules
│   │   ├── diagram/            # React Flow canvas, table nodes
│   │   ├── table-editor/       # Manual form, DBML editor
│   │   ├── excel-import/       # Excel upload and preview
│   │   ├── chat-agent/         # AI chat interface (shell)
│   │   └── projects/           # Project management
│   ├── lib/                    # Backend services
│   │   └── storage/            # JSON file persistence
│   ├── store/                  # Zustand state management
│   ├── types/                  # TypeScript type definitions
│   └── utils/                  # Utilities (DBML parser)
├── data/                       # Local JSON storage (gitignored)
├── doc/                        # Project documentation
└── README.md
```

## Usage Guide

### Creating a Project

1. From the dashboard, click "New Project"
2. Enter a project name and optional description
3. Click "Create Project" to navigate to the diagram editor

### Adding Tables

There are three methods to add tables:

**Manual (Form)**
- Click the "+" button in the sidebar
- Fill in table name, columns, data types, and key settings
- Set foreign key references to other tables
- Click "Add Table"

**DBML Editor**
- Click the code brackets button in the sidebar
- Write table definitions using DBML syntax
- Click "Apply DBML" to generate tables

**Excel Import**
- Click the file upload button in the sidebar
- Upload a .xlsx file where each sheet is a table
- Review and edit the parsed data in the preview
- Confirm to import tables to the canvas

### DBML Syntax

```dbml
Table users {
  id integer [pk, increment]
  username varchar(50) [not null]
  email varchar(100) [unique]
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

## Documentation

Full documentation is available in the `doc/` directory:

- [Architecture](doc/architecture.md) - System architecture and component overview
- [Data Flow](doc/data-flow.md) - Data ingestion and persistence flows
- [API Reference](doc/api-reference.md) - REST API endpoint documentation
- [Design System](doc/design-system.md) - Color palette, typography, and UI patterns
- [User Guide](doc/user-guide.md) - Detailed usage instructions
- [Deployment](doc/deployment.md) - Deployment and configuration guide

## License

This project is proprietary software.
