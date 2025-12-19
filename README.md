# AI-Powered Ebook Reader

An intelligent ebook reader with AI-powered character recognition and text-to-speech conversion.

## Features

- User authentication with JWT tokens
- Ebook reading and management (per-user libraries)
- EPUB upload + parsing into chapters
- AI-powered character identification (planned)
- Text-to-speech with character-specific voices (planned)
- Amazon Kindle integration (planned)
- Cross-platform support (Web first, mobile later)

## Tech Stack

### Frontend
- React 19 with TypeScript
- Vite for build tooling
- TailwindCSS for styling
- React Router v6 for routing
- Axios for HTTP client
- Context API for authentication state

### Backend
- .NET 8 Web API
- Entity Framework Core 8.0.11
- PostgreSQL 16 (Npgsql provider)
- JWT Authentication (Microsoft.AspNetCore.Authentication.JwtBearer 8.0.11)
- BCrypt.Net-Next 4.0.3 for password hashing
- Hangfire 1.8.17 for background jobs
- Serilog 8.0.3 for structured logging

### AI Services
- Azure OpenAI (character analysis)
- Google Cloud TTS (text-to-speech)

### Infrastructure
- Azure App Service
- Azure Database for PostgreSQL (or self-hosted)
- Azure Blob Storage
- Docker for local development

## Project Structure

```
ebook-reader/
├── backend/              # .NET Web API
│   ├── Controllers/
│   ├── Services/
│   ├── Models/
│   └── Data/
├── frontend/            # React application
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── services/
│   │   └── hooks/
│   └── public/
├── docker-compose.yml   # Local development
└── azure/              # Azure deployment configs
```

## Getting Started

### Prerequisites
- .NET 8 SDK
- Node.js 18+
- Docker Desktop
- Azure account (optional for deployment)

### Local Development

This project is set up to run via Docker Compose (frontend + backend + database).

1. **Start everything**
```bash
cd C:\Repos\Training\ebook_reader
docker-compose up -d --build
```

2. **Access points**
- Frontend: http://localhost:5174
- Backend API (HTTP): http://localhost:5000
- Backend API (HTTPS): https://localhost:5001
- Swagger (HTTPS): https://localhost:5001/swagger
- Hangfire (HTTPS): https://localhost:5001/hangfire
- PostgreSQL: localhost:5432

3. **HTTPS development certificate (Windows)**

The backend container uses a development certificate mounted from your user profile.
If you haven't generated it yet:
```bash
dotnet dev-certs https -ep "%USERPROFILE%\\.aspnet\\https\\aspnetapp.pfx" -p yourpassword
```

The password must match the value configured in `docker-compose.yml`.

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login and receive JWT token

### Books (Authenticated)
- `GET /api/books` - List user's books
- `GET /api/books/{id}` - Get book details
- `POST /api/books` - Upload new book
- `DELETE /api/books/{id}` - Delete book
- `GET /api/books/{id}/characters` - Get identified characters (planned)
- `POST /api/audio/convert` - Convert text to speech (planned)

## Environment Variables

### Backend (appsettings.json)
```json
{
  "ConnectionStrings": {
    "DefaultConnection": "Host=localhost;Port=5432;Database=EbookReader;Username=postgres;Password=postgres"
  },
  "Jwt": {
    "Secret": "your-super-secret-key-min-32-chars",
    "Issuer": "EbookReaderAPI",
    "Audience": "EbookReaderClient",
    "ExpirationMinutes": 43200
  },
  "FileStorage": {
    "Type": "Local",
    "LocalPath": "uploads",
    "AzureBlobConnectionString": "",
    "AzureBlobContainerName": "ebooks"
  },
  "Audio": {
    "Format": "mp3",
    "Bitrate": 128,
    "SampleRate": 24000
  }
}
```

### Frontend (.env)
```
VITE_API_URL=https://localhost:5001
```

## React StrictMode

React StrictMode is recommended during development because it helps surface unsafe patterns.
However, in development it can intentionally run certain effects twice (so you may see duplicate API calls).
This does not happen in production builds.

## Deployment

Deployment to Azure is configured via GitHub Actions (see `.github/workflows`).

## Documentation Maintenance

**Important**: When implementing new features or making architectural changes, always update:
1. This README.md file (user-facing documentation)
2. `.github/copilot-instructions.md` (AI assistant development guidelines)

Key sections to update:
- **Features**: Add new capabilities to the features list
- **Tech Stack**: Document new libraries or version changes
- **API Endpoints**: Add/update endpoint documentation
- **Database Schema**: Reflect entity changes
- **Known Issues**: Remove resolved items, add new blockers
- **Roadmap**: Check off completed items, add new phases

## License

MIT
