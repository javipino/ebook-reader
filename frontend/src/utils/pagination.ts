const LINES_PER_PAGE = 28;
const CHARS_PER_LINE = 75;

export function normalizeNewlines(content: string): string {
  return content.replace(/\\n/g, '\n');
}

export function getPageBreaks(content: string): number[] {
  const text = normalizeNewlines(content);
  const pageBreaks: number[] = [0];
  let lineCount = 0;
  let charInCurrentLine = 0;
  let prevChar = '';
  let lastLineEndPos = 0;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === '\n') {
      lineCount++;
      charInCurrentLine = 0;
      lastLineEndPos = i + 1;

      if (prevChar === '\n') {
        lineCount++;
      }

      if (lineCount >= LINES_PER_PAGE) {
        pageBreaks.push(lastLineEndPos);
        lineCount = 0;
        charInCurrentLine = 0;
        prevChar = '';
      }
    } else if (char === ' ') {
      charInCurrentLine++;
      if (charInCurrentLine >= CHARS_PER_LINE) {
        lineCount++;
        charInCurrentLine = 0;
        lastLineEndPos = i + 1;

        if (lineCount >= LINES_PER_PAGE) {
          pageBreaks.push(lastLineEndPos);
          lineCount = 0;
          charInCurrentLine = 0;
          prevChar = '';
        }
      }
    } else {
      charInCurrentLine++;
      if (charInCurrentLine >= CHARS_PER_LINE) {
        let wrapPoint = i;
        while (wrapPoint > lastLineEndPos && text[wrapPoint] !== ' ') {
          wrapPoint--;
        }
        if (wrapPoint > lastLineEndPos) {
          lineCount++;
          charInCurrentLine = i - wrapPoint;
          lastLineEndPos = wrapPoint + 1;

          if (lineCount >= LINES_PER_PAGE) {
            pageBreaks.push(lastLineEndPos);
            lineCount = 0;
            charInCurrentLine = i - wrapPoint;
            prevChar = '';
          }
        } else {
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
}

export function getPageContent(content: string, pageIndex: number): string {
  const text = normalizeNewlines(content);
  const pageBreaks = getPageBreaks(content);

  const startChar = pageBreaks[pageIndex] || 0;
  const endChar = pageBreaks[pageIndex + 1] || text.length;
  const pageText = text.slice(startChar, endChar);

  return pageText.replace(/\n/g, '<br />');
}

export function getTotalPages(content: string): number {
  const pageBreaks = getPageBreaks(content);
  return pageBreaks.length - 1;
}
