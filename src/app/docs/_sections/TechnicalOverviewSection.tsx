import React from 'react';
import {
  SectionTitle,
  P,
  Sub,
  Ul,
  DocTable,
  Callout,
  Code,
  CodeBlock,
} from '../_components/primitives';

export function TechnicalOverviewSection() {
  return (
    <>
      <SectionTitle id="technical-overview">Arquitectura Técnica</SectionTitle>
      <P>
        Data Model Hub está compuesto por <strong>tres servicios independientes</strong> que se
        comunican vía HTTP/JSON. El frontend habla directamente con cada backend (sin proxy
        intermedio) y la persistencia vive en Azure Cosmos DB for MongoDB.
      </P>

      <DocTable
        headers={['Servicio', 'Puerto', 'Rol', 'Auth']}
        rows={[
          [<Code>web-data-model-hub</Code>, '3000', 'Frontend Next.js (UI, canvas, chat)', 'Cookie de sesión'],
          [<Code>backend-data-model-hub</Code>, '8000', 'Plataforma: auth, proyectos, modelos, usuarios', 'JWT cookie (HttpOnly)'],
          [<Code>app-agents-modeler</Code>, '8001', 'Agente IA: modelado, DDL, QA, guidelines', 'CORS allowlist (sin cookies)'],
        ]}
      />

      <Callout type="info">
        El frontend usa <strong>dos URLs públicas</strong>:
        {' '}<Code>NEXT_PUBLIC_API_URL</Code> para la plataforma y
        {' '}<Code>NEXT_PUBLIC_AGENT_API_URL</Code> para el agente. El navegador llama a cada
        FastAPI directamente; no existe Route Handler de Next.js que haga de proxy.
      </Callout>

      <Sub>Frontend — <Code>web-data-model-hub</Code> (Next.js :3000)</Sub>
      <DocTable
        headers={['Capa', 'Tecnología', 'Responsabilidad']}
        rows={[
          ['UI / Canvas', 'React 19 + @xyflow/react v12', 'Diagrama ER interactivo, TableNode, ViewNode, herramientas'],
          ['Estado', 'Zustand', 'useModelStore, useUIStore, useAuthStore, useAgentStore'],
          [
            'Cliente HTTP plataforma',
            <Code>fetch · credentials: &apos;include&apos;</Code>,
            <>Llama a <Code>NEXT_PUBLIC_API_URL</Code> con la cookie <Code>modeler-auth</Code></>,
          ],
          [
            'Cliente HTTP agente',
            <Code>fetch · credentials: &apos;omit&apos;</Code>,
            <>Llama a <Code>NEXT_PUBLIC_AGENT_API_URL</Code> vía CORS, sin cookies</>,
          ],
          [
            'Feature chat-agent',
            <Code>src/features/chat-agent</Code>,
            'Self-contained: lib, services, store, components, hooks, config y barrel público',
          ],
        ]}
      />

      <Sub>Plataforma — <Code>backend-data-model-hub</Code> (FastAPI :8000)</Sub>
      <DocTable
        headers={['Componente', 'Responsabilidad']}
        rows={[
          ['Auth (JWT + cookie)', <>Login/logout, hash bcrypt, cookie <Code>modeler-auth</Code> (HttpOnly · SameSite=Lax · HS256)</>],
          ['Motor async client', <>Conexión única a Cosmos DB compartida vía <Code>get_db()</Code></>],
          ['Routers', <><Code>/api/auth/*</Code> · <Code>/api/projects/*</Code> · <Code>/api/models/*</Code> · <Code>/api/admin/users/*</Code> · <Code>/api/health</Code></>],
          ['CORS', <><Code>allow_credentials=True</Code>; allowlist explícita por origen</>],
          ['Bootstrap', 'Crea el usuario admin idempotente al primer arranque'],
        ]}
      />

      <Sub>Agente — <Code>app-agents-modeler</Code> (FastAPI :8001)</Sub>
      <DocTable
        headers={['Componente', 'Responsabilidad']}
        rows={[
          ['ConversationStore', <>Memoria en RAM por <Code>conversation_id</Code> (UUID v4): historial, guidelines, último modelo</>],
          ['Pipeline', <><Code>prepare_input → ExecutorAgent → extract_model → QAValidatorAgent → format_output</Code></>],
          ['ExecutorAgent', 'Microsoft Agent Framework + Azure AI Foundry (GPT-4o); genera tablas + DDL aplicando lineamientos'],
          ['QAValidatorAgent', 'Estandariza nombres vs catálogo corporativo, calcula quality_score'],
          ['knowledge_base_tools', 'Carga y cachea guidelines por sesión usando ContextVar'],
          ['catalog_tools', <>CRUD sobre <Code>column_catalog</Code> en Cosmos DB con similitud Jaccard + embeddings</>],
          ['Routers', <><Code>/api/conversations/*</Code> · <Code>/api/conversations/{'{id}'}/model</Code> · <Code>/api/health</Code> · <Code>/api/engines</Code></>],
          ['CORS', <><Code>allow_credentials=False</Code>; allowlist explícita por origen</>],
        ]}
      />

      <Sub>Flujo completo de un turno de modelado</Sub>
      <CodeBlock>{`
[Usuario] → escribe en el chat del frontend
    │
[Frontend] POST {NEXT_PUBLIC_AGENT_API_URL}/api/conversations/{id}/model
    │  (request directo al agente · sin proxy de Next.js · sin cookie)
    │
[Agente :8001]
  ConversationStore → inyecta history + last_model en el payload
    │
  run_modeling_pipeline:
    prepare_input    → construye prompt enriquecido
    ExecutorAgent    → Microsoft Agent Framework + Foundry: tablas + DDL
    extract_model    → limpia JSON, prepara prompt QA
    QAValidatorAgent → estandariza vs Cosmos column_catalog · score
    format_output    → JSON final
    │
  response_builder → ModelingResponseAPI
    │
[Frontend] muestra el resultado en el chat con el perrito
    │
[Usuario] "Aplicar al canvas" (2 pasos) → tablas en el canvas
    │
[Usuario] click Guardar
    │
[Frontend] PUT {NEXT_PUBLIC_API_URL}/api/models/{id}
    │  (request directo a la plataforma · con cookie modeler-auth)
    │
[Plataforma :8000]
  Auth dependency → valida JWT de la cookie
    │
  Motor client → Cosmos DB:
      models             ← upsert metadata (nombre, motor, projectId, …)
      model_tables       ← upsert hijos (uno por tabla)
      model_relationships← upsert hijos (uno por FK)
      model_views        ← upsert hijos (uno por vista SQL)
      `}</CodeBlock>

      <Sub>Persistencia en Cosmos DB</Sub>
      <P>
        El modelo se almacena <strong>desnormalizado en cuatro collections</strong>:
        un documento padre en <Code>models</Code> con la metadata, y un documento por cada
        tabla, relación y vista en sus respectivas collections hijas. El borrado es soft
        (campo <Code>flgactive</Code>) para preservar histórico y permitir restauración.
      </P>

      <DocTable
        headers={['Collection', 'Servicio', 'Qué guarda']}
        rows={[
          ['users', 'Plataforma', 'Cuentas, hash bcrypt, roles (admin / modeler / viewer)'],
          ['projects', 'Plataforma', 'Proyectos del usuario (nombre, descripción, ownerId)'],
          ['models', 'Plataforma', 'Metadata del modelo (nombre, motor, projectId, tableCount)'],
          ['model_tables', 'Plataforma', 'Una fila por tabla del modelo (columnas, particionamiento, dominios)'],
          ['model_relationships', 'Plataforma', 'Una fila por FK (sourceTable/Column → targetTable/Column, tipo)'],
          ['model_views', 'Plataforma', 'Una fila por vista SQL (alias, expresiones, filtros)'],
          ['column_catalog', 'Agente', 'Catálogo corporativo de columnas estandarizadas para QA + embeddings vectoriales'],
        ]}
      />

      <Sub>Documento de tabla (collection <Code>model_tables</Code>)</Sub>
      <CodeBlock lang="json">{`
{
  "_id": "uuid",
  "modelId": "uuid",
  "schema": "bcp_ddv_crm",
  "name": "HD_CLIENTE",
  "logicalName": "Cliente",
  "definition": "Tabla maestra de clientes",
  "domain": "Clientes",
  "subdomain": null,
  "applicationCode": "CRM",
  "tags": ["maestro", "cliente"],
  "columns": [
    {
      "id": "uuid", "name": "CODCLI", "logicalName": "Código de Cliente",
      "type": "varchar", "length": 20, "scale": null,
      "isPrimaryKey": true, "isForeignKey": false, "isNullable": false,
      "default": null, "definition": "Código único del cliente"
    }
  ],
  "partition": { "strategy": "NONE", "columns": [], "buckets": null },
  "position": { "x": 240, "y": 80 },
  "flgactive": true,
  "createdAt": "ISO 8601",
  "updatedAt": "ISO 8601"
}
      `}</CodeBlock>

      <Callout type="tip">
        Cada servicio mantiene su propio venv y su propio <Code>.env</Code>. El agente puede
        bajarse sin afectar la plataforma; el chat del frontend mostrará un error claro y el
        resto de la app sigue funcionando normalmente.
      </Callout>

      <Sub>Variables de entorno clave</Sub>
      <Ul
        items={[
          <><Code>NEXT_PUBLIC_API_URL</Code> (frontend) — URL pública de la plataforma, ej. <Code>http://localhost:8000</Code></>,
          <><Code>NEXT_PUBLIC_AGENT_API_URL</Code> (frontend) — URL pública del agente, ej. <Code>http://localhost:8001</Code></>,
          <><Code>AUTH_SECRET</Code> (frontend + plataforma) — debe coincidir entre ambos para validar JWT</>,
          <><Code>COSMOS_CONNECTION_STRING</Code> (plataforma + agente) — cluster compartido, collections distintas</>,
          <><Code>COSMOS_DATABASE</Code> (default <Code>db_modeler</Code>) — nombre de la base lógica en Cosmos</>,
          <><Code>FOUNDRY_*</Code> y <Code>AZURE_OPENAI_*</Code> (agente) — credenciales de los modelos IA</>,
        ]}
      />
    </>
  );
}
