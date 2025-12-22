using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using EbookReader.Core.Interfaces;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace EbookReader.Infrastructure.Services;

/// <summary>
/// ElevenLabs TTS service implementation using Eleven v3 model with word-level timestamps
/// </summary>
public class ElevenLabsTtsService : ITtsService
{
    private readonly HttpClient _httpClient;
    private readonly ILogger<ElevenLabsTtsService> _logger;
    private readonly string _apiKey;
    private readonly string _defaultVoiceId;
    private readonly string _modelId;
    private readonly string _baseUrl;

    public ElevenLabsTtsService(HttpClient httpClient, IConfiguration configuration, ILogger<ElevenLabsTtsService> logger)
    {
        _httpClient = httpClient;
        _logger = logger;
        _apiKey = configuration["ElevenLabs:ApiKey"] ?? throw new InvalidOperationException("ElevenLabs API key is not configured");
        _defaultVoiceId = configuration["ElevenLabs:DefaultVoiceId"] ?? "6bNjXphfWPUDHuFkgDt3";
        _modelId = configuration["ElevenLabs:ModelId"] ?? "eleven_v3";
        _baseUrl = configuration["ElevenLabs:BaseUrl"] ?? "https://api.elevenlabs.io/v1";
    }

    public async Task<TtsResult> ConvertTextToSpeechAsync(string text, string? voiceId = null, double speed = 1.0)
    {
        var effectiveVoiceId = voiceId ?? _defaultVoiceId;
        
        _logger.LogInformation("Converting text to speech using voice {VoiceId}, text length: {Length}", 
            effectiveVoiceId, text.Length);

        // Use the text-to-speech endpoint with timestamps
        var url = $"{_baseUrl}/text-to-speech/{effectiveVoiceId}/with-timestamps";

        var requestBody = new ElevenLabsRequest
        {
            Text = text,
            ModelId = _modelId,
            VoiceSettings = new VoiceSettings
            {
                Stability = 0.5,
                SimilarityBoost = 0.75,
                Style = 0.0,
                UseSpeakerBoost = true
            }
        };

        var jsonContent = JsonSerializer.Serialize(requestBody, new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower
        });

