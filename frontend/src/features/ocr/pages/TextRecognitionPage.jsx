import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
    OCRLayout,
    SidebarConfig,
    PageThumbnailList,
    PagePreview,
    TranscriptPanel,
} from '../../../components/ocr';
import {
    getModels,
    processPageOCR,
    processBatchOCR,
    getRateLimitStatus,
    verifyApiKey,
    downloadBlob,
} from '../services/ocrApi';
import { saveTranscriptSession } from '../../../services/storageApi';
import {
    PROVIDER_LABELS,
    FALLBACK_MODELS,
    DEFAULT_MODELS,
} from '../config/providers';

// Default batch size (safe for 5 req/min limit)
const DEFAULT_BATCH_SIZE = 4;

/**
 * TextRecognitionPage - Full Viewport OCR Workspace
 * Redesigned with 3-column responsive layout
 * Supports background auto-processing with batch concurrent requests
 * Now supports multiple providers: gemini, chatgpt, deepseek, qwen
 */
export default function TextRecognitionPage({ provider = 'gemini', bookName = 'transcript', processedImages, onBack, onHome, onComplete }) {
    // API Configuration
    const [apiKey, setApiKey] = useState('');
    const [isKeyValid, setIsKeyValid] = useState(null);
    const [isValidating, setIsValidating] = useState(false);
    const [selectedModel, setSelectedModel] = useState(DEFAULT_MODELS[provider] || DEFAULT_MODELS.gemini);
    const [models, setModels] = useState([]);
    const [backendOnline, setBackendOnline] = useState(null);
    const [batchSize, setBatchSize] = useState(DEFAULT_BATCH_SIZE);

    // Viewing state - which page user is looking at
    const [viewingPageIndex, setViewingPageIndex] = useState(0);

    // Processing state - tracks pages currently being processed
    const [processingPageIndex, setProcessingPageIndex] = useState(null);
    const [processingPageIndices, setProcessingPageIndices] = useState(new Set()); // For batch processing
    const [isProcessing, setIsProcessing] = useState(false);
    const [isAutoProcessing, setIsAutoProcessing] = useState(false);
    const [isWaitingForRateLimit, setIsWaitingForRateLimit] = useState(false); // True when auto-processing is waiting
    const [error, setError] = useState(null);

    // Ref to track if batch processing is in progress (prevents multiple batches)
    const batchInProgressRef = useRef(false);

    // Transcripts
    const [transcripts, setTranscripts] = useState({});
    const [originalTranscripts, setOriginalTranscripts] = useState({});
    const [processedPages, setProcessedPages] = useState(new Set());

    // Rate limit
    const [rateLimitReady, setRateLimitReady] = useState(true);
    const [waitSeconds, setWaitSeconds] = useState(0);
    const [availableSlots, setAvailableSlots] = useState(5);
    const [dailyLimitReached, setDailyLimitReached] = useState(false);
    const pollRetryCountRef = useRef(0);
    const MAX_POLL_RETRIES = 30; // Stop polling after ~60 seconds (30 * 2s)
    const lastSavedSignatureRef = useRef('');

    // Export state
    const [exporting, setExporting] = useState(null);
    const [isSavingSession, setIsSavingSession] = useState(false);
    const [sessionSaved, setSessionSaved] = useState(false);

    // Zoom state - lifted here to persist across page changes
    const [zoomLevel, setZoomLevel] = useState(1);

    // Custom prompt state
    const [customPrompt, setCustomPrompt] = useState('');

    // Use the same page numbers shown in the Select Pages step
    const pageLabels = useMemo(() => {
        return processedImages.map((img) => `${img.pageNumber}`);
    }, [processedImages]);

    // Load models on mount based on provider
    useEffect(() => {
        async function loadModels() {
            try {
                const data = await getModels(provider);
                setModels(data.models);
                setSelectedModel(data.default);
                setBackendOnline(true);
            } catch {
                setBackendOnline(false);
                setModels(FALLBACK_MODELS[provider] || FALLBACK_MODELS.gemini);
                setSelectedModel(DEFAULT_MODELS[provider] || DEFAULT_MODELS.gemini);
            }
        }
        loadModels();
    }, [provider]);

    // Initialize transcripts using original page labels as keys
    useEffect(() => {
        const initial = {};
        processedImages.forEach((_, index) => {
            initial[pageLabels[index]] = '';
        });
        setTranscripts(initial);
        setOriginalTranscripts(initial);
    }, [processedImages, pageLabels]);

    // Rate limit countdown
    useEffect(() => {
        if (waitSeconds > 0) {
            const timer = setTimeout(() => {
                setWaitSeconds((prev) => {
                    if (prev <= 1) {
                        setRateLimitReady(true);
                        // Clear any rate-limit error so the banner doesn't linger
                        setError((e) => (e && e.includes('Rate limit') ? null : e));
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
            return () => clearTimeout(timer);
        }
    }, [waitSeconds]);

    // Computed values - for the page user is VIEWING
    const viewingPage = processedImages[viewingPageIndex];
    const viewingPageLabel = pageLabels[viewingPageIndex];
    const totalPages = processedImages.length;
    const isViewingPageProcessed = processedPages.has(viewingPageLabel);
    const hasAnyTranscript = processedPages.size > 0;
    const canProcess = apiKey && apiKey.length >= 10 && isKeyValid !== false && rateLimitReady;

    // Check if the currently viewing page is being processed (single or batch)
    const isViewingPageProcessing = isProcessing && (
        processingPageIndex === viewingPageIndex ||
        processingPageIndices.has(viewingPageIndex)
    );

    // Manual API key verification (simple format check for non-Gemini providers)
    const handleVerifyKey = useCallback(async () => {
        if (!apiKey || apiKey.length < 10) return;

        setIsValidating(true);
        setError(null);

        try {
            if (provider === 'gemini') {
                const result = await verifyApiKey(apiKey);
                setIsKeyValid(result.valid);
                if (!result.valid) {
                    setError(result.error || 'Invalid API key');
                }
            } else {
                // For non-Gemini providers, do a simple format check
                // Actual validation happens on first OCR call
                if (apiKey.length >= 20) {
                    setIsKeyValid(true);
                } else {
                    setIsKeyValid(false);
                    setError('API key appears too short');
                }
            }
        } catch (err) {
            setIsKeyValid(false);
            setError('Could not verify API key');
        } finally {
            setIsValidating(false);
        }
    }, [apiKey, provider]);

    // Handle API key change - reset validation state
    const handleApiKeyChange = useCallback((value) => {
        setApiKey(value);
        // Only clear validation state, don't auto-validate
        if (isKeyValid !== null) {
            setIsKeyValid(null);
        }
        setError(null);
    }, [isKeyValid]);

    // Navigation - only changes viewing, not processing
    const goToPage = useCallback((index) => {
        if (index >= 0 && index < totalPages) {
            setViewingPageIndex(index);
            setError(null);
        }
    }, [totalPages]);

    // Process a specific page using the unified API
    const processPage = useCallback(async (pageIndex) => {
        if (!canProcess || isProcessing) return;

        const pageLabel = pageLabels[pageIndex];
        const page = processedImages[pageIndex];

        setProcessingPageIndex(pageIndex);
        setIsProcessing(true);
        setError(null);

        try {
            const imageData = page.processed || page.original;

            // Call the unified OCR API with provider parameter
            const result = await processPageOCR(imageData, selectedModel, apiKey, provider, customPrompt);

            if (result.success) {
                setTranscripts((prev) => ({ ...prev, [pageLabel]: result.transcript }));
                setOriginalTranscripts((prev) => ({ ...prev, [pageLabel]: result.transcript }));
                setProcessedPages((prev) => new Set([...prev, pageLabel]));
                // Mark key as valid since OCR succeeded
                setIsKeyValid(true);
            } else if (result.error === 'rate_limited') {
                setRateLimitReady(false);
                setWaitSeconds(result.waitSeconds || 20);
            } else if (result.error === 'invalid_api_key') {
                setIsKeyValid(false);
                setError('Invalid API key');
            } else {
                setError(result.error || 'Processing failed');
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setIsProcessing(false);
            setProcessingPageIndex(null);
        }
    }, [apiKey, processedImages, selectedModel, canProcess, isProcessing, provider, customPrompt, pageLabels]);

    // Process the currently viewed page (for manual "Process Page" button)
    const processCurrentPage = useCallback(() => {
        processPage(viewingPageIndex);
    }, [processPage, viewingPageIndex]);

    // Batch process multiple pages concurrently
    // For non-Gemini providers, process sequentially since they don't have a batch endpoint
    const processBatch = useCallback(async (pageIndices) => {
        // Use ref as primary guard to prevent concurrent calls
        if (batchInProgressRef.current) return;
        if (!canProcess || pageIndices.length === 0) return;

        batchInProgressRef.current = true;
        setIsProcessing(true);
        setProcessingPageIndices(new Set(pageIndices));
        setError(null);

        try {
            if (provider === 'gemini') {
                // Gemini has a batch endpoint
                const items = pageIndices.map(pageIndex => {
                    const page = processedImages[pageIndex];
                    return {
                        pageIndex,
                        imageData: page.processed || page.original,
                    };
                });

                const result = await processBatchOCR(items, selectedModel, apiKey, customPrompt);

                if (result.success) {
                    // Check if quota was exceeded (daily limit)
                    if (result.quotaExceeded) {
                        setDailyLimitReached(true);
                        setIsAutoProcessing(false);
                        setError('Daily API quota exceeded. Please try again tomorrow or use a different API key.');
                    }

                    // Process each result
                    result.results.forEach(item => {
                        const pageLabel = pageLabels[item.page_index];
                        if (item.success) {
                            setTranscripts(prev => ({ ...prev, [pageLabel]: item.transcript }));
                            setOriginalTranscripts(prev => ({ ...prev, [pageLabel]: item.transcript }));
                            setProcessedPages(prev => new Set([...prev, pageLabel]));
                        } else {
                            // Check individual errors for quota issues
                            const errLower = (item.error || '').toLowerCase();
                            if (errLower.includes('quota') || errLower.includes('resource_exhausted')) {
                                setDailyLimitReached(true);
                                setIsAutoProcessing(false);
                                setError('Daily API quota exceeded. Please try again tomorrow or use a different API key.');
                            }
                            console.error(`Page ${pageLabel} failed:`, item.error);
                        }
                    });

                    // Mark key as valid since at least some OCR succeeded
                    if (result.successfulCount > 0) {
                        setIsKeyValid(true);
                    }

                    // Update rate limit status
                    const status = await getRateLimitStatus();
                    const slotsAvailable = status.available_slots || 0;
                    setAvailableSlots(slotsAvailable);

                    // Mark ready if we have any slots available
                    setRateLimitReady(status.ready && slotsAvailable > 0);

                    if (!status.ready || slotsAvailable === 0) {
                        setWaitSeconds(status.wait_seconds || 60);
                    }
                } else if (result.error === 'rate_limited') {
                    setRateLimitReady(false);
                    setWaitSeconds(result.waitSeconds || 60);
                    setAvailableSlots(result.availableSlots || 0);
                } else if (result.error === 'invalid_api_key') {
                    setIsKeyValid(false);
                    setError('Invalid API key');
                    setIsAutoProcessing(false);
                } else if (result.error && (result.error.toLowerCase().includes('quota') || result.error.toLowerCase().includes('resource_exhausted'))) {
                    setDailyLimitReached(true);
                    setIsAutoProcessing(false);
                    setError('Daily API quota exceeded. Please try again tomorrow or use a different API key.');
                } else {
                    setError(result.error || 'Batch processing failed');
                }
            } else {
                // For non-Gemini providers: process pages sequentially
                for (const pageIndex of pageIndices) {
                    const page = processedImages[pageIndex];
                    const imageData = page.processed || page.original;
                    const pageLabel = pageLabels[pageIndex];

                    try {
                        const result = await processPageOCR(imageData, selectedModel, apiKey, provider, customPrompt);

                        if (result.success) {
                            setTranscripts(prev => ({ ...prev, [pageLabel]: result.transcript }));
                            setOriginalTranscripts(prev => ({ ...prev, [pageLabel]: result.transcript }));
                            setProcessedPages(prev => new Set([...prev, pageLabel]));
                            setIsKeyValid(true);
                        } else if (result.error === 'rate_limited') {
                            setRateLimitReady(false);
                            setWaitSeconds(result.waitSeconds || 20);
                            break; // Stop processing on rate limit
                        } else if (result.error === 'invalid_api_key') {
                            setIsKeyValid(false);
                            setError('Invalid API key');
                            setIsAutoProcessing(false);
                            break;
                        } else {
                            console.error(`Page ${pageLabel} failed:`, result.error);
                        }
                    } catch (err) {
                        console.error(`Page ${pageLabel} error:`, err.message);
                    }
                }
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setIsProcessing(false);
            setProcessingPageIndices(new Set());
            batchInProgressRef.current = false;
        }
    }, [apiKey, processedImages, selectedModel, canProcess, provider, customPrompt, pageLabels]);

    // Auto-processing - triggers batch processing when conditions are met
    // Uses a ref-based guard to prevent rapid re-triggers
    useEffect(() => {
        // Early exit conditions
        if (!isAutoProcessing) {
            setIsWaitingForRateLimit(false);
            pollRetryCountRef.current = 0;
            return;
        }
        if (batchInProgressRef.current) return;
        if (dailyLimitReached) return;

        // Find all unprocessed pages
        const unprocessedIndices = processedImages
            .map((_, i) => i)
            .filter(i => !processedPages.has(pageLabels[i]));

        if (unprocessedIndices.length === 0) {
            // All pages processed
            setIsAutoProcessing(false);
            setIsWaitingForRateLimit(false);
            pollRetryCountRef.current = 0;
            return;
        }

        // For Gemini: check rate limits. For other providers: just process.
        if (provider === 'gemini' && !rateLimitReady) {
            setIsWaitingForRateLimit(true);

            // Poll every 2 seconds to check if rate limit has reset
            const pollId = setInterval(async () => {
                // Check if we've exceeded max retries (likely daily limit)
                pollRetryCountRef.current += 1;
                if (pollRetryCountRef.current > MAX_POLL_RETRIES) {
                    setDailyLimitReached(true);
                    setIsAutoProcessing(false);
                    setIsWaitingForRateLimit(false);
                    setError('Daily rate limit reached. Please try again later or use a different API key.');
                    clearInterval(pollId);
                    return;
                }

                try {
                    const status = await getRateLimitStatus();
                    const slotsAvailable = status.available_slots || 0;
                    setAvailableSlots(slotsAvailable);

                    // Update wait seconds from server
                    if (status.wait_seconds !== undefined) {
                        setWaitSeconds(status.wait_seconds);
                    }

                    // Check if we have any slots available
                    if (status.ready && slotsAvailable > 0) {
                        setRateLimitReady(true);
                        setWaitSeconds(0);
                        setIsWaitingForRateLimit(false);
                        pollRetryCountRef.current = 0;
                        clearInterval(pollId);
                    }
                } catch (e) {
                    console.error('Failed to poll rate limit:', e);
                }
            }, 2000);

            return () => clearInterval(pollId);
        }

        // Ready to process - reset retry counter and take batch
        pollRetryCountRef.current = 0;
        setIsWaitingForRateLimit(false);
        const actualBatchSize = provider === 'gemini'
            ? Math.min(unprocessedIndices.length, batchSize, availableSlots || batchSize)
            : Math.min(unprocessedIndices.length, batchSize);
        const batchIndices = unprocessedIndices.slice(0, actualBatchSize);

        // Use a small timeout to prevent synchronous state update loops
        const timeoutId = setTimeout(() => {
            if (!batchInProgressRef.current && isAutoProcessing && (provider !== 'gemini' || rateLimitReady)) {
                processBatch(batchIndices);
            }
        }, 200);

        return () => clearTimeout(timeoutId);
    }, [isAutoProcessing, rateLimitReady, availableSlots, batchSize, dailyLimitReached, processedPages, processedImages, processBatch, provider, pageLabels]);

    // Handle transcript change
    const handleTranscriptChange = useCallback((value) => {
        setTranscripts((prev) => ({ ...prev, [viewingPageLabel]: value }));
    }, [viewingPageLabel]);


    // Reset transcript
    const handleResetTranscript = useCallback(() => {
        setTranscripts((prev) => ({ ...prev, [viewingPageLabel]: originalTranscripts[viewingPageLabel] }));
    }, [viewingPageLabel, originalTranscripts]);

    // Export
    const handleExport = useCallback(async (format) => {
        if (exporting || !hasAnyTranscript) return;
        setExporting(format);
        try {
            const timestamp = new Date().toISOString().slice(0, 10);
            const orderedEntries = Object.entries(transcripts)
                .filter(([, text]) => text && text.trim())
                .sort(([a], [b]) => {
                    const aNum = Number.parseInt(a, 10);
                    const bNum = Number.parseInt(b, 10);
                    if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) return aNum - bNum;
                    return a.localeCompare(b);
                });

            let blob;
            if (format === 'txt') {
                const text = orderedEntries
                    .map(([page, value]) => `--- Page ${page} ---\n${value.trim()}`)
                    .join('\n\n');
                blob = new Blob([`\uFEFF${text}\n`], { type: 'text/plain;charset=utf-8' });
            } else if (format === 'csv') {
                const escapeCsv = (value) => `"${String(value).replaceAll('"', '""')}"`;
                const rows = ['page,text'];
                orderedEntries.forEach(([page, value]) => {
                    rows.push(`${escapeCsv(page)},${escapeCsv(value.trim())}`);
                });
                blob = new Blob([`\uFEFF${rows.join('\n')}\n`], { type: 'text/csv;charset=utf-8' });
            } else if (format === 'json') {
                const payload = Object.fromEntries(orderedEntries);
                blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
            } else {
                throw new Error(`Unsupported format: ${format}`);
            }

            downloadBlob(blob, `transcript_${timestamp}.${format}`);
        } catch (err) {
            setError(`Export failed: ${err.message}`);
        }
        setExporting(null);
    }, [exporting, hasAnyTranscript, transcripts]);

    const toDataUrl = useCallback(async (url) => {
        if (!url) return null;
        if (url.startsWith('data:')) return url;
        const response = await fetch(url);
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Failed converting image to base64'));
            reader.readAsDataURL(blob);
        });
    }, []);

    const buildSavePayload = useCallback(async () => {
        const entries = Object.entries(transcripts)
            .filter(([, value]) => typeof value === 'string' && value.trim())
            .sort(([a], [b]) => {
                const aNum = Number.parseInt(a, 10);
                const bNum = Number.parseInt(b, 10);
                if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) return aNum - bNum;
                return a.localeCompare(b);
            });

        const nonEmptyTranscripts = {};
        entries.forEach(([key, value]) => {
            nonEmptyTranscripts[key] = value.trim();
        });

        const transcriptImages = {};
        for (let i = 0; i < pageLabels.length; i += 1) {
            const key = pageLabels[i];
            if (!(key in nonEmptyTranscripts)) continue;

            const imageSrc = processedImages[i]?.processed || processedImages[i]?.original || '';
            if (!imageSrc) continue;

            try {
                const dataUrl = await toDataUrl(imageSrc);
                if (typeof dataUrl === 'string' && dataUrl.startsWith('data:')) {
                    transcriptImages[key] = dataUrl;
                }
            } catch {
                // Skip image snapshot if conversion fails; transcript save still proceeds.
            }
        }

        const signature = JSON.stringify(nonEmptyTranscripts);
        return { nonEmptyTranscripts, transcriptImages, signature };
    }, [pageLabels, processedImages, toDataUrl, transcripts]);

    const handleSaveLocal = useCallback(async () => {
        if (!hasAnyTranscript || isSavingSession) return;
        setIsSavingSession(true);
        setError(null);
        try {
            const { nonEmptyTranscripts, transcriptImages, signature } = await buildSavePayload();
            if (Object.keys(nonEmptyTranscripts).length === 0) {
                setError('No transcript pages to save.');
                return;
            }

            if (lastSavedSignatureRef.current === signature) {
                const proceed = window.confirm('No transcript changes were detected since the last save. Save another copy anyway?');
                if (!proceed) return;
            }

            await saveTranscriptSession(
                nonEmptyTranscripts,
                'ocr workflow',
                'recognition',
                transcriptImages,
                bookName,
                {
                    ocr_provider: provider,
                    ocr_model: selectedModel,
                    batch_size: batchSize,
                    custom_prompt_enabled: Boolean(customPrompt && customPrompt.trim()),
                },
            );
            lastSavedSignatureRef.current = signature;
            setSessionSaved(true);
            window.alert('Transcript and page images saved to My Files.');
        } catch (err) {
            setError(`Save failed: ${err.message}`);
        } finally {
            setIsSavingSession(false);
        }
    }, [batchSize, bookName, buildSavePayload, customPrompt, hasAnyTranscript, isSavingSession, provider, selectedModel]);

    // Toggle auto processing - properly stops all processes when toggled off
    const handleToggleAutoProcess = useCallback(() => {
        setIsAutoProcessing((prev) => {
            if (prev) {
                // Stopping - clear all processing states
                setIsWaitingForRateLimit(false);
                setIsProcessing(false);
                setProcessingPageIndices(new Set());
                batchInProgressRef.current = false;
                pollRetryCountRef.current = 0;
                setError(null);
            }
            return !prev;
        });
    }, []);

    const handleComplete = useCallback(async () => {
        if (typeof onComplete === 'function') {
            onComplete('OCR processing complete. Use Save to My Files to persist transcripts.');
        }
    }, [onComplete]);

    return (
        <OCRLayout
            onBack={onBack}
            onComplete={handleComplete}
            onHome={onHome}
            processedCount={processedPages.size}
            totalPages={totalPages}
            hasAnyTranscript={hasAnyTranscript && !isSavingSession}
            backendOnline={backendOnline}
            leftSidebar={
                <>
                    <SidebarConfig
                        apiKey={apiKey}
                        onApiKeyChange={handleApiKeyChange}
                        selectedModel={selectedModel}
                        onModelChange={setSelectedModel}
                        models={models}
                        isKeyValid={isKeyValid}
                        isValidating={isValidating}
                        onVerifyKey={handleVerifyKey}
                        backendOnline={backendOnline}
                        batchSize={batchSize}
                        onBatchSizeChange={setBatchSize}
                        provider={provider}
                        customPrompt={customPrompt}
                        onCustomPromptChange={setCustomPrompt}
                    />
                    <PageThumbnailList
                        images={processedImages}
                        currentIndex={viewingPageIndex}
                        processedPages={processedPages}
                        processingPageIndex={processingPageIndex}
                        processingPageIndices={processingPageIndices}
                        onPageSelect={goToPage}
                        pageLabels={pageLabels}
                    />
                </>
            }
            centerPanel={
                <PagePreview
                    currentPage={viewingPage}
                    currentIndex={viewingPageIndex}
                    totalPages={totalPages}
                    isProcessing={isViewingPageProcessing}
                    isPageProcessed={isViewingPageProcessed}
                    isAutoProcessing={isAutoProcessing}
                    isWaitingForRateLimit={isWaitingForRateLimit}
                    rateLimitReady={rateLimitReady}
                    waitSeconds={waitSeconds}
                    error={error}
                    canProcess={canProcess}
                    onPrevPage={() => goToPage(viewingPageIndex - 1)}
                    onNextPage={() => goToPage(viewingPageIndex + 1)}
                    onProcess={processCurrentPage}
                    onToggleAutoProcess={handleToggleAutoProcess}
                    // Controlled zoom - persists across page changes
                    zoomLevel={zoomLevel}
                    onZoomChange={setZoomLevel}
                    // Show which page is being processed during auto-processing
                    processingPageIndex={processingPageIndex}
                    pageLabel={viewingPageLabel}
                    pageLabels={pageLabels}
                />
            }
            rightPanel={
                <TranscriptPanel
                    pageNumber={viewingPageLabel}
                    transcript={transcripts[viewingPageLabel] || ''}
                    originalTranscript={originalTranscripts[viewingPageLabel] || ''}
                    isProcessing={isViewingPageProcessing}
                    isProcessed={isViewingPageProcessed}
                    hasAnyTranscript={hasAnyTranscript}
                    processedCount={processedPages.size}
                    onTranscriptChange={handleTranscriptChange}
                    onReset={handleResetTranscript}
                    onExport={handleExport}
                    onSaveLocal={handleSaveLocal}
                    exporting={exporting}
                    savingLocal={isSavingSession}
                />
            }
        />
    );
}
