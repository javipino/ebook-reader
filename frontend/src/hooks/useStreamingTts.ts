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

  const audioContextRef = useRef<AudioContext | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const audioChunksRef = useRef<Uint8Array[]>([]);
  const isStoppedRef = useRef(false);
  const updateIntervalRef = useRef<number | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, []);

  const cleanup = useCallback(() => {
    isStoppedRef.current = true;

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
      audioElementRef.current.src = '';
      audioElementRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    mediaSourceRef.current = null;
    sourceBufferRef.current = null;
    audioChunksRef.current = [];
  }, []);

  const play = useCallback(async (text: string, voiceId?: string) => {
    // Stop any existing playback
    cleanup();
    isStoppedRef.current = false;

    setIsLoading(true);
    setIsPlaying(false);
    setIsPaused(false);
    setCurrentTime(0);
    setDuration(0);

    try {
      // Collect all audio chunks first, then play
      const audioChunks: Uint8Array[] = [];
      
      // Get WebSocket URL - derive protocol from API URL, not window.location
      const apiUrl = import.meta.env.VITE_API_URL || 'https://localhost:5001';
      const wsProtocol = apiUrl.startsWith('https') ? 'wss:' : 'ws:';
      const wsHost = apiUrl.replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '');
      const wsUrl = `${wsProtocol}//${wsHost}/api/ttsstream/stream`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => {
          // Send the text to convert
          ws.send(JSON.stringify({ text, voiceId }));
        };

        ws.onmessage = async (event) => {
          if (isStoppedRef.current) return;

          if (event.data instanceof Blob) {
            // Binary audio data
            const arrayBuffer = await event.data.arrayBuffer();
            audioChunks.push(new Uint8Array(arrayBuffer));
          } else {
            // Text message (alignment or control)
            try {
              const message = JSON.parse(event.data);
              
              if (message.type === 'complete') {
                resolve();
              } else if (message.type === 'error') {
                reject(new Error(message.message));
              }
            } catch (e) {
              // Ignore parse errors for non-JSON messages
            }
          }
        };

        ws.onerror = () => {
          reject(new Error('WebSocket connection failed'));
        };

        ws.onclose = () => {
          // Resolve if we have audio chunks
          if (audioChunks.length > 0) {
            resolve();
          }
        };

        // Timeout after 60 seconds
        setTimeout(() => {
          if (audioChunks.length > 0) {
            resolve();
          } else {
            reject(new Error('Timeout waiting for audio'));
          }
        }, 60000);
      });

      if (isStoppedRef.current) return;

      // Combine all chunks into a single blob
      const totalLength = audioChunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const combinedArray = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of audioChunks) {
        combinedArray.set(chunk, offset);
        offset += chunk.length;
      }

      const audioBlob = new Blob([combinedArray], { type: 'audio/mpeg' });
      const audioUrl = URL.createObjectURL(audioBlob);

      // Create audio element for playback
      const audio = new Audio(audioUrl);
      audio.playbackRate = speed;
      audioElementRef.current = audio;

      // Set up event handlers
      audio.onloadedmetadata = () => {
        setDuration(audio.duration);
      };

      audio.onplay = () => {
        setIsPlaying(true);
        setIsPaused(false);
        setIsLoading(false);

        // Start progress updates
        updateIntervalRef.current = window.setInterval(() => {
          if (audioElementRef.current) {
            setCurrentTime(audioElementRef.current.currentTime);
            onProgress?.(audioElementRef.current.currentTime, audioElementRef.current.duration);
          }
        }, 100);
      };

      audio.onpause = () => {
        setIsPlaying(false);
        setIsPaused(true);
      };

      audio.onended = () => {
        setIsPlaying(false);
        setIsPaused(false);
        setCurrentTime(0);
        if (updateIntervalRef.current) {
          clearInterval(updateIntervalRef.current);
        }
        URL.revokeObjectURL(audioUrl);
        onComplete?.();
      };

      audio.onerror = () => {
        setIsPlaying(false);
        setIsLoading(false);
        URL.revokeObjectURL(audioUrl);
        onError?.('Error playing audio');
      };

      setIsLoading(false);
      await audio.play();

    } catch (error: any) {
      setIsLoading(false);
      setIsPlaying(false);
      const errorMessage = error.message || 'Failed to stream audio';
      onError?.(errorMessage);
    }
  }, [cleanup, speed, onProgress, onComplete, onError]);

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
      audioElementRef.current.currentTime = Math.min(
        audioElementRef.current.currentTime + seconds,
        audioElementRef.current.duration
      );
      setCurrentTime(audioElementRef.current.currentTime);
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
