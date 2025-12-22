using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using EbookReader.Infrastructure.Services;
using Microsoft.AspNetCore.Mvc;

namespace EbookReader.API.Controllers;

/// <summary>
/// WebSocket endpoint for streaming TTS audio
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class TtsStreamController : ControllerBase
{
    private readonly ElevenLabsStreamingService _streamingService;
    private readonly ILogger<TtsStreamController> _logger;

    public TtsStreamController(ElevenLabsStreamingService streamingService, ILogger<TtsStreamController> logger)
    {
        _streamingService = streamingService;
        _logger = logger;
    }

    /// <summary>
    /// WebSocket endpoint for streaming TTS audio.
    /// Connect via WebSocket, send JSON with { text: "...", voiceId?: "..." }
    /// Receive binary audio chunks and text alignment data.
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

        using var webSocket = await HttpContext.WebSockets.AcceptWebSocketAsync();
        _logger.LogInformation("TTS WebSocket connection accepted");

        try
        {
            // Wait for initial message with text
            var buffer = new byte[1024 * 64]; // 64KB buffer for large text
            var result = await webSocket.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);

            if (result.MessageType == WebSocketMessageType.Text)
            {
                var requestJson = Encoding.UTF8.GetString(buffer, 0, result.Count);
                var request = JsonSerializer.Deserialize<TtsStreamRequest>(requestJson, new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true
                });

                if (request?.Text == null || string.IsNullOrWhiteSpace(request.Text))
                {
                    await SendErrorAndClose(webSocket, "Text is required");
                    return;
                }

                _logger.LogInformation("Starting TTS stream for {Length} characters", request.Text.Length);

                // Stream the audio
                await _streamingService.StreamTextToSpeechAsync(
                    request.Text,
                    webSocket,
                    request.VoiceId,
                    CancellationToken.None);
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
}

public class TtsStreamRequest
{
    public string Text { get; set; } = string.Empty;
    public string? VoiceId { get; set; }
}
