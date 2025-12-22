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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, []);

  const cleanup = useCallback(() => {
    isStoppedRef.current = true;
    isSourceOpenRef.current = false;
    streamCompleteRef.current = false;
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
    
    console.log(`Sending text chunk ${currentChunkIndexRef.current}/${textChunksRef.current.length}: ${chunk.length} chars`);
    ws.send(JSON.stringify({ text: chunk, voiceId: voiceIdRef.current }));
  }, []);

  const appendNextChunk = useCallback(() => {
    if (!sourceBufferRef.current || !isSourceOpenRef.current) return;
    if (sourceBufferRef.current.updating) return;
    if (pendingChunksRef.current.length === 0) {
      // No more chunks - if stream is complete, end the stream
      if (streamCompleteRef.current && mediaSourceRef.current?.readyState === 'open') {
        try {
          mediaSourceRef.current.endOfStream();
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

    // Store full text and split into words for tracking
    fullTextRef.current = text;
    wordsRef.current = text.split(/\s+/).filter(w => w.length > 0);
    setTotalWords(wordsRef.current.length);
    setCurrentWordIndex(-1);

    // Split text into sentences for progressive loading
    textChunksRef.current = splitTextIntoSentences(text);
    currentChunkIndexRef.current = 0;
    chunkInFlightRef.current = false;
    voiceIdRef.current = voiceId;

    console.log(`Split text into ${textChunksRef.current.length} sentences, ${wordsRef.current.length} words`);
    console.log('Sentences:', textChunksRef.current);

    setIsLoading(true);
    setIsPlaying(false);
    setIsPaused(false);
    setCurrentTime(0);
    setDuration(0);

    let hasStartedPlaying = false;

    const tryStartPlayback = async () => {
      if (hasStartedPlaying || !audioElementRef.current || isStoppedRef.current) return;
      
      const buffered = audioElementRef.current.buffered;
      // Wait for at least 0.3 seconds of buffered audio before playing
      if (buffered.length > 0 && buffered.end(0) > 0.3) {
        hasStartedPlaying = true;
        setIsLoading(false);
        console.log('Starting playback, buffered:', buffered.end(0), 'seconds');
        try {
          await audioElementRef.current.play();
        } catch (e: any) {
          // Handle autoplay restrictions
          if (e.name === 'NotAllowedError') {
            console.warn('Autoplay blocked, waiting for user interaction');
          } else {
            console.error('Error starting playback:', e);
          }
        }
      }
    };

    try {
      // Create MediaSource for streaming playback
      const mediaSource = new MediaSource();
      mediaSourceRef.current = mediaSource;
      
      const audio = new Audio();
      audio.src = URL.createObjectURL(mediaSource);
      audio.playbackRate = speed;
      audioElementRef.current = audio;

      // Wait for MediaSource to open
      await new Promise<void>((resolve, reject) => {
        mediaSource.addEventListener('sourceopen', () => {
          try {
            // Create source buffer for MP3 audio
            const sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
            sourceBufferRef.current = sourceBuffer;
            isSourceOpenRef.current = true;

            // When a chunk finishes appending, try to append next one and maybe start playing
            sourceBuffer.addEventListener('updateend', () => {
              appendNextChunk();
              tryStartPlayback();
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

      // Set up audio event handlers
      audio.onplay = () => {
        setIsPlaying(true);
        setIsPaused(false);
        setIsLoading(false);
      };

      audio.onpause = () => {
        if (!isStoppedRef.current) {
          setIsPlaying(false);
          setIsPaused(true);
        }
      };

      audio.onended = () => {
        setIsPlaying(false);
        setIsPaused(false);
        setCurrentTime(0);
        if (updateIntervalRef.current) {
          clearInterval(updateIntervalRef.current);
        }
        onComplete?.();
      };

      audio.onerror = () => {
        if (!isStoppedRef.current) {
          setIsPlaying(false);
          setIsLoading(false);
          onError?.('Error playing audio');
        }
      };

      // Start progress updates with word tracking
      updateIntervalRef.current = window.setInterval(() => {
        if (audioElementRef.current) {
          const time = audioElementRef.current.currentTime;
          setCurrentTime(time);
          if (audioElementRef.current.duration && isFinite(audioElementRef.current.duration)) {
            setDuration(audioElementRef.current.duration);
          }
          onProgress?.(time, audioElementRef.current.duration || 0);
          
          // Update current word index based on timing
          // A word is highlighted from its startMs until the NEXT word's startMs
          const timeMs = time * 1000;
          const timings = wordTimingsRef.current;
          let wordIndex = -1;
          
          for (let i = 0; i < timings.length; i++) {
            const nextWordStart = i < timings.length - 1 ? timings[i + 1].startMs : Infinity;
            if (timeMs >= timings[i].startMs && timeMs < nextWordStart) {
              wordIndex = i;
              break;
            }
          }
          
          setCurrentWordIndex(wordIndex);
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

        if (event.data instanceof Blob) {
          // Binary audio data - add to queue
          const arrayBuffer = await event.data.arrayBuffer();
          const chunk = new Uint8Array(arrayBuffer);
          
          console.log('Received audio chunk:', chunk.length, 'bytes');
          
          pendingChunksRef.current.push(chunk);

          // Try to append if buffer is ready
          if (sourceBufferRef.current && !sourceBufferRef.current.updating) {
            appendNextChunk();
          }

          // Try to start playback (will check if buffered enough)
          tryStartPlayback();
        } else {
          // Text message (control or alignment)
          try {
            const message = JSON.parse(event.data);
            if (message.type === 'alignment' && message.data) {
              // Process alignment data - convert character timings to word timings
              const { chars, charStartTimesMs, charDurationsMs } = message.data;
              if (chars && charStartTimesMs && charDurationsMs) {
                console.log('Received alignment for', chars.length, 'chars, offset:', alignmentOffsetRef.current);
                
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
                
                console.log('Word timings updated:', wordTimingsRef.current.length, 'words, new offset:', alignmentOffsetRef.current);
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
        if (!isStoppedRef.current) {
          onError?.('WebSocket connection failed');
        }
      };

      ws.onclose = () => {
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
  }, [cleanup, speed, onProgress, onComplete, onError, appendNextChunk, splitTextIntoSentences, sendNextTextChunk]);

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
    if (audioElementRef.current && audioElementRef.current.duration) {
      const newTime = Math.max(0, Math.min(position * audioElementRef.current.duration, audioElementRef.current.duration));
      audioElementRef.current.currentTime = newTime;
      setCurrentTime(newTime);
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
