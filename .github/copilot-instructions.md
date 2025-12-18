# AI-Powered Ebook Reader - Development Instructions

## Project Overview

This is an AI-powered ebook reader application that enables users to read books with intelligent features including:
- AI-based character identification and analysis
- Text-to-speech conversion with character-specific voices
- Seamless switching between reading and listening modes
- Amazon Kindle synchronization (planned)

**Current Status**: Web application (mobile app planned for future)

## Tech Stack Decisions

### Frontend
- **Framework**: React 19 with TypeScript
- **Build Tool**: Vite
- **Styling**: TailwindCSS
- **Routing**: React Router v6
- **HTTP Client**: Axios
- **State Management**: Zustand (when needed)

### Backend
- **Framework**: .NET 8 Web API
- **Architecture**: Clean Architecture (3-layer)
  - `EbookReader.API`: Controllers and API endpoints
  - `EbookReader.Core`: Domain entities and business logic
  - `EbookReader.Infrastructure`: Database context and external services
- **Database**: PostgreSQL 16 (Npgsql.EntityFrameworkCore.PostgreSQL 8.0.11)
- **API Documentation**: Swagger/OpenAPI
- **Background Jobs**: Hangfire with PostgreSQL storage
- **Logging**: Serilog with console and file sinks
- **File Storage**: Abstracted (IFileStorageService) supporting both Azure Blob Storage and local filesystem
- **Ebook Parser**: VersOne.Epub 3.3.4 for EPUB format

### AI & Services
- **Character Analysis**: Azure OpenAI (GPT-4o or GPT-3.5-turbo)
  - Used to identify main characters in books
  - Extract character descriptions for voice assignment
- **Text-to-Speech**: Google Cloud TTS (primary)
  - **Free tier**: 1M characters/month for neural voices
  - **Alternative options** (evaluated but not primary):
    - OpenAI TTS: $15/1M chars, excellent quality, 6 voices
    - ElevenLabs: $0.30/1K chars (pay-as-go), best quality, voice cloning
  - **Hybrid strategy** (future optimization):
    - Use cheaper TTS (OpenAI/Google) for narration (~70% of content)
    - Use premium TTS (ElevenLabs) for character dialogue (~30%)

### Infrastructure
- **Hosting**: Azure (or self-hosted Debian server)
  - App Service for .NET API
  - Static Web Apps for React frontend (future)
  - Azure Database for PostgreSQL (flexible server) or self-hosted PostgreSQL
  - Azure Blob Storage for ebook files
- **Local Development**: Docker Compose
- **CI/CD**: Azure DevOps (planned)

## Architecture Patterns

### Database Schema
- **Book**: Core entity containing title, author, file path, upload date
- **Character**: Linked to Book, stores character name, description, assigned voice
- **Chapter**: Book content split into chapters for efficient TTS processing
- **ReadingProgress**: Tracks user's current position per book

### Key Design Decisions

1. **Ebook Format Support**: EPUB only (MVP)
   - Use VersOne.Epub 3.3.4 parser
   - Add PDF support in future phases
   - MOBI/AZW require conversion to EPUB

2. **File Storage Strategy**: Environment-based abstraction
   - `IFileStorageService` interface supports multiple backends
   - **Local**: Default for development and self-hosted Debian
   - **Azure Blob**: Production Azure deployments
   - Configure via `FileStorage:Type` in appsettings.json

3. **Audio Format**: MP3 64kbps, 24kHz sample rate
   - Best balance of file size (~7MB/hour) and speech quality
   - Generated on-demand, cached for reuse
   - Reduces TTS costs significantly

4. **Background Job Processing**: Hangfire with PostgreSQL
   - Long-running tasks (character analysis, TTS generation)
   - Web dashboard at `/hangfire` (development only)
   - Same database as application data

5. **Monitoring & Logging**: Serilog
   - Structured logging to console and rolling files
   - 7-day log retention
   - Logs stored in `logs/` directory (gitignored)

