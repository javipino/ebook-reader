import axios from 'axios'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000'

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

export const booksApi = {
  getAll: () => api.get('/api/books'),
  getById: (id: string) => api.get(`/api/books/${id}`),
  upload: (formData: FormData) => api.post('/api/books/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
  delete: (id: string) => api.delete(`/api/books/${id}`),
}

export const charactersApi = {
  analyze: (bookId: string) => api.post(`/api/books/${bookId}/analyze-characters`),
  getByBook: (bookId: string) => api.get(`/api/books/${bookId}/characters`),
  updateVoice: (characterId: string, voiceId: string) => 
    api.put(`/api/characters/${characterId}/voice`, { voiceId }),
}

export const audioApi = {
  generateChapter: (bookId: string, chapterNumber: number) => 
    api.post(`/api/books/${bookId}/chapters/${chapterNumber}/audio`),
  getAudioUrl: (bookId: string, chapterNumber: number) => 
    `${API_URL}/api/books/${bookId}/chapters/${chapterNumber}/audio`,
}

export default api
