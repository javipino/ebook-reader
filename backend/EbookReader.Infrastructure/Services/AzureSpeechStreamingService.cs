using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using Microsoft.CognitiveServices.Speech;
using Microsoft.CognitiveServices.Speech.Audio;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace EbookReader.Infrastructure.Services;

public class AzureSpeechStreamingService
{
    private readonly ILogger<AzureSpeechStreamingService> _logger;
    private readonly string _key;
    private readonly string _region;
    private readonly string _defaultVoiceName;

    public AzureSpeechStreamingService(IConfiguration configuration, ILogger<AzureSpeechStreamingService> logger)
    {
        _logger = logger;
        _key = configuration["AzureSpeech:Key"] ?? string.Empty;
        _region = configuration["AzureSpeech:Region"] ?? string.Empty;
        _defaultVoiceName = configuration["AzureSpeech:DefaultVoiceName"] ?? "en-US-JennyNeural";
    }

    /// <summary>
    /// Streams SSML-enhanced text to speech with word-level timing aligned to the original plain text
    /// </summary>
    /// <param name="ssml">The SSML-enhanced text</param>
    /// <param name="clientWebSocket">WebSocket to stream audio to</param>
    /// <param name="originalText">Original plain text for word alignment (before SSML enhancement)</param>
    /// <param name="ssmlToPlainPositionMap">Mapping from SSML char positions to plain text char positions</param>
    /// <param name="cancellationToken">Cancellation token</param>
    public async Task StreamSsmlToSpeechAsync(
        string ssml,
        WebSocket clientWebSocket,
        string originalText,
        Dictionary<int, int> ssmlToPlainPositionMap,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(ssml))
        {
            throw new ArgumentException("SSML is required", nameof(ssml));
        }

        if (string.IsNullOrWhiteSpace(_key) || string.IsNullOrWhiteSpace(_region))
        {
            throw new InvalidOperationException("Azure Speech is not configured (AzureSpeech:Key/Region)");
        }

        var speechConfig = SpeechConfig.FromSubscription(_key, _region);
        speechConfig.SetSpeechSynthesisOutputFormat(SpeechSynthesisOutputFormat.Audio24Khz160KBitRateMonoMp3);

        using var synthesizer = new SpeechSynthesizer(speechConfig, audioConfig: null);

        _logger.LogInformation("Starting Azure Speech SSML TTS stream for {Length} characters (original: {OriginalLength})", 
            ssml.Length, originalText.Length);