6. **On-Demand Audio Generation**: Don't pre-convert entire books
   - Generate audio chapter by chapter as user progresses
   - Cache generated audio for reuse
   - Reduces TTS costs significantly

7. **Character Voice Assignment**:
   - Step 1: Use Azure OpenAI to analyze book and identify main characters
   - Step 2: Present characters to user
   - Step 3: User selects voice for each character (or use AI suggestions)
   - Step 4: Store voice assignments in database

8. **Playback Speed**: Client-side control
   - Use HTML5 Audio API `playbackRate` property
   - No need to regenerate audio at different speeds
   - User preference stored per book

9. **CORS Configuration**: Frontend (localhost:5173) allowed in development

## Project Structure

```
ebook_reader/
├── frontend/                    # React application
│   ├── src/
│   │   ├── components/         # Reusable components (Layout, etc.)
│   │   ├── pages/              # Route pages (Home, Library, Reader)
│   │   ├── services/           # API client (api.ts)
│   │   ├── App.tsx             # Main app component with routing
│   │   └── main.tsx            # Entry point
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── Dockerfile
├── backend/
│   ├── EbookReader.API/        # Web API controllers
│   │   ├── Controllers/        # BooksController, etc.
│   │   ├── Program.cs          # App configuration & DI
│   │   └── appsettings.*.json  # Configuration
│   ├── EbookReader.Core/       # Domain layer
│   │   └── Entities/           # Book, Character, Chapter, ReadingProgress
│   ├── EbookReader.Infrastructure/  # Data layer
│   │   └── Data/
│   │       └── EbookReaderDbContext.cs
│   ├── EbookReader.sln
│   └── Dockerfile
├── infrastructure/             # Azure deployment (Bicep)
│   ├── main.bicep
│   └── README.md
├── docker-compose.yml
└── README.md
```

## Development Setup

### Prerequisites
- Node.js 18+
- .NET 8 SDK
- Docker Desktop
- PostgreSQL 16 (via Docker)

### Local Development

**Option 1: Docker Compose (Frontend + Database)**
```bash
cd C:\Repos\Training\ebook_reader
docker-compose up -d
```

**Backend (Run Locally)**
```bash
cd backend/EbookReader.API
dotnet run --urls "http://localhost:5000"
```

**Access Points**:
- Frontend: http://localhost:5173
- Backend API: http://localhost:5000
- Swagger: http://localhost:5000/swagger
- Hangfire Dashboard: http://localhost:5000/hangfire
- Database: localhost:5432

### Environment Variables

**Backend (.env)**:
```
AZURE_OPENAI_ENDPOINT=your-endpoint
AZURE_OPENAI_KEY=your-key
GOOGLE_CLOUD_PROJECT_ID=your-project-id
GOOGLE_APPLICATION_CREDENTIALS=path-to-credentials.json
ConnectionStrings__DefaultConnection=Host=localhost;Port=5432;Database=EbookReader;Username=postgres;Password=postgres
```

**Frontend (.env)**:
```
VITE_API_URL=http://localhost:5000
```

## Coding Conventions

### Frontend
- Use TypeScript for all new files
- Functional components with hooks
- File naming: PascalCase for components (`HomePage.tsx`)
- Export components as default
- Use Tailwind utility classes for styling
- API calls should go through `services/api.ts`

### Backend
- Follow Clean Architecture principles
- Controllers in `EbookReader.API/Controllers`
- Entities in `EbookReader.Core/Entities`
- DbContext and repositories in `EbookReader.Infrastructure`
- Use async/await for all database operations
- Return `ActionResult<T>` from controller actions
- Use DTOs for API responses (future enhancement)

### Database
- Use GUID for primary keys
- Required fields: explicitly mark with `[Required]` or `IsRequired()`
- Navigation properties: use `ICollection<T>` for one-to-many
- Cascade delete where appropriate
- Use UTC for all timestamps

## API Endpoints (Current & Planned)

