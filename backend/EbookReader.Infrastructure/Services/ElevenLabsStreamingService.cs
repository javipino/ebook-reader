using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace EbookReader.Infrastructure.Services;

/// <summary>
/// Service for streaming TTS audio via WebSocket connection to ElevenLabs
/// </summary>
public class ElevenLabsStreamingService
{
    private readonly ILogger<ElevenLabsStreamingService> _logger;
    private readonly string _apiKey;
    private readonly string _defaultVoiceId;
    private readonly string _modelId;

    public ElevenLabsStreamingService(IConfiguration configuration, ILogger<ElevenLabsStreamingService> logger)
    {
        _logger = logger;
        _apiKey = configuration["ElevenLabs:ApiKey"] ?? throw new InvalidOperationException("ElevenLabs API key is not configured");
        _defaultVoiceId = configuration["ElevenLabs:DefaultVoiceId"] ?? "6bNjXphfWPUDHuFkgDt3";
        _modelId = configuration["ElevenLabs:ModelId"] ?? "eleven_flash_v2_5";
    }

    public async Task StreamTextToSpeechAsync(
        string text,
        WebSocket clientWebSocket,
        string? voiceId = null,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(_apiKey))
        {
            throw new InvalidOperationException("ElevenLabs API key is not configured");
        }

        var effectiveVoiceId = voiceId ?? _defaultVoiceId;
        var wsUrl = $"wss://api.elevenlabs.io/v1/text-to-speech/{effectiveVoiceId}/stream-input?model_id={_modelId}";

        _logger.LogInformation("Starting TTS stream for {Length} characters with voice {VoiceId}", text.Length, effectiveVoiceId);

        using var elevenLabsWs = new ClientWebSocket();
        elevenLabsWs.Options.SetRequestHeader("xi-api-key", _apiKey);

