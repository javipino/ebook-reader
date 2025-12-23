import { useState, useCallback, useRef, useEffect } from 'react';

export interface UseStreamingTtsOptions {
  onProgress?: (currentTime: number, duration: number) => void;
  onComplete?: () => void;
  onError?: (error: string) => void;
}

export interface UseStreamingTtsReturn {
  isPlaying: boolean;
  isLoading: boolean;
  isPaused: boolean;
  currentTime: number;
  duration: number;
  currentWordIndex: number;
  totalWords: number;
  play: (text: string, voiceId?: string) => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  seekForward: (seconds?: number) => void;
  seekBackward: (seconds?: number) => void;
  seekToPosition: (position: number) => void;
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
  
  // For progressive text chunking
  const textChunksRef = useRef<string[]>([]);
  const currentChunkIndexRef = useRef(0);
  const chunkInFlightRef = useRef(false);
  const voiceIdRef = useRef<string | undefined>(undefined);
  
  // For word tracking
  const fullTextRef = useRef<string>('');
  const wordsRef = useRef<string[]>([]);
  const wordTimingsRef = useRef<{ startMs: number; endMs: number }[]>([]);
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
    textChunksRef.current = [];
    currentChunkIndexRef.current = 0;
    chunkInFlightRef.current = false;
    wordTimingsRef.current = [];
    alignmentOffsetRef.current = 0;

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

  // Split text into sentences (at . ! ? or newlines)
  const splitTextIntoSentences = useCallback((text: string): string[] => {
    const chunks: string[] = [];
    
    // Split on sentence endings followed by space/newline, or on newlines
    // Keep the punctuation with the sentence
    const sentences = text.split(/(?<=[.!?])\s+|(?<=\n)/);
    
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

  // Send the next text chunk to TTS
  const sendNextTextChunk = useCallback(() => {
    if (isStoppedRef.current) return;
    if (chunkInFlightRef.current) return;
    if (currentChunkIndexRef.current >= textChunksRef.current.length) {
      // All chunks sent
      return;
    }
    
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    
    const chunk = textChunksRef.current[currentChunkIndexRef.current];
    currentChunkIndexRef.current++;
    chunkInFlightRef.current = true;

    ws.send(JSON.stringify({ text: chunk, voiceId: voiceIdRef.current }));
  }, []);

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

  const play = useCallback(async (text: string, voiceId?: string) => {
    // Stop any existing playback
    cleanup();
    isStoppedRef.current = false;
    streamCompleteRef.current = false;
    endOfStreamCalledRef.current = false;

    const sessionId = ++sessionIdRef.current;
    activeSessionIdRef.current = sessionId;

    // Store full text and split into words for tracking
    fullTextRef.current = text;
    wordsRef.current = text.split(/\s+/).filter(w => w.length > 0);
    setTotalWords(wordsRef.current.length);
    setCurrentWordIndex(-1);

    // Split text into sentence-like chunks and group them to reduce WebSocket messages.
    // (Smaller chunks = faster first audio, larger chunks = fewer messages.)
    const sentences = splitTextIntoSentences(text);
    textChunksRef.current = chunkSentences(sentences, 900);
    currentChunkIndexRef.current = 0;
    chunkInFlightRef.current = false;
    voiceIdRef.current = voiceId;

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

          // Update current word index based on timing.
          // Keep a word highlighted until the next word starts.
          const timeMs = time * 1000;
          const wordIndex = findWordIndexAtTimeMs(timeMs);
          if (wordIndex !== lastEmittedWordIndexRef.current) {
            lastEmittedWordIndexRef.current = wordIndex;
            setCurrentWordIndex(wordIndex);
          }
        }
      }, 50); // Update more frequently for smoother word tracking

      // Connect to WebSocket and start streaming
      const apiUrl = import.meta.env.VITE_API_URL || 'https://localhost:5001';
      const wsProtocol = apiUrl.startsWith('https') ? 'wss:' : 'ws:';
      const wsHost = apiUrl.replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '');
      const wsUrl = `${wsProtocol}//${wsHost}/api/ttsstream/stream`;

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
            if (message.type === 'alignment' && message.data) {
              // Process alignment data - convert character timings to word timings
              const { chars, charStartTimesMs, charDurationsMs } = message.data;
              if (chars && charStartTimesMs && charDurationsMs) {
                // Build words from characters and their timings
                let currentWord = '';
                let wordStartMs = 0;
                const baseOffset = alignmentOffsetRef.current;
                
                for (let i = 0; i < chars.length; i++) {
                  const char = chars[i];
                  const startMs = charStartTimesMs[i] + baseOffset;
                  
                  if (char === ' ' || char === '\n' || char === '\t') {
                    // End of word
                    if (currentWord.length > 0) {
                      wordTimingsRef.current.push({
                        startMs: wordStartMs,
                        endMs: startMs
                      });
                      currentWord = '';
                    }
                  } else {
                    if (currentWord.length === 0) {
                      wordStartMs = startMs;
                    }
                    currentWord += char;
                  }
                }
                
                // Don't forget the last word
                if (currentWord.length > 0 && chars.length > 0) {
                  const lastCharIndex = chars.length - 1;
                  wordTimingsRef.current.push({
                    startMs: wordStartMs,
                    endMs: charStartTimesMs[lastCharIndex] + charDurationsMs[lastCharIndex] + baseOffset
                  });
                }
                
                // Update offset for next chunk - use the end time of the last character
                if (chars.length > 0) {
                  const lastIdx = chars.length - 1;
                  alignmentOffsetRef.current = baseOffset + charStartTimesMs[lastIdx] + charDurationsMs[lastIdx];
                }
              }
            } else if (message.type === 'complete') {
              // Current text chunk is done - send next one
              chunkInFlightRef.current = false;
              
              if (currentChunkIndexRef.current >= textChunksRef.current.length) {
                // All text chunks sent and processed
                streamCompleteRef.current = true;
                if (pendingChunksRef.current.length === 0 && !sourceBufferRef.current?.updating) {
                  appendNextChunk(); // This will trigger endOfStream
                }
              } else {
                // Send next text chunk
                sendNextTextChunk();
              }
            } else if (message.type === 'error') {
              onError?.(message.message);
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
        onError?.('WebSocket connection failed');
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

  return {
    isPlaying,
    isLoading,
    isPaused,
    currentTime,
    duration,
    currentWordIndex,
    totalWords,
    play,
    pause,
    resume,
    stop,
    seekForward,
    seekBackward,
    seekToPosition,
    setSpeed,
    speed
  };
}

export default useStreamingTts;
