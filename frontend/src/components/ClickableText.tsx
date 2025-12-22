import { useMemo } from 'react';

interface ClickableTextProps {
  content: string;
  isPlaying: boolean;
  onWordClick: (wordIndex: number, totalWords: number) => void;
  className?: string;
}

export function ClickableText({ 
  content, 
  isPlaying, 
  onWordClick,
  className = ''
}: ClickableTextProps) {
  // Parse HTML content and extract text with word positions
  const { words, totalWords } = useMemo(() => {
    // Create a temporary div to parse HTML
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = content;
    const textContent = tempDiv.textContent || tempDiv.innerText || '';
    
    // Split into words, preserving whitespace info
    const wordList = textContent.split(/(\s+)/).filter(Boolean);
    const actualWords = wordList.filter(w => w.trim().length > 0);
    
    return { 
      words: wordList,
      totalWords: actualWords.length 
    };
  }, [content]);

  if (!isPlaying) {
    // When not playing, just render the HTML normally
    return (
      <div
        className={className}
        style={{ lineHeight: '1.6' }}
        dangerouslySetInnerHTML={{ __html: content }}
      />
    );
  }

  // When playing, render clickable words
  let wordIndex = 0;
  
  return (
    <div className={className} style={{ lineHeight: '1.6' }}>
      {words.map((word, idx) => {
        if (!word.trim()) {
          // It's whitespace
          return <span key={idx}>{word}</span>;
        }
        
        const currentWordIndex = wordIndex;
        wordIndex++;
        
        return (
          <span
            key={idx}
            onClick={() => onWordClick(currentWordIndex, totalWords)}
            className="cursor-pointer hover:bg-indigo-100 hover:text-indigo-700 rounded px-0.5 transition-colors"
            title="Click to jump here"
          >
            {word}
          </span>
        );
      })}
    </div>
  );
}

export default ClickableText;
