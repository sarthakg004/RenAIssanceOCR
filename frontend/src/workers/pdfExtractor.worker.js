/**
 * PDF extraction worker.
 *
 * Renders PDF pages on an OffscreenCanvas off the main thread so extraction
 * keeps running at full speed even when the browser tab is hidden (background
 * tabs aggressively throttle main-thread timers / canvas work, but workers
 * are not throttled the same way).
 *
 * Protocol:
 *   in:  { type: 'extract', id, fileBuffer, options: { scale, pageRange, splitDoublePages } }
 *   out: { type: 'page',     id, page }     // streamed per page
 *        { type: 'progress', id, progress } // 0–100
 *        { type: 'done',     id }
 *        { type: 'error',    id, error }
 */

import * as pdfjsLib from 'pdfjs-dist';
// Vite resolves this URL at build time and bundles the worker.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * PDF.js's default DOMCanvasFactory calls `document.createElement('canvas')`
 * for internal scratch canvases (masks, patterns, etc.). `document` doesn't
 * exist inside a Web Worker, so we provide an OffscreenCanvas-backed factory.
 */
class OffscreenCanvasFactory {
  create(width, height) {
    if (width <= 0 || height <= 0) {
      throw new Error('Invalid canvas size');
    }
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    return { canvas, context };
  }
  reset(canvasAndContext, width, height) {
    if (!canvasAndContext.canvas) throw new Error('Canvas is not specified');
    if (width <= 0 || height <= 0) throw new Error('Invalid canvas size');
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }
  destroy(canvasAndContext) {
    if (!canvasAndContext.canvas) return;
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

async function offscreenToDataURL(canvas) {
  // OffscreenCanvas has no toDataURL — go via blob → FileReader.
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to encode page as data URL'));
    reader.readAsDataURL(blob);
  });
}

async function renderPage(pdf, pageNum, scale, splitDoublePages) {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  const canvas = new OffscreenCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;

  const isDouble = splitDoublePages && viewport.width > viewport.height * 1.19;

  if (!isDouble) {
    const dataUrl = await offscreenToDataURL(canvas);
    return [{
      pageNumber: pageNum,
      originalPageNumber: pageNum,
      thumbnail: dataUrl,
      width: viewport.width,
      height: viewport.height,
      isSplit: false,
    }];
  }

  // Split double-page spread into left / right halves.
  const halfWidth = Math.floor(viewport.width / 2);
  const out = [];
  for (const side of ['left', 'right']) {
    const sideCanvas = new OffscreenCanvas(halfWidth, viewport.height);
    const sideCtx = sideCanvas.getContext('2d');
    const srcX = side === 'left' ? 0 : halfWidth;
    sideCtx.drawImage(canvas, srcX, 0, halfWidth, viewport.height, 0, 0, halfWidth, viewport.height);
    const dataUrl = await offscreenToDataURL(sideCanvas);
    out.push({
      pageNumber: `${pageNum}_${side}`,
      originalPageNumber: pageNum,
      thumbnail: dataUrl,
      width: halfWidth,
      height: viewport.height,
      isSplit: true,
      splitSide: side,
    });
  }
  return out;
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  if (msg.type !== 'extract') return;
  const { id, fileBuffer, options = {} } = msg;
  const { scale = 1.5, pageRange = null, splitDoublePages = true } = options;

  try {
    const pdf = await pdfjsLib.getDocument({
      data: fileBuffer,
      CanvasFactory: OffscreenCanvasFactory,
    }).promise;
    const totalPages = pdf.numPages;

    let pagesToExtract = [];
    if (pageRange) {
      const [start, end] = pageRange;
      for (let i = Math.max(1, start); i <= Math.min(totalPages, end); i++) pagesToExtract.push(i);
    } else {
      for (let i = 1; i <= totalPages; i++) pagesToExtract.push(i);
    }

    for (let i = 0; i < pagesToExtract.length; i++) {
      const pageNum = pagesToExtract[i];
      const rendered = await renderPage(pdf, pageNum, scale, splitDoublePages);
      for (const page of rendered) {
        self.postMessage({ type: 'page', id, page });
      }
      const progress = Math.round(((i + 1) / pagesToExtract.length) * 100);
      self.postMessage({ type: 'progress', id, progress });
    }

    self.postMessage({ type: 'done', id });
  } catch (err) {
    self.postMessage({ type: 'error', id, error: err?.message || String(err) });
  }
};
