import { useState, useEffect, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker - use unpkg CDN with correct path for v4.x
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

/**
 * Hook for extracting PDF pages as images
 */
export function usePdfPreview() {
  const [pages, setPages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(0);

  const extractPages = useCallback(async (file, options = {}) => {
    const { scale = 1.5, pageRange = null, splitDoublePages = true } = options;

    setIsLoading(true);
    setError(null);
    setProgress(0);
    setPages([]);

    try {
      // Read file as ArrayBuffer
      const arrayBuffer = await file.arrayBuffer();

      // Load PDF document
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const totalPages = pdf.numPages;

      // Determine pages to extract
      let pagesToExtract = [];
      if (pageRange) {
        const [start, end] = pageRange;
        for (let i = Math.max(1, start); i <= Math.min(totalPages, end); i++) {
          pagesToExtract.push(i);
        }
      } else {
        for (let i = 1; i <= totalPages; i++) {
          pagesToExtract.push(i);
        }
      }

      const extractedPages = [];
      let imageCounter = 1;

      for (let i = 0; i < pagesToExtract.length; i++) {
        const pageNum = pagesToExtract[i];
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale });

        // Create canvas for rendering
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        // Render page to canvas
        await page.render({
          canvasContext: context,
          viewport: viewport,
        }).promise;

        // Check if this is a double page (width > height * 1.19)
        // Split logic from Python: if img.width > img.height * 1.19
        if (splitDoublePages && viewport.width > viewport.height * 1.19) {
          // Split into left and right pages
          const halfWidth = Math.floor(viewport.width / 2);
          
          // Left page
          const leftCanvas = document.createElement('canvas');
          leftCanvas.width = halfWidth;
          leftCanvas.height = viewport.height;
          const leftCtx = leftCanvas.getContext('2d');
          leftCtx.drawImage(canvas, 0, 0, halfWidth, viewport.height, 0, 0, halfWidth, viewport.height);
          
          extractedPages.push({
            pageNumber: imageCounter,
            originalPageNumber: pageNum,
            thumbnail: leftCanvas.toDataURL('image/png'),
            width: halfWidth,
            height: viewport.height,
            isSplit: true,
            splitSide: 'left',
          });
          imageCounter++;

          // Right page
          const rightCanvas = document.createElement('canvas');
          rightCanvas.width = halfWidth;
          rightCanvas.height = viewport.height;
          const rightCtx = rightCanvas.getContext('2d');
          rightCtx.drawImage(canvas, halfWidth, 0, halfWidth, viewport.height, 0, 0, halfWidth, viewport.height);
          
          extractedPages.push({
            pageNumber: imageCounter,
            originalPageNumber: pageNum,
            thumbnail: rightCanvas.toDataURL('image/png'),
            width: halfWidth,
            height: viewport.height,
            isSplit: true,
            splitSide: 'right',
          });
          imageCounter++;
        } else {
          // Single page - no split needed
          const thumbnail = canvas.toDataURL('image/png');

          extractedPages.push({
            pageNumber: imageCounter,
            originalPageNumber: pageNum,
            thumbnail,
            width: viewport.width,
            height: viewport.height,
            isSplit: false,
          });
          imageCounter++;
        }

        // Update progress
        setProgress(Math.round(((i + 1) / pagesToExtract.length) * 100));
      }

      setPages(extractedPages);
      return extractedPages;
    } catch (err) {
      console.error('PDF extraction error:', err);
      setError(err.message || 'Failed to extract PDF pages');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadImages = useCallback(async (files, options = {}) => {
    const { splitDoublePages = true } = options;
    
    setIsLoading(true);
    setError(null);
    setProgress(0);
    setPages([]);

    try {
      const loadedPages = [];
      let imageCounter = 1;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        // Read file as data URL
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('Failed to read file'));
          reader.readAsDataURL(file);
        });

        // Get image dimensions
        const imgData = await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () =>
            resolve({ width: img.width, height: img.height, img });
          img.onerror = () => reject(new Error('Failed to load image'));
          img.src = dataUrl;
        });

        // Check if double page and split if needed
        if (splitDoublePages && imgData.width > imgData.height * 1.19) {
          const halfWidth = Math.floor(imgData.width / 2);
          
          // Left page
          const leftCanvas = document.createElement('canvas');
          leftCanvas.width = halfWidth;
          leftCanvas.height = imgData.height;
          const leftCtx = leftCanvas.getContext('2d');
          leftCtx.drawImage(imgData.img, 0, 0, halfWidth, imgData.height, 0, 0, halfWidth, imgData.height);
          
          loadedPages.push({
            pageNumber: imageCounter,
            thumbnail: leftCanvas.toDataURL('image/png'),
            width: halfWidth,
            height: imgData.height,
            fileName: file.name,
            isSplit: true,
            splitSide: 'left',
          });
          imageCounter++;

          // Right page
          const rightCanvas = document.createElement('canvas');
          rightCanvas.width = halfWidth;
          rightCanvas.height = imgData.height;
          const rightCtx = rightCanvas.getContext('2d');
          rightCtx.drawImage(imgData.img, halfWidth, 0, halfWidth, imgData.height, 0, 0, halfWidth, imgData.height);
          
          loadedPages.push({
            pageNumber: imageCounter,
            thumbnail: rightCanvas.toDataURL('image/png'),
            width: halfWidth,
            height: imgData.height,
            fileName: file.name,
            isSplit: true,
            splitSide: 'right',
          });
          imageCounter++;
        } else {
          loadedPages.push({
            pageNumber: imageCounter,
            thumbnail: dataUrl,
            width: imgData.width,
            height: imgData.height,
            fileName: file.name,
            isSplit: false,
          });
          imageCounter++;
        }

        setProgress(Math.round(((i + 1) / files.length) * 100));
      }

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
