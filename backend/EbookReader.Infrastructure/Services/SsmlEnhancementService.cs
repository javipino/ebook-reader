using System.ClientModel;
using System.Text;
using Azure;
using Azure.AI.OpenAI;
using EbookReader.Core.Interfaces;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using OpenAI.Chat;

namespace EbookReader.Infrastructure.Services;

/// <summary>
/// Service that uses Azure OpenAI to enhance plain text with SSML tags
/// </summary>
public class SsmlEnhancementService : ISsmlEnhancementService
{
    private readonly ILogger<SsmlEnhancementService> _logger;
    private readonly string _endpoint;
    private readonly string _key;
    private readonly string _deploymentName;

    private const string SystemPrompt = """
        You are an SSML enhancement assistant specialized in Azure Speech text-to-speech.
        Your goal is to subtly improve the naturalness, rhythm, and expressiveness of the TARGET text
        by adding minimal, well-placed SSML tags suitable for long-form narration and audiobooks.

        IMPORTANT RULES:
        1. Return ONLY the content that goes inside the <voice> element.
        Do NOT include <speak>, <voice>, or any outer SSML tags.
        2. Preserve the original text EXACTLY.
        Do NOT rewrite, remove, or replace any words, punctuation, or casing.
        Only insert SSML tags.
        3. Prefer subtlety over dramatization.
        If a tag does not clearly improve naturalness, do NOT add it.
        4. Use pauses (breaks) as the primary tool.
        Prosody and emphasis are secondary and must be used sparingly.
        5. Avoid excessive nesting.
        Never nest more than one SSML tag inside another.
        6. Do NOT add comments, explanations, or extra text.
        Output must be valid SSML content for Azure Speech.

        ────────────────────────
        ALLOWED SSML TAGS & GUIDELINES
        ────────────────────────

        • Pauses (primary tool):
        - Use <break time="250ms"/> for commas or light internal pauses
        - Use <break time="400ms"/> after sentences
        - Use <break time="600ms"/> between paragraphs or major narrative shifts
        - IMPORTANT: Use a SINGLE value, never ranges like "200ms-300ms"
        - Breaks represent silence only (no breathing sounds)

        • Default speaking rate (important):
        - Azure Speech tends to sound slightly fast by default.
        - If no explicit emotional contrast is required, apply a subtle default
            <prosody rate="-7%"> to narrative sentences longer than one clause.
        - Do NOT apply default rate to very short sentences, interjections, or dialogue fragments.
        - Never combine the default rate with other prosody adjustments.

        • Prosody (emotional contrast only):
        - Use prosody sparingly and only when emotional contrast is clearly present.
        - Allowed values:
            - rate: "-5%" to "-12%" (use a single value like rate="-8%")
            - pitch: "+0%" to "+2%" (use a single value like pitch="+1%")
        - Never use extreme, theatrical, or exaggerated values.

        • Emphasis:
        - Use <emphasis level="moderate"> only on emotionally or semantically important words.
        - Use <emphasis level="strong"> very rarely, only for critical narrative moments.
        - Do NOT emphasize full sentences unless absolutely necessary.

        • Dialogue handling:
        - Add a short pause (200-300ms) before and/or after quoted dialogue when it improves flow.
        - Do NOT exaggerate dialogue unless the CONTEXT clearly requires it.

        • Acronyms or spelled-out words:
        - Use <say-as interpret-as="characters"> only when clarity requires spelling letters.

        ────────────────────────
        INPUT STRUCTURE
        ────────────────────────

        You will receive:
        - CONTEXT: Surrounding text to understand emotional tone and narrative flow.
        DO NOT enhance or modify the CONTEXT.
        - TARGET: The exact text chunk to enhance with SSML.
        ONLY enhance this part.

        ────────────────────────
        OUTPUT REQUIREMENTS
        ────────────────────────

        - Enhance ONLY the TARGET text
        - Do NOT include <speak> or <voice> tags
        - Do NOT include explanations or comments
        - Keep the output concise and readable
        - Avoid over-tagging

        ────────────────────────
        GOAL
        ────────────────────────

        The enhanced text should sound calm, human, and naturally narrated,
        with reduced speaking speed, organic pauses, and subtle expressiveness,
        suitable for high-quality audiobook or storytelling content in Azure Speech.
        """;

