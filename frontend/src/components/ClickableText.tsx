import { useEffect, useRef } from 'react';

interface ClickableTextProps {
  content: string;
  isActive: boolean;  // TTS is playing or paused
  currentWordIndex: number;  // Currently spoken word index (-1 if none)
  onWordClick: (position: number) => void;
  className?: string;
}

export function ClickableText({ 
  content, 
  isActive, 
  currentWordIndex,
  onWordClick,
  className = ''
}: ClickableTextProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Wrap all text nodes in clickable spans
    const wrapTextNodes = (element: Node) => {
      const childNodes = Array.from(element.childNodes);
      
      childNodes.forEach(child => {
        if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
          // Split text into words while preserving whitespace
          const text = child.textContent;
          const fragment = document.createDocumentFragment();
          
          // Match words and whitespace separately
          const parts = text.split(/(\s+)/);
          
          parts.forEach(part => {
            if (part.match(/^\s+$/)) {
              // Whitespace - keep as text node
              fragment.appendChild(document.createTextNode(part));
            } else if (part.trim()) {
              // Word - wrap in clickable span
              const span = document.createElement('span');
              span.textContent = part;
              span.className = 'tts-word cursor-pointer hover:bg-yellow-200 hover:text-indigo-700 rounded transition-colors';
              span.style.cssText = 'cursor: pointer;';
              span.setAttribute('data-word', 'true');
              fragment.appendChild(span);
            }
          });
          
          child.parentNode?.replaceChild(fragment, child);
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          // Recurse into element children
          wrapTextNodes(child);
        }
      });
    };

    // Set up the clickable words
    const container = containerRef.current;
    wrapTextNodes(container);

    // Add click handler
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.getAttribute('data-word') === 'true') {
        // Find position of this word among all words
        const allWords = container.querySelectorAll('[data-word="true"]');
        const wordIndex = Array.from(allWords).indexOf(target);
        const position = wordIndex / allWords.length;
        onWordClick(position);
      }
    };

    container.addEventListener('click', handleClick);

    return () => {
      container.removeEventListener('click', handleClick);
    };
  }, [content, onWordClick]);

  // Update word highlighting when currentWordIndex changes
  useEffect(() => {
    if (!containerRef.current) return;
    
    const allWords = containerRef.current.querySelectorAll('[data-word="true"]');
    
    allWords.forEach((word, index) => {
      const el = word as HTMLElement;
      if (isActive && index === currentWordIndex) {
        // Highlight current word with inline style for reliability
        el.style.backgroundColor = '#fde047'; // yellow-300
        el.style.color = '#312e81'; // indigo-900
        el.style.borderRadius = '2px';
        el.style.padding = '0 2px';
        // Scroll into view if needed
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      } else {
        // Remove highlight
        el.style.backgroundColor = '';
        el.style.color = '';
        el.style.borderRadius = '';
        el.style.padding = '';
      }
    });
  }, [currentWordIndex, isActive]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ lineHeight: '1.6' }}
      dangerouslySetInnerHTML={{ __html: content }}
    />
  );
}

export default ClickableText;
