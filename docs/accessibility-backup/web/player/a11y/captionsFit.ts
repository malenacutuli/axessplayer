// utils/captionsFit.ts (lifted verbatim from the Axessible engine; `any` relaxed to `unknown` for lint)
export type Word = { text: string; startTime: number; endTime: number; emphasis?: string; pitch?: string; syllables?: unknown };
export type Seg<T = unknown> = T & { text: string; startTime: number; endTime: number; words: Word[] };

export type FontOpts = {
  // computed font for current segment (after intensity scaling)
  fontFamily: string; // e.g., 'Inter, system-ui, ...'
  fontSizePx: number; // final px used to render words
  fontWeight?: number | string; // 400/600/700...
  letterSpacingPx?: number;
};

let _canvas: HTMLCanvasElement | null = null;
function measure(text: string, opts: FontOpts) {
  if (!_canvas) _canvas = document.createElement('canvas');
  const ctx = _canvas.getContext('2d')!;
  ctx.font = `${opts.fontWeight ?? 600} ${opts.fontSizePx}px ${opts.fontFamily}`;
  // crude letter-spacing approximation:
  const ls = opts.letterSpacingPx ?? 0;
  const w = ctx.measureText(text).width + (text.length - 1) * ls;
  return w;
}

/**
 * Split a segment into sequential "pages" where each page contains up to TWO lines
 * that fit within maxWidthPx. Uses pixel measurement so it's device-accurate.
 * Words retain their original timings. No word is dropped or duplicated.
 */
export function paginateTwoLinesByWidth<T = unknown>(
  seg: Seg<T>,
  opts: FontOpts,
  maxWidthPx: number
): Array<Seg<T> & { _pageIndex: number; _originKey: string }> {
  if (!seg.words || seg.words.length === 0) return [{
    ...seg, _pageIndex: 0, _originKey: `${seg.startTime}-${seg.endTime}-${seg.text}`
  }];

  const originKey = `${seg.startTime}-${seg.endTime}-${seg.text}`;
  const pages: Array<Seg<T> & { _pageIndex: number; _originKey: string }> = [];

  let i = 0; // index into words
  while (i < seg.words.length) {
    // Build up to two lines greedily by visual width
    const line1: Word[] = [];
    const line2: Word[] = [];
    let width1 = 0, width2 = 0;

    // helper to try push a word into a given line
    const tryPush = (line: Word[], widthSoFar: number, w: Word): [boolean, number] => {
      const trialText = (line.length ? (line.map(x => x.text).join(' ') + ' ' + w.text) : w.text);
      const trialWidth = measure(trialText, opts);
      if (trialWidth <= maxWidthPx) {
        line.push(w);
        return [true, trialWidth];
      }
      return [false, widthSoFar];
    };

    // Fill line 1
    while (i < seg.words.length) {
      const [ok, newW] = tryPush(line1, width1, seg.words[i]);
      if (!ok) break;
      width1 = newW; i++;
    }
    if (line1.length === 0) {
      // single word longer than container → force it alone, it will wrap naturally
      line1.push(seg.words[i]); i++;
    }

    // Fill line 2
    while (i < seg.words.length) {
      const [ok, newW] = tryPush(line2, width2, seg.words[i]);
      if (!ok) break;
      width2 = newW; i++;
    }

    const pageWords = [...line1, ...line2];
    const pageText = pageWords.map(w => w.text).join(' ');
    pages.push({
      ...seg,
      text: pageText,
      words: pageWords,
      startTime: pageWords[0].startTime,
      endTime: pageWords[pageWords.length - 1].endTime,
      _pageIndex: pages.length,
      _originKey: originKey
    });
  }

  return pages;
}

