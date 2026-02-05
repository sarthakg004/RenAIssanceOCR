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
 */
export default function TextRecognitionPage({ processedImages, onBack, onComplete }) {
  // API Configuration
  const [apiKey, setApiKey] = useState('');
  const [isKeyValid, setIsKeyValid] = useState(null);
  const [isValidating, setIsValidating] = useState(false);
  const [selectedModel, setSelectedModel] = useState('gemini-3-flash-preview');
  const [models, setModels] = useState([]);
  const [backendOnline, setBackendOnline] = useState(null);

  // Processing state
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
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

  // Computed values
  const currentPage = processedImages[currentPageIndex];
  const pageNumber = currentPageIndex + 1;
  const totalPages = processedImages.length;
  const isPageProcessed = processedPages.has(pageNumber);
  const hasAnyTranscript = processedPages.size > 0;
  const canProcess = apiKey && apiKey.length >= 10 && isKeyValid !== false && rateLimitReady;

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

  // Navigation
  const goToPage = useCallback((index) => {
    if (index >= 0 && index < totalPages) {
      setCurrentPageIndex(index);
      setError(null);
    }
  }, [totalPages]);

  // Process single page
  const processCurrentPage = useCallback(async () => {
    if (!canProcess || isProcessing) return;

    setIsProcessing(true);
    setError(null);

    try {
      const imageData = currentPage.processed || currentPage.original;
      const result = await processPageOCR(imageData, selectedModel, apiKey);

      if (result.success) {
        setTranscripts((prev) => ({ ...prev, [pageNumber]: result.transcript }));
        setOriginalTranscripts((prev) => ({ ...prev, [pageNumber]: result.transcript }));
        setProcessedPages((prev) => new Set([...prev, pageNumber]));
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
    }
  }, [apiKey, currentPage, pageNumber, selectedModel, canProcess, isProcessing]);

  // Auto-processing
  useEffect(() => {
    if (!isAutoProcessing || isProcessing || !rateLimitReady) return;

    const nextUnprocessed = processedImages.findIndex((_, i) => !processedPages.has(i + 1));
    if (nextUnprocessed === -1) {
      setIsAutoProcessing(false);
      return;
    }

    if (nextUnprocessed !== currentPageIndex) {
      setCurrentPageIndex(nextUnprocessed);
    } else {
      processCurrentPage();
    }
  }, [isAutoProcessing, isProcessing, rateLimitReady, processedPages, currentPageIndex, processCurrentPage, processedImages]);

  // Handle transcript change
  const handleTranscriptChange = useCallback((value) => {
    setTranscripts((prev) => ({ ...prev, [pageNumber]: value }));
  }, [pageNumber]);

  // Reset transcript
  const handleResetTranscript = useCallback(() => {
    setTranscripts((prev) => ({ ...prev, [pageNumber]: originalTranscripts[pageNumber] }));
  }, [pageNumber, originalTranscripts]);

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
            currentIndex={currentPageIndex}
            processedPages={processedPages}
            onPageSelect={goToPage}
          />
        </>
      }
      centerPanel={
        <PagePreview
          currentPage={currentPage}
          currentIndex={currentPageIndex}
          totalPages={totalPages}
          isProcessing={isProcessing}
          isPageProcessed={isPageProcessed}
          isAutoProcessing={isAutoProcessing}
          rateLimitReady={rateLimitReady}
          waitSeconds={waitSeconds}
          error={error}
          canProcess={canProcess}
          onPrevPage={() => goToPage(currentPageIndex - 1)}
          onNextPage={() => goToPage(currentPageIndex + 1)}
          onProcess={processCurrentPage}
          onToggleAutoProcess={handleToggleAutoProcess}
        />
      }
      rightPanel={
        <TranscriptPanel
          pageNumber={pageNumber}
          transcript={transcripts[pageNumber] || ''}
          originalTranscript={originalTranscripts[pageNumber] || ''}
          isProcessing={isProcessing}
          isProcessed={isPageProcessed}
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
