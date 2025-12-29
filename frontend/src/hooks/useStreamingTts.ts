import { useState, useCallback, useRef, useEffect } from 'react';

export interface UseStreamingTtsOptions {
  onProgress?: (currentTime: number, duration: number) => void;
  onComplete?: () => void;
  onError?: (error: string) => void;
}

export interface StreamingTtsSegmentOptions {
  onSegmentComplete?: () => void;
  /** Context text (e.g., surrounding pages/chapter) for AI SSML enhancement */
  context?: string;
}

export interface StreamingTtsPlayOptions extends StreamingTtsSegmentOptions {
  voiceId?: string;
  provider?: 'elevenlabs' | 'azure';
  voiceName?: string;
}

export interface UseStreamingTtsReturn {
  isPlaying: boolean;
  isLoading: boolean;
  isPaused: boolean;
  currentTime: number;
  duration: number;
  currentWordIndex: number;
  totalWords: number;
  play: (text: string, voiceIdOrOptions?: string | StreamingTtsPlayOptions, provider?: 'elevenlabs' | 'azure', voiceName?: string) => Promise<void>;
  enqueue: (text: string, options?: StreamingTtsSegmentOptions) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  seekForward: (seconds?: number) => void;
  seekBackward: (seconds?: number) => void;
  seekToPosition: (position: number) => void;
  seekToWord: (localWordIndex: number) => void;
  setSpeed: (speed: number) => void;
  speed: number;
}

