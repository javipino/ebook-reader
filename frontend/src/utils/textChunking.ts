/**
 * Splits HTML content into readable chunks (paragraphs) for efficient TTS processing.
 * Minimizes token consumption by sending smaller text sections.
 */

export interface TextChunk {
  text: string;
  startIndex: number;
  endIndex: number;
}

/**
 * Extracts plain text from HTML while preserving structure
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Splits content into chunks based on natural boundaries (paragraphs, sentences).
 * Aims for chunks of 300-500 characters for optimal TTS processing.
 */
export function splitIntoChunks(content: string, maxChunkSize: number = 500): TextChunk[] {
  const plainText = stripHtml(content);
  const chunks: TextChunk[] = [];
  
  if (!plainText || plainText.length === 0) {
    return chunks;
  }

  // Split by double newlines (paragraphs) first
  const paragraphs = plainText.split(/\n\n+/).filter(p => p.trim().length > 0);
  
  let currentIndex = 0;
  
  for (const paragraph of paragraphs) {
    const trimmedParagraph = paragraph.trim();
    
    if (trimmedParagraph.length === 0) {
      continue;
    }

    // If paragraph is small enough, add it as a single chunk
    if (trimmedParagraph.length <= maxChunkSize) {
      chunks.push({
        text: trimmedParagraph,
        startIndex: currentIndex,
        endIndex: currentIndex + trimmedParagraph.length
      });
      currentIndex += trimmedParagraph.length;
    } else {
      // Split large paragraph by sentences
      const sentences = trimmedParagraph.match(/[^.!?]+[.!?]+/g) || [trimmedParagraph];
      let currentChunk = '';
      let chunkStartIndex = currentIndex;

      for (const sentence of sentences) {
        const trimmedSentence = sentence.trim();
        
        if (currentChunk.length + trimmedSentence.length <= maxChunkSize) {
          currentChunk += (currentChunk ? ' ' : '') + trimmedSentence;
        } else {
          // Save current chunk if not empty
          if (currentChunk) {
            chunks.push({
              text: currentChunk,
              startIndex: chunkStartIndex,
              endIndex: chunkStartIndex + currentChunk.length
            });
            chunkStartIndex += currentChunk.length;
          }
          
          // Start new chunk with current sentence
          // If sentence itself is too long, split it by commas
          if (trimmedSentence.length > maxChunkSize) {
            const parts = trimmedSentence.split(/,\s+/);
            for (const part of parts) {
              const trimmedPart = part.trim();
              if (trimmedPart.length > 0) {
                chunks.push({
                  text: trimmedPart,
                  startIndex: chunkStartIndex,
                  endIndex: chunkStartIndex + trimmedPart.length
                });
                chunkStartIndex += trimmedPart.length;
              }
            }
            currentChunk = '';
          } else {
            currentChunk = trimmedSentence;
          }
        }
      }

      // Add remaining chunk
      if (currentChunk) {
        chunks.push({
          text: currentChunk,
          startIndex: chunkStartIndex,
          endIndex: chunkStartIndex + currentChunk.length
        });
        currentIndex = chunkStartIndex + currentChunk.length;
      } else {
        currentIndex = chunkStartIndex;
      }
    }
  }

  return chunks;
}

/**
 * Gets a specific chunk by index
 */
export function getChunk(content: string, chunkIndex: number, maxChunkSize: number = 500): TextChunk | null {
  const chunks = splitIntoChunks(content, maxChunkSize);
  return chunks[chunkIndex] || null;
}

/**
 * Gets total number of chunks in content
 */
export function getTotalChunks(content: string, maxChunkSize: number = 500): number {
  return splitIntoChunks(content, maxChunkSize).length;
}
