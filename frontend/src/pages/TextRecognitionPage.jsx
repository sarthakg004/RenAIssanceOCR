import { useState, useEffect, useCallback, useRef } from 'react';
import {
  OCRLayout,
  SidebarConfig,
  PageThumbnailList,
  PagePreview,
  TranscriptPanel,
} from '../components/ocr';
import {
  getAvailableModels,
  processPageOCR,
  processBatchOCR,
  getRateLimitStatus,
  verifyApiKey,
  exportTranscripts,
  downloadBlob,
} from '../services/geminiApi';

// Default batch size (safe for 5 req/min limit)
const DEFAULT_BATCH_SIZE = 4;

/**
 * TextRecognitionPage - Full Viewport OCR Workspace
 * Redesigned with 3-column responsive layout
 * Supports background auto-processing with batch concurrent requests
 */
export default function TextRecognitionPage({ processedImages, onBack, onComplete }) {
  // API Configuration
  const [apiKey, setApiKey] = useState('');
  const [isKeyValid, setIsKeyValid] = useState(null);
  const [isValidating, setIsValidating] = useState(false);
  const [selectedModel, setSelectedModel] = useState('gemini-3-flash-preview');
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

  // Export state
  const [exporting, setExporting] = useState(null);

  // Zoom state - lifted here to persist across page changes
  const [zoomLevel, setZoomLevel] = useState(1);

  // Load models on mount
  useEffect(() => {
    async function loadModels() {
      try {
        const data = await getAvailableModels();
        setModels(data.models);
        setSelectedModel(data.default);
        setBackendOnline(true);
      } catch {
        setBackendOnline(false);
        setModels([
          { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview', description: 'Latest and fastest (recommended)' },
          { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro Preview', description: 'Most capable preview model' },
          { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'Stable pro model' },
          { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Stable flash model' },
        ]);
      }
    }
    loadModels();
  }, []);

  // Initialize transcripts
  useEffect(() => {
    const initial = {};
    processedImages.forEach((_, index) => {
      initial[index + 1] = '';
    });
    setTranscripts(initial);
    setOriginalTranscripts(initial);
  }, [processedImages]);

  // Rate limit countdown
  useEffect(() => {
    if (waitSeconds > 0) {
      const timer = setTimeout(() => {
        setWaitSeconds((prev) => {
          if (prev <= 1) {
            setRateLimitReady(true);
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
  const viewingPageNumber = viewingPageIndex + 1;
  const totalPages = processedImages.length;
  const isViewingPageProcessed = processedPages.has(viewingPageNumber);
  const hasAnyTranscript = processedPages.size > 0;
  const canProcess = apiKey && apiKey.length >= 10 && isKeyValid !== false && rateLimitReady;
  
  // Check if the currently viewing page is being processed (single or batch)
  const isViewingPageProcessing = isProcessing && (
    processingPageIndex === viewingPageIndex || 
    processingPageIndices.has(viewingPageIndex)
  );

  // Manual API key verification
  const handleVerifyKey = useCallback(async () => {
    if (!apiKey || apiKey.length < 10) return;

    setIsValidating(true);
    setError(null);

    try {
      const result = await verifyApiKey(apiKey);
      setIsKeyValid(result.valid);
      if (!result.valid) {
        setError(result.error || 'Invalid API key');
      }
    } catch (err) {
      setIsKeyValid(false);
      setError('Could not verify API key');
    } finally {
      setIsValidating(false);
    }
  }, [apiKey]);

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

  // Process a specific page (used by both manual and auto processing)
  const processPage = useCallback(async (pageIndex) => {
    if (!canProcess || isProcessing) return;

    const pageNum = pageIndex + 1;
    const page = processedImages[pageIndex];
    
    setProcessingPageIndex(pageIndex);
    setIsProcessing(true);
    setError(null);

    try {
      const imageData = page.processed || page.original;
      const result = await processPageOCR(imageData, selectedModel, apiKey);

      if (result.success) {
        setTranscripts((prev) => ({ ...prev, [pageNum]: result.transcript }));
        setOriginalTranscripts((prev) => ({ ...prev, [pageNum]: result.transcript }));
        setProcessedPages((prev) => new Set([...prev, pageNum]));
        // Mark key as valid since OCR succeeded
        setIsKeyValid(true);
      } else if (result.error === 'rate_limited') {
        setRateLimitReady(false);
        setWaitSeconds(result.waitSeconds || 20);
        setError(`Rate limited. Waiting ${result.waitSeconds}s...`);
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
  }, [apiKey, processedImages, selectedModel, canProcess, isProcessing]);

  // Process the currently viewed page (for manual "Process Page" button)
  const processCurrentPage = useCallback(() => {
    processPage(viewingPageIndex);
  }, [processPage, viewingPageIndex]);

  // Batch process multiple pages concurrently
  const processBatch = useCallback(async (pageIndices) => {
    // Use ref as primary guard to prevent concurrent calls
    if (batchInProgressRef.current) return;
    if (!canProcess || pageIndices.length === 0) return;

    batchInProgressRef.current = true;
    setIsProcessing(true);
    setProcessingPageIndices(new Set(pageIndices));
    setError(null);

    try {
      // Prepare batch items
      const items = pageIndices.map(pageIndex => {
        const page = processedImages[pageIndex];
        return {
          pageIndex,
          imageData: page.processed || page.original,
        };
      });

      const result = await processBatchOCR(items, selectedModel, apiKey);

      if (result.success) {
        // Check if quota was exceeded (daily limit)
        if (result.quotaExceeded) {
          setDailyLimitReached(true);
          setIsAutoProcessing(false);
          setError('Daily API quota exceeded. Please try again tomorrow or use a different API key.');
        }
        
        // Process each result
        result.results.forEach(item => {
          const pageNum = item.page_index + 1;
          if (item.success) {
            setTranscripts(prev => ({ ...prev, [pageNum]: item.transcript }));
            setOriginalTranscripts(prev => ({ ...prev, [pageNum]: item.transcript }));
            setProcessedPages(prev => new Set([...prev, pageNum]));
          } else {
            // Check individual errors for quota issues
            const errLower = (item.error || '').toLowerCase();
            if (errLower.includes('quota') || errLower.includes('resource_exhausted')) {
              setDailyLimitReached(true);
              setIsAutoProcessing(false);
              setError('Daily API quota exceeded. Please try again tomorrow or use a different API key.');
            }
            console.error(`Page ${pageNum} failed:`, item.error);
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
        // (the useEffect will adjust batch size based on remaining pages and slots)
        setRateLimitReady(status.ready && slotsAvailable > 0);
        
        if (!status.ready || slotsAvailable === 0) {
          setWaitSeconds(status.wait_seconds || 60);
        }
      } else if (result.error === 'rate_limited') {
        setRateLimitReady(false);
        setWaitSeconds(result.waitSeconds || 60);
        setAvailableSlots(result.availableSlots || 0);
        setError(`Rate limited. Waiting ${result.waitSeconds}s...`);
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
    } catch (err) {
      setError(err.message);
    } finally {
      setIsProcessing(false);
      setProcessingPageIndices(new Set());
      batchInProgressRef.current = false;
    }
  }, [apiKey, processedImages, selectedModel, canProcess]);

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
      .filter(i => !processedPages.has(i + 1));
    
    if (unprocessedIndices.length === 0) {
      // All pages processed
      setIsAutoProcessing(false);
      setIsWaitingForRateLimit(false);
      pollRetryCountRef.current = 0;
      return;
    }

    // If rate limited (no slots available), show waiting state and poll for status
    if (!rateLimitReady) {
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
    const actualBatchSize = Math.min(unprocessedIndices.length, batchSize, availableSlots || batchSize);
    const batchIndices = unprocessedIndices.slice(0, actualBatchSize);
    
    // Use a small timeout to prevent synchronous state update loops
    const timeoutId = setTimeout(() => {
      if (!batchInProgressRef.current && isAutoProcessing && rateLimitReady) {
        processBatch(batchIndices);
      }
    }, 200);

    return () => clearTimeout(timeoutId);
  }, [isAutoProcessing, rateLimitReady, availableSlots, batchSize, dailyLimitReached, processedPages, processedImages, processBatch]);

  // Handle transcript change
  const handleTranscriptChange = useCallback((value) => {
    setTranscripts((prev) => ({ ...prev, [viewingPageNumber]: value }));
  }, [viewingPageNumber]);


  // Reset transcript
  const handleResetTranscript = useCallback(() => {
    setTranscripts((prev) => ({ ...prev, [viewingPageNumber]: originalTranscripts[viewingPageNumber] }));
  }, [viewingPageNumber, originalTranscripts]);

  // Export
  const handleExport = useCallback(async (format) => {
    if (exporting || !hasAnyTranscript) return;
    setExporting(format);
    try {
      const blob = await exportTranscripts(transcripts, format);
      downloadBlob(blob, `transcript_${new Date().toISOString().slice(0, 10)}.${format}`);
    } catch (err) {
      setError(`Export failed: ${err.message}`);
    }
    setExporting(null);
  }, [exporting, hasAnyTranscript, transcripts]);

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

  return (
    <OCRLayout
      onBack={onBack}
      onComplete={onComplete}
      processedCount={processedPages.size}
      totalPages={totalPages}
      hasAnyTranscript={hasAnyTranscript}
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
          />
          <PageThumbnailList
            images={processedImages}
            currentIndex={viewingPageIndex}
            processedPages={processedPages}
            processingPageIndex={processingPageIndex}
            processingPageIndices={processingPageIndices}
            onPageSelect={goToPage}
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
        />
      }
      rightPanel={
        <TranscriptPanel
          pageNumber={viewingPageNumber}
          transcript={transcripts[viewingPageNumber] || ''}
          originalTranscript={originalTranscripts[viewingPageNumber] || ''}
          isProcessing={isViewingPageProcessing}
          isProcessed={isViewingPageProcessed}
          hasAnyTranscript={hasAnyTranscript}
          processedCount={processedPages.size}
          onTranscriptChange={handleTranscriptChange}
          onReset={handleResetTranscript}
          onExport={handleExport}
          exporting={exporting}
        />
      }
    />
  );
}
