using EbookReader.Core.Interfaces;
using EbookReader.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using System.Text.RegularExpressions;

namespace EbookReader.API.Controllers;

/// <summary>
/// Controller for Text-to-Speech functionality using ElevenLabs
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public partial class TtsController : ControllerBase
{
    private readonly ITtsService _ttsService;
    private readonly EbookReaderDbContext _dbContext;
    private readonly ILogger<TtsController> _logger;

    public TtsController(ITtsService ttsService, EbookReaderDbContext dbContext, ILogger<TtsController> logger)
    {
        _ttsService = ttsService;
        _dbContext = dbContext;
        _logger = logger;
    }

    /// <summary>
    /// Converts text to speech with word-level timing information
    /// </summary>
    [HttpPost("convert")]
    public async Task<ActionResult<TtsResponse>> ConvertTextToSpeech([FromBody] TtsRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Text))
        {
            return BadRequest(new { message = "Text is required" });
        }

        // Limit text length to prevent abuse (max ~5000 characters per request)
        if (request.Text.Length > 5000)
        {
            return BadRequest(new { message = "Text too long. Maximum 5000 characters per request." });
        }

        try
        {
            // Strip HTML tags for TTS processing
            var plainText = StripHtmlTags(request.Text);
            
            var result = await _ttsService.ConvertTextToSpeechAsync(
                plainText, 
                request.VoiceId, 
                request.Speed ?? 1.0);

            // Return audio as base64 along with word timings
            return Ok(new TtsResponse
            {
                AudioBase64 = Convert.ToBase64String(result.AudioData),
                ContentType = result.ContentType,
                WordTimings = result.WordTimings.Select(w => new WordTimingDto
                {
                    Word = w.Word,
                    StartTime = w.StartTime,
                    EndTime = w.EndTime
                }).ToList()
            });
        }
        catch (HttpRequestException ex)
        {
            _logger.LogError(ex, "Error calling TTS service");
            return StatusCode(502, new { message = "Error communicating with TTS service" });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error converting text to speech");
            return StatusCode(500, new { message = "Error converting text to speech" });
        }
    }

    /// <summary>
    /// Converts a specific chapter section to speech
    /// </summary>
    [HttpPost("books/{bookId}/chapters/{chapterNumber}/convert")]
    public async Task<ActionResult<TtsResponse>> ConvertChapterSection(
        Guid bookId, 
        int chapterNumber, 
        [FromBody] ChapterTtsRequest request)
    {
        var userId = Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

        // Verify book ownership
        var book = await _dbContext.Books
            .Include(b => b.Chapters)
            .FirstOrDefaultAsync(b => b.Id == bookId && b.UserId == userId);

        if (book == null)
        {
            return NotFound(new { message = "Book not found" });
        }

        var chapter = book.Chapters.FirstOrDefault(c => c.ChapterNumber == chapterNumber);
        if (chapter == null)
        {
            return NotFound(new { message = "Chapter not found" });
        }

        // Extract the requested section
        var content = chapter.Content;
        var startIndex = Math.Max(0, request.StartIndex);
        var endIndex = Math.Min(content.Length, request.EndIndex);
        var sectionText = content.Substring(startIndex, endIndex - startIndex);

        // Strip HTML and limit length
        var plainText = StripHtmlTags(sectionText);
        if (plainText.Length > 5000)
        {
            plainText = plainText.Substring(0, 5000);
        }

        try
        {
            var result = await _ttsService.ConvertTextToSpeechAsync(
                plainText, 
                request.VoiceId, 
                request.Speed ?? 1.0);

            return Ok(new TtsResponse
            {
                AudioBase64 = Convert.ToBase64String(result.AudioData),
                ContentType = result.ContentType,
                WordTimings = result.WordTimings.Select(w => new WordTimingDto
                {
                    Word = w.Word,
                    StartTime = w.StartTime,
                    EndTime = w.EndTime
                }).ToList()
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error converting chapter section to speech");
            return StatusCode(500, new { message = "Error converting text to speech" });
        }
    }

    /// <summary>
    /// Gets available voices from the TTS provider
    /// </summary>
    [HttpGet("voices")]
    public async Task<ActionResult<List<VoiceDto>>> GetVoices()
    {
        try
        {
            var voices = await _ttsService.GetAvailableVoicesAsync();
            return Ok(voices.Select(v => new VoiceDto { Id = v.Id, Name = v.Name }).ToList());
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error getting available voices");
            return StatusCode(500, new { message = "Error getting available voices" });
        }
    }

    private static string StripHtmlTags(string html)
    {
        if (string.IsNullOrEmpty(html))
            return string.Empty;

        // Remove HTML tags
        var withoutTags = HtmlTagRegex().Replace(html, " ");
        
        // Decode common HTML entities
        withoutTags = withoutTags
            .Replace("&nbsp;", " ")
            .Replace("&amp;", "&")
            .Replace("&lt;", "<")
            .Replace("&gt;", ">")
            .Replace("&quot;", "\"")
            .Replace("&#39;", "'")
            .Replace("&apos;", "'");

        // Normalize whitespace
        withoutTags = WhitespaceRegex().Replace(withoutTags, " ").Trim();
        
        return withoutTags;
    }

    [GeneratedRegex("<[^>]+>")]
    private static partial Regex HtmlTagRegex();

    [GeneratedRegex(@"\s+")]
    private static partial Regex WhitespaceRegex();
}

#region DTOs

public class TtsRequest
{
    public string Text { get; set; } = string.Empty;
    public string? VoiceId { get; set; }
    public double? Speed { get; set; }
}

public class ChapterTtsRequest
{
    public int StartIndex { get; set; }
    public int EndIndex { get; set; }
    public string? VoiceId { get; set; }
    public double? Speed { get; set; }
}

public class TtsResponse
{
    public string AudioBase64 { get; set; } = string.Empty;
    public string ContentType { get; set; } = "audio/mpeg";
    public List<WordTimingDto> WordTimings { get; set; } = new();
}

public class WordTimingDto
{
    public string Word { get; set; } = string.Empty;
    public double StartTime { get; set; }
    public double EndTime { get; set; }
}

public class VoiceDto
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
}

#endregion
