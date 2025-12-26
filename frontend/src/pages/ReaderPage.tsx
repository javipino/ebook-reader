import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../services/api';
import { Book, Chapter, ReadingProgress } from '../types';
import { getPageContent, getTotalPages } from '../utils/pagination';
import { LoadingSpinner } from '../components/ui';
import { useStreamingTts } from '../hooks/useStreamingTts';
import { AudioPlayer } from '../components/AudioPlayer';
import { ClickableText } from '../components/ClickableText';

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

  // TTS Hook - WebSocket streaming
  const tts = useStreamingTts({
    onComplete: () => {
      // Auto-advance to next page when audio finishes
      handleAutoAdvance();
    },
    onError: (error: string) => {
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
          // Strip HTML for TTS
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = nextPageContent;
          const plainText = tempDiv.textContent || tempDiv.innerText || '';
          if (plainText.trim()) {
            tts.play(plainText.trim());
          }
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
          // Strip HTML for TTS
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = nextChapterContent;
          const plainText = tempDiv.textContent || tempDiv.innerText || '';
          if (plainText.trim()) {
            tts.play(plainText.trim());
          }
        }
      }, 500);
    } else {
      // Finished book
      toast.success('Finished reading!');
    }
  }, [book, currentChapterIndex, currentPage, getTotalPagesInChapter, saveProgress, tts]);

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

  const handlePlayPause = useCallback(async () => {
    if (tts.isPlaying) {
      tts.pause();
    } else if (tts.isLoading) {
      return;
    } else if (tts.isPaused) {
      tts.resume();
    } else {
      const pageContent = getCurrentPageContent();
      if (!pageContent) {
        toast.error('No content to read');
        return;
      }

      // Strip HTML and get plain text for TTS
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = pageContent;
      const plainText = tempDiv.textContent || tempDiv.innerText || '';
      
      if (!plainText.trim()) {
        toast.error('No readable content found');
        return;
      }

      await tts.play(plainText.trim());
    }
  }, [tts, getCurrentPageContent]);

  const handleStop = useCallback(() => {
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
          {/* Page navigation overlays - hidden when TTS is active */}
          {!tts.isPlaying && !tts.isPaused && (
            <>
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
            </>
          )}

          <div className="relative z-0">
            <ClickableText
              content={pageContent}
              isActive={tts.isPlaying || tts.isPaused}
              currentWordIndex={tts.currentWordIndex}
              onWordClick={(position: number) => {
                tts.seekToPosition(position);
              }}
              className="text-gray-800 text-lg"
            />
          </div>
        </div>

        <div className="border-t border-gray-200 pt-4">
          {/* Audio Player - replaces old previous/next buttons */}
          <div className="mb-6">
            <AudioPlayer
              isPlaying={tts.isPlaying}
              isPaused={tts.isPaused}
              isLoading={tts.isLoading}
              speed={tts.speed}
              canGoPrevious={canGoPrevious}
              canGoNext={canGoNext}
              onPlayPause={handlePlayPause}
              onStop={handleStop}
              onSeekForward={() => tts.seekForward(10)}
              onSeekBackward={() => tts.seekBackward(10)}
              onSpeedChange={tts.setSpeed}
              onPreviousPage={handlePreviousPage}
              onNextPage={handleNextPage}
            />
          </div>

          <div className="flex items-end justify-between">
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

        </div>
      </div>
    </div>
  );
}
