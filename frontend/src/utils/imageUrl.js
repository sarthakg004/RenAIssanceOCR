/**
 * Image URL helpers.
 *
 * Page images are kept in app state as Blob-backed object URLs ("blob:…")
 * instead of base64 data URLs. A data URL keeps the whole encoded image as a
 * string on the JS heap (≈1.33× the PNG size, per page, for every page of the
 * book) which is what made large books lag; an object URL is a ~50-char
 * pointer and the pixels live in browser-managed storage outside the heap.
 *
 * Backends that want base64 call `toDataUrl` at the moment of the request.
 */

/** Any image URL (blob:, http(s):, data:) → base64 data URL. */
export async function toDataUrl(url) {
    if (!url) return null;
    if (url.startsWith('data:')) return url;
    const blob = await (await fetch(url)).blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    const CHUNK = 0x8000; // avoid call-stack limits on large images
    for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return `data:${blob.type || 'image/png'};base64,${btoa(bin)}`;
}

/**
 * base64 data URL → Blob-backed object URL. Non-data URLs pass through
 * unchanged. Callers own the returned URL (revoke it when replaced).
 */
export function dataUrlToObjectUrl(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return dataUrl;
    const [header, b64] = dataUrl.split(',');
    const mime = header.match(/:(.*?);/)?.[1] || 'image/png';
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([u8], { type: mime }));
}

/** Revoke every blob: URL in a list, ignoring anything else. */
export function revokeObjectUrls(urls) {
    for (const url of urls || []) {
        if (typeof url === 'string' && url.startsWith('blob:')) URL.revokeObjectURL(url);
    }
}