        var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new StringContent(jsonContent, Encoding.UTF8, "application/json")
        };
        request.Headers.Add("xi-api-key", _apiKey);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        try
        {
            var response = await _httpClient.SendAsync(request);
            
            if (!response.IsSuccessStatusCode)
            {
                var errorContent = await response.Content.ReadAsStringAsync();
                _logger.LogError("ElevenLabs API error: {StatusCode} - {Error}", response.StatusCode, errorContent);
                throw new HttpRequestException($"ElevenLabs API error: {response.StatusCode} - {errorContent}");
            }

            var responseContent = await response.Content.ReadAsStringAsync();
            var elevenLabsResponse = JsonSerializer.Deserialize<ElevenLabsTimestampResponse>(responseContent, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            });

            if (elevenLabsResponse == null)
            {
                throw new InvalidOperationException("Failed to parse ElevenLabs response");
            }

            // Decode base64 audio
            var audioData = Convert.FromBase64String(elevenLabsResponse.AudioBase64);

            // Convert alignment to word timings
            var wordTimings = new List<WordTiming>();
            if (elevenLabsResponse.Alignment != null)
            {
                for (int i = 0; i < elevenLabsResponse.Alignment.Characters.Count; i++)
                {
                    var character = elevenLabsResponse.Alignment.Characters[i];
                    var startTime = elevenLabsResponse.Alignment.CharacterStartTimesSeconds[i];
                    var endTime = elevenLabsResponse.Alignment.CharacterEndTimesSeconds[i];

                    // Group characters into words (split on spaces)
                    if (character == " " || i == elevenLabsResponse.Alignment.Characters.Count - 1)
                    {
                        continue;
                    }

                    // Find word boundaries
                    if (i == 0 || elevenLabsResponse.Alignment.Characters[i - 1] == " ")
                    {
                        // Start of a new word
                        var wordBuilder = new StringBuilder();
                        var wordStartTime = startTime;
                        var wordEndTime = endTime;

                        for (int j = i; j < elevenLabsResponse.Alignment.Characters.Count; j++)
                        {
                            var c = elevenLabsResponse.Alignment.Characters[j];
                            if (c == " ")
                            {
                                break;
                            }
                            wordBuilder.Append(c);
                            wordEndTime = elevenLabsResponse.Alignment.CharacterEndTimesSeconds[j];
                        }

                        var word = wordBuilder.ToString().Trim();
                        if (!string.IsNullOrEmpty(word))
                        {
                            wordTimings.Add(new WordTiming
                            {
                                Word = word,
                                StartTime = wordStartTime,
                                EndTime = wordEndTime
                            });
                        }
                    }
                }
            }

            _logger.LogInformation("TTS conversion successful. Audio size: {Size} bytes, Word timings: {Count}", 
                audioData.Length, wordTimings.Count);

            return new TtsResult
            {
                AudioData = audioData,
                ContentType = "audio/mpeg",
                WordTimings = wordTimings
            };
        }
        catch (HttpRequestException ex)
        {
            _logger.LogError(ex, "HTTP error calling ElevenLabs API");
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error converting text to speech");
            throw;
        }
    }

    public async Task<List<(string Id, string Name)>> GetAvailableVoicesAsync()
    {
        var url = $"{_baseUrl}/voices";
        var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Add("xi-api-key", _apiKey);

        var response = await _httpClient.SendAsync(request);
        response.EnsureSuccessStatusCode();

        var responseContent = await response.Content.ReadAsStringAsync();
        var voicesResponse = JsonSerializer.Deserialize<VoicesResponse>(responseContent, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        });

        if (voicesResponse?.Voices == null)
        {
            return new List<(string Id, string Name)>();
        }

        return voicesResponse.Voices.Select(v => (v.VoiceId, v.Name)).ToList();
    }

    #region ElevenLabs API Models

    private class ElevenLabsRequest
    {
        [JsonPropertyName("text")]
        public string Text { get; set; } = string.Empty;

        [JsonPropertyName("model_id")]
        public string ModelId { get; set; } = string.Empty;

        [JsonPropertyName("voice_settings")]
        public VoiceSettings VoiceSettings { get; set; } = new();
    }

    private class VoiceSettings
    {
        [JsonPropertyName("stability")]
        public double Stability { get; set; }

        [JsonPropertyName("similarity_boost")]
        public double SimilarityBoost { get; set; }

        [JsonPropertyName("style")]
        public double Style { get; set; }

        [JsonPropertyName("use_speaker_boost")]
        public bool UseSpeakerBoost { get; set; }
    }

    private class ElevenLabsTimestampResponse
    {
        [JsonPropertyName("audio_base64")]
        public string AudioBase64 { get; set; } = string.Empty;

        [JsonPropertyName("alignment")]
        public AlignmentData? Alignment { get; set; }
    }

    private class AlignmentData
    {
        [JsonPropertyName("characters")]
        public List<string> Characters { get; set; } = new();

        [JsonPropertyName("character_start_times_seconds")]
        public List<double> CharacterStartTimesSeconds { get; set; } = new();

        [JsonPropertyName("character_end_times_seconds")]
        public List<double> CharacterEndTimesSeconds { get; set; } = new();
    }

    private class VoicesResponse
    {
        [JsonPropertyName("voices")]
        public List<VoiceInfo> Voices { get; set; } = new();
    }

    private class VoiceInfo
    {
        [JsonPropertyName("voice_id")]
        public string VoiceId { get; set; } = string.Empty;

        [JsonPropertyName("name")]
        public string Name { get; set; } = string.Empty;
    }

    #endregion
}
