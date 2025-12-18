# AI-Powered Ebook Reader

An intelligent ebook reader with AI-powered character recognition and text-to-speech conversion.

## Features

- 📚 Ebook reading and management
- 🎭 AI-powered character identification
- 🔊 Text-to-speech with character-specific voices
- 🔄 Amazon Kindle integration (planned)
- 📱 Cross-platform support (Web first, mobile later)

## Tech Stack

### Frontend
- React 19 with TypeScript
- Vite for build tooling
- TailwindCSS for styling

### Backend
- .NET 8 Web API
- Entity Framework Core
- PostgreSQL 16

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

1. **Clone the repository**
```bash
cd C:\Repos\Training\ebook_reader
```

2. **Start with Docker Compose**
```bash
docker-compose up
```

3. **Or run services individually:**

**Backend:**
```bash
cd backend
dotnet restore
dotnet run
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

## API Endpoints

- `GET /api/books` - List all books
- `GET /api/books/{id}` - Get book details
- `POST /api/books` - Upload new book
- `GET /api/books/{id}/characters` - Get identified characters
- `POST /api/audio/convert` - Convert text to speech

## Environment Variables

### Backend (.NET)
```
AZURE_OPENAI_ENDPOINT=your_endpoint
AZURE_OPENAI_KEY=your_key
GOOGLE_CLOUD_TTS_KEY=your_key
ConnectionStrings__DefaultConnection=Host=localhost;Port=5432;Database=EbookReader;Username=postgres;Password=postgres
```

### Frontend (React)
```
VITE_API_URL=http://localhost:5000
```

## Deployment

Deployment to Azure is configured via GitHub Actions (see `.github/workflows`).

## License

MIT
