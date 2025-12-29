using EbookReader.Core.Interfaces;
using EbookReader.Infrastructure.Data;
using EbookReader.Infrastructure.Services;
using Hangfire;
using Hangfire.PostgreSql;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Serilog;
using System.Text;

// Configure Serilog
Log.Logger = new LoggerConfiguration()
    .ReadFrom.Configuration(new ConfigurationBuilder()
        .AddJsonFile("appsettings.json")
        .Build())
    .CreateLogger();

try
{
    Log.Information("Starting Ebook Reader API");

    var builder = WebApplication.CreateBuilder(args);

    // Add Serilog
    builder.Host.UseSerilog();

    // Add services to the container.
    builder.Services.AddControllers()
        .AddJsonOptions(options =>
        {
            options.JsonSerializerOptions.ReferenceHandler = System.Text.Json.Serialization.ReferenceHandler.IgnoreCycles;
        });
    builder.Services.AddEndpointsApiExplorer();
    builder.Services.AddSwaggerGen();

// Database
builder.Services.AddDbContext<EbookReaderDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("DefaultConnection")));

// File Storage - choose based on configuration
var storageType = builder.Configuration["FileStorage:Type"] ?? "Local";
if (storageType.Equals("Azure", StringComparison.OrdinalIgnoreCase))
{
    builder.Services.AddScoped<IFileStorageService, AzureBlobStorageService>();
}
else
{
    builder.Services.AddScoped<IFileStorageService, LocalFileStorageService>();
}

// Book Service
builder.Services.AddScoped<IBookService, BookService>();

// Kindle Service
builder.Services.AddHttpClient(); // Required for KindleService
builder.Services.AddScoped<IKindleService, KindleService>();

// TTS Service - ElevenLabs
builder.Services.AddHttpClient<ITtsService, ElevenLabsTtsService>();
builder.Services.AddSingleton<ElevenLabsStreamingService>();
builder.Services.AddSingleton<AzureSpeechStreamingService>();

// SSML Enhancement Service - Azure OpenAI
builder.Services.AddSingleton<ISsmlEnhancementService, SsmlEnhancementService>();

// Hangfire - Background Job Processing
builder.Services.AddHangfire(configuration => configuration
    .SetDataCompatibilityLevel(CompatibilityLevel.Version_180)
    .UseSimpleAssemblyNameTypeSerializer()
    .UseRecommendedSerializerSettings()
    .UsePostgreSqlStorage(options =>
        options.UseNpgsqlConnection(builder.Configuration.GetConnectionString("DefaultConnection"))));

builder.Services.AddHangfireServer();

// JWT Authentication
var jwtSecret = builder.Configuration["Jwt:Secret"]!;
var jwtIssuer = builder.Configuration["Jwt:Issuer"]!;
var jwtAudience = builder.Configuration["Jwt:Audience"]!;

builder.Services.AddAuthentication(options =>
{
    options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
    options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
})
.AddJwtBearer(options =>
{
    options.Events = new JwtBearerEvents
    {
        OnMessageReceived = context =>
        {
            // WebSocket clients can't send Authorization headers reliably.
            // We support passing the JWT as a query string param for the TTS stream endpoint.
            var accessToken = context.Request.Query["access_token"].ToString();
            var path = context.HttpContext.Request.Path;

            if (!string.IsNullOrWhiteSpace(accessToken) && path.StartsWithSegments("/api/ttsstream/stream"))
            {
                context.Token = accessToken;
            }

            return Task.CompletedTask;
        }
    };

    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = true,
        ValidateAudience = true,
        ValidateLifetime = true,
        ValidateIssuerSigningKey = true,
        ValidIssuer = jwtIssuer,
        ValidAudience = jwtAudience,
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret))
    };
});

builder.Services.AddAuthorization();

// CORS
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontend", policy =>
    {
        policy.WithOrigins("http://localhost:5173", "http://localhost:5174", "https://localhost:5173", "https://localhost:5174")
              .AllowAnyMethod()
              .AllowAnyHeader()
              .WithExposedHeaders("X-Total-Count", "X-Page", "X-Page-Size", "X-Total-Pages"); // Expose pagination headers
    });
});

var app = builder.Build();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
    
    // Hangfire Dashboard (development only)
    app.UseHangfireDashboard("/hangfire");
}

// Auto-apply EF Core migrations in Development.
// This makes Docker Compose startup smoother (no manual migration step).
if (app.Environment.IsDevelopment())
{
    using var scope = app.Services.CreateScope();
    var logger = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("StartupMigrations");
    var db = scope.ServiceProvider.GetRequiredService<EbookReaderDbContext>();

    const int maxAttempts = 15;
    for (var attempt = 1; attempt <= maxAttempts; attempt++)
    {
        try
        {
            logger.LogInformation("Applying database migrations (attempt {Attempt}/{MaxAttempts})", attempt, maxAttempts);
            await db.Database.MigrateAsync();
            logger.LogInformation("Database migrations applied successfully");
            break;
        }
        catch (Exception ex) when (attempt < maxAttempts)
        {
            logger.LogWarning(ex, "Database not ready yet; retrying...");
            await Task.Delay(TimeSpan.FromSeconds(2));
        }
    }
}

// (No recurring background jobs registered at startup)

// Enable WebSockets for TTS streaming
app.UseWebSockets(new WebSocketOptions
{
    KeepAliveInterval = TimeSpan.FromSeconds(30)
});

app.UseCors("AllowFrontend");
app.UseSerilogRequestLogging();
app.UseHttpsRedirection();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.Run();
}
catch (Exception ex)
{
    // EF Core design-time services can trigger a HostAbortedException during `dotnet ef`.
    // It's expected and should not be logged as a fatal application crash.
    if (ex is Microsoft.Extensions.Hosting.HostAbortedException)
    {
        Log.Information("Host aborted (design-time)");
    }
    else
    {
        Log.Fatal(ex, "Application terminated unexpectedly");
    }
}
finally
{
    Log.CloseAndFlush();
}
