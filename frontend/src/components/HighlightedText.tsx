import React, { useMemo } from 'react';
import { WordTiming } from '../types';

interface HighlightedTextProps {
  content: string;
  wordTimings: WordTiming[];
  currentWordIndex: number;
  isPlaying: boolean;
  className?: string;
}

interface TextSegment {
  type: 'text' | 'tag';
  content: string;
  wordIndex?: number;
}

/**
 * Component that renders text content with word highlighting synchronized to TTS playback.
 * Handles HTML content by preserving tags while highlighting words.
 */
export function HighlightedText({
  content,
  wordTimings,
  currentWordIndex,
  isPlaying,
  className = ''
}: HighlightedTextProps) {
  // Parse content and create word mappings
  const segments = useMemo(() => {
    const segs: TextSegment[] = [];
    
    // Parse HTML content
    let currentWordIdx = 0;
    
    // Simple HTML parser
    const tagRegex = /<[^>]+>/g;
    let match;
    let lastIndex = 0;

    while ((match = tagRegex.exec(content)) !== null) {
      // Add text before tag
      if (match.index > lastIndex) {
        const textContent = content.slice(lastIndex, match.index);
        const words = textContent.split(/(\s+)/);
        
        words.forEach(word => {
          if (word.trim().length > 0) {
            // Find matching word timing
            const cleanWord = word.toLowerCase().replace(/[^\w]/g, '');
            let matchedIdx = -1;
            
            // Look for this word in the word timings starting from current position
            for (let i = currentWordIdx; i < wordTimings.length && i < currentWordIdx + 3; i++) {
              const timingWord = wordTimings[i]?.word.toLowerCase().replace(/[^\w]/g, '');
              if (timingWord === cleanWord || timingWord?.startsWith(cleanWord) || cleanWord.startsWith(timingWord || '')) {
                matchedIdx = i;
                currentWordIdx = i + 1;
                break;
              }
            }
            
            segs.push({ type: 'text', content: word, wordIndex: matchedIdx >= 0 ? matchedIdx : undefined });
          } else if (word.length > 0) {
            // Whitespace
            segs.push({ type: 'text', content: word });
          }
        });
      }
      
      // Add tag
      segs.push({ type: 'tag', content: match[0] });
      lastIndex = match.index + match[0].length;
    }

    // Add remaining text after last tag
    if (lastIndex < content.length) {
      const textContent = content.slice(lastIndex);
      const words = textContent.split(/(\s+)/);
      
      words.forEach(word => {
        if (word.trim().length > 0) {
          const cleanWord = word.toLowerCase().replace(/[^\w]/g, '');
          let matchedIdx = -1;
          
          for (let i = currentWordIdx; i < wordTimings.length && i < currentWordIdx + 3; i++) {
            const timingWord = wordTimings[i]?.word.toLowerCase().replace(/[^\w]/g, '');
            if (timingWord === cleanWord || timingWord?.startsWith(cleanWord) || cleanWord.startsWith(timingWord || '')) {
              matchedIdx = i;
              currentWordIdx = i + 1;
              break;
            }
          }
          
          segs.push({ type: 'text', content: word, wordIndex: matchedIdx >= 0 ? matchedIdx : undefined });
        } else if (word.length > 0) {
          segs.push({ type: 'text', content: word });
        }
      });
    }

    return segs;
  }, [content, wordTimings]);

  // Render segments
  const renderedContent = useMemo(() => {
    const elements: React.ReactNode[] = [];
    let keyCounter = 0;

    segments.forEach((segment) => {
      if (segment.type === 'tag') {
        // Just track tags, we'll use dangerouslySetInnerHTML for proper rendering
        elements.push(
          <span 
            key={`tag-${keyCounter++}`} 
            dangerouslySetInnerHTML={{ __html: segment.content }} 
          />
        );
      } else {
        const isHighlighted = isPlaying && segment.wordIndex === currentWordIndex;
        
        if (segment.wordIndex !== undefined) {
          elements.push(
            <span
              key={`word-${keyCounter++}`}
              className={`transition-all duration-100 ${
                isHighlighted 
                  ? 'bg-yellow-300 text-gray-900 rounded px-0.5 font-medium' 
                  : ''
              }`}
              data-word-index={segment.wordIndex}
            >
              {segment.content}
            </span>
          );
        } else {
          elements.push(
            <span key={`text-${keyCounter++}`}>{segment.content}</span>
          );
        }
      }
    });

    return elements;
  }, [segments, currentWordIndex, isPlaying]);

  // If no word timings, fall back to dangerouslySetInnerHTML
  if (wordTimings.length === 0) {
    return (
      <div 
        className={className}
        dangerouslySetInnerHTML={{ __html: content }}
      />
    );
  }

  return (
    <div className={className}>
      {renderedContent}
    </div>
  );
}

export default HighlightedText;
