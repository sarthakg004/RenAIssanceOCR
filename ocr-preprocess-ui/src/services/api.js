/**
 * Mock API service for OCR preprocessing
 * Simulates backend responses with realistic delays
 */

// Simulate network delay
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Random delay between min and max ms
const randomDelay = (min = 300, max = 800) =>
  delay(Math.random() * (max - min) + min);

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
 * Preprocess an image (mock)
 * Applies visual transformations to simulate preprocessing
 */
export async function preprocessImage(imageUrl, pipeline) {
  console.log('Mock API: preprocessImage called', { imageUrl, pipeline });

  // Simulate processing delay
  await randomDelay(500, 1200);

  // Load the image
  const img = new Image();
  img.crossOrigin = 'anonymous';

  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = imageUrl;
  });

  // Create canvas for processing
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');

  // Draw original image
  ctx.drawImage(img, 0, 0);

  // Get image data for manipulation
  let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let data = imageData.data;

  // Apply operations based on pipeline
  for (const step of pipeline) {
    switch (step.op) {
      case 'grayscale':
        // Convert to grayscale
        for (let i = 0; i < data.length; i += 4) {
          const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
          data[i] = gray;
          data[i + 1] = gray;
          data[i + 2] = gray;
        }
        break;

      case 'contrast':
        // Enhance contrast (simplified CLAHE simulation)
        const clipLimit = step.params?.clipLimit || 2;
        const factor = (259 * (clipLimit * 50 + 255)) / (255 * (259 - clipLimit * 50));
        for (let i = 0; i < data.length; i += 4) {
          data[i] = Math.min(255, Math.max(0, factor * (data[i] - 128) + 128));
          data[i + 1] = Math.min(255, Math.max(0, factor * (data[i + 1] - 128) + 128));
          data[i + 2] = Math.min(255, Math.max(0, factor * (data[i + 2] - 128) + 128));
        }
        break;

      case 'binarize':
        // Simple threshold binarization
        const method = step.params?.method || 'otsu';
        let threshold = 128;

        if (method === 'otsu') {
          // Simplified Otsu's method
          const histogram = new Array(256).fill(0);
          for (let i = 0; i < data.length; i += 4) {
            const gray = Math.round(
              data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
            );
            histogram[gray]++;
          }

          const total = data.length / 4;
          let sum = 0;
          for (let i = 0; i < 256; i++) sum += i * histogram[i];

          let sumB = 0;
          let wB = 0;
          let maximum = 0;

          for (let i = 0; i < 256; i++) {
            wB += histogram[i];
            if (wB === 0) continue;
            const wF = total - wB;
            if (wF === 0) break;

            sumB += i * histogram[i];
            const mB = sumB / wB;
            const mF = (sum - sumB) / wF;
            const between = wB * wF * (mB - mF) * (mB - mF);

            if (between > maximum) {
              maximum = between;
              threshold = i;
            }
          }
        }

        for (let i = 0; i < data.length; i += 4) {
          const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
          const binary = gray > threshold ? 255 : 0;
          data[i] = binary;
          data[i + 1] = binary;
          data[i + 2] = binary;
        }
        break;

      case 'denoise':
        // Simple blur for noise reduction (simplified bilateral)
        const strength = step.params?.strength || 10;
        const radius = Math.floor(strength / 3);
        const tempData = new Uint8ClampedArray(data);

        for (let y = radius; y < canvas.height - radius; y++) {
          for (let x = radius; x < canvas.width - radius; x++) {
            let r = 0, g = 0, b = 0, count = 0;

            for (let dy = -radius; dy <= radius; dy++) {
              for (let dx = -radius; dx <= radius; dx++) {
                const idx = ((y + dy) * canvas.width + (x + dx)) * 4;
                r += tempData[idx];
                g += tempData[idx + 1];
                b += tempData[idx + 2];
                count++;
              }
            }

            const idx = (y * canvas.width + x) * 4;
            data[idx] = r / count;
            data[idx + 1] = g / count;
            data[idx + 2] = b / count;
          }
        }
        break;

      case 'deskew':
        // For demo purposes, apply a slight rotation correction
        ctx.putImageData(imageData, 0, 0);
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext('2d');

        tempCtx.fillStyle = '#fff';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

        // Simulate small rotation correction
        const angle = (Math.random() - 0.5) * 0.02; // ±0.01 radians
        tempCtx.translate(canvas.width / 2, canvas.height / 2);
        tempCtx.rotate(angle);
        tempCtx.translate(-canvas.width / 2, -canvas.height / 2);
        tempCtx.drawImage(canvas, 0, 0);

        ctx.drawImage(tempCanvas, 0, 0);
        imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        data = imageData.data;
        break;

      case 'morph':
        // Simplified morphological operation
        const operation = step.params?.operation || 'open';
        const kernelSize = step.params?.kernelSize || 2;

        // This is a very simplified version - real implementation would be more complex
        if (operation === 'dilate' || operation === 'close') {
          // Dilate: expand white regions
          const tempData2 = new Uint8ClampedArray(data);
          for (let y = kernelSize; y < canvas.height - kernelSize; y++) {
            for (let x = kernelSize; x < canvas.width - kernelSize; x++) {
              let maxVal = 0;
              for (let dy = -kernelSize; dy <= kernelSize; dy++) {
                for (let dx = -kernelSize; dx <= kernelSize; dx++) {
                  const idx = ((y + dy) * canvas.width + (x + dx)) * 4;
                  maxVal = Math.max(maxVal, tempData2[idx]);
                }
              }
              const idx = (y * canvas.width + x) * 4;
              data[idx] = maxVal;
              data[idx + 1] = maxVal;
              data[idx + 2] = maxVal;
            }
          }
        } else if (operation === 'erode' || operation === 'open') {
          // Erode: shrink white regions
          const tempData3 = new Uint8ClampedArray(data);
          for (let y = kernelSize; y < canvas.height - kernelSize; y++) {
            for (let x = kernelSize; x < canvas.width - kernelSize; x++) {
              let minVal = 255;
              for (let dy = -kernelSize; dy <= kernelSize; dy++) {
                for (let dx = -kernelSize; dx <= kernelSize; dx++) {
                  const idx = ((y + dy) * canvas.width + (x + dx)) * 4;
                  minVal = Math.min(minVal, tempData3[idx]);
                }
              }
              const idx = (y * canvas.width + x) * 4;
              data[idx] = minVal;
              data[idx + 1] = minVal;
              data[idx + 2] = minVal;
            }
          }
        }
        break;

      default:
        console.log('Unknown operation:', step.op);
    }
  }

  // Put processed data back
  ctx.putImageData(imageData, 0, 0);

  // Add visual indicator that image was processed
  ctx.fillStyle = 'rgba(37, 99, 235, 0.1)';
  ctx.fillRect(0, 0, 5, canvas.height);

  return canvas.toDataURL('image/png');
}

