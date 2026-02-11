/**
 * Gemini OCR API Service
 * Handles communication with the FastAPI backend for Gemini-based OCR
 */

const API_BASE = 'http://localhost:8000/api';

/**
 * Get available Gemini models
 */
export async function getAvailableModels() {
  const response = await fetch(`${API_BASE}/models`);
  if (!response.ok) {
    throw new Error('Failed to fetch models');
  }
  return response.json();
}

/**
 * Get current rate limit status
 * @returns {Promise<{ready: boolean, wait_seconds: number, available_slots: number}>}
 */
export async function getRateLimitStatus() {
  try {
    const response = await fetch(`${API_BASE}/rate-limit-status`);
    if (!response.ok) {
      // Return safe defaults if endpoint fails
      return { ready: true, wait_seconds: 0, available_slots: 5 };
    }
    const data = await response.json();
    // Handle both old format (without available_slots) and new format
    return {
      ready: data.ready ?? true,
      wait_seconds: data.wait_seconds ?? 0,
      available_slots: data.available_slots ?? (data.ready ? 5 : 0),
      requests_in_window: data.requests_in_window ?? 0,
    };
  } catch (error) {
    console.error('Failed to fetch rate limit status:', error);
    // Return safe defaults on error
    return { ready: true, wait_seconds: 0, available_slots: 5 };
  }
}

/**
 * Process a single page with Gemini OCR using base64 image data
 * 
 * Uses JSON body instead of FormData to support large images (up to 100MB).
 * FormData has a default 1MB per-part limit in browsers/servers.
 * 
 * @param {string} imageData - Base64 encoded image (with data URL prefix)
 * @param {string} model - Gemini model name
 * @param {string} apiKey - Gemini API key
 * @returns {Promise<{success: boolean, transcript?: string, error?: string}>}
 */
export async function processPageOCR(imageData, model, apiKey) {
  // Check rate limit first
  const rateLimitStatus = await getRateLimitStatus();
  if (!rateLimitStatus.ready) {
    return {
      success: false,
      error: 'rate_limited',
      waitSeconds: rateLimitStatus.wait_seconds,
    };
  }

  const response = await fetch(`${API_BASE}/gemini-ocr-json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Gemini-API-Key': apiKey,
    },
    body: JSON.stringify({
      image_data: imageData,
      model: model,
    }),
  });

  if (response.status === 429) {
    const errorData = await response.json();
    return {
      success: false,
      error: 'rate_limited',
      waitSeconds: errorData.detail?.wait_seconds || 20,
    };
  }

  if (response.status === 401) {
    return {
      success: false,
      error: 'invalid_api_key',
    };
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    return {
      success: false,
      error: errorData.detail || 'OCR processing failed',
    };
  }

  const data = await response.json();
  return data;
}

/**
 * Process multiple pages with Gemini OCR concurrently (batch processing)
 * 
 * Processes up to 4 pages at once to maximize throughput within rate limits.
 * The Gemini free tier allows 5 requests per minute, so batching 4 requests
 * at a time is safe and ~4x faster than sequential processing.
 * 
 * @param {Array<{pageIndex: number, imageData: string}>} items - Array of pages to process
 * @param {string} model - Gemini model name
 * @param {string} apiKey - Gemini API key
 * @returns {Promise<{success: boolean, results?: Array, error?: string}>}
 */
export async function processBatchOCR(items, model, apiKey) {
  if (!items || items.length === 0) {
    return { success: false, error: 'No items to process' };
  }

  try {
    // Check rate limit first
    const rateLimitStatus = await getRateLimitStatus();
    if (!rateLimitStatus.ready || rateLimitStatus.available_slots < items.length) {
      return {
        success: false,
        error: 'rate_limited',
        waitSeconds: rateLimitStatus.wait_seconds || 60,
        availableSlots: rateLimitStatus.available_slots || 0,
      };
    }

    const response = await fetch(`${API_BASE}/gemini-ocr-batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Gemini-API-Key': apiKey,
      },
      body: JSON.stringify({
        items: items.map(item => ({
          page_index: item.pageIndex,
          image_data: item.imageData,
        })),
        model: model,
      }),
    });

    if (response.status === 429) {
      const errorData = await response.json().catch(() => ({}));
      return {
        success: false,
        error: 'rate_limited',
        waitSeconds: errorData.detail?.wait_seconds || 60,
        availableSlots: errorData.detail?.available_slots || 0,
      };
    }

    if (response.status === 401) {
      return {
        success: false,
        error: 'invalid_api_key',
      };
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        success: false,
        error: errorData.detail || `Batch OCR failed with status ${response.status}`,
      };
    }

    const data = await response.json();
    
    // Check if any results indicate quota exceeded (daily limit)
    const quotaExceeded = data.results?.some(r => 
      !r.success && r.error && (
        r.error.toLowerCase().includes('quota') ||
        r.error.toLowerCase().includes('resource_exhausted') ||
        r.error.toLowerCase().includes('rate limit') ||
        r.error.includes('429')
      )
    );
    
    return {
      success: true,
      results: data.results,
      successfulCount: data.successful_count,
      failedCount: data.failed_count,
      totalProcessingTimeMs: data.total_processing_time_ms,
      quotaExceeded: quotaExceeded,
    };
  } catch (error) {
    console.error('Batch OCR error:', error);
    return {
      success: false,
      error: error.message || 'Batch OCR processing failed',
    };
  }
}

