using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using EbookReader.Core.Interfaces;
using EbookReader.Infrastructure.Services;
using EbookReader.Infrastructure.Data;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace EbookReader.API.Controllers;

/// <summary>
/// WebSocket endpoint for streaming TTS audio
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class TtsStreamController : ControllerBase
{
    private readonly ElevenLabsStreamingService _streamingService;
    private readonly AzureSpeechStreamingService _azureStreamingService;
    private readonly ISsmlEnhancementService _ssmlEnhancementService;
    private readonly EbookReaderDbContext _db;
    private readonly IConfiguration _config;
    private readonly ILogger<TtsStreamController> _logger;

    public TtsStreamController(
        ElevenLabsStreamingService streamingService,
        AzureSpeechStreamingService azureStreamingService,
        ISsmlEnhancementService ssmlEnhancementService,
        EbookReaderDbContext db,
        IConfiguration config,
        ILogger<TtsStreamController> logger)
    {
        _streamingService = streamingService;
        _azureStreamingService = azureStreamingService;
        _ssmlEnhancementService = ssmlEnhancementService;
        _db = db;
        _config = config;
        _logger = logger;
    }

    /// <summary>
    /// WebSocket endpoint for streaming TTS audio.
    /// Connect via WebSocket, send JSON with { text: "...", voiceId?: "..." }
    /// Receive binary audio chunks and text alignment data.
    /// Supports multiple text chunks on the same connection.
    /// </summary>
    [HttpGet("stream")]
    public async Task StreamTts()
    {
        if (!HttpContext.WebSockets.IsWebSocketRequest)
        {
            HttpContext.Response.StatusCode = 400;
            await HttpContext.Response.WriteAsync("WebSocket connection required");
            return;
        }

        // Enforce auth without rejecting the HTTP Upgrade handshake.
        // WebSocket clients generally can't read a 401 body, so we authenticate manually
        // and send a structured error message over the socket if the token is missing/invalid.
        var authResult = await HttpContext.AuthenticateAsync(JwtBearerDefaults.AuthenticationScheme);
        if (authResult.Succeeded && authResult.Principal is not null)
        {
            HttpContext.User = authResult.Principal;
        }

        using var webSocket = await HttpContext.WebSockets.AcceptWebSocketAsync();
        _logger.LogInformation("TTS WebSocket connection accepted");

        if (!authResult.Succeeded)
        {
            await SendErrorAndClose(webSocket, "Unauthorized");
            return;
        }

        try
        {
            var buffer = new byte[1024 * 64]; // 64KB buffer for large text

            // Loop to handle multiple text chunks
            while (webSocket.State == WebSocketState.Open)
            {
                var result = await webSocket.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);

                if (result.MessageType == WebSocketMessageType.Close)
                {
                    _logger.LogDebug("Client requested close");
                    break;
                }

                if (result.MessageType == WebSocketMessageType.Text)
                {
                    var requestJson = Encoding.UTF8.GetString(buffer, 0, result.Count);
                    var request = JsonSerializer.Deserialize<TtsStreamRequest>(requestJson, new JsonSerializerOptions
                    {
                        PropertyNameCaseInsensitive = true
                    });

                    if (request?.Text == null || string.IsNullOrWhiteSpace(request.Text))
                    {
                        // Send error but don't close - allow retry
                        var errorJson = JsonSerializer.Serialize(new { type = "error", message = "Text is required" });
                        var errorBytes = Encoding.UTF8.GetBytes(errorJson);
                        await webSocket.SendAsync(new ArraySegment<byte>(errorBytes), WebSocketMessageType.Text, true, CancellationToken.None);
                        continue;
                    }

                    var userId = TryGetUserId();
                    if (userId is null)
                    {
                        await SendErrorAndClose(webSocket, "Unauthorized");
                        return;
                    }

                    var user = await _db.Users
                        .AsNoTracking()
                        .FirstOrDefaultAsync(u => u.Id == userId.Value, CancellationToken.None);

                    var provider = ResolveProvider(request.Provider, user?.PreferredTtsProvider);

                    // If the client does not provide voice fields, default from user settings / app configuration.
                    var resolvedVoiceName = string.IsNullOrWhiteSpace(request.VoiceName)
                        ? (string.IsNullOrWhiteSpace(user?.PreferredAzureVoiceName)
                            ? _config["AzureSpeech:DefaultVoiceName"]
                            : user!.PreferredAzureVoiceName)
                        : request.VoiceName;

                    var resolvedVoiceId = string.IsNullOrWhiteSpace(request.VoiceId)
                        ? _config["ElevenLabs:DefaultVoiceId"]
                        : request.VoiceId;

                    _logger.LogInformation("Starting TTS stream ({Provider}) for {Length} characters", provider, request.Text.Length);

                    try
                    {
                        if (provider is "azure" or "azurespeech" or "azureai")
                        {
                            // Check if user has SSML enhancement enabled
                            var enableSsml = user?.EnableSsmlEnhancement ?? false;
                            
                            if (enableSsml && _ssmlEnhancementService.IsConfigured)
                            {
                                _logger.LogInformation("Enhancing text with SSML using AI (context: {HasContext})", 
                                    !string.IsNullOrWhiteSpace(request.ContextText));
                                    
                                var (ssmlText, positionMap) = await _ssmlEnhancementService.EnhanceWithSsmlAsync(
                                    request.Text,
                                    resolvedVoiceName ?? _config["AzureSpeech:DefaultVoiceName"] ?? "en-US-JennyNeural",
                                    request.ContextText,
                                    CancellationToken.None);
                                
                                _logger.LogInformation("SSML enhancement returned. SSML length: {SsmlLen}, Position map size: {MapSize}", 
                                    ssmlText.Length, positionMap.Count);
                                
                                // Log the full SSML for debugging
                                _logger.LogDebug("SSML content being sent to Azure Speech:\n{SsmlContent}", ssmlText);
                                
                                await _azureStreamingService.StreamSsmlToSpeechAsync(
                                    ssmlText,
                                    webSocket,
                                    request.Text, // Pass original text for word alignment
                                    positionMap, // Pass position mapping
                                    CancellationToken.None);
                            }
                            else
                            {
                                await _azureStreamingService.StreamTextToSpeechAsync(
                                    request.Text,
                                    webSocket,
                                    resolvedVoiceName,
                                    CancellationToken.None);
                            }
                        }
                        else
                        {
                            // Default: ElevenLabs (SSML enhancement not supported for ElevenLabs in this version)
                            await _streamingService.StreamTextToSpeechAsync(
                                request.Text,
                                webSocket,
                                resolvedVoiceId,
                                CancellationToken.None);
                        }
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "Error streaming audio for provider {Provider}", provider);
                        var errorJson = JsonSerializer.Serialize(new { type = "error", message = ex.Message });
                        var errorBytes = Encoding.UTF8.GetBytes(errorJson);
                        await webSocket.SendAsync(new ArraySegment<byte>(errorBytes), WebSocketMessageType.Text, true, CancellationToken.None);
                        // Continue to allow next chunk (e.g. user switches provider/config)
                    }
                    
                    // After streaming completes, continue listening for more chunks
                }
            }

            // Close gracefully
            if (webSocket.State == WebSocketState.Open)
            {
                await webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Complete", CancellationToken.None);
            }
        }
        catch (WebSocketException ex) when (ex.WebSocketErrorCode == WebSocketError.ConnectionClosedPrematurely)
        {
            _logger.LogDebug("Client disconnected");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error in TTS WebSocket stream");
            if (webSocket.State == WebSocketState.Open)
            {
                await SendErrorAndClose(webSocket, "Error streaming audio");
            }
        }
    }

    private static async Task SendErrorAndClose(WebSocket webSocket, string message)
    {
        var errorJson = JsonSerializer.Serialize(new { type = "error", message });
        var errorBytes = Encoding.UTF8.GetBytes(errorJson);
        await webSocket.SendAsync(new ArraySegment<byte>(errorBytes), WebSocketMessageType.Text, true, CancellationToken.None);
        await webSocket.CloseAsync(WebSocketCloseStatus.InvalidPayloadData, message, CancellationToken.None);
    }

    private Guid? TryGetUserId()
    {
        var userIdString = User.FindFirstValue(ClaimTypes.NameIdentifier)
                          ?? User.FindFirstValue("sub");

        return Guid.TryParse(userIdString, out var userId) ? userId : null;
    }

    private static string ResolveProvider(string? requestProvider, string? userPreferredProvider)
    {
        var raw = string.IsNullOrWhiteSpace(requestProvider)
            ? userPreferredProvider
            : requestProvider;

        var normalized = (raw ?? "elevenlabs").Trim().ToLowerInvariant();
        if (normalized is "azureai" or "azurespeech" or "azure") return "azure";
        return "elevenlabs";
    }
}

public class TtsStreamRequest
{
    public string Text { get; set; } = string.Empty;
    public string? VoiceId { get; set; }
    public string? Provider { get; set; }
    public string? VoiceName { get; set; }
    public string? ContextText { get; set; }
}
