# Architecture

## System Overview

Data Model Hub is a unified Next.js application that serves both the frontend UI and backend API. The application follows a feature-based architecture pattern, where each functional domain is encapsulated in its own module under `src/features/`.

## Architecture Diagram

```
                    +-------------------------------------------+
                    |           Next.js Application             |
                    |                                           |
                    |  +------------------+  +---------------+  |
                    |  |   Client Layer   |  |  API Layer    |  |
                    |  |  (React + X6)    |  |  (Routes)     |  |
                    |  |                  |  |               |  |
                    |  |  - DiagramCanvas |  | /api/projects |  |
                    |  |  - TableForm    |  | /api/models   |  |
                    |  |  - DBMLEditor   |  | /api/chat     |  |
                    |  |  - ExcelImport  |  |               |  |
                    |  |  - ChatPanel    |  +-------+-------+  |
                    |  |                  |          |          |
                    |  +--------+---------+          |          |
                    |           |                    |          |
                    |  +--------v---------+  +------v-------+  |
                    |  |  Zustand Store   |  | JSON Storage |  |
                    |  |  (Client State)  |  | Service      |  |
                    |  +------------------+  +------+-------+  |
                    |                               |          |
                    +-------------------------------|----------+
                                                    |
                                              +-----v------+
                                              | Local JSON  |
                                              | Files       |
                                              | (data/)     |
                                              +-------------+
```

## Technology Decisions

### Next.js (App Router)

Selected as the unified framework to eliminate the complexity of maintaining separate frontend and backend applications. Key benefits:
- Server-side rendering for initial page loads
- API Routes for backend logic without a separate server
- TypeScript support built-in
- File-based routing reduces configuration overhead
- App Router enables server components and streaming

### AntV X6 3.x

Chosen as the graph rendering engine for ER diagrams. Justification:
- Purpose-built for node-edge graph editing (not just visualization)
- Native support for React component rendering inside nodes via @antv/x6-react-shape
- Built-in plugins for editing features: snapline, history, selection, minimap
- ER-specific edge routing algorithms
- JSON serialization support (toJSON/fromJSON) for persistence
- Active maintenance and large community

### Zustand

Selected for client-side state management over Redux or Context API:
- Minimal boilerplate compared to Redux
- TypeScript support with strong inference
- No provider wrappers needed
- Supports derived state and async actions
- Small bundle size (~1KB)

### Local JSON Storage

MVP storage approach with clear migration path:
- Zero infrastructure requirements for development
- Direct filesystem operations via Node.js fs module
- JSON format aligns with the application data model
- Abstract storage interface enables future migration to SharePoint, Cosmos DB, or any database

## Component Architecture

### Feature Modules

Each feature is self-contained with its own components, hooks, utilities, and index file:

```
features/
  diagram/          - Core ER diagram visualization
  table-editor/     - Manual table CRUD and DBML code editor
  excel-import/     - Excel file upload and preview
  chat-agent/       - AI assistant interface (shell)
  projects/         - Project management
```

### Data Flow

1. User interacts with React components (Client Components)
2. Components dispatch actions to Zustand stores
3. Stores make HTTP requests to Next.js API Routes
4. API Routes use the JSON Storage Service for persistence
5. Storage Service reads/writes JSON files to the data/ directory
6. Changes propagate back through the store to update the UI

### Rendering Strategy

- **Client Components** (`'use client'`): All interactive features (diagram canvas, modals, forms)
- **Server Components**: Layout shells, static pages
- **Dynamic Import**: DiagramCanvas is dynamically imported with `ssr: false` because AntV X6 requires DOM access

## Future Architecture

When migrating to SharePoint or Cosmos DB:

1. Create a new implementation of the storage interface (e.g., `sharepointStore.ts`)
2. Swap the import in API routes from `jsonStore` to the new implementation
3. No frontend changes required - the API contract remains the same

When connecting the AI agent:

1. Implement the `/api/chat` route to forward requests to the agent backend
2. Parse agent responses into TableModel/Relationship structures
3. The ChatPanel component already handles the UI - only the API integration changes
