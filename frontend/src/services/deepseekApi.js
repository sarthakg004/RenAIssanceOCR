/**
 * DeepSeek OCR API Service
 * Handles communication with the FastAPI backend for DeepSeek-based OCR
 */

const API_BASE = 'http://localhost:8000/api';

/**
 * Get available DeepSeek models
 */
export async function getDeepSeekModels() {
    const response = await fetch(`${API_BASE}/deepseek-models`);
    if (!response.ok) {
        throw new Error('Failed to fetch DeepSeek models');
    }
    return response.json();
}

/**
 * Process a single page with DeepSeek OCR using base64 image data
 *
 * @param {string} imageData - Base64 encoded image (with data URL prefix)
 * @param {string} model - DeepSeek model name
 * @param {string} apiKey - DeepSeek API key
 * @returns {Promise<{success: boolean, transcript?: string, error?: string}>}
 */
export async function processDeepSeekPageOCR(imageData, model, apiKey) {
    const response = await fetch(`${API_BASE}/deepseek-ocr-json`, {
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
            error: errorData.detail || 'DeepSeek OCR processing failed',
        };
    }

    const data = await response.json();
    return data;
}
