/**
 * ChatGPT (OpenAI) OCR API Service
 * Handles communication with the FastAPI backend for ChatGPT-based OCR
 */

const API_BASE = 'http://localhost:8000/api';

/**
 * Get available ChatGPT models
 */
export async function getChatGPTModels() {
    const response = await fetch(`${API_BASE}/chatgpt-models`);
    if (!response.ok) {
        throw new Error('Failed to fetch ChatGPT models');
    }
    return response.json();
}

/**
 * Process a single page with ChatGPT OCR using base64 image data
 *
 * @param {string} imageData - Base64 encoded image (with data URL prefix)
 * @param {string} model - ChatGPT model name
 * @param {string} apiKey - OpenAI API key
 * @returns {Promise<{success: boolean, transcript?: string, error?: string}>}
 */
export async function processChatGPTPageOCR(imageData, model, apiKey) {
    const response = await fetch(`${API_BASE}/chatgpt-ocr-json`, {
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
            error: errorData.detail || 'ChatGPT OCR processing failed',
        };
    }

    const data = await response.json();
    return data;
}
