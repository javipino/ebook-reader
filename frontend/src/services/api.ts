import axios from 'axios';
import { Book, ReadingProgress } from '../types';

const API_URL = import.meta.env.VITE_API_URL || 'https://localhost:5001';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('username');
      localStorage.removeItem('userId');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export const authApi = {
  login: (username: string, password: string) =>
    api.post('/api/auth/login', { username, password }),
  register: (username: string, email: string, password: string) =>
    api.post('/api/auth/register', { username, email, password }),
  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    localStorage.removeItem('userId');
  },
};

export const booksApi = {
  getAll: () => api.get<Book[]>('/api/books'),
  getById: (id: string) => api.get<Book>(`/api/books/${id}`),
  upload: (formData: FormData, onProgress?: (percent: number) => void) =>
    api.post<Book>('/api/books', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (progressEvent) => {
        if (progressEvent.total && onProgress) {
          onProgress(Math.round((progressEvent.loaded * 100) / progressEvent.total));
        }
      },
    }),
  delete: (id: string) => api.delete(`/api/books/${id}`),
  extractCover: (id: string) => api.post(`/api/books/${id}/extract-cover`),
};

export const readingProgressApi = {
  get: (bookId: string) => api.get<ReadingProgress>(`/api/readingprogress/${bookId}`),
  update: (bookId: string, data: Partial<ReadingProgress>) =>
    api.put(`/api/readingprogress/${bookId}`, data),
};

export const charactersApi = {
  analyze: (bookId: string) => api.post(`/api/books/${bookId}/analyze-characters`),
  getByBook: (bookId: string) => api.get(`/api/books/${bookId}/characters`),
  updateVoice: (characterId: string, voiceId: string) =>
    api.put(`/api/characters/${characterId}/voice`, { voiceId }),
};

export const audioApi = {
  generateChapter: (bookId: string, chapterNumber: number) =>
    api.post(`/api/books/${bookId}/chapters/${chapterNumber}/audio`),
  getAudioUrl: (bookId: string, chapterNumber: number) =>
    `${API_URL}/api/books/${bookId}/chapters/${chapterNumber}/audio`,
};

export default api;
