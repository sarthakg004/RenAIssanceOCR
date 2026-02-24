/**
 * Qwen OCR API Service
 * Handles communication with the FastAPI backend for Qwen-based OCR
 */

const API_BASE = 'http://localhost:8000/api';

/**
 * Get available Qwen models
 */
export async function getQwenModels() {
    const response = await fetch(`${API_BASE}/qwen-models`);
    if (!response.ok) {
        throw new Error('Failed to fetch Qwen models');
    }
    return response.json();
}

/**
 * Process a single page with Qwen OCR using base64 image data
 *
 * @param {string} imageData - Base64 encoded image (with data URL prefix)
 * @param {string} model - Qwen model name
 * @param {string} apiKey - DashScope/Qwen API key
 * @returns {Promise<{success: boolean, transcript?: string, error?: string}>}
 */
export async function processQwenPageOCR(imageData, model, apiKey) {
    const response = await fetch(`${API_BASE}/qwen-ocr-json`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key': apiKey,
        },
        body: JSON.stringify({
            image_data: imageData,
            model: model,
        }),
    });

    if (response.status === 429) {
        const errorData = await response.json().catch(() => ({}));
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
            error: errorData.detail || 'Qwen OCR processing failed',
        };
    }

    const data = await response.json();
    return data;
}
