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
