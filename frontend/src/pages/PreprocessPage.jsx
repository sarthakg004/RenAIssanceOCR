import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
  Redo2,
  RotateCcw,
  Info,
  X,
  AlertTriangle,
  Eraser,
} from 'lucide-react';

// Import preprocess components
import {
  OperationsSidebar,
  PipelineStack,
  BeforeAfterViewer,
  ZoomLensPreview,
  ProgressBarLabeled,
  ImageEraser,
} from '../components/preprocess';

// Import OCR components for resizable panels
import { ResizablePanels } from '../components/ocr';

// Import existing components
import ImageCropper from '../components/ImageCropper';

// Import hooks and services
import { usePipeline } from '../hooks/usePipeline';
import { useHistoryStore, HistoryOps } from '../hooks/useHistoryStore';
import { preprocessImage } from '../services/api';

// Helper: shorten page labels so they fit in small boxes
// "1_left" → "1L", "2_right" → "2R", plain numbers stay as-is
function shortPageLabel(pageNumber) {
  const s = String(pageNumber);
  return s.replace('_left', 'L').replace('_right', 'R');
}

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
  initialProcessedImages,
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
  // Structure: { pageNumber: { current, original } }
  // History lives in `history` (unified command store) — not duplicated here.
  const [imageStates, setImageStates] = useState({});

  // Final processed images (output of preprocessing pipeline)
  // Initialized from parent so navigating back and returning preserves progress
  const [processedImages, setProcessedImages] = useState(() => initialProcessedImages || {});

  // Unified undo/redo store (replaces per-page history[] and globalUndoStack).
  const history = useHistoryStore();

  // UI state
  const [showCropper, setShowCropper] = useState(false);
  const [showEraser, setShowEraser] = useState(false);
  const [showZoomLens, setShowZoomLens] = useState(false);
  const [showPipelinePanel, setShowPipelinePanel] = useState(true);
  const [showTipBanner, setShowTipBanner] = useState(true);

  // ========== DERIVED DATA ==========

  const selectedPageData = useMemo(() =>
    selectedPages.map((pageNum) => ({
      pageNumber: pageNum,
      ...(pages.find(p => p.pageNumber === pageNum) || {}),
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

  // Undo/redo availability is derived from the unified store. `history.version`
  // is included so memoisation invalidates when the timeline changes.
  const canUndo = useMemo(() => (
    currentPage ? history.canUndoPage(currentPage.pageNumber) : false
  ), [currentPage, history, history.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const canRedo = useMemo(() => (
    currentPage ? history.canRedoPage(currentPage.pageNumber) : false
  ), [currentPage, history, history.version]); // eslint-disable-line react-hooks/exhaustive-deps

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
  // Pin the callback so a new prop identity from the parent doesn't re-fire
  // this sync effect. The effect's real deps are the data maps themselves.
  const onProcessedImagesChangeRef = useRef(onProcessedImagesChange);
  useEffect(() => { onProcessedImagesChangeRef.current = onProcessedImagesChange; }, [onProcessedImagesChange]);

  useEffect(() => {
    if (!onProcessedImagesChangeRef.current) return;
    const combinedImages = { ...processedImages };
    selectedPageData.forEach(page => {
      const pageNum = page.pageNumber;
      if (!combinedImages[pageNum]) {
        const state = imageStates[pageNum];
        if (state?.current && state.current !== page.thumbnail) {
          combinedImages[pageNum] = state.current;
        }
      }
    });
    onProcessedImagesChangeRef.current(combinedImages);
  }, [processedImages, imageStates, selectedPageData]);

  // ========== IMAGE STATE HANDLERS ==========

  /**
   * Read the current working image for a page without touching state.
   * Falls back to the page thumbnail if no edits have been made.
   */
  const getCurrentImageFor = useCallback((pageNumber) => {
    const state = imageStates[pageNumber];
    if (state?.current) return state.current;
    const page = pages.find((p) => p.pageNumber === pageNumber);
    return page?.thumbnail;
  }, [imageStates, pages]);

  /**
   * Write a new current image for a page (no history push).
   * Callers that want the change undoable must also push an op to `history`.
   */
  const setCurrentImageFor = useCallback((pageNumber, newImageData) => {
    setImageStates((prev) => {
      const pageData = pages.find((p) => p.pageNumber === pageNumber);
      const entry = prev[pageNumber] || {
        current: pageData?.thumbnail,
        original: pageData?.thumbnail,
      };
      if (entry.current === newImageData) return prev;
      return { ...prev, [pageNumber]: { ...entry, current: newImageData } };
    });
  }, [pages]);

  /**
   * Bulk-overwrite processedImages, dropping any entries set to null so the
   * map stays minimal. Used by revert paths that need to restore a snapshot.
   */
  const replaceProcessedImages = useCallback((nextMap) => {
    setProcessedImages(() => {
      const out = {};
      Object.entries(nextMap || {}).forEach(([k, v]) => {
        if (v != null) out[k] = v;
      });
      return out;
    });
  }, []);

  /**
   * Apply an operation's `after` side — used for redo. Returns nothing; all
   * state writes happen through the existing setters so subscribers update.
   */
  const applyForward = useCallback((op) => {
    if (!op) return;
    switch (op.kind) {
      case 'crop':
        setCurrentImageFor(op.pageNumber, op.after.image);
        setProcessedImages((prev) => {
          const { [op.pageNumber]: _removed, ...rest } = prev;
          return rest;
        });
        break;
      case 'crop-batch':
        Object.entries(op.after.images).forEach(([pn, url]) => {
          setCurrentImageFor(pn in imageStates ? pn : Number(pn), url);
        });
        setProcessedImages((prev) => {
          const next = { ...prev };
          Object.keys(op.after.images).forEach((pn) => { delete next[pn]; });
          return next;
        });
        break;
      case 'erase':
        setCurrentImageFor(op.pageNumber, op.after.image);
        setProcessedImages((prev) => {
          const { [op.pageNumber]: _removed, ...rest } = prev;
          return rest;
        });
        break;
      case 'erase-batch':
        Object.entries(op.after.images).forEach(([pn, url]) => {
          const key = isNaN(Number(pn)) ? pn : Number(pn);
          setCurrentImageFor(key, url);
        });
        setProcessedImages((prev) => {
          const next = { ...prev };
          Object.keys(op.after.images).forEach((pn) => { delete next[pn]; });
          return next;
        });
        break;
      case 'pipeline':
        setProcessedImages((prev) => ({ ...prev, [op.pageNumber]: op.after.processed }));
        break;
      case 'pipeline-batch':
        replaceProcessedImages(op.after.processed);
        break;
      case 'reset-page': {
        const page = pages.find((p) => p.pageNumber === op.pageNumber);
        setCurrentImageFor(op.pageNumber, page?.thumbnail);
        setProcessedImages((prev) => {
          const { [op.pageNumber]: _removed, ...rest } = prev;
          return rest;
        });
        break;
      }
      default:
        console.warn('applyForward: unknown op kind', op.kind);
    }
  }, [imageStates, pages, replaceProcessedImages, setCurrentImageFor]);

  /**
   * Revert an operation's effect. The store has already moved its cursor;
   * this just walks the state changes backwards.
   */
  const applyRevert = useCallback((op) => {
    if (!op) return;
    switch (op.kind) {
      case 'crop':
      case 'erase':
        setCurrentImageFor(op.pageNumber, op.before.image);
        // processed was cleared by the forward op; we can't re-derive it, leave it empty
        break;
      case 'crop-batch':
      case 'erase-batch':
        Object.entries(op.before.images).forEach(([pn, url]) => {
          const key = isNaN(Number(pn)) ? pn : Number(pn);
          setCurrentImageFor(key, url);
        });
        break;
      case 'pipeline':
        if (op.before.processed == null) {
          setProcessedImages((prev) => {
            const { [op.pageNumber]: _removed, ...rest } = prev;
            return rest;
          });
        } else {
          setProcessedImages((prev) => ({ ...prev, [op.pageNumber]: op.before.processed }));
        }
        break;
      case 'pipeline-batch':
        replaceProcessedImages(op.before.processed);
        break;
      case 'reset-page':
        if (op.before.image != null) setCurrentImageFor(op.pageNumber, op.before.image);
        if (op.before.processed != null) {
          setProcessedImages((prev) => ({ ...prev, [op.pageNumber]: op.before.processed }));
        }
        break;
      default:
        console.warn('applyRevert: unknown op kind', op.kind);
    }
  }, [replaceProcessedImages, setCurrentImageFor]);

  /**
   * Undo last edit for the current page. Pulls the most recent op involving
   * this page off the timeline and reverts its effect.
   */
  const handleUndo = useCallback(() => {
    if (!currentPage) return;
    const op = history.undoPage(currentPage.pageNumber);
    if (op) applyRevert(op);
  }, [currentPage, history, applyRevert]);

  /**
   * Redo — walks the timeline forward. Scoped globally because the store's
   * branch semantics already ensure this only exposes a coherent next op.
   */
  const handleRedo = useCallback(() => {
    const op = history.redoGlobal();
    if (op) applyForward(op);
  }, [history, applyForward]);

  // Keyboard shortcuts — Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z map to the store.
  // Skipped while a modal is open (cropper / eraser handle their own keys).
  useEffect(() => {
    if (showCropper || showEraser) return;
    const onKey = (e) => {
      const meta = e.ctrlKey || e.metaKey;
      if (!meta) return;
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleUndo, handleRedo, showCropper, showEraser]);

  /**
   * Reset current page to original image — pushed as a `reset-page` op so it
   * is itself undoable.
   */
  const handleResetImage = useCallback(() => {
    if (!currentPage) return;
    const pn = currentPage.pageNumber;
    const beforeImage = getCurrentImageFor(pn);
    const beforeProcessed = processedImages[pn] ?? null;
    if (beforeImage === currentPage.thumbnail && beforeProcessed == null) return;

    history.push(HistoryOps.resetPage({
      pageNumber: pn,
      beforeImage,
      beforeProcessed,
    }));

    setImageStates((prev) => ({
      ...prev,
      [pn]: { current: currentPage.thumbnail, original: currentPage.thumbnail },
    }));
    setProcessedImages((prev) => {
      const { [pn]: _removed, ...rest } = prev;
      return rest;
    });
  }, [currentPage, getCurrentImageFor, history, processedImages]);

  // ========== CROP HANDLERS ==========

  /**
   * Handle crop completion for single page. Pushes a `crop` op capturing the
   * before/after image references so the edit is undoable.
   */
  const handleCropComplete = useCallback((croppedDataUrl, cropData) => {
    if (!currentPage) return;
    const pn = currentPage.pageNumber;
    const before = getCurrentImageFor(pn);

    history.push(HistoryOps.crop({ pageNumber: pn, before, after: croppedDataUrl, cropData }));
    setCurrentImageFor(pn, croppedDataUrl);
    setProcessedImages((prev) => {
      const { [pn]: _removed, ...rest } = prev;
      return rest;
    });
    setShowCropper(false);
  }, [currentPage, getCurrentImageFor, history, setCurrentImageFor]);

  /**
   * Eraser batch save — the eraser hands us a map of `{pageNumber: dataUrl}`
   * for every page touched. We fold that into a single `erase-batch` op so
   * one undo click rewinds the whole save.
   */
  const handleEraserSave = useCallback((results) => {
    const pageNumbers = [];
    const beforeMap = {};
    const afterMap = {};

    Object.entries(results).forEach(([pageNumStr, dataUrl]) => {
      const page = selectedPageData.find((p) => String(p.pageNumber) === pageNumStr);
      const pn = page ? page.pageNumber : (isNaN(Number(pageNumStr)) ? pageNumStr : Number(pageNumStr));
      pageNumbers.push(pn);
      beforeMap[pn] = getCurrentImageFor(pn);
      afterMap[pn] = dataUrl;
    });

    if (pageNumbers.length === 1) {
      const pn = pageNumbers[0];
      history.push(HistoryOps.erase({ pageNumber: pn, before: beforeMap[pn], after: afterMap[pn] }));
    } else if (pageNumbers.length > 1) {
      history.push(HistoryOps.eraseBatch({ pageNumbers, before: beforeMap, after: afterMap }));
    }

    pageNumbers.forEach((pn) => setCurrentImageFor(pn, afterMap[pn]));
    setProcessedImages((prev) => {
      const next = { ...prev };
      pageNumbers.forEach((pn) => { delete next[pn]; });
      return next;
    });
    setShowEraser(false);
  }, [getCurrentImageFor, history, selectedPageData, setCurrentImageFor]);

  /**
   * Batch crop — one op spanning the current page + all batch targets.
   */
  const handleBatchCropComplete = useCallback((currentCroppedUrl, cropData, batchResults) => {
    if (!currentPage) return;
    const pageNumbers = [currentPage.pageNumber];
    const beforeMap = { [currentPage.pageNumber]: getCurrentImageFor(currentPage.pageNumber) };
    const afterMap = { [currentPage.pageNumber]: currentCroppedUrl };

    batchResults.forEach(({ pageNumber, croppedDataUrl }) => {
      pageNumbers.push(pageNumber);
      beforeMap[pageNumber] = getCurrentImageFor(pageNumber);
      afterMap[pageNumber] = croppedDataUrl;
    });

    history.push(HistoryOps.cropBatch({ pageNumbers, before: beforeMap, after: afterMap }));
    pageNumbers.forEach((pn) => setCurrentImageFor(pn, afterMap[pn]));
    setProcessedImages((prev) => {
      const next = { ...prev };
      pageNumbers.forEach((pn) => { delete next[pn]; });
      return next;
    });
    setShowCropper(false);
  }, [currentPage, getCurrentImageFor, history, setCurrentImageFor]);

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
      const pn = currentPage.pageNumber;
      const beforeProcessed = processedImages[pn] ?? null;

      history.push(HistoryOps.pipeline({
        pageNumber: pn,
        beforeProcessed,
        afterProcessed: result,
        pipelineConfig,
      }));

      setProcessedImages((prev) => ({ ...prev, [pn]: result }));
      setProcessingProgress(100);
    } catch (error) {
      console.error('Processing failed:', error);
    } finally {
      setIsProcessing(false);
      setCurrentProcessingStep(null);
      setProcessingProgress(0);
    }
  }, [currentPage, isProcessing, getActivePipeline, buildPipelineConfig, currentImageState, history, processedImages]);

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

      const pageNumbers = Object.keys(results).map((k) => (isNaN(Number(k)) ? k : Number(k)));
      const beforeProcessed = {};
      pageNumbers.forEach((pn) => { beforeProcessed[pn] = processedImages[pn] ?? null; });

      history.push(HistoryOps.pipelineBatch({
        pageNumbers,
        beforeProcessed,
        afterProcessed: results,
        pipelineConfig,
      }));

      setProcessedImages(results);
      setProcessingProgress(100);
    } catch (error) {
      console.error('Batch processing failed:', error);
    } finally {
      setIsProcessing(false);
      setBatchProgress({ current: 0, total: 0 });
      setProcessingProgress(0);
    }
  }, [isProcessing, getActivePipeline, buildPipelineConfig, selectedPageData, imageStates, processedImages, history]);

  // ========== NAVIGATION HANDLERS ==========

  const handlePrevPage = () => {
    setCurrentPageIndex((prev) => Math.max(0, prev - 1));
  };

  const handleNextPage = () => {
    setCurrentPageIndex((prev) => Math.min(selectedPageData.length - 1, prev + 1));
  };

  // ========== RESET HANDLERS ==========

  /** Reset ONLY the pipeline/operation config. Leaves all page images/results intact. */
  const handleResetOperations = useCallback(() => {
    resetPipeline();
  }, [resetPipeline]);

  /** Reset current page — delegates to the undoable reset-page handler. */
  const handleResetCurrentPage = handleResetImage;

  /** Full reset: pipeline + ALL pages. Clears history too since every op's
   *  before-state is about to disappear. */
  const handleResetAll = useCallback(() => {
    resetPipeline();
    setProcessedImages({});
    setImageStates({});
    history.clear();
  }, [resetPipeline, history]);

  /**
   * "Undo All" — now an alias for the unified global undo. Reverts the most
   * recent op regardless of page, matching the original button's intent of
   * rewinding the last apply-all (which is the most common batch op).
   */
  const handleGlobalUndo = useCallback(() => {
    const op = history.undoGlobal();
    if (op) applyRevert(op);
  }, [history, applyRevert]);

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

  // Global undo/redo availability is read from the unified store.
  const canGlobalUndo = history.canUndoGlobal;
  const canGlobalRedo = history.canRedoGlobal;

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
              className={`flex items-center gap-2 px-4 sm:px-5 py-2 font-semibold rounded-xl transition-all ${canProceed
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
                onReset={handleResetOperations}
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
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${isModified
                      ? 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    title="Crop image - changes are saved immediately"
                  >
                    <Crop className="w-4 h-4" />
                    Crop
                  </button>

                  {/* Eraser button */}
                  <button
                    onClick={() => setShowEraser(true)}
                    disabled={!currentPage}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all bg-gray-100 text-gray-700 hover:bg-gray-200"
                    title="Erase artifacts - paint white to clean up"
                  >
                    <Eraser className="w-4 h-4" />
                    Eraser
                  </button>

                  {/* Undo button (current image) */}
                  <button
                    onClick={handleUndo}
                    disabled={!canUndo}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${canUndo
                      ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      : 'bg-gray-50 text-gray-300 cursor-not-allowed'
                      }`}
                    title="Undo last edit (current image)"
                  >
                    <Undo2 className="w-4 h-4" />
                    <span className="hidden sm:inline">Undo</span>
                  </button>

                  {/* Redo button — walks the timeline forward */}
                  <button
                    onClick={handleRedo}
                    disabled={!canGlobalRedo}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${canGlobalRedo
                      ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      : 'bg-gray-50 text-gray-300 cursor-not-allowed'
                      }`}
                    title="Redo (Ctrl+Shift+Z)"
                  >
                    <Redo2 className="w-4 h-4" />
                    <span className="hidden sm:inline">Redo</span>
                  </button>

                  {/* Undo All button (global - reverts last op across all pages) */}
                  <button
                    onClick={handleGlobalUndo}
                    disabled={!canGlobalUndo}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${canGlobalUndo
                      ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      : 'bg-gray-50 text-gray-300 cursor-not-allowed'
                      }`}
                    title="Undo last global operation (e.g. Apply All)"
                  >
                    <Undo2 className="w-4 h-4" />
                    <Layers className="w-3 h-3" />
                    <span className="hidden sm:inline">Undo All</span>
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
                    className={`p-1.5 rounded-lg transition-colors ${currentPageIndex === 0 ? 'text-gray-300' : 'text-gray-600 hover:bg-gray-100'
                      }`}
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>

                  <div className="flex items-center gap-1.5 flex-wrap justify-center">
                    {selectedPageData.map((page, idx) => (
                      <button
                        key={page.pageNumber}
                        onClick={() => setCurrentPageIndex(idx)}
                        className={`relative w-8 h-7 rounded-lg text-xs font-medium transition-all ${idx === currentPageIndex
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                      >
                        {shortPageLabel(page.pageNumber)}
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
                    className={`p-1.5 rounded-lg transition-colors ${currentPageIndex === selectedPageData.length - 1 ? 'text-gray-300' : 'text-gray-600 hover:bg-gray-100'
                      }`}
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>

                {/* Right: Zoom lens toggle */}
                <button
                  onClick={() => setShowZoomLens(!showZoomLens)}
                  className={`p-2 rounded-lg transition-colors ${showZoomLens ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  title="Toggle zoom lens"
                >
                  <Search className="w-4 h-4" />
                </button>
              </div>

              {/* Image preview - Takes remaining height */}
              <div className="flex-1 min-h-0">
                <BeforeAfterViewer
                  originalImage={originalImageState}
                  processedImage={currentPageProcessed || currentImageState}
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
                    Modified: {Object.keys(imageStates).filter(k => { const pg = pages.find(p => String(p.pageNumber) === String(k)); return imageStates[k]?.current !== pg?.thumbnail; }).length}
                  </span>
                </div>
                {currentPage && (
                  <span>Page {shortPageLabel(currentPage.pageNumber)}</span>
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
          // Multi-page crop support
          availablePages={selectedPageData.map(page => ({
            pageNumber: page.pageNumber,
            thumbnail: imageStates[page.pageNumber]?.current || page.thumbnail,
          }))}
          currentPageNumber={currentPage.pageNumber}
          onBatchCropComplete={handleBatchCropComplete}
        />
      )}

      {/* Image Eraser Modal */}
      {showEraser && currentPage && (
        <ImageEraser
          pages={selectedPageData.map(page => ({
            pageNumber: page.pageNumber,
            imageSrc: processedImages[page.pageNumber] || imageStates[page.pageNumber]?.current || page.thumbnail,
          }))}
          initialPageIndex={currentPageIndex}
          onSaveAll={handleEraserSave}
          onCancel={() => setShowEraser(false)}
        />
      )}

      {/* Zoom Lens Preview */}
      <ZoomLensPreview
        originalImage={originalImageState}
        processedImage={currentPageProcessed || currentImageState}
        isOpen={showZoomLens}
        onClose={() => setShowZoomLens(false)}
      />
    </div>
  );
}
