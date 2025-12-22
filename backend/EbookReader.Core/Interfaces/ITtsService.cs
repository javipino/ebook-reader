namespace EbookReader.Core.Interfaces;

/// <summary>
/// Represents a word with its timing information for synchronized playback
/// </summary>
public class WordTiming
{
    public string Word { get; set; } = string.Empty;
    public double StartTime { get; set; }
    public double EndTime { get; set; }
}

/// <summary>
/// Represents the result of a text-to-speech conversion
/// </summary>
public class TtsResult
{
    public byte[] AudioData { get; set; } = Array.Empty<byte>();
    public string ContentType { get; set; } = "audio/mpeg";
    public List<WordTiming> WordTimings { get; set; } = new();
}

/// <summary>
/// Service interface for text-to-speech conversion
/// </summary>
public interface ITtsService
{
    /// <summary>
    /// Converts text to speech with word-level timing information
    /// </summary>
    /// <param name="text">The text to convert to speech</param>
    /// <param name="voiceId">Optional voice ID (uses default if not specified)</param>
    /// <param name="speed">Playback speed multiplier (0.5 to 2.0)</param>
    /// <returns>TTS result with audio data and word timings</returns>
    Task<TtsResult> ConvertTextToSpeechAsync(string text, string? voiceId = null, double speed = 1.0);

    /// <summary>
    /// Gets available voices from the TTS provider
    /// </summary>
    /// <returns>List of available voice IDs and names</returns>
    Task<List<(string Id, string Name)>> GetAvailableVoicesAsync();
}
