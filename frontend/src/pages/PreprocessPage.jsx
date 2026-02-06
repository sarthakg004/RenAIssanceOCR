import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Crop,
  Play,
  SkipForward,
  Sparkles,
  Layers,
  Search,
  Undo2,
  RotateCcw,
  Info,
  X,
  AlertTriangle,
} from 'lucide-react';

// Import preprocess components
import {
  OperationsSidebar,
  PipelineStack,
  BeforeAfterViewer,
  ZoomLensPreview,
  ProgressBarLabeled,
} from '../components/preprocess';

// Import OCR components for resizable panels
import { ResizablePanels } from '../components/ocr';

// Import existing components
import ImageCropper from '../components/ImageCropper';

// Import hooks and services
import { usePipeline } from '../hooks/usePipeline';
import { preprocessImage } from '../services/api';

// ============================================
// InfoBanner Component - Dismissible UX Tip
// ============================================
function InfoBanner({ message, onDismiss, variant = 'info' }) {
  const variants = {
    info: {
      bg: 'bg-blue-50',
      border: 'border-blue-200',
      text: 'text-blue-800',
      icon: 'text-blue-500',
    },
    warning: {
      bg: 'bg-amber-50',
      border: 'border-amber-200',
      text: 'text-amber-800',
      icon: 'text-amber-500',
    },
  };

  const style = variants[variant] || variants.info;
  const Icon = variant === 'warning' ? AlertTriangle : Info;

  return (
    <div className={`${style.bg} ${style.border} border rounded-lg px-4 py-3 flex items-start gap-3`}>
      <Icon className={`w-5 h-5 ${style.icon} flex-shrink-0 mt-0.5`} />
      <p className={`text-sm ${style.text} flex-1`}>{message}</p>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className={`${style.text} hover:opacity-70 transition-opacity p-0.5`}
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

// ============================================
// useImageHistory Hook - Manages undo stack
// ============================================
function useImageHistory(initialState = null) {
  // History stack for undo operations (stores previous states)
  const [history, setHistory] = useState([]);
  // Current working image state
  const [currentState, setCurrentState] = useState(initialState);
  // Original image (never modified)
  const [originalState, setOriginalState] = useState(initialState);

  // Initialize with a new original image
  const initialize = useCallback((imageData) => {
    setOriginalState(imageData);
    setCurrentState(imageData);
    setHistory([]);
  }, []);

  // Push current state to history and update with new state
  const pushState = useCallback((newState) => {
    setHistory((prev) => {
      // Limit history size to prevent memory issues
      const MAX_HISTORY = 10;
      const newHistory = [...prev, currentState];
      if (newHistory.length > MAX_HISTORY) {
        return newHistory.slice(-MAX_HISTORY);
      }
      return newHistory;
    });
    setCurrentState(newState);
  }, [currentState]);

  // Undo - pop from history
  const undo = useCallback(() => {
    if (history.length === 0) return false;
    
    const previousState = history[history.length - 1];
    setHistory((prev) => prev.slice(0, -1));
    setCurrentState(previousState);
    return true;
  }, [history]);

  // Reset to original
  const reset = useCallback(() => {
    setCurrentState(originalState);
    setHistory([]);
  }, [originalState]);

  return {
    currentState,
    originalState,
    history,
    canUndo: history.length > 0,
    initialize,
    pushState,
    undo,
    reset,
    setCurrentState,
  };
}

// ============================================
// PreprocessPage - Enhanced Image Preprocessing Studio
// ============================================
/**
 * PreprocessPage - Enhanced Image Preprocessing Studio
 * 
 * Features:
 * - Full-page responsive layout
 * - Persistent crop with undo support
 * - Pipeline model that chains operations on current state
 * - UX tip banners
 * - State safety with history tracking
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
  
  // Image state management per page
  // Structure: { pageNumber: { current, original, history } }
  const [imageStates, setImageStates] = useState({});
  
  // Final processed images (output of preprocessing pipeline)
  const [processedImages, setProcessedImages] = useState({});
  
  // UI state
  const [showCropper, setShowCropper] = useState(false);
  const [showZoomLens, setShowZoomLens] = useState(false);
  const [showPipelinePanel, setShowPipelinePanel] = useState(true);
  const [showTipBanner, setShowTipBanner] = useState(true);

  // ========== DERIVED DATA ==========
  
  const selectedPageData = useMemo(() => 
    selectedPages.map((pageNum) => ({
      pageNumber: pageNum,
      ...pages[pageNum - 1],
    })),
    [selectedPages, pages]
  );

  const currentPage = selectedPageData[currentPageIndex];
  
  // Initialize image state for a page if not exists
  const getOrCreateImageState = useCallback((pageNumber, originalImage) => {
    if (!imageStates[pageNumber]) {
      return {
        current: originalImage,
        original: originalImage,
        history: [],
      };
    }
    return imageStates[pageNumber];
  }, [imageStates]);
  
  // Get current working image for the active page
  const currentImageState = useMemo(() => {
    if (!currentPage) return null;
    const state = imageStates[currentPage.pageNumber];
    return state?.current || currentPage.thumbnail;
  }, [currentPage, imageStates]);
  
  // Get original image for the active page
  const originalImageState = useMemo(() => {
    if (!currentPage) return null;
    return currentPage.thumbnail;
  }, [currentPage]);
  
  // Check if current page has history (can undo)
  const canUndo = useMemo(() => {
    if (!currentPage) return false;
    const state = imageStates[currentPage.pageNumber];
    return state?.history?.length > 0;
  }, [currentPage, imageStates]);
  
  // Check if current page has been modified from original
  const isModified = useMemo(() => {
    if (!currentPage) return false;
    const state = imageStates[currentPage.pageNumber];
    return state?.current && state.current !== currentPage.thumbnail;
  }, [currentPage, imageStates]);

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
      // Auto-preview disabled for performance
    },
  });

  // ========== EFFECTS ==========
  
  // Sync processed/modified images to parent
  // This includes both preprocessed images AND cropped-only images
  useEffect(() => {
    if (onProcessedImagesChange) {
      // Build a combined map: preprocessed images take priority, 
      // but include cropped images that weren't preprocessed
      const combinedImages = { ...processedImages };
      
      // Add cropped images that don't have a preprocessed version
      selectedPageData.forEach(page => {
        const pageNum = page.pageNumber;
        if (!combinedImages[pageNum]) {
          const state = imageStates[pageNum];
          // If the image was modified (cropped), use the current state
          if (state?.current && state.current !== page.thumbnail) {
            combinedImages[pageNum] = state.current;
          }
        }
      });
      
      onProcessedImagesChange(combinedImages);
    }
  }, [processedImages, imageStates, selectedPageData, onProcessedImagesChange]);

  // ========== IMAGE STATE HANDLERS ==========
  
  /**
   * Push a new image state to history and update current
   * This is the core state management function that ensures:
   * - Previous state is saved for undo
   * - New state becomes the working image
   * - Original is never mutated
   */
  const pushImageState = useCallback((pageNumber, newImageData) => {
    setImageStates((prev) => {
      const currentState = prev[pageNumber] || {
        current: pages[pageNumber - 1]?.thumbnail,
        original: pages[pageNumber - 1]?.thumbnail,
        history: [],
      };
      
      // Don't push if same as current
      if (currentState.current === newImageData) {
        return prev;
      }
      
      // Limit history size
      const MAX_HISTORY = 10;
      const newHistory = [...currentState.history, currentState.current];
      
      return {
        ...prev,
        [pageNumber]: {
          ...currentState,
          current: newImageData,
          history: newHistory.slice(-MAX_HISTORY),
        },
      };
    });
  }, [pages]);
  
  /**
   * Undo last image modification
   */
  const handleUndo = useCallback(() => {
    if (!currentPage) return;
    
    setImageStates((prev) => {
      const state = prev[currentPage.pageNumber];
      if (!state || state.history.length === 0) return prev;
      
      const previousImage = state.history[state.history.length - 1];
      
      return {
        ...prev,
        [currentPage.pageNumber]: {
          ...state,
          current: previousImage,
          history: state.history.slice(0, -1),
        },
      };
    });
    
    // Also clear processed image since source changed
    setProcessedImages((prev) => {
      const { [currentPage.pageNumber]: removed, ...rest } = prev;
      return rest;
    });
  }, [currentPage]);
  
  /**
   * Reset current page to original image
   */
  const handleResetImage = useCallback(() => {
    if (!currentPage) return;
    
    setImageStates((prev) => ({
      ...prev,
      [currentPage.pageNumber]: {
        current: currentPage.thumbnail,
        original: currentPage.thumbnail,
        history: [],
      },
    }));
    
    // Clear processed image
    setProcessedImages((prev) => {
      const { [currentPage.pageNumber]: removed, ...rest } = prev;
      return rest;
    });
  }, [currentPage]);

  // ========== CROP HANDLERS ==========

  /**
   * Handle crop completion
   * Crops are treated as direct edits - saved immediately to working state
   * with full undo support. No special "crop-only" mode needed.
   */
  const handleCropComplete = useCallback((croppedDataUrl, cropData) => {
    if (!currentPage) return;

    // Push cropped image to state (saves history for undo)
    pushImageState(currentPage.pageNumber, croppedDataUrl);
    
    setShowCropper(false);

    // Clear processed image since source changed
    // User needs to re-apply preprocessing on the new cropped base
    setProcessedImages((prev) => {
      const { [currentPage.pageNumber]: removed, ...rest } = prev;
      return rest;
    });
  }, [currentPage, pushImageState]);

  // ========== PREPROCESSING HANDLERS ==========

  /**
   * Apply preprocessing to current page
   * Always operates on the currentImageState (which may be cropped)
   */
  const handleApplyToCurrentPage = useCallback(async () => {
    if (!currentPage || isProcessing) return;

    const activePipeline = getActivePipeline();
    if (activePipeline.length === 0) return;

    setIsProcessing(true);
    setProcessingProgress(0);

    try {
      const pipelineConfig = buildPipelineConfig();
      
      // IMPORTANT: Use current working image state, not original
      const sourceImage = currentImageState;

      // Progress simulation for UI feedback
      for (let i = 0; i < pipelineConfig.length; i++) {
        setCurrentProcessingStep(pipelineConfig[i].op);
        setProcessingProgress(((i + 0.5) / pipelineConfig.length) * 100);
        await new Promise(r => setTimeout(r, 100));
      }

      const result = await preprocessImage(sourceImage, pipelineConfig);
      
      // Save the preprocessed result
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
  }, [currentPage, isProcessing, getActivePipeline, buildPipelineConfig, currentImageState]);

  /**
   * Apply preprocessing to all selected pages
   * Each page uses its own current working image state
   */
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

        // Use each page's current working image state
        const pageState = imageStates[page.pageNumber];
        const sourceImage = pageState?.current || page.thumbnail;
        
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
  }, [isProcessing, getActivePipeline, buildPipelineConfig, selectedPageData, imageStates]);

  // ========== NAVIGATION HANDLERS ==========
  
  const handlePrevPage = () => {
    setCurrentPageIndex((prev) => Math.max(0, prev - 1));
  };

  const handleNextPage = () => {
    setCurrentPageIndex((prev) => Math.min(selectedPageData.length - 1, prev + 1));
  };

  // ========== RESET HANDLER ==========
  
  const handleResetAll = useCallback(() => {
    resetPipeline();
    setProcessedImages({});
    setImageStates({});
  }, [resetPipeline]);

  // ========== COMPUTED VALUES ==========
  
  const activePipelineCount = getActivePipeline().length;
  const hasProcessedImages = Object.keys(processedImages).length > 0;
  const currentPageProcessed = currentPage && processedImages[currentPage.pageNumber];
  
  // Check if any page has been modified (cropped) from its original
  const hasModifiedImages = useMemo(() => {
    return selectedPageData.some(page => {
      const state = imageStates[page.pageNumber];
      return state?.current && state.current !== page.thumbnail;
    });
  }, [selectedPageData, imageStates]);
  
  // Allow proceeding if there are processed images OR modified (cropped) images
  const canProceed = hasProcessedImages || hasModifiedImages;

  // ========== RENDER ==========

  return (
    <div className="h-full w-full flex flex-col bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/40 overflow-hidden">
      {/* ========== TOP BAR ========== */}
      <header className="flex-shrink-0 px-4 py-3 border-b border-gray-200 bg-white/80 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          {/* Left section - Back button and title */}
          <div className="flex items-center gap-4">
            <button onClick={onBack} className="btn-ghost">
              <ArrowLeft className="w-5 h-5" />
              <span className="hidden sm:inline">Back</span>
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
            <div className="flex-1 max-w-md mx-8 hidden md:block">
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
              <span className="hidden sm:inline">Apply</span>
            </button>

            {/* Apply to all */}
            <button
              onClick={handleApplyToAllPages}
              disabled={isProcessing || activePipelineCount === 0}
              className="btn-secondary flex items-center gap-2"
              title="Apply pipeline to all selected pages"
            >
              <Layers className="w-4 h-4" />
              <span className="hidden lg:inline">Apply All</span>
            </button>

            <div className="w-px h-6 bg-gray-200 mx-1 hidden sm:block" />

            {/* Skip */}
            <button
              onClick={onNext}
              disabled={isProcessing}
              className="btn-ghost text-gray-500 flex items-center gap-1"
              title="Skip preprocessing"
            >
              <SkipForward className="w-4 h-4" />
              <span className="hidden md:inline">Skip</span>
            </button>

            {/* Next step */}
            <button
              onClick={onNext}
              disabled={!canProceed}
              className={`flex items-center gap-2 px-4 sm:px-5 py-2 font-semibold rounded-xl transition-all ${
                canProceed
                  ? 'bg-gradient-to-r from-green-500 to-emerald-600 text-white shadow-md hover:shadow-lg hover:-translate-y-0.5'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              }`}
            >
              <span className="hidden sm:inline">Next</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* ========== MAIN CONTENT - Resizable 3-Panel Layout ========== */}
      <main className="flex-1 min-h-0 overflow-hidden">
        <ResizablePanels
          defaultLeftWidth={280}
          defaultRightWidth={260}
          minLeftWidth={220}
          maxLeftWidth={400}
          minRightWidth={200}
          maxRightWidth={380}
          minCenterWidth={400}
          
          /* ========== LEFT PANEL - Operations Sidebar ========== */
          leftPanel={
            <div className="h-full border-r border-gray-200 overflow-hidden bg-white/50">
              <OperationsSidebar
                enabledOperations={enabledOperations}
                onOperationToggle={toggleOperation}
                onOperationParamsChange={updateOperationParams}
                onApplyRecommended={applyRecommendedPipeline}
                onReset={handleResetAll}
                isProcessing={isProcessing}
                className="h-full rounded-none shadow-none"
              />
            </div>
          }

          /* ========== CENTER PANEL - Preview ========== */
          centerPanel={
            <div className="h-full flex flex-col p-3 lg:p-4 overflow-hidden">
              {/* UX Tip Banner */}
              {showTipBanner && (
                <div className="mb-3 flex-shrink-0">
                  <InfoBanner
                    message="Tip: Crop images first before applying preprocessing for best results. Cropping after preprocessing may change output quality."
                    onDismiss={() => setShowTipBanner(false)}
                    variant="info"
                  />
                </div>
              )}
              
              {/* Page navigation and crop controls */}
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3 flex-shrink-0">
                {/* Left: Crop and Undo controls */}
                <div className="flex items-center gap-2">
                  {/* Crop button */}
                  <button
                    onClick={() => setShowCropper(true)}
                    disabled={!currentPage}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                      isModified
                        ? 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                    title="Crop image - changes are saved immediately"
                  >
                    <Crop className="w-4 h-4" />
                    Crop
                  </button>

                  {/* Undo button */}
                  <button
                    onClick={handleUndo}
                    disabled={!canUndo}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                      canUndo
                        ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        : 'bg-gray-50 text-gray-300 cursor-not-allowed'
                    }`}
                    title="Undo last edit"
                  >
                    <Undo2 className="w-4 h-4" />
                    <span className="hidden sm:inline">Undo</span>
                  </button>

                  {/* Reset button */}
                  {isModified && (
                    <button
                      onClick={handleResetImage}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Reset to original image"
                    >
                      <RotateCcw className="w-4 h-4" />
                      <span className="hidden sm:inline">Reset</span>
                    </button>
                  )}
                  
                  {/* Modified indicator */}
                  {isModified && (
                    <span className="text-xs text-orange-600 bg-orange-50 px-2 py-1 rounded hidden lg:inline">
                      Modified
                    </span>
                  )}
                </div>

                {/* Center: Page navigation */}
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

                  <div className="flex items-center gap-1.5 flex-wrap justify-center">
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
                        {!processedImages[page.pageNumber] && imageStates[page.pageNumber]?.current !== page.thumbnail && (
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

                {/* Right: Zoom lens toggle */}
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

              {/* Image preview - Takes remaining height */}
              <div className="flex-1 min-h-0">
                <BeforeAfterViewer
                  originalImage={currentImageState}
                  processedImage={currentPageProcessed}
                  isProcessing={isProcessing}
                  processingLabel={currentProcessingStep ? `Running: ${currentProcessingStep}` : 'Processing...'}
                  onOpenZoomLens={() => setShowZoomLens(true)}
                  className="h-full"
                />
              </div>

              {/* Status bar */}
              <div className="flex items-center justify-between mt-2 px-2 text-xs text-gray-500 flex-shrink-0">
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-green-500" />
                    Processed: {Object.keys(processedImages).length}/{selectedPages.length}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-orange-400" />
                    Modified: {Object.keys(imageStates).filter(k => imageStates[k]?.current !== pages[k-1]?.thumbnail).length}
                  </span>
                </div>
                {currentPage && (
                  <span>Page {currentPage.pageNumber}</span>
                )}
              </div>
            </div>
          }

          /* ========== RIGHT PANEL - Pipeline Stack ========== */
          rightPanel={
            showPipelinePanel ? (
              <div className="h-full border-l border-gray-200 bg-gray-50/50 p-3 overflow-y-auto">
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

                {/* Quick tips when pipeline empty */}
                {pipeline.length === 0 && (
                  <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-100">
                    <div className="flex items-start gap-2">
                      <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
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
            ) : (
              <div className="h-full" /> /* Empty placeholder when pipeline panel is hidden */
            )
          }
        />
      </main>

      {/* ========== MODALS ========== */}
      
      {/* Image Cropper Modal */}
      {showCropper && currentPage && (
        <ImageCropper
          imageSrc={currentImageState}
          onCropComplete={handleCropComplete}
          onCancel={() => setShowCropper(false)}
        />
      )}

      {/* Zoom Lens Preview */}
      <ZoomLensPreview
        originalImage={currentImageState}
        processedImage={currentPageProcessed}
        isOpen={showZoomLens}
        onClose={() => setShowZoomLens(false)}
      />
    </div>
  );
}