export function useStreamingTts(options: UseStreamingTtsOptions = {}): UseStreamingTtsReturn {
  const { onProgress, onComplete, onError } = options;

  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeedState] = useState(1.0);
  const [currentWordIndex, setCurrentWordIndex] = useState(-1);
  const [totalWords, setTotalWords] = useState(0);

  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pendingChunksRef = useRef<Uint8Array[]>([]);
  const isStoppedRef = useRef(false);
  const updateIntervalRef = useRef<number | null>(null);
  const isSourceOpenRef = useRef(false);
  const streamCompleteRef = useRef(false);
  const endOfStreamCalledRef = useRef(false);
  const sessionIdRef = useRef(0);
  const activeSessionIdRef = useRef(0);
  
  type WordTiming = { startMs: number; endMs: number };
  type Segment = {
    originalText: string;
    chunks: string[];
    nextChunkIndex: number;
    wordTimings: WordTiming[];
    onSegmentComplete?: () => void;
    /** Context text for AI SSML enhancement (e.g., chapter content) */
    context?: string;
  };
  type PendingCompletion = {
    audioEndMs: number;
    wordIndexEnd: number; // global word index at end of this segment
    wordCount: number;    // how many words in this segment (for display)
    callback: () => void;
  };

  // For progressive streaming: queue segments (pages) and stream them back-to-back on one session.
  const segmentQueueRef = useRef<Segment[]>([]);
  const activeSegmentRef = useRef<Segment | null>(null);
  const chunkInFlightRef = useRef(false);
  // Pending segment completions: fire callback when audio playback reaches audioEndMs
  const pendingCompletionsRef = useRef<PendingCompletion[]>([]);
  // Track incomplete sentences that span page boundaries
  const incompleteSentenceRef = useRef<string>('');
  // Track word index offset for the currently DISPLAYED segment (based on audio time)
  const displayedSegmentWordOffsetRef = useRef(0);
  const displayedSegmentWordCountRef = useRef(0);
  const voiceIdRef = useRef<string | undefined>(undefined);
  const providerRef = useRef<'elevenlabs' | 'azure' | undefined>(undefined);
  const voiceNameRef = useRef<string | undefined>(undefined);
  // Track recently sent chunks for context (last ~500 chars)
  const recentSentTextRef = useRef<string>('');
  
  // For word tracking
  const wordsRef = useRef<string[]>([]);
  const wordTimingsRef = useRef<WordTiming[]>([]);
  const alignmentOffsetRef = useRef(0); // Track cumulative time offset for multiple chunks
  const lastEmittedWordIndexRef = useRef<number>(-2);

  const findWordIndexAtTimeMs = useCallback((timeMs: number) => {
    const timings = wordTimingsRef.current;
    if (timings.length === 0) return -1;

    // Find the last word whose start time is <= current time.
    // This naturally keeps the current word highlighted until the NEXT word starts.
    let lo = 0;
    let hi = timings.length - 1;
    let result = -1;

    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (timings[mid].startMs <= timeMs) {
        result = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    return result;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, []);

  const cleanup = useCallback(() => {
    // Invalidate any in-flight async handlers from a previous play.
    activeSessionIdRef.current = ++sessionIdRef.current;

    isStoppedRef.current = true;
    isSourceOpenRef.current = false;
    streamCompleteRef.current = false;
    endOfStreamCalledRef.current = false;
    segmentQueueRef.current = [];
    activeSegmentRef.current = null;
    chunkInFlightRef.current = false;
    pendingCompletionsRef.current = [];
    displayedSegmentWordOffsetRef.current = 0;
    displayedSegmentWordCountRef.current = 0;
    wordTimingsRef.current = [];
    alignmentOffsetRef.current = 0;
    incompleteSentenceRef.current = '';
    recentSentTextRef.current = '';

    if (updateIntervalRef.current) {
      clearInterval(updateIntervalRef.current);
      updateIntervalRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    if (audioElementRef.current) {
      audioElementRef.current.pause();
      if (audioElementRef.current.src) {
        URL.revokeObjectURL(audioElementRef.current.src);
      }
      audioElementRef.current.src = '';
      audioElementRef.current = null;
    }

    if (sourceBufferRef.current && mediaSourceRef.current) {
      try {
        if (mediaSourceRef.current.readyState === 'open') {
          sourceBufferRef.current.abort();
        }
      } catch (e) {
        // Ignore errors during cleanup
      }
    }

    mediaSourceRef.current = null;
    sourceBufferRef.current = null;
    pendingChunksRef.current = [];
  }, []);

  const normalizeTextForTts = useCallback((text: string) => {
    // Normalize whitespace for TTS. Backend will handle pauses via SSML.
    // Keep paragraph breaks (double newlines) as single newlines for backend to process.
    let t = text.replace(/\r\n/g, '\n');
    t = t.replace(/\u00A0/g, ' '); // nbsp
    // Convert multiple newlines to double newline (paragraph marker)
    t = t.replace(/\n{2,}/g, '\n\n');
    // Convert single newlines to space (same sentence)
    t = t.replace(/(?<!\n)\n(?!\n)/g, ' ');
    // Collapse multiple spaces
    t = t.replace(/  +/g, ' ');
    return t.trim();
  }, []);

  // Split text into sentences (at . ! ?)
  const splitTextIntoSentences = useCallback((text: string): string[] => {
    const chunks: string[] = [];
    
    // Split on sentence endings followed by whitespace.
    // Keep the punctuation with the sentence.
    const sentences = text.split(/(?<=[.!?])\s+/);
    
    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      if (trimmed.length > 0) {
        chunks.push(trimmed);
      }
    }
    
    return chunks;
  }, []);

  const chunkSentences = useCallback((sentences: string[], maxChars: number): string[] => {
    const chunks: string[] = [];
    let current = '';

    for (const sentence of sentences) {
      const candidate = current ? `${current} ${sentence}` : sentence;
      if (candidate.length <= maxChars) {
        current = candidate;
      } else {
        if (current) chunks.push(current);
        // If a single sentence is longer than maxChars, send it as-is.
        current = sentence;
      }
    }

    if (current) chunks.push(current);
    return chunks;
  }, []);

  const activateSegment = useCallback((segment: Segment) => {
    activeSegmentRef.current = segment;
    // DON'T reset wordTimingsRef - keep accumulating globally.
    // DON'T reset currentWordIndex - it will be updated based on audio time.
    // Just track that this segment is now being sent.
    wordsRef.current = segment.originalText.split(/\s+/).filter(w => w.length > 0);
  }, []);

  const getOrActivateSegment = useCallback(() => {
    if (activeSegmentRef.current) return activeSegmentRef.current;
    const next = segmentQueueRef.current.shift() ?? null;
    if (next) activateSegment(next);
    return next;
  }, [activateSegment]);

  // Send the next text chunk to TTS
  const sendNextTextChunk = useCallback(() => {
    if (isStoppedRef.current) return;
    if (chunkInFlightRef.current) return;

    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    // Advance across completed segments until we find a chunk to send.
    while (true) {
      const segment = getOrActivateSegment();

      if (!segment) {
        // Nothing left to send.
        streamCompleteRef.current = true;
        if (
          pendingChunksRef.current.length === 0 &&
          !sourceBufferRef.current?.updating &&
          !endOfStreamCalledRef.current &&
          mediaSourceRef.current?.readyState === 'open'
        ) {
          try {
            mediaSourceRef.current.endOfStream();
            endOfStreamCalledRef.current = true;
          } catch {
            // Ignore
          }
        }
        return;
      }

      if (segment.nextChunkIndex < segment.chunks.length) {
        const chunk = segment.chunks[segment.nextChunkIndex];
        segment.nextChunkIndex++;
        chunkInFlightRef.current = true;

        // Use segment's context if provided, otherwise fall back to recently sent text
        const contextText = segment.context || recentSentTextRef.current.slice(-500) || '';

        const payload: any = { 
          text: chunk,
          contextText: contextText
        };
        if (voiceIdRef.current) payload.voiceId = voiceIdRef.current;
        if (providerRef.current) payload.provider = providerRef.current;
        if (voiceNameRef.current) payload.voiceName = voiceNameRef.current;

        // Update recent text with what we just sent (for fallback context)
        recentSentTextRef.current = (recentSentTextRef.current + ' ' + chunk).slice(-1000);

        ws.send(JSON.stringify(payload));
        return;
      }

      // Segment is fully sent; queue completion for when audio reaches this point.
      // DON'T call onSegmentComplete now - wait until audio has actually played.
      const wordIndexEnd = wordTimingsRef.current.length;
      const wordCount = segment.originalText.split(/\s+/).filter(w => w.length > 0).length;
      pendingCompletionsRef.current.push({
        audioEndMs: alignmentOffsetRef.current,
        wordIndexEnd,
        wordCount,
        callback: segment.onSegmentComplete || (() => {})
      });
      activeSegmentRef.current = null;
    }
  }, [getOrActivateSegment]);

  const appendNextChunk = useCallback(() => {
    if (!sourceBufferRef.current || !isSourceOpenRef.current) return;
    if (sourceBufferRef.current.updating) return;
    if (pendingChunksRef.current.length === 0) {
      // No more chunks - if stream is complete, end the stream
      if (
        streamCompleteRef.current &&
        !endOfStreamCalledRef.current &&
        mediaSourceRef.current?.readyState === 'open'
      ) {
        try {
          mediaSourceRef.current.endOfStream();
          endOfStreamCalledRef.current = true;
        } catch (e) {
          // Ignore
        }
      }
      return;
    }

    const chunk = pendingChunksRef.current.shift();
    if (chunk) {
      try {
        sourceBufferRef.current.appendBuffer(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer);
      } catch (e) {
        console.error('Error appending buffer:', e);
      }
    }
  }, []);

  const enqueue = useCallback((text: string, segOptions?: StreamingTtsSegmentOptions) => {
    if (isStoppedRef.current) return;

    let normalized = normalizeTextForTts(text);
    if (!normalized) return;

    // Prepend any incomplete sentence from the previous segment
    if (incompleteSentenceRef.current) {
      normalized = incompleteSentenceRef.current + ' ' + normalized;
      incompleteSentenceRef.current = '';
    }

    // Check if text ends with sentence-ending punctuation
    // If not, extract the trailing incomplete sentence for the next segment
    const sentenceEndMatch = normalized.match(/^(.*)([.!?])\s*([^.!?]*)$/s);
    if (sentenceEndMatch && sentenceEndMatch[3].trim()) {
      // Text has a complete part and a trailing incomplete part
      const completeText = sentenceEndMatch[1] + sentenceEndMatch[2];
      incompleteSentenceRef.current = sentenceEndMatch[3].trim();
      normalized = completeText.trim();
      console.log(`[TTS] Split at sentence boundary. Complete: ${normalized.length} chars, Incomplete carried over: ${incompleteSentenceRef.current.length} chars`);
    } else if (!normalized.match(/[.!?]\s*$/)) {
      // Text doesn't end with sentence punctuation at all - but we'll send it anyway
      // and hope the next segment completes it
      console.log(`[TTS] Text doesn't end with sentence punctuation: "...${normalized.slice(-30)}"`);
    }

    if (!normalized) return;

    const sentences = splitTextIntoSentences(normalized);
    const chunks = chunkSentences(sentences, 900);
    
    const segment: Segment = {
      originalText: normalized,
      chunks,
      nextChunkIndex: 0,
      wordTimings: [],
      onSegmentComplete: segOptions?.onSegmentComplete,
      context: segOptions?.context // Use provided context for AI SSML enhancement
    };

    segmentQueueRef.current.push(segment);
    streamCompleteRef.current = false;

    // If we're already connected, kick the sender.
    if (wsRef.current?.readyState === WebSocket.OPEN && !chunkInFlightRef.current) {
      sendNextTextChunk();
    }
  }, [chunkSentences, normalizeTextForTts, sendNextTextChunk, splitTextIntoSentences]);

  const play = useCallback(async (text: string, voiceIdOrOptions?: string | StreamingTtsPlayOptions, provider?: 'elevenlabs' | 'azure', voiceName?: string) => {
    // Stop any existing playback
    cleanup();
    isStoppedRef.current = false;
    streamCompleteRef.current = false;
    endOfStreamCalledRef.current = false;

    const sessionId = ++sessionIdRef.current;
    activeSessionIdRef.current = sessionId;

    let playOptions: StreamingTtsPlayOptions | undefined;
    let resolvedVoiceId: string | undefined;
    let resolvedProvider: 'elevenlabs' | 'azure' | undefined;
    let resolvedVoiceName: string | undefined;

    if (typeof voiceIdOrOptions === 'object' && voiceIdOrOptions !== null) {
      playOptions = voiceIdOrOptions;
      resolvedVoiceId = voiceIdOrOptions.voiceId;
      resolvedProvider = voiceIdOrOptions.provider;
      resolvedVoiceName = voiceIdOrOptions.voiceName;
    } else {
      resolvedVoiceId = voiceIdOrOptions;
      resolvedProvider = provider;
      resolvedVoiceName = voiceName;
    }

    voiceIdRef.current = resolvedVoiceId;
    providerRef.current = resolvedProvider;
    voiceNameRef.current = resolvedVoiceName;
    chunkInFlightRef.current = false;

    // Reset queue/alignment for a fresh continuous session.
    segmentQueueRef.current = [];
    activeSegmentRef.current = null;
    wordTimingsRef.current = [];
    alignmentOffsetRef.current = 0;
    lastEmittedWordIndexRef.current = -2;
    displayedSegmentWordOffsetRef.current = 0;
    pendingCompletionsRef.current = [];  // Clear pending completions
    setCurrentWordIndex(-1);

    // Calculate word count for the first segment and set totalWords
    const firstSegmentWords = text.split(/\\s+/).filter(w => w.length > 0).length;
    displayedSegmentWordCountRef.current = firstSegmentWords;
    setTotalWords(firstSegmentWords);

    enqueue(text, { 
      onSegmentComplete: playOptions?.onSegmentComplete,
      context: playOptions?.context // Pass context for AI SSML enhancement
    });

    setIsLoading(true);
    setIsPlaying(false);
    setIsPaused(false);
    setCurrentTime(0);
    setDuration(0);

    try {
      // Create MediaSource for streaming playback
      const mediaSource = new MediaSource();
      mediaSourceRef.current = mediaSource;
      
      const audio = new Audio();
      audio.src = URL.createObjectURL(mediaSource);
      audio.playbackRate = speed;
      audioElementRef.current = audio;

      // Set up audio event handlers BEFORE calling play().
      // If play() starts immediately, we still want onplay/onpause to update UI state.
      audio.onplay = () => {
        if (activeSessionIdRef.current !== sessionId) return;
        setIsPlaying(true);
        setIsPaused(false);
        setIsLoading(false);
      };

      audio.onpause = () => {
        if (activeSessionIdRef.current !== sessionId) return;
        if (!isStoppedRef.current) {
          setIsPlaying(false);
          setIsPaused(true);
        }
      };

      audio.onended = () => {
        if (activeSessionIdRef.current !== sessionId) return;
        setIsPlaying(false);
        setIsPaused(false);
        setCurrentTime(0);
        if (updateIntervalRef.current) {
          clearInterval(updateIntervalRef.current);
        }
        onComplete?.();
      };

      audio.onerror = () => {
        if (activeSessionIdRef.current !== sessionId) return;
        if (!isStoppedRef.current) {
          setIsPlaying(false);
          setIsLoading(false);
          onError?.('Error playing audio');
        }
      };

      // IMPORTANT: Call play() immediately while still in user gesture call stack.
      // This satisfies browser autoplay policy. Audio will buffer and play once data arrives.
      audio.play().catch((e: any) => {
        if (activeSessionIdRef.current !== sessionId) return;
        if (e.name === 'NotAllowedError') {
          onError?.('Playback blocked by browser autoplay policy');
        } else {
          onError?.('Error starting playback');
        }
      });

      // Wait for MediaSource to open
      await new Promise<void>((resolve, reject) => {
        mediaSource.addEventListener('sourceopen', () => {
          try {
            // Create source buffer for MP3 audio
            const sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
            sourceBufferRef.current = sourceBuffer;
            isSourceOpenRef.current = true;

            // When a chunk finishes appending, try to append next one
            sourceBuffer.addEventListener('updateend', () => {
              appendNextChunk();
            });

            resolve();
          } catch (e) {
            reject(e);
          }
        });

        mediaSource.addEventListener('error', () => {
          reject(new Error('MediaSource error'));
        });

        // Timeout
        setTimeout(() => reject(new Error('MediaSource timeout')), 5000);
      });

      // Start progress updates with word tracking
      updateIntervalRef.current = window.setInterval(() => {
        if (audioElementRef.current) {
          const audio = audioElementRef.current;
          const time = audio.currentTime;
          setCurrentTime(time);
          if (audio.duration && isFinite(audio.duration)) {
            setDuration(audio.duration);
          }
          onProgress?.(time, audio.duration || 0);

          const timeMs = time * 1000;

          // Fire any pending segment completions whose audio has been reached.
          // This ensures UI advances only after the audio for that page has played.
          // Also update word offset/count for correct local highlighting.
          while (pendingCompletionsRef.current.length > 0) {
            const pending = pendingCompletionsRef.current[0];
            if (timeMs >= pending.audioEndMs) {
              pendingCompletionsRef.current.shift();
              // Update displayed segment boundaries BEFORE firing callback
              // (callback may change the page, and we want highlighting to match)
              displayedSegmentWordOffsetRef.current = pending.wordIndexEnd;
              // Set word count from next pending segment, or 0 if none
              const nextPending = pendingCompletionsRef.current[0];
              if (nextPending) {
                displayedSegmentWordCountRef.current = nextPending.wordCount;
                setTotalWords(nextPending.wordCount);
              }
              try {
                pending.callback();
              } catch {
                // Ignore callback errors
              }
            } else {
              break;
            }
          }

          // Update current word index based on timing.
          // Calculate LOCAL word index for the currently displayed segment.
          const globalWordIndex = findWordIndexAtTimeMs(timeMs);
          const localWordIndex = globalWordIndex >= 0 
            ? globalWordIndex - displayedSegmentWordOffsetRef.current 
            : -1;
          
          if (localWordIndex !== lastEmittedWordIndexRef.current) {
            lastEmittedWordIndexRef.current = localWordIndex;
            setCurrentWordIndex(localWordIndex);
            
            // DEBUG: Log timing info when word changes
            if (globalWordIndex >= 0 && globalWordIndex < wordTimingsRef.current.length) {
              const timing = wordTimingsRef.current[globalWordIndex];
              console.log(`[TTS] Highlight word #${globalWordIndex} (local: ${localWordIndex}): timeMs=${timeMs.toFixed(0)}, word.startMs=${timing.startMs}`);
            }
          }
        }
      }, 50); // Update more frequently for smoother word tracking

      // Connect to WebSocket and start streaming
      const apiUrl = import.meta.env.VITE_API_URL || 'https://localhost:5001';
      const wsProtocol = apiUrl.startsWith('https') ? 'wss:' : 'ws:';
      const wsHost = apiUrl.replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '');
      const token = localStorage.getItem('token');
      if (!token) {
        setIsLoading(false);
        setIsPlaying(false);
        setIsPaused(false);
        onError?.('Not authenticated');
        cleanup();
        return;
      }

      const wsUrl = `${wsProtocol}//${wsHost}/api/ttsstream/stream?access_token=${encodeURIComponent(token)}`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        // Send the first text chunk
        sendNextTextChunk();
      };

      ws.onmessage = async (event) => {
        if (isStoppedRef.current) return;
        if (activeSessionIdRef.current !== sessionId) return;

        if (event.data instanceof Blob) {
          // Binary audio data - add to queue
          const arrayBuffer = await event.data.arrayBuffer();
          const chunk = new Uint8Array(arrayBuffer);
          
          pendingChunksRef.current.push(chunk);

          // Try to append if buffer is ready
          if (sourceBufferRef.current && !sourceBufferRef.current.updating) {
            appendNextChunk();
          }
        } else {
          // Text message (control or alignment)
          try {
            const message = JSON.parse(event.data);
            if (message.type === 'wordBoundary' && message.data) {
              // Incremental word boundary - add word timing immediately
              const { audioOffsetMs, durationMs } = message.data;
              const baseOffset = alignmentOffsetRef.current;
              
              // DEBUG: Log first few word timings
              if (wordTimingsRef.current.length < 5) {
                console.log(`[TTS] Word timing #${wordTimingsRef.current.length}: audioOffsetMs=${audioOffsetMs}, baseOffset=${baseOffset}, total=${audioOffsetMs + baseOffset}`);
              }
              
              wordTimingsRef.current.push({
                startMs: audioOffsetMs + baseOffset,
                endMs: audioOffsetMs + durationMs + baseOffset
              });
            } else if (message.type === 'alignment' && message.data) {
              // Final alignment - update offset for next chunk
              const { chunkDurationMs } = message.data;
              console.log(`[TTS] Alignment received: chunkDurationMs=${chunkDurationMs}, current offset=${alignmentOffsetRef.current}`);
              if (chunkDurationMs) {
                alignmentOffsetRef.current += chunkDurationMs;
                console.log(`[TTS] New offset=${alignmentOffsetRef.current}`);
              }
            } else if (message.type === 'complete') {
              // Current text chunk is done - send next one
              chunkInFlightRef.current = false;

              // Let the queued segment sender decide what to do next.
              // When the queue is empty it will mark completion and end the stream.
              sendNextTextChunk();
            } else if (message.type === 'error') {
              // Treat as fatal for this session; otherwise UI can get stuck in loading.
              setIsLoading(false);
              setIsPlaying(false);
              setIsPaused(false);
              onError?.(message.message || 'TTS error');
              cleanup();
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      };

      ws.onerror = () => {
        // Browsers can emit onerror even for normal closes.
        if (isStoppedRef.current) return;
        if (activeSessionIdRef.current !== sessionId) return;
        if (streamCompleteRef.current) return;
        setIsLoading(false);
        setIsPlaying(false);
        setIsPaused(false);
        onError?.('WebSocket connection failed');
        cleanup();
      };

      ws.onclose = () => {
        if (activeSessionIdRef.current !== sessionId) return;
        streamCompleteRef.current = true;
        if (pendingChunksRef.current.length === 0 && !sourceBufferRef.current?.updating) {
          appendNextChunk();
        }
      };

    } catch (error: any) {
      setIsLoading(false);
      setIsPlaying(false);
      const errorMessage = error.message || 'Failed to stream audio';
      onError?.(errorMessage);
    }
  }, [cleanup, speed, onProgress, onComplete, onError, appendNextChunk, splitTextIntoSentences, chunkSentences, sendNextTextChunk, findWordIndexAtTimeMs]);

  const pause = useCallback(() => {
    if (audioElementRef.current && !audioElementRef.current.paused) {
      audioElementRef.current.pause();
    }
  }, []);

  const resume = useCallback(() => {
    if (audioElementRef.current && audioElementRef.current.paused) {
      audioElementRef.current.play();
    }
  }, []);

  const stop = useCallback(() => {
    cleanup();
    setIsPlaying(false);
    setIsPaused(false);
    setIsLoading(false);
    setCurrentTime(0);
    setDuration(0);
  }, [cleanup]);

  const seekForward = useCallback((seconds: number = 10) => {
    if (audioElementRef.current) {
      const newTime = Math.min(
        audioElementRef.current.currentTime + seconds,
        audioElementRef.current.duration || audioElementRef.current.currentTime + seconds
      );
      audioElementRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  }, []);

  const seekBackward = useCallback((seconds: number = 10) => {
    if (audioElementRef.current) {
      audioElementRef.current.currentTime = Math.max(
        audioElementRef.current.currentTime - seconds,
        0
      );
      setCurrentTime(audioElementRef.current.currentTime);
    }
  }, []);

  const setSpeed = useCallback((newSpeed: number) => {
    setSpeedState(newSpeed);
    if (audioElementRef.current) {
      audioElementRef.current.playbackRate = newSpeed;
    }
  }, []);

  const seekToPosition = useCallback((position: number) => {
    const audio = audioElementRef.current;
    if (!audio) return;

    const duration = audio.duration;
    const bufferedEnd = audio.buffered.length > 0 ? audio.buffered.end(audio.buffered.length - 1) : 0;

    // Streaming audio often reports duration as Infinity/NaN until the stream ends.
    // Seek within what we know is available.
    const seekMax = Number.isFinite(duration) ? duration : bufferedEnd;
    if (!seekMax || !Number.isFinite(seekMax) || seekMax <= 0) return;

    const newTime = Math.max(0, Math.min(position * seekMax, seekMax));
    audio.currentTime = newTime;
    setCurrentTime(newTime);
  }, []);

  // Seek to a specific LOCAL word index within the currently displayed segment
  const seekToWord = useCallback((localWordIndex: number) => {
    const audio = audioElementRef.current;
    if (!audio) return;

    // Convert local word index to global word index
    const globalWordIndex = displayedSegmentWordOffsetRef.current + localWordIndex;
    
    // Look up the word timing
    const timings = wordTimingsRef.current;
    if (globalWordIndex < 0 || globalWordIndex >= timings.length) return;

    const timing = timings[globalWordIndex];
    const seekTimeSeconds = timing.startMs / 1000;

    const bufferedEnd = audio.buffered.length > 0 ? audio.buffered.end(audio.buffered.length - 1) : 0;
    if (seekTimeSeconds <= bufferedEnd) {
      audio.currentTime = seekTimeSeconds;
      setCurrentTime(seekTimeSeconds);
    }
  }, []);

  return {
    isPlaying,
    isLoading,
    isPaused,
    currentTime,
    duration,
    currentWordIndex,
    totalWords,
    play,
    enqueue,
    pause,
    resume,
    stop,
    seekForward,
    seekBackward,
    seekToPosition,
    seekToWord,
    setSpeed,
    speed
  };
}

export default useStreamingTts;
