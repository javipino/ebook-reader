import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import BookCover from '../components/BookCover';

interface Book {
  id: string;
  title: string;
  author: string;
  description?: string;
  uploadedAt: string;
  charactersAnalyzed: boolean;
  coverImageUrl?: string;
  readingProgress?: number;
}

export default function LibraryPage() {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetchBooks();
  }, []);

  const fetchBooks = async () => {
    try {
      const response = await api.get<Book[]>('/api/books');
      const booksData = response.data;
      
      // Fetch reading progress for each book
      const booksWithProgress = await Promise.all(
        booksData.map(async (book) => {
          try {
            const progressResponse = await api.get(`/api/readingprogress/${book.id}`);
            const progress = progressResponse.data;
            // Calculate percentage (simplified - based on chapter number)
            const percentage = Math.round((progress.currentChapterNumber / 142) * 100); // TODO: use actual chapter count
            return { ...book, readingProgress: percentage };
          } catch {
            return { ...book, readingProgress: 0 };
          }
        })
      );
      
      setBooks(booksWithProgress);
    } catch (err: any) {
      console.error('Error fetching books:', err);
      setError('Failed to load books');
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = async (file: File) => {
    // Validate file
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
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            setUploadProgress(progress);
          }
        },
      });

      setBooks([...books, response.data]);
      setUploadProgress(0);
      
      // Auto-open the newly uploaded book
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
    } catch (err: any) {
      console.error('Error deleting book:', err);
      setError('Failed to delete book');
    }
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
          <p className="mt-4 text-gray-600">Loading your library...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-gray-900">My Library</h1>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="px-6 py-3 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center"
        >
          {uploading ? (
            <>
              <div className="inline-block animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
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
        <input
          ref={fileInputRef}
          type="file"
          accept=".epub"
          onChange={handleFileInput}
          className="hidden"
        />
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
          <p className="text-red-800">{error}</p>
          <button
            onClick={() => setError(null)}
            className="mt-2 text-sm text-red-600 hover:text-red-800"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Drag and Drop Zone */}
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

      {/* Book Grid */}
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
                {/* Gradient overlay for text readability */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                
                {/* Book info overlay */}
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

                {/* Hover actions */}
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

