import { useState, useEffect, useCallback } from 'react';
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
  verifyApiKey,
  exportTranscripts,
  downloadBlob,
} from '../services/geminiApi';

/**
 * TextRecognitionPage - Full Viewport OCR Workspace
 * Redesigned with 3-column responsive layout
 * Supports background auto-processing while user can freely view any page
 */
export default function TextRecognitionPage({ processedImages, onBack, onComplete }) {
  // API Configuration
  const [apiKey, setApiKey] = useState('');
  const [isKeyValid, setIsKeyValid] = useState(null);
  const [isValidating, setIsValidating] = useState(false);
  const [selectedModel, setSelectedModel] = useState('gemini-3-flash-preview');
  const [models, setModels] = useState([]);
  const [backendOnline, setBackendOnline] = useState(null);

  // Viewing state - which page user is looking at
  const [viewingPageIndex, setViewingPageIndex] = useState(0);
  
  // Processing state - which page is being processed (can be different from viewing)
  const [processingPageIndex, setProcessingPageIndex] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAutoProcessing, setIsAutoProcessing] = useState(false);
  const [error, setError] = useState(null);

  // Transcripts
  const [transcripts, setTranscripts] = useState({});
  const [originalTranscripts, setOriginalTranscripts] = useState({});
  const [processedPages, setProcessedPages] = useState(new Set());

  // Rate limit
  const [rateLimitReady, setRateLimitReady] = useState(true);
  const [waitSeconds, setWaitSeconds] = useState(0);

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
  
  // Check if the currently viewing page is also being processed
  const isViewingPageProcessing = isProcessing && processingPageIndex === viewingPageIndex;

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

  // Auto-processing - processes pages in background without changing view
  useEffect(() => {
    if (!isAutoProcessing || isProcessing || !rateLimitReady) return;

    // Find next unprocessed page
    const nextUnprocessed = processedImages.findIndex((_, i) => !processedPages.has(i + 1));
    
    if (nextUnprocessed === -1) {
      // All pages processed
      setIsAutoProcessing(false);
      return;
    }

    // Process the next unprocessed page (don't change viewing page)
    processPage(nextUnprocessed);
  }, [isAutoProcessing, isProcessing, rateLimitReady, processedPages, processedImages, processPage]);

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

  // Toggle auto processing
  const handleToggleAutoProcess = useCallback(() => {
    setIsAutoProcessing((prev) => !prev);
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
          />
          <PageThumbnailList
            images={processedImages}
            currentIndex={viewingPageIndex}
            processedPages={processedPages}
            processingPageIndex={processingPageIndex}
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