**Books**
- `GET /api/books` - List all books
- `GET /api/books/{id}` - Get book details
- `POST /api/books` - Create/upload book
- `DELETE /api/books/{id}` - Delete book
- `POST /api/books/{id}/analyze-characters` - Trigger AI character analysis (planned)

**Characters**
- `GET /api/books/{bookId}/characters` - List characters for book (planned)
- `PUT /api/characters/{id}/voice` - Assign voice to character (planned)

**Audio**
- `POST /api/books/{bookId}/chapters/{number}/audio` - Generate chapter audio (planned)
- `GET /api/books/{bookId}/chapters/{number}/audio` - Stream chapter audio (planned)

**Reading Progress**
- `GET /api/books/{bookId}/progress` - Get user's reading position (planned)
- `PUT /api/books/{bookId}/progress` - Update reading position (planned)

## Future Features & Roadmap

### Phase 1: MVP (Current)
- [x] Basic project structure
- [x] Database schema
- [x] Frontend UI skeleton
- [ ] Book upload functionality
- [ ] Basic reader view
- [ ] Chapter parsing

### Phase 2: AI Integration
- [ ] Azure OpenAI integration for character analysis
- [ ] Google Cloud TTS integration
- [ ] Character voice assignment UI
- [ ] Audio generation pipeline
- [ ] Audio player in reader view

### Phase 3: Enhanced Features
- [ ] Reading progress tracking
- [ ] Playback speed controls
- [ ] Bookmarks and highlights
- [ ] Audio caching strategy
- [ ] User authentication

### Phase 4: External Integrations
- [ ] Amazon Kindle API integration
- [ ] Sync reading position across devices
- [ ] Import books from Kindle library

### Phase 5: Mobile App
- [ ] React Native mobile app
- [ ] Offline reading support
- [ ] Background audio playback

## Cost Optimization Strategies

1. **TTS**: Start with Google Cloud (free tier), scale to hybrid model (OpenAI narration + ElevenLabs dialogue)
2. **Storage**: Use Azure Blob Storage cool tier for ebook files
3. **Database**: Azure PostgreSQL Flexible Server (burstable tier) or self-hosted on Debian
4. **Compute**: Azure App Service B1 tier (~$13/month) covered by $50 credit

## Known Issues & Technical Debt

1. **Docker Backend**: Backend Dockerfile needs fixing - currently running .NET locally instead
2. **PostCSS Config**: Fixed to use ES module syntax for Vite compatibility
3. **Authentication**: Not implemented yet - all endpoints are public
4. **DTOs**: Using entities directly in API responses (should add DTOs)
5. **Error Handling**: Basic error handling needs improvement
6. **Validation**: Input validation needs to be added to API endpoints
7. **Migrations**: EF migrations not set up yet

## Testing Strategy (Future)

- **Frontend**: Vitest + React Testing Library
- **Backend**: xUnit + Moq
- **E2E**: Playwright
- **API**: Swagger-based contract testing

## Security Considerations

- [ ] Add authentication (Azure AD B2C recommended)
- [ ] Implement authorization for book access
- [ ] Sanitize file uploads
- [ ] Validate ebook file formats
- [ ] Rate limiting on TTS endpoints
- [ ] Secure storage of API keys (Azure Key Vault)

## Performance Considerations

- Audio files should be streamed, not downloaded entirely
- Implement pagination for large book libraries
- Consider CDN for static assets (Azure CDN)
- Database indexing on frequently queried fields
- Lazy loading for chapter content

## Language Support

- Primary: English and Spanish
- TTS services support both languages natively
- Character analysis prompts should support multilingual books
- UI should be i18n-ready for future localization

## References & Documentation

- Azure OpenAI: https://learn.microsoft.com/azure/ai-services/openai/
- Google Cloud TTS: https://cloud.google.com/text-to-speech
- OpenAI TTS Pricing: $15/1M characters
- ElevenLabs Pricing: Starting at $5/month for 30K characters
- React Router v6: https://reactrouter.com/
- Entity Framework Core: https://learn.microsoft.com/ef/core/
