import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../services/api';
import kindleService from '../services/kindleService';
import { toast } from 'react-hot-toast';
import { Book } from '../types';
import BookCover from '../components/BookCover';
import { LoadingSpinner, ErrorAlert } from '../components/ui';

interface BookWithProgress extends Book {
  readingProgress?: number;
}

export default function LibraryPage() {
  const [books, setBooks] = useState<BookWithProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [kindleConnected, setKindleConnected] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetchBooks();
    checkKindleStatus();
  }, []);

  const fetchBooks = async () => {
    try {
      const response = await api.get<Book[]>('/api/books');
      const booksData = response.data;

      const booksWithProgress = await Promise.all(
        booksData.map(async (book: Book) => {
          try {
            const progressResponse = await api.get(`/api/readingprogress/${book.id}`);
            const progress = progressResponse.data;
            const percentage = Math.round((progress.currentChapterNumber / 142) * 100);
            return { ...book, readingProgress: percentage };
          } catch {
            return { ...book, readingProgress: 0 };
          }
        })
      );

      setBooks(booksWithProgress);
    } catch (err) {
      console.error('Error fetching books:', err);
      setError('Failed to load books');
    } finally {
      setLoading(false);
    }
  };

  const checkKindleStatus = async () => {
    try {
      const status = await kindleService.getStatus();
      setKindleConnected(status.isConnected);
    } catch {
      setKindleConnected(false);
    }
  };

  const handleSyncKindle = async () => {
    try {
      setSyncing(true);
      const result = await kindleService.syncLibrary();
      
      if (result.success) {
        const messages = [];
        if (result.booksAdded > 0) messages.push(`${result.booksAdded} books added`);
        if (result.booksUpdated > 0) messages.push(`${result.booksUpdated} books updated`);
        
        toast.success(messages.length > 0 ? messages.join(', ') : 'Library is up to date');
        await fetchBooks();
      } else {
        toast.error(result.errorMessage || 'Sync failed');
      }
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to sync Kindle library');
    } finally {
      setSyncing(false);
    }
  };

  const handleFileSelect = async (file: File) => {
    if (!file.name.endsWith('.epub')) {
      setError('Only EPUB files are supported');
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      setError('File size must be less than 50MB');
      return;
    }

    setError(null);
    setUploading(true);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await api.post<Book>('/api/books', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: (progressEvent: { loaded: number; total?: number }) => {
          if (progressEvent.total) {
            const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            setUploadProgress(progress);
          }
        },
      });

      setBooks([...books, response.data]);
      setUploadProgress(0);
      navigate(`/reader/${response.data.id}`);
    } catch (err: any) {
      console.error('Error uploading book:', err);
      setError(err.response?.data || 'Failed to upload book');
    } finally {
      setUploading(false);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDelete = async (bookId: string) => {
    if (!confirm('Are you sure you want to delete this book?')) {
      return;
    }

    try {
      await api.delete(`/api/books/${bookId}`);
      setBooks(books.filter(b => b.id !== bookId));
    } catch (err) {
      console.error('Error deleting book:', err);
      setError('Failed to delete book');
    }
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <LoadingSpinner message="Loading your library..." />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-gray-900">My Library</h1>
        <div className="flex gap-3">
          {kindleConnected && (
            <button
              onClick={handleSyncKindle}
              disabled={syncing}
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
            >
              {syncing ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Syncing...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Sync Kindle
                </>
              )}
            </button>
          )}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="px-6 py-3 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center"
          >
            {uploading ? (
              <>
                <div className="inline-block animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2" />
                Uploading {uploadProgress}%
              </>
            ) : (
              <>
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Upload Book
              </>
            )}
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".epub"
        onChange={handleFileInput}
        className="hidden"
      />

      {error && (
        <div className="mb-4">
          <ErrorAlert message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      {books.length === 0 && !uploading && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
            isDragging
              ? 'border-indigo-600 bg-indigo-50'
              : 'border-gray-300 hover:border-indigo-400'
          }`}
        >
          <div className="text-6xl mb-4">📚</div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">No books yet</h2>
          <p className="text-gray-600 mb-4">
            Drag and drop an EPUB file here, or click the button above to upload
          </p>
          <p className="text-sm text-gray-500">
            Supported format: EPUB • Max size: 50MB
          </p>
        </div>
      )}

      {books.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
          {books.map((book) => (
            <div
              key={book.id}
              className="group relative rounded-lg shadow-lg hover:shadow-xl transition-all cursor-pointer overflow-hidden aspect-[2/3]"
              onClick={() => navigate(`/reader/${book.id}`)}
            >
              <BookCover
                bookId={book.id}
                coverImageUrl={book.coverImageUrl}
                className="w-full h-full rounded-lg"
              >
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

                <div className="absolute bottom-0 left-0 right-0 p-4 text-white">
                  <h3 className="text-sm font-bold line-clamp-2 drop-shadow-lg">
                    {book.title}
                  </h3>
                  <div className="flex items-center justify-between mt-1">
                    <p className="text-xs text-gray-200 drop-shadow-lg">
                      {book.author}
                    </p>
                    {book.readingProgress !== undefined && book.readingProgress > 0 && (
                      <span className="text-xs bg-indigo-600 px-2 py-1 rounded-full">
                        {book.readingProgress}%
                      </span>
                    )}
                  </div>
                </div>

                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/reader/${book.id}`);
                    }}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
                  >
                    Read
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(book.id);
                    }}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </BookCover>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

