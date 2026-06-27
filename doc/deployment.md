# Deployment

> El MVP es **abierto/anónimo** (sin auth) y se despliega a **Databricks Apps**.
> El frontend (Next.js) no expone rutas API propias: llama directo al backend
> FastAPI. El agente de IA (`app-agents-modeler`) no es parte de este MVP.

## Despliegue (Databricks Apps)

Guía operativa completa en **[`../../DEPLOY-databricks.md`](../../DEPLOY-databricks.md)**
(bundles, GitHub Actions, secrets, Cosmos vía Key Vault). Dos apps:
`frnt-data-model-hub` (este repo) y `bknd-data-model-hub`.

## Desarrollo local (sin Databricks, sin costo de compute)

```bash
# Terminal 1 — backend
cd backend-data-model-hub
/opt/homebrew/bin/python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # editar COSMOS_CONNECTION_STRING
uvicorn app.main:app --port 8000 --reload

# Terminal 2 — frontend
cd web-data-model-hub
npm install
cp .env.example .env            # NEXT_PUBLIC_API_URL=http://localhost:8000
npm run dev                     # Next.js + Turbopack en :3000
```

Visitar `http://localhost:3000` — **sin login** (el MVP es abierto).

> `.env` (local) apunta al backend local; `.env.production` (commiteado) apunta al
> backend en Databricks y **solo lo usa el build de producción** (`next build` /
> `next start`). `npm run dev` ignora `.env.production`.

## Cosmos DB

- Cuenta Azure Cosmos DB API **MongoDB vCore**, DB `db_modeler` (la app no la crea).
- Índices creados idempotentemente al arrancar el backend (`projects`,
  `project_tables`, `project_relationships`, `semantic_types`, `udps`).
  `column_catalog` lo gestiona el agente, no este backend.
- Soft-delete (`flgactive`) hace reversibles las eliminaciones.

## Producción / observabilidad

- Health: `GET /api/health` → `{ "status": "ok", "db_connected": true }`.
- `LOG_FORMAT=json` → una línea por evento, con `request_id` (header `X-Request-ID`).
- Backend stateless → escala horizontal detrás del balanceador de Databricks Apps.