/**
 * Process multiple pages (mock batch)
 */
export async function preprocessBatch(images, pipeline) {
  console.log('Mock API: preprocessBatch called', { imageCount: images.length });

  const results = [];

  for (const image of images) {
    const processed = await preprocessImage(image.thumbnail, pipeline);
    results.push({
      pageNumber: image.pageNumber,
      processed,
    });
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
        { op: 'deskew', params: {} },
        { op: 'denoise', params: { method: 'nlm', strength: 10 } },
        { op: 'contrast', params: { method: 'clahe', clipLimit: 2, tileSize: 8 } },
        { op: 'binarize', params: { method: 'adaptive', blockSize: 15 } },
      ],
    },
    handwritten: {
      name: 'Handwritten',
      description: 'Optimized for handwritten documents',
      pipeline: [
        { op: 'deskew', params: {} },
        { op: 'denoise', params: { method: 'bilateral', strength: 15 } },
        { op: 'contrast', params: { method: 'clahe', clipLimit: 3, tileSize: 8 } },
        { op: 'binarize', params: { method: 'adaptive', blockSize: 21 } },
      ],
    },
    printed: {
      name: 'Printed Text',
      description: 'Best for clean printed documents',
      pipeline: [
        { op: 'grayscale', params: {} },
        { op: 'denoise', params: { method: 'nlm', strength: 5 } },
        { op: 'binarize', params: { method: 'otsu' } },
      ],
    },
    historical: {
      name: 'Historical Documents',
      description: 'For aged or degraded documents',
      pipeline: [
        { op: 'deskew', params: {} },
        { op: 'denoise', params: { method: 'nlm', strength: 15 } },
        { op: 'contrast', params: { method: 'clahe', clipLimit: 4, tileSize: 16 } },
        { op: 'binarize', params: { method: 'adaptive', blockSize: 25 } },
        { op: 'morph', params: { operation: 'close', kernelSize: 2, iterations: 1 } },
      ],
    },
  };
}
