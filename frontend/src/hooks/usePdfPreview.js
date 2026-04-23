import { useState, useCallback, useEffect, useRef } from 'react';

/**
 * Hook for extracting PDF pages and loading raw image files as page objects.
 *
 * PDF extraction runs inside a Web Worker (OffscreenCanvas) so it keeps making
 * progress when the tab is hidden — main-thread canvas work is throttled to
 * ~1 Hz in background tabs, which is what made progress appear to "freeze"
 * when switching tabs.
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

  // Tear down worker on unmount.
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, []);

  const extractPages = useCallback(async (file, options = {}) => {
    setIsLoading(true);
    setError(null);
    setProgress(0);
    setPages([]);

    // Recreate the worker per extraction so a stuck one can't poison later runs.
    if (workerRef.current) workerRef.current.terminate();
    const worker = makeWorker();
    workerRef.current = worker;

    const requestId = Date.now() + Math.random();
    const collected = [];

    try {
      const fileBuffer = await file.arrayBuffer();

      const result = await new Promise((resolve, reject) => {
        worker.onmessage = (e) => {
          const msg = e.data || {};
          if (msg.id !== requestId) return;
          if (msg.type === 'page') {
            collected.push(msg.page);
            // Stream pages into state so the UI can show partial results.
            setPages((prev) => [...prev, msg.page]);
          } else if (msg.type === 'progress') {
            setProgress(msg.progress);
          } else if (msg.type === 'done') {
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
      setIsLoading(false);
      // Keep worker alive in case the caller starts another extraction soon;
      // it'll be replaced on next call or torn down on unmount.
    }
  }, []);

  const loadImages = useCallback(async (files, options = {}) => {
    const { splitDoublePages = true } = options;

    setIsLoading(true);
    setError(null);
    setProgress(0);
    setPages([]);

    try {
      const total = files.length;
      let done = 0;
      // Preserve original order: index → page(s).
      const slots = new Array(total);

      const processOne = async (file, index) => {
        const fileIndex = index + 1;

        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('Failed to read file'));
          reader.readAsDataURL(file);
        });

        const imgData = await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve({ width: img.width, height: img.height, img });
          img.onerror = () => reject(new Error('Failed to load image'));
          img.src = dataUrl;
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
              thumbnail: leftCanvas.toDataURL('image/png'),
              width: halfWidth,
              height: imgData.height,
              fileName: file.name,
              isSplit: true,
              splitSide: 'left',
            },
            {
              pageNumber: `${fileIndex}_right`,
              thumbnail: rightCanvas.toDataURL('image/png'),
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
            thumbnail: dataUrl,
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
  }, []);

  const reset = useCallback(() => {
    setPages([]);
    setIsLoading(false);
    setError(null);
    setProgress(0);
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
  }, []);

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
