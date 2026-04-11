# Deployment Guide

## Development Environment

### Prerequisites

- Node.js 18 or later
- npm (included with Node.js)
- Git

### Setup

```bash
# Clone the repository
git clone https://github.com/Carlosmps97/web-data-model-hub.git
cd web-data-model-hub

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your configuration
```

### Running in Development

```bash
npm run dev
```

The application starts on http://localhost:3000 with hot module replacement enabled.

### Building for Production

```bash
npm run build
npm start
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATA_DIR` | Path to local JSON storage directory | No (defaults to `./data`) |
| `APP_AZURE_TENANT_ID` | Azure AD tenant ID (future SharePoint) | No |
| `APP_AZURE_CLIENT_ID` | Azure AD client ID (future SharePoint) | No |
| `APP_AZURE_CLIENT_SECRET` | Azure AD client secret (future SharePoint) | No |

## Data Storage

### Local JSON (Current)

Data is stored in the `data/` directory:

```
data/
  projects.json        # Project registry
  models/
    {uuid}.json        # Individual model files
```

The data directory is created automatically on first API call. It is excluded from version control via `.gitignore`.

To back up your data, simply copy the `data/` directory.

### Data Migration

To migrate data to a new environment:
1. Copy the `data/` directory to the new location
2. Set the `DATA_DIR` environment variable if using a non-default path
3. Start the application

## Production Considerations

### Deployment Platforms

The application can be deployed to any platform that supports Node.js:

- **Vercel**: Native Next.js support, zero configuration
- **Docker**: Containerized deployment
- **Node.js Server**: Direct deployment with `npm start`

### Docker Deployment

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

### Vercel Deployment

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel
```

Note: When deploying to serverless platforms, the local JSON storage will not persist between deployments. For production use, migrate to a database solution (Cosmos DB, PostgreSQL, etc.) or SharePoint.

## Security Notes

- The `.env` file contains sensitive credentials and is excluded from version control
- Azure service principal credentials are stored for future SharePoint integration
- Never commit the `.env` file or the `data/` directory to public repositories
- When deploying to production, use environment variable injection through the hosting platform
