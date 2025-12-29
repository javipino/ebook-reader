namespace EbookReader.Core.Interfaces;

/// <summary>
/// Service for enhancing plain text with SSML tags using AI
/// </summary>
public interface ISsmlEnhancementService
{
    /// <summary>
    /// Enhances plain text with SSML tags for improved TTS output
    /// </summary>
    /// <param name="plainText">The plain text to enhance</param>
    /// <param name="voiceName">The voice name to use in the SSML speak element</param>
    /// <param name="contextText">Optional surrounding text for better understanding of tone and emotion</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>Tuple of (SSML-enhanced text, position mapping from SSML char positions to plain text char positions)</returns>
    Task<(string ssmlText, Dictionary<int, int> ssmlToPlainTextPositionMap)> EnhanceWithSsmlAsync(string plainText, string voiceName, string? contextText = null, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Checks if the service is properly configured and available
    /// </summary>
    bool IsConfigured { get; }
}
