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

    private sealed record WordBoundaryState(int TextOffset, int WordLength, int AudioOffsetMs);
}
