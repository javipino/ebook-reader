interface AudioPlayerProps {
  isPlaying: boolean;
  isPaused: boolean;
  isLoading: boolean;
  currentTime: number;
  duration: number;
  speed: number;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onPlayPause: () => void;
  onStop: () => void;
  onSeekForward: () => void;
  onSeekBackward: () => void;
  onSpeedChange: (speed: number) => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
}

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function AudioPlayer({
  isPlaying,
  isPaused,
  isLoading,
  currentTime,
  duration,
  speed,
  canGoPrevious,
  canGoNext,
  onPlayPause,
  onStop,
  onSeekForward,
  onSeekBackward,
  onSpeedChange,
  onPreviousPage,
  onNextPage
}: AudioPlayerProps) {
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const isActive = isPlaying || isPaused || isLoading;

  return (
    <div className="py-2">
      {/* Progress bar */}
      {isActive && (
        <div className="mb-3">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-1.5">
            <div
              className="bg-indigo-600 h-1.5 rounded-full transition-all duration-100"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center justify-between">
        {/* Previous page - far left */}
        <button
          onClick={onPreviousPage}
          disabled={!canGoPrevious}
          className="p-2 text-gray-600 hover:text-indigo-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Previous page"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Center controls */}
        <div className="flex items-center justify-center gap-2">
          {/* Seek backward 10s */}
          <button
            onClick={onSeekBackward}
            disabled={!isActive || isLoading}
            className="flex flex-col items-center p-2 text-gray-600 hover:text-indigo-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Back 10 seconds"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.333 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z" />
            </svg>
            <span className="text-xs">10</span>
          </button>

          {/* Play/Pause button */}
          <button
            onClick={onPlayPause}
            disabled={isLoading}
            className={`p-4 rounded-full transition-colors ${
              isLoading
                ? 'bg-gray-300 cursor-not-allowed'
                : isPlaying
                ? 'bg-yellow-500 hover:bg-yellow-600 text-white'
                : 'bg-indigo-600 hover:bg-indigo-700 text-white'
            }`}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isLoading ? (
              <svg className="w-6 h-6 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : isPlaying ? (
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          {/* Stop button */}
          {isActive && (
            <button
              onClick={onStop}
              className="p-2 text-gray-600 hover:text-red-600 transition-colors"
              title="Stop"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 6h12v12H6z" />
              </svg>
            </button>
          )}

          {/* Seek forward 10s */}
          <button
            onClick={onSeekForward}
            disabled={!isActive || isLoading}
            className="flex flex-col items-center p-2 text-gray-600 hover:text-indigo-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Forward 10 seconds"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.933 12.8a1 1 0 000-1.6L6.6 7.2A1 1 0 005 8v8a1 1 0 001.6.8l5.333-4zM19.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.333-4z" />
            </svg>
            <span className="text-xs">10</span>
          </button>

          {/* Speed control */}
          <select
            value={speed}
            onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
            className="text-sm text-gray-700 bg-white border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="0.5">0.5x</option>
            <option value="0.75">0.75x</option>
            <option value="1">1x</option>
            <option value="1.25">1.25x</option>
            <option value="1.5">1.5x</option>
            <option value="1.75">1.75x</option>
            <option value="2">2x</option>
          </select>
        </div>

        {/* Next page - far right */}
        <button
          onClick={onNextPage}
          disabled={!canGoNext}
          className="p-2 text-gray-600 hover:text-indigo-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Next page"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default AudioPlayer;
