# Azure Deployment

Deploy the infrastructure and application to Azure.

## Prerequisites

- Azure CLI installed
- Azure subscription
- Logged in to Azure CLI (`az login`)

## Steps

### 1. Create Resource Group

```bash
az group create --name ebook-reader-rg --location eastus
```

### 2. Deploy Infrastructure

```bash
az deployment group create \
  --resource-group ebook-reader-rg \
  --template-file main.bicep \
  --parameters sqlServerAdminLogin=ebookadmin sqlServerAdminPassword='YourSecurePassword123!'
```

### 3. Deploy Backend API

```bash
cd ../backend
dotnet publish -c Release
cd EbookReader.API/bin/Release/net8.0/publish
zip -r ../deploy.zip .
az webapp deployment source config-zip \
  --resource-group ebook-reader-rg \
  --name ebook-reader-api-dev \
  --src ../deploy.zip
```

### 4. Deploy Frontend (Azure Static Web Apps)

```bash
cd ../../../frontend
npm run build

# Install Azure Static Web Apps CLI
npm install -g @azure/static-web-apps-cli

# Deploy
swa deploy ./dist \
  --app-name ebook-reader-frontend \
  --resource-group ebook-reader-rg \
  --env production
```

## Configuration

Update environment variables in Azure Portal:
- App Service > Configuration > Application settings
- Add Azure OpenAI endpoint and keys
- Add Google Cloud credentials

## Database Migrations

```bash
# From backend/EbookReader.API directory
dotnet ef database update --connection "your-azure-sql-connection-string"
```
