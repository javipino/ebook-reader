import { useEffect, useRef } from 'react';

interface ClickableTextProps {
  content: string;
  isActive: boolean; // TTS is playing or paused
  currentWordIndex: number; // Currently spoken word index (-1 if none)
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
  const onWordClickRef = useRef(onWordClick);

  const wordElementsRef = useRef<HTMLElement[]>([]);
  const lastHighlightedRef = useRef<HTMLElement | null>(null);
  const lastHighlightedIndexRef = useRef<number>(-1);

  useEffect(() => {
    onWordClickRef.current = onWordClick;
  }, [onWordClick]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Set the HTML only when `content` changes.
    // This prevents React re-renders (e.g. wordIndex updates) from overwriting our wrapped spans.
    container.innerHTML = content;

    const wordElements: HTMLElement[] = [];
    let nextWordIndex = 0;

    const wrapTextNodes = (node: Node) => {
      const childNodes = Array.from(node.childNodes);

      for (const child of childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          const rawText = child.textContent ?? '';
          if (!rawText.trim()) continue;

          const fragment = document.createDocumentFragment();
          const parts = rawText.split(/(\s+)/);

          for (const part of parts) {
            if (/^\s+$/.test(part)) {
              fragment.appendChild(document.createTextNode(part));
              continue;
            }

            if (!part.trim()) continue;

            const span = document.createElement('span');
            span.textContent = part;
            span.className =
              'tts-word cursor-pointer hover:bg-yellow-200 hover:text-indigo-700 transition-colors';
            span.setAttribute('data-word', 'true');
            span.setAttribute('data-word-index', String(nextWordIndex));
            wordElements.push(span);
            nextWordIndex++;
            fragment.appendChild(span);
          }

          child.parentNode?.replaceChild(fragment, child);
          continue;
        }

        if (child.nodeType === Node.ELEMENT_NODE) {
          const el = child as HTMLElement;
          // Avoid re-wrapping inside already wrapped word spans.
          if (el.getAttribute('data-word') === 'true') continue;
          wrapTextNodes(child);
        }
      }
    };

    lastHighlightedRef.current = null;
    lastHighlightedIndexRef.current = -1;
    wrapTextNodes(container);
    wordElementsRef.current = wordElements;

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (target.getAttribute('data-word') !== 'true') return;

      // Make seeking feel like a single-tap interaction (avoid text-selection behaviors).
      e.preventDefault();
      e.stopPropagation();

      const wordIndexStr = target.getAttribute('data-word-index');
      const wordIndex = wordIndexStr ? Number.parseInt(wordIndexStr, 10) : -1;
      if (!Number.isFinite(wordIndex) || wordIndex < 0) return;

      // Pass the word index directly (not as a fraction)
      onWordClickRef.current(wordIndex);
    };

    container.addEventListener('pointerdown', handlePointerDown, { passive: false });
    return () => {
      container.removeEventListener('pointerdown', handlePointerDown as any);
    };
  }, [content]);

  useEffect(() => {
    if (!containerRef.current) return;

    if (!isActive || currentWordIndex < 0) {
      if (lastHighlightedRef.current) {
        lastHighlightedRef.current.style.backgroundColor = '';
        lastHighlightedRef.current.style.color = '';
      }
      lastHighlightedRef.current = null;
      lastHighlightedIndexRef.current = -1;
      return;
    }

    if (lastHighlightedIndexRef.current === currentWordIndex) return;

    const words = wordElementsRef.current;
    if (currentWordIndex >= words.length) return;

    if (lastHighlightedRef.current) {
      lastHighlightedRef.current.style.backgroundColor = '';
      lastHighlightedRef.current.style.color = '';
    }

    const currentEl = words[currentWordIndex];
    currentEl.style.backgroundColor = '#fde047'; // yellow-300
    currentEl.style.color = '#312e81'; // indigo-900

    lastHighlightedRef.current = currentEl;
    lastHighlightedIndexRef.current = currentWordIndex;

    currentEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  }, [currentWordIndex, isActive]);

  return <div ref={containerRef} className={className} style={{ lineHeight: '1.6' }} />;
}

export default ClickableText;
