import { useState, useCallback, useEffect, useRef } from 'react';

/**
 * Hook for extracting PDF pages and loading raw image files as page objects.
 *
 * PDF extraction runs inside a Web Worker (OffscreenCanvas) so it keeps making
 * progress when the tab is hidden — main-thread canvas work is throttled to
 * ~1 Hz in background tabs, which is what made progress appear to "freeze"
 * when switching tabs.
 *
 * Page images are stored as Blob-backed object URLs, not base64 data URLs:
 * a data URL keeps the whole encoded image on the JS heap per page (hundreds
 * of MB → GBs for large books, which made the UI lag), while an object URL is
 * a ~50-char pointer with the pixels in browser-managed storage.
 *
 * Image loading is parallelised with a small concurrency cap (workers don't
 * help here because <img> decode + <canvas> ops only exist on the main thread,
 * but parallel I/O drains the queue regardless of timer throttling).
 */

const IMAGE_CONCURRENCY = 4;

function makeWorker() {
  return new Worker(
    new URL('../workers/pdfExtractor.worker.js', import.meta.url),
    { type: 'module' }
  );
}

export function usePdfPreview() {
  const [pages, setPages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(0);

  const workerRef = useRef(null);
  // Object URLs created for the current page set; revoked on reset / reload.
  const objectUrlsRef = useRef([]);

  const revokeAllUrls = useCallback(() => {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current = [];
  }, []);

  const trackUrl = useCallback((url) => {
    objectUrlsRef.current.push(url);
    return url;
  }, []);

  // Tear down worker + URLs on unmount.
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
      revokeAllUrls();
    };
  }, [revokeAllUrls]);

  const extractPages = useCallback(async (file, options = {}) => {
    setIsLoading(true);
    setError(null);
    setProgress(0);
    setPages([]);
    revokeAllUrls();

    // Recreate the worker per extraction so a stuck one can't poison later runs.
    if (workerRef.current) workerRef.current.terminate();
    const worker = makeWorker();
    workerRef.current = worker;

    const requestId = Date.now() + Math.random();
    const collected = [];
    // Buffer streamed pages and flush at most a few times per second — a
    // setPages per page re-renders the whole thumbnail grid N times for an
    // N-page book.
    let pending = [];
    let flushTimer = null;
    const flush = () => {
      flushTimer = null;
      if (pending.length === 0) return;
      const batch = pending;
      pending = [];
      setPages((prev) => [...prev, ...batch]);
    };

    try {
      const fileBuffer = await file.arrayBuffer();

      const result = await new Promise((resolve, reject) => {
        worker.onmessage = (e) => {
          const msg = e.data || {};
          if (msg.id !== requestId) return;
          if (msg.type === 'page') {
            const { blob, ...rest } = msg.page;
            const page = { ...rest, thumbnail: trackUrl(URL.createObjectURL(blob)) };
            collected.push(page);
            pending.push(page);
            if (!flushTimer) flushTimer = setTimeout(flush, 200);
          } else if (msg.type === 'progress') {
            setProgress(msg.progress);
          } else if (msg.type === 'done') {
            flush();
            resolve(collected);
          } else if (msg.type === 'error') {
            reject(new Error(msg.error));
          }
        };
        worker.onerror = (e) => reject(new Error(e.message || 'PDF worker crashed'));

        // Transfer the ArrayBuffer to avoid a copy.
        worker.postMessage(
          { type: 'extract', id: requestId, fileBuffer, options },
          [fileBuffer]
        );
      });

      return result;
    } catch (err) {
      console.error('PDF extraction error:', err);
      setError(err.message || 'Failed to extract PDF pages');
      throw err;
    } finally {
      if (flushTimer) clearTimeout(flushTimer);
      setIsLoading(false);
      // Keep worker alive in case the caller starts another extraction soon;
      // it'll be replaced on next call or torn down on unmount.
    }
  }, [revokeAllUrls, trackUrl]);

  const loadImages = useCallback(async (files, options = {}) => {
    const { splitDoublePages = true } = options;

    setIsLoading(true);
    setError(null);
    setProgress(0);
    setPages([]);
    revokeAllUrls();

    try {
      const total = files.length;
      let done = 0;
      // Preserve original order: index → page(s).
      const slots = new Array(total);

      const canvasToUrl = (canvas) => new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(trackUrl(URL.createObjectURL(blob)));
          else reject(new Error('Failed to encode split page'));
        }, 'image/png');
      });

      const processOne = async (file, index) => {
        const fileIndex = index + 1;
        // The file itself backs the object URL — no read, no re-encode.
        const fileUrl = trackUrl(URL.createObjectURL(file));

        const imgData = await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve({ width: img.width, height: img.height, img });
          img.onerror = () => reject(new Error('Failed to load image'));
          img.src = fileUrl;
        });

        let produced;
        if (splitDoublePages && imgData.width > imgData.height * 1.19) {
          const halfWidth = Math.floor(imgData.width / 2);

          const leftCanvas = document.createElement('canvas');
          leftCanvas.width = halfWidth;
          leftCanvas.height = imgData.height;
          leftCanvas
            .getContext('2d')
            .drawImage(imgData.img, 0, 0, halfWidth, imgData.height, 0, 0, halfWidth, imgData.height);

          const rightCanvas = document.createElement('canvas');
          rightCanvas.width = halfWidth;
          rightCanvas.height = imgData.height;
          rightCanvas
            .getContext('2d')
            .drawImage(imgData.img, halfWidth, 0, halfWidth, imgData.height, 0, 0, halfWidth, imgData.height);

          produced = [
            {
              pageNumber: `${fileIndex}_left`,
              thumbnail: await canvasToUrl(leftCanvas),
              width: halfWidth,
              height: imgData.height,
              fileName: file.name,
              isSplit: true,
              splitSide: 'left',
            },
            {
              pageNumber: `${fileIndex}_right`,
              thumbnail: await canvasToUrl(rightCanvas),
              width: halfWidth,
              height: imgData.height,
              fileName: file.name,
              isSplit: true,
              splitSide: 'right',
            },
          ];
        } else {
          produced = [{
            pageNumber: fileIndex,
            thumbnail: fileUrl,
            width: imgData.width,
            height: imgData.height,
            fileName: file.name,
            isSplit: false,
          }];
        }

        slots[index] = produced;
        done += 1;
        setProgress(Math.round((done / total) * 100));
      };

      // Bounded-concurrency runner: each "lane" pulls the next index until exhausted.
      let cursor = 0;
      const lanes = Array.from({ length: Math.min(IMAGE_CONCURRENCY, total) }, async () => {
        while (true) {
          const idx = cursor++;
          if (idx >= total) return;
          await processOne(files[idx], idx);
        }
      });
      await Promise.all(lanes);

      const loadedPages = slots.flat().filter(Boolean);
      setPages(loadedPages);
      return loadedPages;
    } catch (err) {
      console.error('Image loading error:', err);
      setError(err.message || 'Failed to load images');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [revokeAllUrls, trackUrl]);

  const reset = useCallback(() => {
    setPages([]);
    setIsLoading(false);
    setError(null);
    setProgress(0);
    revokeAllUrls();
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
  }, [revokeAllUrls]);

  return {
    pages,
    isLoading,
    error,
    progress,
    extractPages,
    loadImages,
    reset,
  };
}

export default usePdfPreview;