    public SsmlEnhancementService(IConfiguration configuration, ILogger<SsmlEnhancementService> logger)
    {
        _logger = logger;
        _endpoint = configuration["AzureOpenAI:Endpoint"] ?? string.Empty;
        _key = configuration["AzureOpenAI:Key"] ?? string.Empty;
        _deploymentName = configuration["AzureOpenAI:DeploymentName"] ?? "gpt-5-nano";
    }

    public bool IsConfigured => !string.IsNullOrWhiteSpace(_endpoint) && !string.IsNullOrWhiteSpace(_key);

    public async Task<(string ssmlText, Dictionary<int, int> ssmlToPlainTextPositionMap)> EnhanceWithSsmlAsync(string plainText, string voiceName, string? contextText = null, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(plainText))
        {
            var (ssml, _) = WrapInSsml(plainText, voiceName);
            return (ssml, new Dictionary<int, int>());
        }

        if (!IsConfigured)
        {
            _logger.LogWarning("Azure OpenAI is not configured, returning plain text wrapped in SSML");
            var (ssml, map) = WrapInSsml(AddParagraphBreaks(EscapeForSsml(plainText)), voiceName, plainText);
            return (ssml, map);
        }

        try
        {
            var client = new AzureOpenAIClient(
                new Uri(_endpoint),
                new AzureKeyCredential(_key));

            var chatClient = client.GetChatClient(_deploymentName);

            // Build the prompt with context if provided
            var userPrompt = new StringBuilder();
            
            if (!string.IsNullOrWhiteSpace(contextText))
            {
                userPrompt.AppendLine("CONTEXT (for understanding, do not enhance):");
                userPrompt.AppendLine(contextText);
                userPrompt.AppendLine();
                userPrompt.AppendLine("TARGET (enhance this with SSML tags):");
                userPrompt.AppendLine(plainText);
            }
            else
            {
                userPrompt.AppendLine("Enhance this text with SSML tags:");
                userPrompt.AppendLine();
                userPrompt.AppendLine(plainText);
            }

            var messages = new ChatMessage[]
            {
                new SystemChatMessage(SystemPrompt),
                new UserChatMessage(userPrompt.ToString())
            };

            // Note: GPT-5-nano doesn't support custom temperature or max_tokens parameters
            var options = new ChatCompletionOptions();

            _logger.LogInformation("Sending text to Azure OpenAI for SSML enhancement ({Length} chars, context: {HasContext})", 
                plainText.Length, !string.IsNullOrWhiteSpace(contextText));

            var sw = System.Diagnostics.Stopwatch.StartNew();
            var response = await chatClient.CompleteChatAsync(messages, options, cancellationToken);
            sw.Stop();
            _logger.LogInformation("Azure OpenAI SSML enhancement took {ElapsedMs}ms", sw.ElapsedMilliseconds);

            if (response?.Value?.Content == null || response.Value.Content.Count == 0)
            {
                _logger.LogWarning("Empty response from Azure OpenAI, returning plain text");
                var (ssml, map) = WrapInSsml(AddParagraphBreaks(EscapeForSsml(plainText)), voiceName, plainText);
                return (ssml, map);
            }

            var enhancedContent = response.Value.Content[0].Text ?? string.Empty;

            // Clean up any accidental speak/voice tags the model might have added
            enhancedContent = CleanupSsmlContent(enhancedContent);

            _logger.LogDebug("SSML enhancement complete: {InputLength} -> {OutputLength} chars",
                plainText.Length, enhancedContent.Length);
            
            _logger.LogInformation("Creating position map. Enhanced content length: {EnhancedLen}, Plain text length: {PlainLen}",
                enhancedContent.Length, plainText.Length);

            return WrapInSsml(enhancedContent, voiceName, plainText);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error enhancing text with SSML, falling back to plain text");
            var (ssml, map) = WrapInSsml(AddParagraphBreaks(EscapeForSsml(plainText)), voiceName, plainText);
            return (ssml, map);
        }
    }

    private static (string ssmlText, Dictionary<int, int> positionMap) WrapInSsml(string content, string voiceName, string? originalPlainText = null)
    {
        // Extract language from voice name (e.g., "es-ES-ElviraNeural" -> "es-ES")
        var language = "en-US"; // default
        if (!string.IsNullOrEmpty(voiceName))
        {
            var parts = voiceName.Split('-');
            if (parts.Length >= 2)
            {
                language = $"{parts[0]}-{parts[1]}";
            }
        }

        // Azure Speech SSML format
        var ssml = $"""
            <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="{language}">
                <voice name="{voiceName}">
                    {content}
                </voice>
            </speak>
            """;

        // Create position mapping if we have the original plain text
        var positionMap = new Dictionary<int, int>();
        if (!string.IsNullOrEmpty(originalPlainText) && !string.IsNullOrEmpty(content))
        {
            positionMap = CreatePositionMapping(ssml, content, originalPlainText);
            // Debug log
            Console.WriteLine($"[WrapInSsml] Created position map with {positionMap.Count} entries. " +
                $"SSML length: {ssml.Length}, Content length: {content.Length}, PlainText length: {originalPlainText.Length}");
        }
        else
        {
            Console.WriteLine($"[WrapInSsml] Skipping position map. originalPlainText null/empty: {string.IsNullOrEmpty(originalPlainText)}, " +
                $"content null/empty: {string.IsNullOrEmpty(content)}");
        }

        return (ssml, positionMap);
    }

    /// <summary>
    /// Creates a mapping from SSML character positions to plain text character positions
    /// by finding where text content appears in both strings
    /// </summary>
    private static Dictionary<int, int> CreatePositionMapping(string ssml, string ssmlContent, string plainText)
    {
        var map = new Dictionary<int, int>();
        
        Console.WriteLine($"[CreatePositionMapping] Starting. SSML length: {ssml.Length}, Content length: {ssmlContent.Length}, Plain text length: {plainText.Length}");
        Console.WriteLine($"[CreatePositionMapping] Plain text start: {plainText.Substring(0, Math.Min(50, plainText.Length))}...");
        Console.WriteLine($"[CreatePositionMapping] SSML content start: {ssmlContent.Substring(0, Math.Min(100, ssmlContent.Length))}...");
        
        // Strategy: Walk through both strings, skipping SSML tags, and map matching characters
        int ssmlPos = 0;
        int plainPos = 0;
        bool insideTag = false;

        // Find the start of the voice element content in the SSML
        var voiceContentStart = ssml.IndexOf("<voice", StringComparison.Ordinal);
        if (voiceContentStart >= 0)
        {
            voiceContentStart = ssml.IndexOf('>', voiceContentStart) + 1;
            ssmlPos = voiceContentStart;
            Console.WriteLine($"[CreatePositionMapping] Voice content starts at position {voiceContentStart}");
        }
        else
        {
            Console.WriteLine($"[CreatePositionMapping] Could not find <voice> tag in SSML!");
        }

        while (ssmlPos < ssml.Length && plainPos < plainText.Length)
        {
            char ssmlChar = ssml[ssmlPos];

            // Skip SSML tags
            if (ssmlChar == '<')
            {
                insideTag = true;
                ssmlPos++;
                continue;
            }

            if (insideTag)
            {
                if (ssmlChar == '>')
                {
                    insideTag = false;
                }
                ssmlPos++;
                continue;
            }

            // Handle whitespace normalization - both plain and SSML might have different whitespace
            if (char.IsWhiteSpace(ssmlChar) && plainPos < plainText.Length && char.IsWhiteSpace(plainText[plainPos]))
            {
                map[ssmlPos] = plainPos;
                ssmlPos++;
                plainPos++;
                continue;
            }

            // Skip extra whitespace in either string
            if (char.IsWhiteSpace(ssmlChar))
            {
                ssmlPos++;
                continue;
            }
            if (plainPos < plainText.Length && char.IsWhiteSpace(plainText[plainPos]))
            {
                plainPos++;
                continue;
            }

            // Map matching non-whitespace characters
            if (plainPos < plainText.Length && 
                char.ToLowerInvariant(ssmlChar) == char.ToLowerInvariant(plainText[plainPos]))
            {
                map[ssmlPos] = plainPos;
                ssmlPos++;
                plainPos++;
            }
            else
            {
                // Characters don't match - this might be HTML entity encoding
                // Try to skip it in SSML
                ssmlPos++;
            }
        }

        Console.WriteLine($"[CreatePositionMapping] Completed. Map entries: {map.Count}, Final ssmlPos: {ssmlPos}/{ssml.Length}, Final plainPos: {plainPos}/{plainText.Length}");
        if (map.Count == 0)
        {
            Console.WriteLine($"[CreatePositionMapping] WARNING: Empty map! First few chars of SSML at voice start:");
            var startPos = ssml.IndexOf("<voice", StringComparison.Ordinal);
            if (startPos >= 0)
            {
                startPos = ssml.IndexOf('>', startPos) + 1;
                var preview = ssml.Substring(startPos, Math.Min(100, ssml.Length - startPos));
                Console.WriteLine($"  SSML: '{preview}'");
            }
            Console.WriteLine($"  Plain: '{plainText.Substring(0, Math.Min(100, plainText.Length))}'");
        }

        return map;
    }

    private static string EscapeForSsml(string text)
    {
        if (string.IsNullOrEmpty(text)) return text;

        return text
            .Replace("&", "&amp;")
            .Replace("<", "&lt;")
            .Replace(">", "&gt;")
            .Replace("\"", "&quot;")
            .Replace("'", "&apos;");
    }

    /// <summary>
    /// Adds SSML break tags for paragraph breaks (double newlines) in text.
    /// This ensures proper pauses even when AI enhancement is not used.
    /// </summary>
    private static string AddParagraphBreaks(string text)
    {
        if (string.IsNullOrEmpty(text)) return text;

        // Replace double newlines (paragraph breaks) with SSML break
        text = System.Text.RegularExpressions.Regex.Replace(
            text,
            @"\n\n+",
            " <break time=\"600ms\"/> ");
        
        // Replace remaining single newlines with space
        text = text.Replace("\n", " ");
        
        // Clean up multiple spaces
        text = System.Text.RegularExpressions.Regex.Replace(text, @"  +", " ");
        
        return text.Trim();
    }

    private static string CleanupSsmlContent(string content)
    {
        if (string.IsNullOrWhiteSpace(content)) return content;

        // Remove any speak or voice tags the model might have added
        content = System.Text.RegularExpressions.Regex.Replace(
            content,
            @"<\/?speak[^>]*>",
            string.Empty,
            System.Text.RegularExpressions.RegexOptions.IgnoreCase);

        content = System.Text.RegularExpressions.Regex.Replace(
            content,
            @"<\/?voice[^>]*>",
            string.Empty,
            System.Text.RegularExpressions.RegexOptions.IgnoreCase);

        // Fix invalid SSML time ranges like "200ms-300ms" -> use first value "200ms"
        // This handles break time, prosody rate, etc.
        content = System.Text.RegularExpressions.Regex.Replace(
            content,
            @"time=""(\d+ms)-\d+ms""",
            @"time=""$1""",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        
        // Fix invalid prosody rate ranges like rate="-6%" to "-8%" -> rate="-7%"
        content = System.Text.RegularExpressions.Regex.Replace(
            content,
            @"rate=""(-?\d+)%""\s*to\s*""-?\d+%""",
            @"rate=""$1%""",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase);

        return content.Trim();
    }
}
