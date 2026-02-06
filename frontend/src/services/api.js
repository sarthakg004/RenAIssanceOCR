/**
 * API service for OCR preprocessing
 * Calls backend Python OpenCV-based preprocessing
 */

// Backend API base URL
const API_BASE = 'http://localhost:8000';

// Simulate network delay (for mock functions only)
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Convert PDF to images (mock)
 * In real implementation, this would call the Python backend
 */
export async function pdfToImages(pdfFile, options = {}) {
  console.log('Mock API: pdfToImages called', { pdfFile, options });

  // Simulate PDF processing delay
  await delay(1500);

  // Generate mock page thumbnails
  // In real app, these would be actual extracted page images
  const pageCount = Math.floor(Math.random() * 10) + 5; // 5-15 pages
  const pages = [];

  for (let i = 0; i < pageCount; i++) {
    // Create a mock thumbnail using canvas
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 550;
    const ctx = canvas.getContext('2d');

    // Draw page background
    ctx.fillStyle = '#fefefe';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw page border
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 2;
    ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);

    // Draw mock text lines
    ctx.fillStyle = '#333';
    const lineHeight = 20;
    const margin = 40;
    const textWidth = canvas.width - margin * 2;

    for (let y = 60; y < canvas.height - 80; y += lineHeight * 1.5) {
      // Random line length for realistic look
      const lineLength = 0.5 + Math.random() * 0.5;
      ctx.fillRect(margin, y, textWidth * lineLength, 8);
    }

    // Draw page number
    ctx.font = '16px Arial';
    ctx.fillStyle = '#666';
    ctx.textAlign = 'center';
    ctx.fillText(`Page ${i + 1}`, canvas.width / 2, canvas.height - 30);

    pages.push({
      pageNumber: i + 1,
      thumbnail: canvas.toDataURL('image/png'),
      width: canvas.width,
      height: canvas.height,
    });
  }

  return {
    success: true,
    pageCount,
    pages,
  };
}

/**
 * Preprocess an image using backend OpenCV pipeline
 * Sends image to Python backend for processing
 */
export async function preprocessImage(imageUrl, pipeline) {
  console.log('API: preprocessImage called', { imageUrl: imageUrl?.substring(0, 50), pipeline });

  try {
    // Convert pipeline format to backend format
    const operations = pipeline.map(step => ({
      op: step.op,
      params: step.params || {},
      enabled: true,
    }));

    const response = await fetch(`${API_BASE}/api/preprocess`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image_data: imageUrl,
        operations: operations,
        preview_mode: false,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(error.detail?.message || error.detail || 'Preprocessing failed');
    }

    const result = await response.json();

    if (!result.success) {
      console.warn('Preprocessing had errors:', result.errors);
    }

    // Return the processed image data URL
    return result.processed_image || imageUrl;

  } catch (error) {
    console.error('Preprocessing API error:', error);
    // Return original image on error
    return imageUrl;
  }
}

/**
 * Preprocess an image with progress callback
 * For UI progress display during processing
 */
export async function preprocessImageWithProgress(imageUrl, pipeline, onProgress) {
  console.log('API: preprocessImageWithProgress called', { pipeline });

  try {
    // Notify starting
    if (onProgress) {
      onProgress({ step: 'starting', percent: 0, message: 'Starting preprocessing...' });
    }

    // Convert pipeline format
    const operations = pipeline.map(step => ({
      op: step.op,
      params: step.params || {},
      enabled: true,
    }));

    // Simulate initial progress
    if (onProgress) {
      onProgress({ step: 'uploading', percent: 10, message: 'Sending to backend...' });
    }

    const response = await fetch(`${API_BASE}/api/preprocess`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image_data: imageUrl,
        operations: operations,
        preview_mode: false,
      }),
    });

    if (onProgress) {
      onProgress({ step: 'processing', percent: 50, message: 'Processing image...' });
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(error.detail?.message || error.detail || 'Preprocessing failed');
    }

    const result = await response.json();

    if (onProgress) {
      onProgress({ step: 'complete', percent: 100, message: 'Complete' });
    }

    return {
      success: result.success,
      processedImage: result.processed_image || imageUrl,
      progressInfo: result.progress_info,
      errors: result.errors,
    };

  } catch (error) {
    console.error('Preprocessing API error:', error);
    if (onProgress) {
      onProgress({ step: 'error', percent: 0, message: error.message });
    }
    throw error;
  }
}

/**
 * Get available preprocessing operations from backend
 */
export async function getAvailableOperations() {
  try {
    const response = await fetch(`${API_BASE}/api/preprocess/operations`);
    if (!response.ok) {
      throw new Error('Failed to fetch operations');
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch operations:', error);
    // Return default list on error
    return {
      operations: ['normalize', 'grayscale', 'deskew', 'denoise', 'contrast', 'sharpen', 'threshold'],
    };
  }
}

/**
 * Process multiple pages (batch preprocessing)
 */
export async function preprocessBatch(images, pipeline, onProgress) {
  console.log('API: preprocessBatch called', { imageCount: images.length });

  const results = [];

  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    
    if (onProgress) {
      onProgress({
        step: `page_${image.pageNumber}`,
        percent: (i / images.length) * 100,
        message: `Processing page ${image.pageNumber}...`,
      });
    }

    const processed = await preprocessImage(image.thumbnail, pipeline);
    results.push({
      pageNumber: image.pageNumber,
      processed,
    });
  }

  if (onProgress) {
    onProgress({ step: 'complete', percent: 100, message: 'Batch complete' });
  }

  return {
    success: true,
    results,
  };
}

/**
 * Get preprocessing presets
 */
export function getPresets() {
  return {
    recommended: {
      name: 'Recommended',
      description: 'Best for most documents',
      pipeline: [
        { op: 'grayscale', params: {} },
        { op: 'deskew', params: {} },
        { op: 'denoise', params: { method: 'nlm', strength: 10 } },
        { op: 'contrast', params: { clipLimit: 2, tileSize: 8 } },
        { op: 'threshold', params: { method: 'otsu' } },
      ],
    },
    handwritten: {
      name: 'Handwritten',
      description: 'Optimized for handwritten documents',
      pipeline: [
        { op: 'grayscale', params: {} },
        { op: 'deskew', params: {} },
        { op: 'denoise', params: { method: 'bilateral', strength: 15 } },
        { op: 'contrast', params: { clipLimit: 3, tileSize: 8 } },
        { op: 'threshold', params: { method: 'adaptive', blockSize: 21 } },
      ],
    },
    printed: {
      name: 'Printed Text',
      description: 'Best for clean printed documents',
      pipeline: [
        { op: 'grayscale', params: {} },
        { op: 'denoise', params: { method: 'nlm', strength: 5 } },
        { op: 'threshold', params: { method: 'otsu' } },
      ],
    },
  };
}
