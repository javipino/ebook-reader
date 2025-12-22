import { useState, useCallback, useRef, useEffect } from 'react';
import api from '../services/api';
import { TtsResponse, WordTiming } from '../types';

export interface UseTtsOptions {
  onWordChange?: (wordIndex: number, word: string) => void;
  onChunkComplete?: (chunkIndex: number) => void;
  onAllComplete?: () => void;
  onError?: (error: string) => void;
}

export interface UseTtsReturn {
  isPlaying: boolean;
  isLoading: boolean;
  currentWordIndex: number;
  currentWord: string;
  wordTimings: WordTiming[];
  currentChunkIndex: number;
  totalChunks: number;
  playChunks: (chunks: string[], voiceId?: string, speed?: number) => Promise<void>;
  play: (text: string, voiceId?: string, speed?: number) => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  setSpeed: (speed: number) => void;
}

export function useTts(options: UseTtsOptions = {}): UseTtsReturn {
  const { onWordChange, onChunkComplete, onAllComplete, onError } = options;
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentWordIndex, setCurrentWordIndex] = useState(-1);
  const [currentWord, setCurrentWord] = useState('');
  const [wordTimings, setWordTimings] = useState<WordTiming[]>([]);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const [totalChunks, setTotalChunks] = useState(0);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const wordTimingsRef = useRef<WordTiming[]>([]);
  const chunksQueueRef = useRef<string[]>([]);
  const voiceIdRef = useRef<string | undefined>(undefined);
  const speedRef = useRef<number>(1.0);
  const isStoppedRef = useRef(false);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const updateWordHighlight = useCallback(() => {
    if (!audioRef.current || !wordTimingsRef.current.length) return;
    
    const currentTime = audioRef.current.currentTime;
    
    // Find the current word based on audio time
    let foundIndex = -1;
    for (let i = 0; i < wordTimingsRef.current.length; i++) {
      const timing = wordTimingsRef.current[i];
      if (currentTime >= timing.startTime && currentTime < timing.endTime) {
        foundIndex = i;
        break;
      }
      // Handle gaps between words - show the previous word until the next starts
      if (i < wordTimingsRef.current.length - 1) {
        const nextTiming = wordTimingsRef.current[i + 1];
        if (currentTime >= timing.endTime && currentTime < nextTiming.startTime) {
          foundIndex = i;
          break;
        }
      }
    }

    if (foundIndex !== -1 && foundIndex !== currentWordIndex) {
      const word = wordTimingsRef.current[foundIndex].word;
      setCurrentWordIndex(foundIndex);
      setCurrentWord(word);
      onWordChange?.(foundIndex, word);
    }

    // Continue animation loop if still playing
    if (audioRef.current && !audioRef.current.paused) {
      animationFrameRef.current = requestAnimationFrame(updateWordHighlight);
    }
  }, [currentWordIndex, onWordChange]);

  const playNextChunk = useCallback(async () => {
    if (isStoppedRef.current || chunksQueueRef.current.length === 0) {
      // All chunks complete
      setIsPlaying(false);
      setCurrentWordIndex(-1);
      setCurrentWord('');
      setCurrentChunkIndex(0);
      setTotalChunks(0);
      chunksQueueRef.current = [];
      onAllComplete?.();
      return;
    }

    const chunk = chunksQueueRef.current.shift()!;
    const chunkIdx = totalChunks - chunksQueueRef.current.length - 1;
    setCurrentChunkIndex(chunkIdx);

    try {
      const response = await api.post<TtsResponse>('/api/tts/convert', {
        text: chunk,
        voiceId: voiceIdRef.current,
        speed: speedRef.current
      });

      if (isStoppedRef.current) {
        return; // User stopped playback while loading
      }

      const { audioBase64, contentType, wordTimings: timings } = response.data;
      
      // Store word timings
      setWordTimings(timings);
      wordTimingsRef.current = timings;

      // Create audio element from base64
      const audioBlob = base64ToBlob(audioBase64, contentType);
      const audioUrl = URL.createObjectURL(audioBlob);
      
      const audio = new Audio(audioUrl);
      audio.playbackRate = speedRef.current;
      audioRef.current = audio;

      // Set up event handlers
      audio.onplay = () => {
        setIsPlaying(true);
        animationFrameRef.current = requestAnimationFrame(updateWordHighlight);
      };

      audio.onpause = () => {
        setIsPlaying(false);
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
      };

      audio.onended = () => {
        setIsPlaying(false);
        setCurrentWordIndex(-1);
        setCurrentWord('');
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
        URL.revokeObjectURL(audioUrl);
        
        // Notify chunk complete
        onChunkComplete?.(chunkIdx);
        
        // Play next chunk after a brief pause
        setTimeout(() => {
          if (!isStoppedRef.current) {
            playNextChunk();
          }
        }, 300);
      };

      audio.onerror = () => {
        setIsPlaying(false);
        setIsLoading(false);
        URL.revokeObjectURL(audioUrl);
        onError?.('Error playing audio');
      };

      await audio.play();
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || 'Failed to convert text to speech';
      onError?.(errorMessage);
      // Continue to next chunk on error
      if (!isStoppedRef.current && chunksQueueRef.current.length > 0) {
        setTimeout(() => playNextChunk(), 500);
      }
    }
  }, [totalChunks, onChunkComplete, onAllComplete, onError, updateWordHighlight]);

  const playChunks = useCallback(async (chunks: string[], voiceId?: string, speed: number = 1.0) => {
    // Stop any existing playback
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    isStoppedRef.current = false;
    setIsLoading(true);
    setCurrentWordIndex(-1);
    setCurrentWord('');
    setCurrentChunkIndex(0);
    setTotalChunks(chunks.length);

    // Set up queue
    chunksQueueRef.current = [...chunks];
    voiceIdRef.current = voiceId;
    speedRef.current = speed;

    setIsLoading(false);
    
    // Start playing first chunk
    await playNextChunk();
  }, [playNextChunk]);

  const play = useCallback(async (text: string, voiceId?: string, speed: number = 1.0) => {
    // Single text playback (backward compatibility)
    await playChunks([text], voiceId, speed);
  }, [playChunks]);

  const pause = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
  }, []);

  const resume = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.play();
    }
  }, []);

  const stop = useCallback(() => {
    isStoppedRef.current = true;
    
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    
    chunksQueueRef.current = [];
    setIsPlaying(false);
    setIsLoading(false);
    setCurrentWordIndex(-1);
    setCurrentWord('');
    setCurrentChunkIndex(0);
    setTotalChunks(0);
  }, []);

  const setSpeed = useCallback((speed: number) => {
    speedRef.current = speed;
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  }, []);

  return {
    isPlaying,
    isLoading,
    currentWordIndex,
    currentWord,
    wordTimings,
    currentChunkIndex,
    totalChunks,
    playChunks,
    play,
    pause,
    resume,
    stop,
    setSpeed
  };
}

// Helper function to convert base64 to Blob
function base64ToBlob(base64: string, contentType: string): Blob {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: contentType });
}

export default useTts;
