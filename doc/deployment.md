# Deployment Guide

## Development Environment

### Prerequisites

- Node.js 18+
- npm (bundled with Node.js)
- Git

### Setup

```bash
git clone https://github.com/Carlosmps97/web-data-model-hub.git
cd web-data-model-hub
npm install
```

Create a `.env` file (or copy `.env.example` if it exists):

```bash
# Optional: override the local JSON storage directory
DATA_DIR=./data
```

### Development Server

```bash
npm run dev
# → http://localhost:3000 with HMR
```

### Production Build

```bash
npm run build
npm start
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATA_DIR` | `./data` | Path to the local JSON storage directory |
| `APP_AZURE_TENANT_ID` | — | Azure AD tenant ID (future SharePoint integration) |
| `APP_AZURE_CLIENT_ID` | — | Azure AD client ID |
| `APP_AZURE_CLIENT_SECRET` | — | Azure AD client secret |

All Azure variables are optional — they are placeholders for future database migration.

---

## Data Storage

### Local JSON (Current)

```
data/
├── projects.json        # Project[] registry
└── models/
    └── {uuid}.json      # Full DataModel per project
```

- Created automatically on first API call
- Excluded from version control (`.gitignore`)
- Backup: copy the entire `data/` directory

### Migration to Another Machine

1. Copy `data/` to the new machine
2. Set `DATA_DIR` if using a non-default path
3. Start the app — all projects and models load immediately

---

## Deployment Platforms

### Node.js Server (recommended for persistent storage)

```bash
npm run build
npm start
# Runs on port 3000 (set PORT env variable to override)
```

Data persists in the `data/` directory on the server filesystem.

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["npm", "start"]
```

Mount the `data/` volume to persist JSON files across container restarts:

```bash
docker run -p 3000:3000 -v $(pwd)/data:/app/data data-model-hub
```

### Vercel / Serverless

> **Warning:** Serverless platforms do not have a persistent filesystem. The `data/` directory will be reset on every deployment. For production, migrate storage to Cosmos DB, PostgreSQL, or SharePoint by replacing `jsonStore.ts` with a database adapter.

```bash
npm i -g vercel
vercel
```

---

## Security Notes

- Never commit `.env` or the `data/` directory to public repositories
- Azure credentials (future SharePoint) must be injected via the hosting platform's environment variable system
- The `data/` directory contains all project and model data — protect it with appropriate file system permissions in production