        // Channel for audio chunks
        var audioChannel = Channel.CreateUnbounded<byte[]>(new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = false
        });

        // Channel for word boundary events to send incrementally
        var wordBoundaryChannel = Channel.CreateUnbounded<(string word, int plainTextOffset, int audioOffsetMs, int durationMs)>();

        // Track the last word boundary time for final offset
        var lastWordEndMs = 0;
        var wordBoundaryLock = new object();

        // Prepare character arrays for alignment data
        var chars = originalText.Select(c => c.ToString()).ToList();
        var charStartTimesMs = new int[chars.Count];
        var charDurationsMs = new int[chars.Count];

        // Task to send audio chunks
        var sendAudioTask = Task.Run(async () =>
        {
            await foreach (var audioChunk in audioChannel.Reader.ReadAllAsync(cancellationToken))
            {
                if (audioChunk.Length == 0) continue;
                await clientWebSocket.SendAsync(
                    new ArraySegment<byte>(audioChunk),
                    WebSocketMessageType.Binary,
                    true,
                    cancellationToken);
            }
        }, cancellationToken);

        // Task to send word boundaries incrementally as they arrive
        var sendWordBoundariesTask = Task.Run(async () =>
        {
            await foreach (var (word, plainTextOffset, audioOffsetMs, durationMs) in wordBoundaryChannel.Reader.ReadAllAsync(cancellationToken))
            {
                // Build character timings
                if (plainTextOffset >= 0 && plainTextOffset < chars.Count)
                {
                    var charDuration = durationMs / Math.Max(1, word.Length);
                    for (var i = 0; i < word.Length && plainTextOffset + i < chars.Count; i++)
                    {
                        var charIdx = plainTextOffset + i;
                        charStartTimesMs[charIdx] = audioOffsetMs + (i * charDuration);
                        charDurationsMs[charIdx] = charDuration;
                    }
                }

                // Send word boundary incrementally
                var wordJson = JsonSerializer.Serialize(new
                {
                    type = "wordBoundary",
                    data = new { word, textOffset = plainTextOffset, audioOffsetMs, durationMs }
                });
                try
                {
                    await clientWebSocket.SendAsync(
                        new ArraySegment<byte>(Encoding.UTF8.GetBytes(wordJson)),
                        WebSocketMessageType.Text,
                        true,
                        cancellationToken);
                }
                catch { /* Client may have disconnected */ }
            }
        }, cancellationToken);

        // Handle word boundary events - translate SSML positions to plain text and queue
        var wordBoundaryCount = 0;
        synthesizer.WordBoundary += (s, e) =>
        {
            var word = e.Text;
            var ssmlTextOffset = (int)e.TextOffset;
            // AudioOffset is in 100-nanosecond ticks (same as TimeSpan.Ticks)
            // 1 ms = 10,000 ticks, so divide by 10,000 to get milliseconds
            var audioOffsetTicks = e.AudioOffset;
            var audioOffset = (int)(audioOffsetTicks / 10000); // Convert ticks to milliseconds
            var duration = (int)e.Duration.TotalMilliseconds;

            // Log first few word boundaries for debugging
            wordBoundaryCount++;
            if (wordBoundaryCount <= 5)
            {
                _logger.LogInformation("WordBoundary #{Count}: word='{Word}' ssmlOffset={SsmlOffset} audioTicks={AudioTicks} audioMs={AudioMs} durationMs={DurationMs}",
                    wordBoundaryCount, word, ssmlTextOffset, audioOffsetTicks, audioOffset, duration);
            }

            // Translate SSML position to plain text position
            int plainTextOffset = -1;
            if (ssmlToPlainPositionMap.TryGetValue(ssmlTextOffset, out var exactMatch))
            {
                plainTextOffset = exactMatch;
            }
            else if (ssmlToPlainPositionMap.Count > 0)
            {
                // Find nearest mapped position
                var nearestKey = ssmlToPlainPositionMap.Keys
                    .Where(k => k <= ssmlTextOffset)
                    .OrderByDescending(k => k)
                    .FirstOrDefault();
                if (ssmlToPlainPositionMap.TryGetValue(nearestKey, out var nearestMatch))
                {
                    plainTextOffset = nearestMatch + (ssmlTextOffset - nearestKey);
                }
            }

            // Clamp to valid range
            if (plainTextOffset >= originalText.Length)
            {
                plainTextOffset = Math.Max(0, originalText.Length - word.Length);
            }

            lock (wordBoundaryLock)
            {
                lastWordEndMs = Math.Max(lastWordEndMs, audioOffset + duration);
            }

            wordBoundaryChannel.Writer.TryWrite((word, plainTextOffset, audioOffset, duration));
        };

        synthesizer.Synthesizing += (_, e) =>
        {
            if (cancellationToken.IsCancellationRequested) return;

            var audioData = e.Result?.AudioData;
            if (audioData is { Length: > 0 })
            {
                audioChannel.Writer.TryWrite(audioData.ToArray());
            }
        };

        SpeechSynthesisResult result;
        try
        {
            result = await synthesizer.SpeakSsmlAsync(ssml);
        }
        finally
        {
            audioChannel.Writer.TryComplete();
            wordBoundaryChannel.Writer.TryComplete();
            try
            {
                await Task.WhenAll(sendAudioTask, sendWordBoundariesTask);
            }
            catch
            {
                // Ignore send errors; client may have disconnected.
            }
        }

        if (result.Reason == ResultReason.Canceled)
        {
            var cancellation = SpeechSynthesisCancellationDetails.FromResult(result);
            throw new InvalidOperationException($"Azure Speech synthesis canceled: {cancellation.Reason} {cancellation.ErrorDetails}");
        }

        var actualAudioDurationMs = (int)result.AudioDuration.TotalMilliseconds;
        _logger.LogInformation("Chunk complete: lastWordEndMs={LastWordEnd}ms, actualAudioDuration={ActualDuration}ms, diff={Diff}ms",
            lastWordEndMs, actualAudioDurationMs, actualAudioDurationMs - lastWordEndMs);

        // Send final alignment with ACTUAL audio duration for offset tracking
        // Using lastWordEndMs can cause drift if there are pauses after the last word
        var alignmentJson = JsonSerializer.Serialize(new
        {
            type = "alignment",
            data = new
            {
                chunkDurationMs = actualAudioDurationMs
            }
        });
        var alignmentBytes = Encoding.UTF8.GetBytes(alignmentJson);
        await clientWebSocket.SendAsync(
            new ArraySegment<byte>(alignmentBytes),
            WebSocketMessageType.Text,
            true,
            cancellationToken);

        _logger.LogDebug("SSML synthesis complete, audio duration: {Duration}ms, chars: {CharCount}", 
            result.AudioDuration.TotalMilliseconds, chars.Count);

        // Completion marker
        var completeJson = JsonSerializer.Serialize(new { type = "complete" });
        var completeBytes = Encoding.UTF8.GetBytes(completeJson);
        await clientWebSocket.SendAsync(
            new ArraySegment<byte>(completeBytes),
            WebSocketMessageType.Text,
            true,
            cancellationToken);
    }

    public async Task StreamTextToSpeechAsync(
        string text,
        WebSocket clientWebSocket,
        string? voiceName = null,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            throw new ArgumentException("Text is required", nameof(text));
        }

        if (string.IsNullOrWhiteSpace(_key) || string.IsNullOrWhiteSpace(_region))
        {
            throw new InvalidOperationException("Azure Speech is not configured (AzureSpeech:Key/Region)");
        }

        var effectiveVoiceName = string.IsNullOrWhiteSpace(voiceName) ? _defaultVoiceName : voiceName;

        var speechConfig = SpeechConfig.FromSubscription(_key, _region);
        speechConfig.SpeechSynthesisVoiceName = effectiveVoiceName;
        speechConfig.SetSpeechSynthesisOutputFormat(SpeechSynthesisOutputFormat.Audio24Khz160KBitRateMonoMp3);

        // Note: using null AudioConfig means audio is not played to speakers.
        using var synthesizer = new SpeechSynthesizer(speechConfig, audioConfig: null);

        _logger.LogInformation(
            "Starting Azure Speech TTS stream for {Length} characters with voice {VoiceName}",
            text.Length,
            effectiveVoiceName);

        // Prepare alignment buffers compatible with the existing frontend parser.
        var chars = text.Select(c => c.ToString()).ToList();
        var charStartTimesMs = new int[chars.Count];
        var charDurationsMs = new int[chars.Count];

        var audioChannel = Channel.CreateUnbounded<byte[]>(new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = false
        });

        var sendAudioTask = Task.Run(async () =>
        {
            await foreach (var audioChunk in audioChannel.Reader.ReadAllAsync(cancellationToken))
            {
                if (audioChunk.Length == 0) continue;
                await clientWebSocket.SendAsync(
                    new ArraySegment<byte>(audioChunk),
                    WebSocketMessageType.Binary,
                    true,
                    cancellationToken);
            }
        }, cancellationToken);

        WordBoundaryState? prevBoundary = null;

        synthesizer.WordBoundary += (_, e) =>
        {
            if (cancellationToken.IsCancellationRequested) return;

            // AudioOffset is the start time of this word.
            // In the Speech SDK, AudioOffset is a ulong in 100-nanosecond units.
            var audioOffsetMs = (int)Math.Min(int.MaxValue, e.AudioOffset / 10_000UL);
            var current = new WordBoundaryState(
                TextOffset: (int)e.TextOffset,
                WordLength: (int)e.WordLength,
                AudioOffsetMs: audioOffsetMs);

            if (prevBoundary is { } prev)
            {
                var durationMs = Math.Max(0, current.AudioOffsetMs - prev.AudioOffsetMs);
                FillWordAndGapTimings(text, charStartTimesMs, charDurationsMs, prev, current.TextOffset, durationMs);
            }

            prevBoundary = current;
        };

        synthesizer.Synthesizing += (_, e) =>
        {
            if (cancellationToken.IsCancellationRequested) return;

            var audioData = e.Result?.AudioData;
            if (audioData is { Length: > 0 })
            {
                // Copy because the SDK may reuse internal buffers.
                audioChannel.Writer.TryWrite(audioData.ToArray());
            }
        };

        SpeechSynthesisResult result;
        try
        {
            // This will trigger Synthesizing + WordBoundary events progressively.
            result = await synthesizer.SpeakTextAsync(text);
        }
        finally
        {
            audioChannel.Writer.TryComplete();
            try
            {
                await sendAudioTask;
            }
            catch
            {
                // Ignore send errors; client may have disconnected.
            }
        }

        if (result.Reason == ResultReason.Canceled)
        {
            var cancellation = SpeechSynthesisCancellationDetails.FromResult(result);
            throw new InvalidOperationException($"Azure Speech synthesis canceled: {cancellation.Reason} {cancellation.ErrorDetails}");
        }

        // Finalize last word timings using the overall audio duration.
        if (prevBoundary is { } last)
        {
            var totalMs = (int)Math.Max(0, result.AudioDuration.TotalMilliseconds);
            var durationMs = Math.Max(0, totalMs - last.AudioOffsetMs);
            FillWordAndGapTimings(text, charStartTimesMs, charDurationsMs, last, nextWordOffset: text.Length, durationMs);

            // Any trailing characters after the last word end get a start at end-of-audio.
            var lastEnd = Math.Min(text.Length, last.TextOffset + last.WordLength);
            for (var i = lastEnd; i < text.Length; i++)
            {
                charStartTimesMs[i] = totalMs;
                charDurationsMs[i] = 0;
            }
        }

        // Emit alignment for this chunk.
        var alignmentJson = JsonSerializer.Serialize(new
        {
            type = "alignment",
            data = new
            {
                chars,
                charStartTimesMs = charStartTimesMs.ToList(),
                charDurationsMs = charDurationsMs.ToList()
            }
        });
        var alignmentBytes = Encoding.UTF8.GetBytes(alignmentJson);
        await clientWebSocket.SendAsync(
            new ArraySegment<byte>(alignmentBytes),
            WebSocketMessageType.Text,
            true,
            cancellationToken);

        // Completion marker (frontend uses this to send next chunk).
        var completeJson = JsonSerializer.Serialize(new { type = "complete" });
        var completeBytes = Encoding.UTF8.GetBytes(completeJson);
        await clientWebSocket.SendAsync(
            new ArraySegment<byte>(completeBytes),
            WebSocketMessageType.Text,
            true,
            cancellationToken);
    }

    private static void FillWordAndGapTimings(
        string text,
        int[] charStartTimesMs,
        int[] charDurationsMs,
        WordBoundaryState prev,
        int nextWordOffset,
        int durationMs)
    {
        var startOffset = Math.Clamp(prev.TextOffset, 0, text.Length);
        var endOffset = Math.Clamp(prev.TextOffset + prev.WordLength, 0, text.Length);

        if (endOffset > startOffset && durationMs > 0)
        {
            var len = endOffset - startOffset;
            // Spread the word duration evenly across characters.
            for (var i = 0; i < len; i++)
            {
                var idx = startOffset + i;
                var charStart = prev.AudioOffsetMs + (int)Math.Round((double)i * durationMs / len);
                var charEnd = prev.AudioOffsetMs + (int)Math.Round((double)(i + 1) * durationMs / len);
                charStartTimesMs[idx] = charStart;
                charDurationsMs[idx] = Math.Max(0, charEnd - charStart);
            }
        }
        else
        {
            // Fallback: at least stamp the word start.
            for (var i = startOffset; i < endOffset; i++)
            {
                charStartTimesMs[i] = prev.AudioOffsetMs;
                charDurationsMs[i] = 0;
            }
        }

        // For any characters between previous word end and next word start (spaces/punctuation),
        // set the start time to the end of the previous word.
        var gapStart = endOffset;
        var gapEnd = Math.Clamp(nextWordOffset, 0, text.Length);
        var gapTime = prev.AudioOffsetMs + Math.Max(0, durationMs);
        for (var i = gapStart; i < gapEnd; i++)
        {
            if (charStartTimesMs[i] == 0 && i != 0)
            {
                charStartTimesMs[i] = gapTime;
                charDurationsMs[i] = 0;
            }
        }
    }

    private static string ExtractPlainTextFromSsml(string ssml)
    {
        if (string.IsNullOrEmpty(ssml)) return string.Empty;

        // Remove all SSML tags, keeping only the text content
        var text = System.Text.RegularExpressions.Regex.Replace(
            ssml,
            @"<[^>]+>",
            string.Empty);

        // Decode XML entities
        text = text
            .Replace("&amp;", "&")
            .Replace("&lt;", "<")
            .Replace("&gt;", ">")
            .Replace("&quot;", "\"")
            .Replace("&apos;", "'");

        return text.Trim();
    }

    private sealed record WordBoundaryState(int TextOffset, int WordLength, int AudioOffsetMs);
}
