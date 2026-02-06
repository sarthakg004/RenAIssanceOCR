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
 */
export async function getRateLimitStatus() {
  const response = await fetch(`${API_BASE}/rate-limit-status`);
  if (!response.ok) {
    throw new Error('Failed to fetch rate limit status');
  }
  return response.json();
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
