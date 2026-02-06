import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Download,
  Crop,
  Play,
  SkipForward,
  Sparkles,
  Layers,
  Search,
  Check,
  AlertCircle,
} from 'lucide-react';

// Import preprocess components
import {
  OperationsSidebar,
  PipelineStack,
  BeforeAfterViewer,
  ZoomLensPreview,
  ProgressBarLabeled,
} from '../components/preprocess';

// Import existing components
import ImageCropper from '../components/ImageCropper';

// Import hooks and services
import { usePipeline } from '../hooks/usePipeline';
import { preprocessImage } from '../services/api';

/**
 * PreprocessPage - Enhanced Image Preprocessing Studio
 * 
 * 3-panel layout:
 * - Left: Operations sidebar with accordion groups
 * - Center: Image preview with before/after split view
 * - Right: Pipeline stack (overlay or sidebar)
 * - Top: Action bar with progress and navigation
 */
export default function PreprocessPage({
  pages,
  selectedPages,
  onBack,
  onNext,
  onProcessedImagesChange,
}) {
  // ========== STATE ==========
  
  // Current page navigation
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  
  // Processing state
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [currentProcessingStep, setCurrentProcessingStep] = useState(null);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  
  // Image state
  const [processedImages, setProcessedImages] = useState({});
  const [croppedImages, setCroppedImages] = useState({});
  
  // UI state
  const [showCropper, setShowCropper] = useState(false);
  const [showZoomLens, setShowZoomLens] = useState(false);
  const [showPipelinePanel, setShowPipelinePanel] = useState(true);

  // ========== DERIVED DATA ==========
  
  const selectedPageData = useMemo(() => 
    selectedPages.map((pageNum) => ({
      pageNumber: pageNum,
      ...pages[pageNum - 1],
    })),
    [selectedPages, pages]
  );

  const currentPage = selectedPageData[currentPageIndex];
  
  // Get current source image (cropped or original)
  const currentSourceImage = useMemo(() => {
    if (!currentPage) return null;
    return croppedImages[currentPage.pageNumber]?.dataUrl || currentPage.thumbnail;
  }, [currentPage, croppedImages]);

  // ========== PIPELINE HOOK ==========
  
  const {
    pipeline,
    enabledOperations,
    toggleOperation,
    updateOperationParams,
    togglePipelineStep,
    updatePipelineStepParams,
    removePipelineStep,
    reorderPipeline,
    applyRecommendedPipeline,
    resetPipeline,
    getActivePipeline,
    buildPipelineConfig,
  } = usePipeline({
    debounceMs: 600,
    onPreviewRequest: () => {
      // Auto-preview on changes (optional - can be disabled for performance)
      // handleApplyPreview();
    },
  });

  // ========== EFFECTS ==========
  
  // Sync processed images to parent
  useEffect(() => {
    if (onProcessedImagesChange) {
      onProcessedImagesChange(processedImages);
    }
  }, [processedImages, onProcessedImagesChange]);

  // ========== HANDLERS ==========

  // Handle crop completion
  const handleCropComplete = useCallback((croppedDataUrl, cropData) => {
    if (!currentPage) return;

    setCroppedImages((prev) => ({
      ...prev,
      [currentPage.pageNumber]: {
        dataUrl: croppedDataUrl,
        cropData: cropData,
      },
    }));
    setShowCropper(false);

    // Clear any existing processed image since source changed
    setProcessedImages((prev) => {
      const { [currentPage.pageNumber]: removed, ...rest } = prev;
      return rest;
    });
  }, [currentPage]);

  // Clear crop for current page
  const handleClearCrop = useCallback(() => {
    if (!currentPage) return;
    
    setCroppedImages((prev) => {
      const { [currentPage.pageNumber]: removed, ...rest } = prev;
      return rest;
    });
    
    // Also clear processed image
    setProcessedImages((prev) => {
      const { [currentPage.pageNumber]: removed, ...rest } = prev;
      return rest;
    });
  }, [currentPage]);

  // Apply preprocessing to current page
  const handleApplyToCurrentPage = useCallback(async () => {
    if (!currentPage || isProcessing) return;

    const activePipeline = getActivePipeline();
    if (activePipeline.length === 0) return;

    setIsProcessing(true);
    setProcessingProgress(0);

    try {
      const pipelineConfig = buildPipelineConfig();
      const sourceImage = croppedImages[currentPage.pageNumber]?.dataUrl || currentPage.thumbnail;

      // Simulate step-by-step progress
      for (let i = 0; i < pipelineConfig.length; i++) {
        setCurrentProcessingStep(pipelineConfig[i].op);
        setProcessingProgress(((i + 0.5) / pipelineConfig.length) * 100);
        await new Promise(r => setTimeout(r, 100)); // Small delay for UI feedback
      }

      const result = await preprocessImage(sourceImage, pipelineConfig);
      
      setProcessedImages((prev) => ({
        ...prev,
        [currentPage.pageNumber]: result,
      }));
      
      setProcessingProgress(100);
    } catch (error) {
      console.error('Processing failed:', error);
    } finally {
      setIsProcessing(false);
      setCurrentProcessingStep(null);
      setProcessingProgress(0);
    }
  }, [currentPage, isProcessing, getActivePipeline, buildPipelineConfig, croppedImages]);

  // Apply crop only (no other preprocessing)
  const handleApplyCropOnly = useCallback(async () => {
    if (!currentPage) return;

    const croppedImage = croppedImages[currentPage.pageNumber]?.dataUrl;
    if (!croppedImage) {
      // No crop applied, just use original
      setProcessedImages((prev) => ({
        ...prev,
        [currentPage.pageNumber]: currentPage.thumbnail,
      }));
    } else {
      // Use cropped image as the processed result
      setProcessedImages((prev) => ({
        ...prev,
        [currentPage.pageNumber]: croppedImage,
      }));
    }
  }, [currentPage, croppedImages]);

  // Apply to all selected pages
  const handleApplyToAllPages = useCallback(async () => {
    if (isProcessing) return;

    const activePipeline = getActivePipeline();
    if (activePipeline.length === 0) return;

    setIsProcessing(true);
    setBatchProgress({ current: 0, total: selectedPageData.length });

    try {
      const pipelineConfig = buildPipelineConfig();
      const results = {};

      for (let i = 0; i < selectedPageData.length; i++) {
        const page = selectedPageData[i];
        setBatchProgress({ current: i + 1, total: selectedPageData.length });
        setProcessingProgress(((i + 0.5) / selectedPageData.length) * 100);

        const sourceImage = croppedImages[page.pageNumber]?.dataUrl || page.thumbnail;
        const result = await preprocessImage(sourceImage, pipelineConfig);
        results[page.pageNumber] = result;
      }

      setProcessedImages(results);
      setProcessingProgress(100);
    } catch (error) {
      console.error('Batch processing failed:', error);
    } finally {
      setIsProcessing(false);
      setBatchProgress({ current: 0, total: 0 });
      setProcessingProgress(0);
    }
  }, [isProcessing, getActivePipeline, buildPipelineConfig, selectedPageData, croppedImages]);

  // Page navigation
  const handlePrevPage = () => {
    setCurrentPageIndex((prev) => Math.max(0, prev - 1));
  };

  const handleNextPage = () => {
    setCurrentPageIndex((prev) => Math.min(selectedPageData.length - 1, prev + 1));
  };

  // Reset all
  const handleReset = useCallback(() => {
    resetPipeline();
    setProcessedImages({});
  }, [resetPipeline]);

  // ========== COMPUTED VALUES ==========
  
  const activePipelineCount = getActivePipeline().length;
  const hasProcessedImages = Object.keys(processedImages).length > 0;
  const currentPageProcessed = currentPage && processedImages[currentPage.pageNumber];
  const currentPageCropped = currentPage && croppedImages[currentPage.pageNumber];

  // ========== RENDER ==========

  return (
    <div className="h-full flex flex-col animate-fade-in">
      {/* ========== TOP BAR ========== */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-gray-200 bg-white/80 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          {/* Left section - Back button and title */}
          <div className="flex items-center gap-4">
            <button onClick={onBack} className="btn-ghost">
              <ArrowLeft className="w-5 h-5" />
              Back
            </button>

            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg text-white shadow-md">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-800">
                  Preprocessing Studio
                </h1>
                <p className="text-xs text-gray-500">
                  {selectedPages.length} page{selectedPages.length > 1 ? 's' : ''} • 
                  {activePipelineCount} operation{activePipelineCount !== 1 ? 's' : ''} active
                </p>
              </div>
            </div>
          </div>

          {/* Center section - Progress (when processing) */}
          {isProcessing && (
            <div className="flex-1 max-w-md mx-8">
              <ProgressBarLabeled
                label={
                  batchProgress.total > 0
                    ? `Processing page ${batchProgress.current} of ${batchProgress.total}`
                    : currentProcessingStep
                    ? `Running: ${currentProcessingStep}`
                    : 'Processing...'
                }
                progress={processingProgress}
                variant="primary"
                size="md"
                isActive
              />
            </div>
          )}

          {/* Right section - Actions */}
          <div className="flex items-center gap-2">
            {/* Apply to current */}
            <button
              onClick={handleApplyToCurrentPage}
              disabled={isProcessing || activePipelineCount === 0}
              className="btn-primary flex items-center gap-2"
              title="Apply pipeline to current page"
            >
              <Play className="w-4 h-4" />
              Apply
            </button>

            {/* Apply to all */}
            <button
              onClick={handleApplyToAllPages}
              disabled={isProcessing || activePipelineCount === 0}
              className="btn-secondary flex items-center gap-2"
              title="Apply pipeline to all selected pages"
            >
              <Layers className="w-4 h-4" />
              Apply All
            </button>

            <div className="w-px h-6 bg-gray-200 mx-1" />

            {/* Skip */}
            <button
              onClick={onNext}
              disabled={isProcessing}
              className="btn-ghost text-gray-500 flex items-center gap-1"
              title="Skip preprocessing"
            >
              <SkipForward className="w-4 h-4" />
              Skip
            </button>

            {/* Next step */}
            <button
              onClick={onNext}
              disabled={!hasProcessedImages}
              className={`flex items-center gap-2 px-5 py-2 font-semibold rounded-xl transition-all ${
                hasProcessedImages
                  ? 'bg-gradient-to-r from-green-500 to-emerald-600 text-white shadow-md hover:shadow-lg hover:-translate-y-0.5'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              }`}
            >
              Next
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* ========== MAIN CONTENT ========== */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* ========== LEFT PANEL - Operations Sidebar ========== */}
        <div className="w-72 flex-shrink-0 border-r border-gray-200 overflow-hidden">
          <OperationsSidebar
            enabledOperations={enabledOperations}
            onOperationToggle={toggleOperation}
            onOperationParamsChange={updateOperationParams}
            onApplyRecommended={applyRecommendedPipeline}
            onReset={handleReset}
            isProcessing={isProcessing}
            className="h-full rounded-none shadow-none"
          />
        </div>

        {/* ========== CENTER PANEL - Preview ========== */}
        <div className="flex-1 flex flex-col min-w-0 p-4 overflow-hidden">
          {/* Page navigation and crop controls */}
          <div className="flex items-center justify-between mb-3">
            {/* Crop controls */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowCropper(true)}
                disabled={!currentPage}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  currentPageCropped
                    ? 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <Crop className="w-4 h-4" />
                {currentPageCropped ? 'Re-crop' : 'Crop'}
              </button>

              {currentPageCropped && (
                <button
                  onClick={handleClearCrop}
                  className="px-2 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                >
                  Clear
                </button>
              )}

              {/* Crop-only apply button */}
              {currentPageCropped && (
                <button
                  onClick={handleApplyCropOnly}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-orange-700 bg-orange-50 hover:bg-orange-100 rounded-lg transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                  Crop Only
                </button>
              )}
            </div>

            {/* Page navigation */}
            <div className="flex items-center gap-3">
              <button
                onClick={handlePrevPage}
                disabled={currentPageIndex === 0}
                className={`p-1.5 rounded-lg transition-colors ${
                  currentPageIndex === 0 ? 'text-gray-300' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <ChevronLeft className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-1.5">
                {selectedPageData.map((page, idx) => (
                  <button
                    key={page.pageNumber}
                    onClick={() => setCurrentPageIndex(idx)}
                    className={`relative w-7 h-7 rounded-lg text-xs font-medium transition-all ${
                      idx === currentPageIndex
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {page.pageNumber}
                    {/* Status indicators */}
                    {processedImages[page.pageNumber] && (
                      <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-white" />
                    )}
                    {!processedImages[page.pageNumber] && croppedImages[page.pageNumber] && (
                      <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-orange-400 rounded-full border-2 border-white" />
                    )}
                  </button>
                ))}
              </div>

              <button
                onClick={handleNextPage}
                disabled={currentPageIndex === selectedPageData.length - 1}
                className={`p-1.5 rounded-lg transition-colors ${
                  currentPageIndex === selectedPageData.length - 1 ? 'text-gray-300' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>

            {/* Zoom lens toggle */}
            <button
              onClick={() => setShowZoomLens(!showZoomLens)}
              className={`p-2 rounded-lg transition-colors ${
                showZoomLens ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              title="Toggle zoom lens"
            >
              <Search className="w-4 h-4" />
            </button>
          </div>

          {/* Image preview */}
          <div className="flex-1 min-h-0">
            <BeforeAfterViewer
              originalImage={currentSourceImage}
              processedImage={currentPageProcessed}
              isProcessing={isProcessing}
              processingLabel={currentProcessingStep ? `Running: ${currentProcessingStep}` : 'Processing...'}
              onOpenZoomLens={() => setShowZoomLens(true)}
              className="h-full"
            />
          </div>

          {/* Status bar */}
          <div className="flex items-center justify-between mt-2 px-2 text-xs text-gray-500">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                Processed: {Object.keys(processedImages).length}/{selectedPages.length}
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-orange-400" />
                Cropped: {Object.keys(croppedImages).length}
              </span>
            </div>
            {currentPage && (
              <span>Page {currentPage.pageNumber}</span>
            )}
          </div>
        </div>

        {/* ========== RIGHT PANEL - Pipeline Stack ========== */}
        {showPipelinePanel && (
          <div className="w-64 flex-shrink-0 border-l border-gray-200 bg-gray-50/50 p-3 overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <Layers className="w-4 h-4 text-blue-500" />
                Pipeline
              </h3>
              {activePipelineCount > 0 && (
                <span className="px-2 py-0.5 bg-blue-100 text-blue-600 text-xs font-semibold rounded">
                  {activePipelineCount}
                </span>
              )}
            </div>

            <PipelineStack
              pipeline={pipeline}
              onReorder={reorderPipeline}
              onToggle={togglePipelineStep}
              onUpdateParams={updatePipelineStepParams}
              onRemove={removePipelineStep}
              isProcessing={isProcessing}
              currentStepId={currentProcessingStep}
            />

            {/* Quick tips */}
            {pipeline.length === 0 && (
              <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-100">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-medium text-blue-700">Getting Started</p>
                    <p className="text-[10px] text-blue-600 mt-1">
                      Enable operations from the left sidebar or click "Recommended" for a good starting pipeline.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ========== MODALS ========== */}
      
      {/* Image Cropper Modal */}
      {showCropper && currentPage && (
        <ImageCropper
          imageSrc={currentPage.thumbnail}
          onCropComplete={handleCropComplete}
          onCancel={() => setShowCropper(false)}
          initialCrop={croppedImages[currentPage.pageNumber]?.cropData}
        />
      )}

      {/* Zoom Lens Preview */}
      <ZoomLensPreview
        originalImage={currentSourceImage}
        processedImage={currentPageProcessed}
        isOpen={showZoomLens}
        onClose={() => setShowZoomLens(false)}
      />
    </div>
  );
}
