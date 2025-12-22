export interface User {
  id: string;
  username: string;
  email: string;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  description?: string;
  uploadedAt?: string;
  charactersAnalyzed?: boolean;
  coverImageUrl?: string;
  readingProgress?: number;
  chapters?: Chapter[];
}

export interface Chapter {
  id: string;
  chapterNumber: number;
  title: string;
  content: string;
  wordCount: number;
}

export interface ReadingProgress {
  bookId: string;
  userId: string;
  currentChapterNumber: number;
  currentPosition: number;
  lastRead: string;
  isListening: boolean;
}

export interface Character {
  id: string;
  bookId: string;
  name: string;
  description?: string;
  voiceId?: string;
}

// TTS Types
export interface WordTiming {
  word: string;
  startTime: number;
  endTime: number;
}

export interface TtsResponse {
  audioBase64: string;
  contentType: string;
  wordTimings: WordTiming[];
}

export interface TtsRequest {
  text: string;
  voiceId?: string;
  speed?: number;
}

export interface Voice {
  id: string;
  name: string;
}
