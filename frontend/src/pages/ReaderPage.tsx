import { useState, useEffect, useCallback, useRef } from 'react';
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
  const playbackLocationRef = useRef<{ chapterIdx: number; page: number } | null>(null);

  // TTS Hook - WebSocket streaming
  const tts = useStreamingTts({
    onComplete: () => {
      // Whole queued stream finished.
      toast.success('Finished reading!');
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

      const resolvedChapterIdx = chapterIdx >= 0 ? chapterIdx : 0;
      const resolvedChapter = sortedBook.chapters[resolvedChapterIdx];
      const totalPages = resolvedChapter ? getTotalPages(resolvedChapter.content) : 1;
      const maxPage = Math.max(0, totalPages - 1);
      const clampedPage = Math.max(0, Math.min(progress.currentPosition, maxPage));

      const lastChapterIdx = Math.max(0, sortedBook.chapters.length - 1);
      const lastChapter = sortedBook.chapters[lastChapterIdx];
      const lastChapterTotalPages = lastChapter ? getTotalPages(lastChapter.content) : 1;
      const lastChapterLastPage = Math.max(0, lastChapterTotalPages - 1);

      // If a previous listening session ran all the way to the end (or a bug advanced too far),
      // reset to the start so the user isn't stuck at an empty/end state.
      const isAtEndOfBook =
        resolvedChapterIdx === lastChapterIdx &&
        clampedPage >= lastChapterLastPage;

      if (progress.isListening && isAtEndOfBook) {
        setCurrentChapterIndex(0);
        setCurrentPage(0);
        toast.success('Progress reset to start');

        await api.put(`/api/readingprogress/${bookId}`, {
          currentChapterNumber: sortedBook.chapters[0].chapterNumber,
          currentPosition: 0,
          isListening: false
        });
      } else {
        setCurrentChapterIndex(resolvedChapterIdx);
        setCurrentPage(clampedPage);

        // If the stored page is out of range (e.g. page count changed), persist the corrected value.
        if (chapterIdx >= 0 && clampedPage !== progress.currentPosition) {
          await api.put(`/api/readingprogress/${bookId}`, {
            currentChapterNumber: sortedBook.chapters[resolvedChapterIdx].chapterNumber,
            currentPosition: clampedPage,
            isListening: progress.isListening
          });
        }
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

  const htmlToPlainText = useCallback((html: string) => {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    return (tempDiv.textContent || tempDiv.innerText || '').trim();
  }, []);

  const getPagePlainText = useCallback((chapterIdx: number, pageNum: number) => {
    if (!book) return '';
    const chapter = book.chapters[chapterIdx];
    if (!chapter) return '';
    const pageHtml = getPageContent(chapter.content, pageNum);
    if (!pageHtml) return '';
    return htmlToPlainText(pageHtml);
  }, [book, htmlToPlainText]);

  const getNextLocation = useCallback((chapterIdx: number, pageNum: number) => {
    if (!book) return null;
    const chapter = book.chapters[chapterIdx];
    if (!chapter) return null;

    const totalPages = getTotalPages(chapter.content);
    if (pageNum < totalPages - 1) {
      return { chapterIdx, page: pageNum + 1, chapterChanged: false };
    }

    if (chapterIdx < book.chapters.length - 1) {
      return { chapterIdx: chapterIdx + 1, page: 0, chapterChanged: true };
    }

    return null;
  }, [book]);

  const handlePreviousPage = () => {
    // Stop TTS when navigating
    if (tts.isPlaying) {
      tts.stop();
    }
    playbackLocationRef.current = null;

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
    playbackLocationRef.current = null;

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

      const plainText = htmlToPlainText(pageContent);
      
      if (!plainText.trim()) {
        toast.error('No readable content found');
        return;
      }

      // Start streaming the current page.
      playbackLocationRef.current = { chapterIdx: currentChapterIndex, page: currentPage };

      const onSegmentComplete = () => {
        const currentLoc = playbackLocationRef.current;
        if (!currentLoc) return;

        const next = getNextLocation(currentLoc.chapterIdx, currentLoc.page);
        if (!next) return;

        playbackLocationRef.current = { chapterIdx: next.chapterIdx, page: next.page };
        setCurrentChapterIndex(next.chapterIdx);
        setCurrentPage(next.page);
        saveProgress(next.chapterIdx, next.page);
        window.scrollTo(0, 0);
        if (next.chapterChanged) toast.success('Next chapter');

        // Keep one-page lookahead queued so audio continues smoothly.
        const lookahead = getNextLocation(next.chapterIdx, next.page);
        if (lookahead) {
          const lookaheadText = getPagePlainText(lookahead.chapterIdx, lookahead.page);
          if (lookaheadText) {
            tts.enqueue(lookaheadText, { onSegmentComplete });
          }
        }
      };

      // Do not await; `useStreamingTts` calls `audio.play()` immediately
      // to satisfy autoplay policy in the click gesture.
      void tts.play(plainText.trim(), { onSegmentComplete });

      // Pre-queue the next page immediately (before UI changes) for seamless playback.
      const next = getNextLocation(currentChapterIndex, currentPage);
      if (next) {
        const nextText = getPagePlainText(next.chapterIdx, next.page);
        if (nextText) {
          tts.enqueue(nextText, { onSegmentComplete });
        }
      }
    }
  }, [tts, getCurrentPageContent, currentChapterIndex, currentPage, getNextLocation, getPagePlainText, htmlToPlainText, saveProgress]);

  const handleStop = useCallback(() => {
    tts.stop();
    playbackLocationRef.current = null;
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
              onWordClick={(wordIndex: number) => {
                tts.seekToWord(wordIndex);
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