/**
 * Export transcripts as a combined document
 * Only includes pages that have actual transcripts (non-empty)
 * 
 * @param {Object} transcripts - Object with page numbers as keys and transcript text as values
 * @param {string} format - Export format: 'txt', 'docx', or 'pdf'
 * @returns {Promise<Blob>}
 */
export async function exportTranscripts(transcripts, format) {
  // Filter out empty transcripts - only include pages with actual content
  const filteredTranscripts = {};
  for (const [pageNum, text] of Object.entries(transcripts)) {
    if (text && text.trim().length > 0) {
      filteredTranscripts[pageNum] = text;
    }
  }
  
  // Check if there's anything to export
  if (Object.keys(filteredTranscripts).length === 0) {
    throw new Error('No transcripts to export');
  }

  const response = await fetch(`${API_BASE}/export/${format}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ transcripts: filteredTranscripts, format }),
  });

  if (!response.ok) {
    throw new Error(`Export failed: ${response.statusText}`);
  }

  return response.blob();
}

/**
 * Download a blob as a file
 * 
 * @param {Blob} blob - File blob
 * @param {string} filename - Desired filename
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Check if backend is healthy
 */
export async function checkBackendHealth() {
  try {
    const response = await fetch(`${API_BASE}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Validate a Gemini API key (legacy - use verifyApiKey instead)
 * 
 * @param {string} apiKey - The API key to validate
 * @returns {Promise<{valid: boolean, error?: string}>}
 */
export async function validateApiKey(apiKey) {
  return verifyApiKey(apiKey);
}

/**
 * Verify a Gemini API key format.
 * 
 * Note: We no longer make an actual API call to validate because:
 * 1. It wastes quota (rate limits)
 * 2. The key will be validated on first OCR request
 * 3. Rate limit errors would falsely mark valid keys as invalid
 * 
 * @param {string} apiKey - The API key to verify
 * @returns {Promise<{valid: boolean, error?: string, message?: string}>}
 */
export async function verifyApiKey(apiKey) {
  // Basic format check
  if (!apiKey) {
    return { valid: false, error: 'API key is required' };
  }
  
  if (apiKey.length < 20) {
    return { valid: false, error: 'API key appears too short' };
  }

  try {
    const response = await fetch(`${API_BASE}/validate-key`, {
      method: 'POST',
      headers: {
        'X-Gemini-API-Key': apiKey,
      },
    });

    // Only mark as invalid if we get a 401 (explicit auth failure)
    if (response.status === 401) {
      const data = await response.json().catch(() => ({}));
      return { valid: false, error: data.detail || 'Invalid API key format' };
    }

    // Success - format is valid
    if (response.ok) {
      const data = await response.json().catch(() => ({}));
      return { 
        valid: true, 
        message: data.message || 'API key format verified. Will be validated on first use.'
      };
    }

    // Other errors - still accept the key (will be validated on use)
    return { 
      valid: true, 
      message: 'Could not verify with server, but format looks valid. Will be validated on first use.'
    };
  } catch (error) {
    // Network error - still accept if format looks valid
    if (apiKey.length >= 20) {
      return { 
        valid: true, 
        message: 'Server offline. Key format looks valid, will be verified on first use.'
      };
    }
    return { valid: false, error: 'Could not connect to server' };
  }
}