        try
        {
            await elevenLabsWs.ConnectAsync(new Uri(wsUrl), cancellationToken);
            _logger.LogDebug("Connected to ElevenLabs WebSocket");

            // Send initial configuration (BOS - Beginning of Stream)
            var bosMessage = new
            {
                text = " ",
                voice_settings = new
                {
                    stability = 0.5,
                    similarity_boost = 0.8,
                    speed = 1.0
                },
                generation_config = new
                {
                    chunk_length_schedule = new[] { 120, 160, 250, 290 }
                },
                xi_api_key = _apiKey
            };

            await SendJsonAsync(elevenLabsWs, bosMessage, cancellationToken);

            // Send the text in chunks for better streaming
            var chunks = SplitTextIntoChunks(text, 200);
            foreach (var chunk in chunks)
            {
                if (cancellationToken.IsCancellationRequested) break;
                
                var textMessage = new { text = chunk };
                await SendJsonAsync(elevenLabsWs, textMessage, cancellationToken);
                
                // Small delay to avoid overwhelming the API
                await Task.Delay(50, cancellationToken);
            }

            // Send EOS (End of Stream)
            var eosMessage = new { text = "" };
            await SendJsonAsync(elevenLabsWs, eosMessage, cancellationToken);

            // Receive and forward audio chunks to client
            var buffer = new byte[16384]; // Larger buffer
            var messageBuffer = new MemoryStream();
            
            while (elevenLabsWs.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
            {
                var result = await elevenLabsWs.ReceiveAsync(new ArraySegment<byte>(buffer), cancellationToken);

                if (result.MessageType == WebSocketMessageType.Close)
                {
                    _logger.LogDebug("ElevenLabs WebSocket closed");
                    break;
                }

                if (result.MessageType == WebSocketMessageType.Text)
                {
                    // Accumulate data until end of message
                    messageBuffer.Write(buffer, 0, result.Count);
                    
                    if (!result.EndOfMessage)
                    {
                        // More data coming, continue receiving
                        continue;
                    }
                    
                    // Complete message received, parse it
                    var jsonResponse = Encoding.UTF8.GetString(messageBuffer.ToArray());
                    messageBuffer.SetLength(0); // Reset buffer for next message
                    
                    ElevenLabsStreamResponse? response;
                    try
                    {
                        response = JsonSerializer.Deserialize<ElevenLabsStreamResponse>(jsonResponse);
                    }
                    catch (JsonException ex)
                    {
                        _logger.LogWarning(ex, "Failed to parse ElevenLabs response: {Response}", 
                            jsonResponse.Length > 200 ? jsonResponse.Substring(0, 200) + "..." : jsonResponse);
                        continue;
                    }

                    if (response?.Audio != null)
                    {
                        // Send audio chunk to client
                        var audioBytes = Convert.FromBase64String(response.Audio);
                        await clientWebSocket.SendAsync(
                            new ArraySegment<byte>(audioBytes),
                            WebSocketMessageType.Binary,
                            true,
                            cancellationToken);
                    }

                    if (response?.Alignment != null)
                    {
                        // Send alignment data to client as text
                        var alignmentJson = JsonSerializer.Serialize(new
                        {
                            type = "alignment",
                            data = response.Alignment
                        });
                        var alignmentBytes = Encoding.UTF8.GetBytes(alignmentJson);
                        await clientWebSocket.SendAsync(
                            new ArraySegment<byte>(alignmentBytes),
                            WebSocketMessageType.Text,
                            true,
                            cancellationToken);
                    }

                    if (response?.IsFinal == true)
                    {
                        _logger.LogDebug("Received final message from ElevenLabs");
                        // Send completion message
                        var completeJson = JsonSerializer.Serialize(new { type = "complete" });
                        var completeBytes = Encoding.UTF8.GetBytes(completeJson);
                        await clientWebSocket.SendAsync(
                            new ArraySegment<byte>(completeBytes),
                            WebSocketMessageType.Text,
                            true,
                            cancellationToken);
                        break;
                    }
                }
            }
        }
        catch (WebSocketException ex)
        {
            _logger.LogError(ex, "WebSocket error during TTS streaming");
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error during TTS streaming");
            throw;
        }
        finally
        {
            if (elevenLabsWs.State == WebSocketState.Open)
            {
                await elevenLabsWs.CloseAsync(WebSocketCloseStatus.NormalClosure, "Complete", CancellationToken.None);
            }
        }
    }

    private static async Task SendJsonAsync<T>(ClientWebSocket ws, T data, CancellationToken cancellationToken)
    {
        var json = JsonSerializer.Serialize(data, new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower
        });
        var bytes = Encoding.UTF8.GetBytes(json);
        await ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, cancellationToken);
    }

    private static List<string> SplitTextIntoChunks(string text, int maxChunkSize)
    {
        var chunks = new List<string>();
        var sentences = text.Split(new[] { ". ", "! ", "? " }, StringSplitOptions.RemoveEmptyEntries);
        var currentChunk = new StringBuilder();

        foreach (var sentence in sentences)
        {
            var sentenceWithPeriod = sentence.TrimEnd('.', '!', '?') + ". ";
            
            if (currentChunk.Length + sentenceWithPeriod.Length > maxChunkSize && currentChunk.Length > 0)
            {
                chunks.Add(currentChunk.ToString());
                currentChunk.Clear();
            }
            
            currentChunk.Append(sentenceWithPeriod);
        }

        if (currentChunk.Length > 0)
        {
            chunks.Add(currentChunk.ToString());
        }

        return chunks;
    }

    private class ElevenLabsStreamResponse
    {
        [JsonPropertyName("audio")]
        public string? Audio { get; set; }

        [JsonPropertyName("isFinal")]
        public bool? IsFinal { get; set; }

        [JsonPropertyName("alignment")]
        public AlignmentData? Alignment { get; set; }
    }

    private class AlignmentData
    {
        [JsonPropertyName("chars")]
        public List<string>? Chars { get; set; }

        [JsonPropertyName("charStartTimesMs")]
        public List<int>? CharStartTimesMs { get; set; }

        [JsonPropertyName("charDurationsMs")]
        public List<int>? CharDurationsMs { get; set; }
    }
}
