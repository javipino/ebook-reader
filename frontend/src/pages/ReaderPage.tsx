import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../services/api';
import { Book, Chapter, ReadingProgress } from '../types';
import { getPageContent, getTotalPages } from '../utils/pagination';
import { splitIntoChunks } from '../utils/textChunking';
import { LoadingSpinner } from '../components/ui';
import { useTts } from '../hooks/useTts';
import { HighlightedText } from '../components/HighlightedText';

interface BookWithChapters extends Book {
  chapters: Chapter[];
}

export default function ReaderPage() {
  const { bookId } = useParams();
  const navigate = useNavigate();
  const [book, setBook] = useState<BookWithChapters | null>(null);
  const [currentChapterIndex, setCurrentChapterIndex] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);

  // TTS Hook
  const tts = useTts({
    onChunkComplete: () => {
      // Optional: Track progress per chunk
    },
    onAllComplete: () => {
      // Auto-advance to next page when all chunks finish
      handleAutoAdvance();
    },
    onError: (error) => {
      toast.error(error);
    }
  });

  useEffect(() => {
    fetchBook();
    // Cleanup TTS when leaving page
    return () => {
      tts.stop();
    };
  }, [bookId]);

  // Update playback speed when slider changes
  useEffect(() => {
    tts.setSpeed(playbackSpeed);
  }, [playbackSpeed]);

  const fetchBook = async () => {
    try {
      const response = await api.get<BookWithChapters>(`/api/books/${bookId}`);
      
      // Check if book has no file (Kindle book without download)
      if (!response.data.chapters || response.data.chapters.length === 0) {
        toast.error('This book file is not available yet. Kindle book download is not implemented.');
        navigate('/library');
        return;
      }
      
      const sortedBook: BookWithChapters = {
        ...response.data,
        chapters: response.data.chapters.sort((a: Chapter, b: Chapter) => a.chapterNumber - b.chapterNumber)
      };
      setBook(sortedBook);

      const progressResponse = await api.get<ReadingProgress>(`/api/readingprogress/${bookId}`);
      const progress = progressResponse.data;

      const chapterIdx = sortedBook.chapters.findIndex(
        (ch: Chapter) => ch.chapterNumber === progress.currentChapterNumber
      );

      if (chapterIdx >= 0) {
        setCurrentChapterIndex(chapterIdx);
        setCurrentPage(progress.currentPosition);
      }
    } catch (err: any) {
      console.error('Error fetching book:', err);
      toast.error(err.response?.data?.message || 'Failed to load book');
      navigate('/library');
    } finally {
      setLoading(false);
    }
  };

  const saveProgress = async (chapterIdx: number, pageNum: number) => {
    if (!book) return;

    try {
      const chapter = book.chapters[chapterIdx];
      await api.put(`/api/readingprogress/${bookId}`, {
        currentChapterNumber: chapter.chapterNumber,
        currentPosition: pageNum,
        isListening: tts.isPlaying
      });
    } catch (err: any) {
      console.error('Error saving progress:', err);
      toast.error('Failed to save reading progress');
    }
  };

  const getCurrentChapter = () => book?.chapters[currentChapterIndex];

  const getTotalPagesInChapter = () => {
    const chapter = getCurrentChapter();
    return chapter ? getTotalPages(chapter.content) : 0;
  };

  const getCurrentPageContent = () => {
    const chapter = getCurrentChapter();
    return chapter ? getPageContent(chapter.content, currentPage) : '';
  };

  const handleAutoAdvance = useCallback(() => {
    const totalPages = getTotalPagesInChapter();

    if (currentPage < totalPages - 1) {
      // Move to next page in same chapter
      const newPage = currentPage + 1;
      setCurrentPage(newPage);
      saveProgress(currentChapterIndex, newPage);
      window.scrollTo(0, 0);
      
      // Auto-start reading next page
      setTimeout(() => {
        const nextPageContent = book?.chapters[currentChapterIndex] 
          ? getPageContent(book.chapters[currentChapterIndex].content, newPage)
          : '';
        if (nextPageContent) {
          const chunks = splitIntoChunks(nextPageContent).map(c => c.text);
          tts.playChunks(chunks, undefined, playbackSpeed);
        }
      }, 500);
    } else if (book && currentChapterIndex < book.chapters.length - 1) {
      // Move to next chapter
      const nextChapterIdx = currentChapterIndex + 1;
      setCurrentChapterIndex(nextChapterIdx);
      setCurrentPage(0);
      saveProgress(nextChapterIdx, 0);
      window.scrollTo(0, 0);
      toast.success('Next chapter');
      
      // Auto-start reading next chapter
      setTimeout(() => {
        const nextChapterContent = book?.chapters[nextChapterIdx]
          ? getPageContent(book.chapters[nextChapterIdx].content, 0)
          : '';
        if (nextChapterContent) {
          const chunks = splitIntoChunks(nextChapterContent).map(c => c.text);
          tts.playChunks(chunks, undefined, playbackSpeed);
        }
      }, 500);
    } else {
      // Finished book
      toast.success('Finished reading!');
    }
  }, [book, currentChapterIndex, currentPage, getTotalPagesInChapter, saveProgress, tts, playbackSpeed]);

  const handlePreviousPage = () => {
    // Stop TTS when navigating
    if (tts.isPlaying) {
      tts.stop();
    }

    if (currentPage > 0) {
      const newPage = currentPage - 1;
      setCurrentPage(newPage);
      saveProgress(currentChapterIndex, newPage);
      window.scrollTo(0, 0);
    } else if (currentChapterIndex > 0) {
      const prevChapterIdx = currentChapterIndex - 1;
      const prevChapter = book!.chapters[prevChapterIdx];
      const lastPage = getTotalPages(prevChapter.content) - 1;
      setCurrentChapterIndex(prevChapterIdx);
      setCurrentPage(lastPage);
      saveProgress(prevChapterIdx, lastPage);
      window.scrollTo(0, 0);
    }
  };

  const handleNextPage = () => {
    // Stop TTS when navigating
    if (tts.isPlaying) {
      tts.stop();
    }

    const totalPages = getTotalPagesInChapter();

    if (currentPage < totalPages - 1) {
      const newPage = currentPage + 1;
      setCurrentPage(newPage);
      saveProgress(currentChapterIndex, newPage);
      window.scrollTo(0, 0);
    } else if (book && currentChapterIndex < book.chapters.length - 1) {
      const nextChapterIdx = currentChapterIndex + 1;
      setCurrentChapterIndex(nextChapterIdx);
      setCurrentPage(0);
      saveProgress(nextChapterIdx, 0);
      window.scrollTo(0, 0);
    }
  };

  const handleSpeedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newSpeed = parseFloat(e.target.value);
    setPlaybackSpeed(newSpeed);
  };

  const handleListenClick = useCallback(async () => {
    if (tts.isPlaying) {
      tts.pause();
    } else if (tts.isLoading) {
      // Do nothing while loading
      return;
    } else if (tts.wordTimings.length > 0 && !tts.isPlaying) {
      // Resume if we have existing audio
      tts.resume();
    } else {
      // Start new playback with chunks
      const pageContent = getCurrentPageContent();
      if (!pageContent) {
        toast.error('No content to read');
        return;
      }

      try {
        // Split into smaller chunks (paragraphs) to reduce token usage
        const chunks = splitIntoChunks(pageContent).map(chunk => chunk.text);
        
        if (chunks.length === 0) {
          toast.error('No readable content found');
          return;
        }

        toast.success(`Reading ${chunks.length} section${chunks.length > 1 ? 's' : ''}...`);
        await tts.playChunks(chunks, undefined, playbackSpeed);
      } catch (error) {
        // Error already handled by onError callback
      }
    }
  }, [tts, playbackSpeed, getCurrentPageContent]);

  const handleStopClick = useCallback(() => {
    tts.stop();
  }, [tts]);

  const canGoPrevious = currentChapterIndex > 0 || currentPage > 0;
  const canGoNext = book
    ? currentChapterIndex < book.chapters.length - 1 || currentPage < getTotalPagesInChapter() - 1
    : false;

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <LoadingSpinner message="Loading book..." />
      </div>
    );
  }

  if (!book) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-8 text-center">
          <p className="text-yellow-800">Loading book...</p>
        </div>
      </div>
    );
  }

  const currentChapter = getCurrentChapter()!;
  const totalPagesInChapter = getTotalPagesInChapter();
  const pageContent = getCurrentPageContent();

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="bg-white rounded-lg shadow p-8">
        <div className="mb-4 border-b border-gray-200 pb-3">
          <h1 className="text-2xl font-bold text-gray-900">{book.title}</h1>
        </div>

        <div className="relative mb-8" style={{ minHeight: '65vh' }}>
          <div
            onClick={handlePreviousPage}
            className={`absolute left-0 top-0 bottom-0 w-1/3 cursor-pointer hover:bg-gray-50 hover:bg-opacity-50 transition-colors z-10 ${
              !canGoPrevious ? 'cursor-not-allowed opacity-0' : ''
            }`}
            style={{ pointerEvents: canGoPrevious ? 'auto' : 'none' }}
          />

          <div
            onClick={handleNextPage}
            className={`absolute right-0 top-0 bottom-0 w-2/3 cursor-pointer hover:bg-gray-50 hover:bg-opacity-50 transition-colors z-10 ${
              !canGoNext ? 'cursor-not-allowed opacity-0' : ''
            }`}
            style={{ pointerEvents: canGoNext ? 'auto' : 'none' }}
          />

          <div className="relative z-0">
            {tts.wordTimings.length > 0 ? (
              <HighlightedText
                content={pageContent}
                wordTimings={tts.wordTimings}
                currentWordIndex={tts.currentWordIndex}
                isPlaying={tts.isPlaying}
                className="text-gray-800 text-lg"
              />
            ) : (
              <div
                className="text-gray-800 text-lg"
                style={{ lineHeight: '1.6' }}
                dangerouslySetInnerHTML={{ __html: pageContent }}
              />
            )}
          </div>
        </div>

        <div className="border-t border-gray-200 pt-4">
          <div className="flex items-center justify-between mb-6">
            <button
              onClick={handlePreviousPage}
              disabled={!canGoPrevious}
              className="px-6 py-3 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors font-medium"
            >
              ← Previous
            </button>
            <button
              onClick={handleNextPage}
              disabled={!canGoNext}
              className="px-6 py-3 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors font-medium"
            >
              Next →
            </button>
          </div>

          <div className="flex items-end justify-between mb-6">
            <div className="text-sm text-gray-600">
              <p className="font-medium">
                Chapter {currentChapterIndex + 1} of {book.chapters.length}
                {currentChapter.title && ` - ${currentChapter.title}`}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Page {currentPage + 1} of {totalPagesInChapter}
              </p>
            </div>

            <div className="text-right">
              <p className="text-xs text-gray-600 mb-1">
                Location {currentChapterIndex * 1000 + currentPage} of {book.chapters.length * 1000}
              </p>
              <div className="w-48 bg-gray-200 rounded-full h-2">
                <div
                  className="bg-indigo-600 h-2 rounded-full transition-all"
                  style={{
                    width: `${((currentChapterIndex * 1000 + currentPage) / (book.chapters.length * 1000)) * 100}%`
                  }}
                />
              </div>
            </div>
          </div>

          <div className="pt-6 border-t border-gray-200 flex items-center space-x-4">
            <button 
              onClick={handleListenClick}
              disabled={tts.isLoading}
              className={`px-6 py-3 rounded-lg transition-colors flex items-center gap-2 ${
                tts.isLoading 
                  ? 'bg-gray-400 cursor-not-allowed' 
                  : tts.isPlaying 
                    ? 'bg-yellow-500 hover:bg-yellow-600 text-white' 
                    : 'bg-indigo-600 hover:bg-indigo-700 text-white'
              }`}
            >
              {tts.isLoading ? (
                <>
                  <span className="animate-spin">⏳</span> Loading...
                </>
              ) : tts.isPlaying ? (
                <>⏸️ Pause</>
              ) : (
                <>▶️ Listen</>
              )}
            </button>
            
            {(tts.isPlaying || tts.wordTimings.length > 0) && (
              <button 
                onClick={handleStopClick}
                className="px-6 py-3 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors"
              >
                ⏹️ Stop
              </button>
            )}

            <div className="flex items-center space-x-2">
              <label className="text-sm text-gray-600">Speed:</label>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.1"
                value={playbackSpeed}
                onChange={handleSpeedChange}
                className="w-32"
              />
              <span className="text-gray-600 font-medium w-12">{playbackSpeed.toFixed(1)}x</span>
            </div>

            {tts.isPlaying && tts.currentWord && (
              <div className="text-sm text-gray-500 italic flex items-center gap-2">
                <span>Reading: "{tts.currentWord}"</span>
                {tts.totalChunks > 1 && (
                  <span className="text-xs bg-gray-100 px-2 py-1 rounded">
                    Section {tts.currentChunkIndex + 1}/{tts.totalChunks}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
