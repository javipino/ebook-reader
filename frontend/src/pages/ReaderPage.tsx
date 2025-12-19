import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import api from '../services/api';

interface Chapter {
  id: string;
  chapterNumber: number;
  title: string;
  content: string;
  wordCount: number;
}

interface Book {
  id: string;
  title: string;
  author: string;
  description?: string;
  chapters: Chapter[];
}

interface ReadingProgress {
  bookId: string;
  userId: string;
  currentChapterNumber: number;
  currentPosition: number;
  lastRead: string;
  isListening: boolean;
}

const WORDS_PER_PAGE = 300; // Approximate words per page (like Kindle)

export default function ReaderPage() {
  const { bookId } = useParams();
  const [book, setBook] = useState<Book | null>(null);
  const [currentChapterIndex, setCurrentChapterIndex] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);

  useEffect(() => {
    fetchBook();
  }, [bookId]);

  const fetchBook = async () => {
    try {
      const response = await api.get<Book>(`/api/books/${bookId}`);
      // Sort chapters by chapter number
      const sortedBook = {
        ...response.data,
        chapters: response.data.chapters.sort((a, b) => a.chapterNumber - b.chapterNumber)
      };
      setBook(sortedBook);

      // Load reading progress
      const progressResponse = await api.get<ReadingProgress>(`/api/readingprogress/${bookId}`);
      const progress = progressResponse.data;
      
      // Find chapter index (chapterNumber is 1-based, index is 0-based)
      const chapterIdx = sortedBook.chapters.findIndex(
        ch => ch.chapterNumber === progress.currentChapterNumber
      );
      
      if (chapterIdx >= 0) {
        setCurrentChapterIndex(chapterIdx);
        setCurrentPage(progress.currentPosition);
      }
    } catch (err: any) {
      console.error('Error fetching book:', err);
      setError('Failed to load book');
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
        isListening: false
      });
    } catch (err) {
      console.error('Error saving progress:', err);
    }
  };

  // Kindle-style pagination constants
  const LINES_PER_PAGE = 28; // Lines that fit in ~60vh with 1.6 line-height
  const CHARS_PER_LINE = 75; // Approximate characters per line in the container

  const getPageBreaks = (content: string): number[] => {
    // Convert literal \n to actual newlines
    const text = content.replace(/\\n/g, '\n');
    
    const pageBreaks: number[] = [0];
    let lineCount = 0;
    let charInCurrentLine = 0;
    let prevChar = '';
    let lastLineEndPos = 0; // Track where the last complete line ended
    
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      
      if (char === '\n') {
        // Explicit line break - counts as a full line
        lineCount++;
        charInCurrentLine = 0;
        lastLineEndPos = i + 1; // Mark end of line (after the newline)
        
        // Double line break creates an extra empty visual line
        if (prevChar === '\n') {
          lineCount++;
        }
        
        // Check for page break only at line boundaries
        if (lineCount >= LINES_PER_PAGE) {
          pageBreaks.push(lastLineEndPos);
          lineCount = 0;
          charInCurrentLine = 0;
          prevChar = '';
        }
      } else if (char === ' ') {
        charInCurrentLine++;
        // Check for line wrap at space
        if (charInCurrentLine >= CHARS_PER_LINE) {
          lineCount++;
          charInCurrentLine = 0;
          lastLineEndPos = i + 1; // Mark end of line (after the space)
          
          // Check for page break only at line boundaries
          if (lineCount >= LINES_PER_PAGE) {
            pageBreaks.push(lastLineEndPos);
            lineCount = 0;
            charInCurrentLine = 0;
            prevChar = '';
          }
        }
      } else {
        // Regular character
        charInCurrentLine++;
        // If we exceed line length mid-word, wrap back to last space
        if (charInCurrentLine >= CHARS_PER_LINE) {
          // Find the last space in this line to wrap there
          let wrapPoint = i;
          while (wrapPoint > lastLineEndPos && text[wrapPoint] !== ' ') {
            wrapPoint--;
          }
          if (wrapPoint > lastLineEndPos) {
            // Wrap at the space
            lineCount++;
            charInCurrentLine = i - wrapPoint;
            lastLineEndPos = wrapPoint + 1;
            
            // Check for page break only at line boundaries
            if (lineCount >= LINES_PER_PAGE) {
              pageBreaks.push(lastLineEndPos);
              lineCount = 0;
              charInCurrentLine = i - wrapPoint;
              prevChar = '';
            }
          } else {
            // No space found, force wrap here
            lineCount++;
            charInCurrentLine = 0;
            lastLineEndPos = i + 1;
          }
        }
      }
      
      prevChar = char;
    }
    
    pageBreaks.push(text.length);
    return pageBreaks;
  };

  const getCurrentPageContent = () => {
    if (!book) return '';
    
    const chapter = book.chapters[currentChapterIndex];
    const text = chapter.content.replace(/\\n/g, '\n');
    const pageBreaks = getPageBreaks(chapter.content);
    
    // Get content for current page
    const startChar = pageBreaks[currentPage] || 0;
    const endChar = pageBreaks[currentPage + 1] || text.length;
    const pageText = text.slice(startChar, endChar);
    
    // Convert newlines to <br /> for HTML rendering
    return pageText.replace(/\n/g, '<br />');
  };

  const getTotalPagesInChapter = () => {
    if (!book) return 0;
    const chapter = book.chapters[currentChapterIndex];
    const pageBreaks = getPageBreaks(chapter.content);
    return pageBreaks.length - 1; // Number of pages = number of breaks - 1
  };

  const handlePreviousPage = () => {
    if (currentPage > 0) {
      const newPage = currentPage - 1;
      setCurrentPage(newPage);
      saveProgress(currentChapterIndex, newPage);
      window.scrollTo(0, 0);
    } else if (currentChapterIndex > 0) {
      // Go to last page of previous chapter
      const prevChapterIdx = currentChapterIndex - 1;
      const prevChapter = book!.chapters[prevChapterIdx];
      const lastPage = Math.ceil(prevChapter.wordCount / WORDS_PER_PAGE) - 1;
      setCurrentChapterIndex(prevChapterIdx);
      setCurrentPage(lastPage);
      saveProgress(prevChapterIdx, lastPage);
      window.scrollTo(0, 0);
    }
  };

  const handleNextPage = () => {
    const totalPages = getTotalPagesInChapter();
    
    if (currentPage < totalPages - 1) {
      const newPage = currentPage + 1;
      setCurrentPage(newPage);
      saveProgress(currentChapterIndex, newPage);
      window.scrollTo(0, 0);
    } else if (book && currentChapterIndex < book.chapters.length - 1) {
      // Go to first page of next chapter
      const nextChapterIdx = currentChapterIndex + 1;
      setCurrentChapterIndex(nextChapterIdx);
      setCurrentPage(0);
      saveProgress(nextChapterIdx, 0);
      window.scrollTo(0, 0);
    }
  };

  const handleSpeedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPlaybackSpeed(parseFloat(e.target.value));
  };

  const canGoPrevious = currentChapterIndex > 0 || currentPage > 0;
  const canGoNext = book ? (currentChapterIndex < book.chapters.length - 1 || currentPage < getTotalPagesInChapter() - 1) : false;

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
          <p className="mt-4 text-gray-600">Loading book...</p>
        </div>
      </div>
    );
  }

  if (error || !book) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="bg-red-50 border border-red-200 rounded-lg p-8 text-center">
          <p className="text-red-800">{error || 'Book not found'}</p>
        </div>
      </div>
    );
  }

  const currentChapter = book.chapters[currentChapterIndex];
  const totalPagesInChapter = getTotalPagesInChapter();
  const pageContent = getCurrentPageContent();

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="bg-white rounded-lg shadow p-8">
        {/* Book header */}
        <div className="mb-4 border-b border-gray-200 pb-3">
          <h1 className="text-2xl font-bold text-gray-900">{book.title}</h1>
        </div>

        {/* Reading area with clickable zones - Min height, expands if needed */}
        <div className="relative mb-8" style={{ minHeight: '65vh' }}>
          {/* Left click zone - 1/3 width for Previous */}
          <div
            onClick={handlePreviousPage}
            className={`absolute left-0 top-0 bottom-0 w-1/3 cursor-pointer hover:bg-gray-50 hover:bg-opacity-50 transition-colors z-10 ${
              !canGoPrevious ? 'cursor-not-allowed opacity-0' : ''
            }`}
            style={{ pointerEvents: canGoPrevious ? 'auto' : 'none' }}
          />
          
          {/* Right click zone - 2/3 width for Next */}
          <div
            onClick={handleNextPage}
            className={`absolute right-0 top-0 bottom-0 w-2/3 cursor-pointer hover:bg-gray-50 hover:bg-opacity-50 transition-colors z-10 ${
              !canGoNext ? 'cursor-not-allowed opacity-0' : ''
            }`}
            style={{ pointerEvents: canGoNext ? 'auto' : 'none' }}
          />

          {/* Page content - Auto expand */}
          <div className="relative z-0">
            <div 
              className="text-gray-800 text-lg"
              style={{ lineHeight: '1.6' }}
              dangerouslySetInnerHTML={{ __html: pageContent }}
            />
          </div>
        </div>

        {/* Bottom info and navigation */}
        <div className="border-t border-gray-200 pt-4">
          {/* Navigation buttons - Top */}
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

          {/* Position info - Below buttons */}
          <div className="flex items-end justify-between mb-6">
            {/* Chapter/Page info - Bottom Left */}
            <div className="text-sm text-gray-600">
              <p className="font-medium">
                Chapter {currentChapterIndex + 1} of {book.chapters.length}
                {currentChapter.title && ` - ${currentChapter.title}`}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Page {currentPage + 1} of {totalPagesInChapter}
              </p>
            </div>

            {/* Progress bar - Bottom Right */}
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
                ></div>
              </div>
            </div>
          </div>

          {/* Audio controls */}
          <div className="pt-6 border-t border-gray-200 flex items-center space-x-4">
            <button className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
              ▶️ Listen
            </button>
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
          </div>
        </div>
      </div>
    </div>
  );
}
