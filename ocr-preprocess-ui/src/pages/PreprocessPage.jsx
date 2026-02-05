import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Download,
  Save,
  Sparkles,
  SkipForward,
  Crop,
} from 'lucide-react';
import PreprocessPanel from '../components/PreprocessPanel';
import ImageCompare from '../components/ImageCompare';
import ImageCropper from '../components/ImageCropper';
import { preprocessImage } from '../services/api';

const DEFAULT_SETTINGS = {
  grayscale: { enabled: false },
  deskew: { enabled: false },
  denoise: { enabled: false, method: 'nlm', strength: 10 },
  contrast: { enabled: false, method: 'clahe', clipLimit: 2, tileSize: 8 },
  binarize: { enabled: false, method: 'otsu', blockSize: 15 },
  morph: { enabled: false, operation: 'open', kernelSize: 2, iterations: 1 },
};

const RECOMMENDED_SETTINGS = {
  grayscale: { enabled: false },
  deskew: { enabled: true },
  denoise: { enabled: true, method: 'nlm', strength: 10 },
  contrast: { enabled: true, method: 'clahe', clipLimit: 2, tileSize: 8 },
  binarize: { enabled: true, method: 'adaptive', blockSize: 15 },
  morph: { enabled: false, operation: 'open', kernelSize: 2, iterations: 1 },
};

export default function PreprocessPage({
  pages,
  selectedPages,
  onBack,
  onNext,
  onProcessedImagesChange,
}) {
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [appliedSettings, setAppliedSettings] = useState(null);
  const [processedImages, setProcessedImages] = useState({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [history, setHistory] = useState([]);

  // Cropping state
  const [showCropper, setShowCropper] = useState(false);
  const [croppedImages, setCroppedImages] = useState({}); // Store cropped versions per page

  // Sync processed images to parent
  useEffect(() => {
    if (onProcessedImagesChange) {
      onProcessedImagesChange(processedImages);
    }
  }, [processedImages, onProcessedImagesChange]);

  // Get currently selected pages
  const selectedPageData = selectedPages.map((pageNum) => ({
    pageNumber: pageNum,
    ...pages[pageNum - 1],
  }));

  const currentPage = selectedPageData[currentPageIndex];

  // Check if settings have changed since last apply
  const hasChanges =
    JSON.stringify(settings) !== JSON.stringify(appliedSettings);

  const handleSettingsChange = useCallback((newSettings) => {
    setSettings(newSettings);
  }, []);

  const handleReset = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    setAppliedSettings(null);
    setProcessedImages({});
    // Also clear crop for current page
    setCroppedImages((prev) => {
      const { [currentPage?.pageNumber]: removed, ...rest } = prev;
      return rest;
    });
  }, [currentPage?.pageNumber]);

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

    // Clear any existing processed image for this page since we changed the source
    setProcessedImages((prev) => {
      const { [currentPage.pageNumber]: removed, ...rest } = prev;
      return rest;
    });
    setAppliedSettings(null);
  }, [currentPage]);

  // Get the current source image (cropped or original)
  const getCurrentSourceImage = useCallback(() => {
    if (!currentPage) return null;
    return croppedImages[currentPage.pageNumber]?.dataUrl || currentPage.thumbnail;
  }, [currentPage, croppedImages]);

  const handleApply = useCallback(async () => {
    if (!currentPage) return;

    setIsProcessing(true);

    // Save to history for undo
    setHistory((prev) => [
      ...prev,
      {
        pageNumber: currentPage.pageNumber,
        settings: appliedSettings,
        processedImage: processedImages[currentPage.pageNumber],
      },
    ]);

    try {
      // Build pipeline from enabled settings
      const pipeline = [];
      const ops = ['grayscale', 'deskew', 'denoise', 'contrast', 'binarize', 'morph'];

      ops.forEach((op) => {
        if (settings[op]?.enabled) {
          const { enabled, ...params } = settings[op];
          pipeline.push({ op, params });
        }
      });

      // Use cropped image if available, otherwise use original
      const sourceImage = croppedImages[currentPage.pageNumber]?.dataUrl || currentPage.thumbnail;

      // Call mock API
      const result = await preprocessImage(sourceImage, pipeline);

      setProcessedImages((prev) => ({
        ...prev,
        [currentPage.pageNumber]: result,
      }));
      setAppliedSettings({ ...settings });
    } catch (error) {
      console.error('Processing failed:', error);
    } finally {
      setIsProcessing(false);
    }
  }, [currentPage, settings, appliedSettings, processedImages, croppedImages]);

  const handleUndo = useCallback(() => {
    if (history.length === 0) return;

    const lastState = history[history.length - 1];
    setHistory((prev) => prev.slice(0, -1));

    if (lastState.settings) {
      setAppliedSettings(lastState.settings);
    }
    if (lastState.processedImage) {
      setProcessedImages((prev) => ({
        ...prev,
        [lastState.pageNumber]: lastState.processedImage,
      }));
    } else {
      setProcessedImages((prev) => {
        const { [lastState.pageNumber]: removed, ...rest } = prev;
        return rest;
      });
    }
  }, [history]);

  const handlePrevPage = () => {
    setCurrentPageIndex((prev) => Math.max(0, prev - 1));
  };

  const handleNextPage = () => {
    setCurrentPageIndex((prev) =>
      Math.min(selectedPageData.length - 1, prev + 1)
    );
  };

  const handleApplyToAll = async () => {
    setIsProcessing(true);

    const pipeline = [];
    const ops = ['grayscale', 'deskew', 'denoise', 'contrast', 'binarize', 'morph'];

    ops.forEach((op) => {
      if (settings[op]?.enabled) {
        const { enabled, ...params } = settings[op];
        pipeline.push({ op, params });
      }
    });

    try {
      const results = {};
      for (const page of selectedPageData) {
        // Use cropped image if available, otherwise use original
        const sourceImage = croppedImages[page.pageNumber]?.dataUrl || page.thumbnail;
        const result = await preprocessImage(sourceImage, pipeline);
        results[page.pageNumber] = result;
      }
      setProcessedImages(results);
      setAppliedSettings({ ...settings });
    } catch (error) {
      console.error('Batch processing failed:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  // Apply recommended settings to all pages
  const handleApplyRecommendedToAll = async () => {
    setIsProcessing(true);
    setSettings(RECOMMENDED_SETTINGS);

    const pipeline = [];
    const ops = ['grayscale', 'deskew', 'denoise', 'contrast', 'binarize', 'morph'];

    ops.forEach((op) => {
      if (RECOMMENDED_SETTINGS[op]?.enabled) {
        const { enabled, ...params } = RECOMMENDED_SETTINGS[op];
        pipeline.push({ op, params });
      }
    });

    try {
      const results = {};
      for (const page of selectedPageData) {
        // Use cropped image if available, otherwise use original
        const sourceImage = croppedImages[page.pageNumber]?.dataUrl || page.thumbnail;
        const result = await preprocessImage(sourceImage, pipeline);
        results[page.pageNumber] = result;
      }
      setProcessedImages(results);
      setAppliedSettings({ ...RECOMMENDED_SETTINGS });
    } catch (error) {
      console.error('Batch processing failed:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  // Count enabled operations
  const getEnabledCount = () => {
    return Object.values(settings).filter((s) => s?.enabled).length;
  };

  const handleDownloadAll = () => {
    // Mock download - in real app would trigger actual download
    alert('Download functionality will be implemented with backend integration');
  };

  return (
    <div className="h-full flex flex-col animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="btn-ghost"
          >
            <ArrowLeft className="w-5 h-5" />
            Back
          </button>

          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg text-white shadow-md shadow-blue-500/20">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-gray-800 to-gray-600 bg-clip-text text-transparent">
                Preprocess Images
              </h1>
              <p className="text-sm text-gray-500">
                {selectedPages.length} page{selectedPages.length > 1 ? 's' : ''}{' '}
                selected
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {history.length > 0 && (
            <button
              onClick={handleUndo}
              className="btn-ghost"
            >
              Undo
            </button>
          )}

          <button
            onClick={handleApplyRecommendedToAll}
            disabled={isProcessing}
            className="btn-gradient flex items-center gap-2"
          >
            <Sparkles className="w-4 h-4" />
            Apply Recommended
          </button>

          <button
            onClick={handleApplyToAll}
            disabled={isProcessing || getEnabledCount() === 0}
            className="btn-secondary"
          >
            <Save className="w-4 h-4" />
            Apply to All
          </button>

          <button
            onClick={handleDownloadAll}
            disabled={Object.keys(processedImages).length === 0}
            className="btn-secondary"
          >
            <Download className="w-4 h-4" />
            Download
          </button>

          {/* Divider */}
          <div className="w-px h-8 bg-gray-200" />

          <button
            onClick={onNext}
            disabled={isProcessing}
            className="btn-ghost text-gray-500"
            title="Skip preprocessing and use original images"
          >
            <SkipForward className="w-4 h-4" />
            Skip
          </button>

          <button
            onClick={onNext}
            disabled={Object.keys(processedImages).length === 0}
            className={`flex items-center gap-2 px-6 py-2.5 font-semibold rounded-xl transition-all duration-200 ${Object.keys(processedImages).length > 0
                ? 'bg-gradient-to-r from-green-500 to-emerald-600 text-white shadow-md shadow-green-500/20 hover:shadow-lg hover:-translate-y-0.5'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              }`}
            title={Object.keys(processedImages).length === 0 ? 'Process at least one page first' : 'Continue to text detection'}
          >
            Next Step
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 grid grid-cols-12 gap-4 min-h-0">
        {/* Preprocessing panel */}
        <div className="col-span-4 overflow-hidden">
          <PreprocessPanel
            settings={settings}
            onSettingsChange={handleSettingsChange}
            onApply={handleApply}
            onReset={handleReset}
            isProcessing={isProcessing}
            hasChanges={hasChanges}
          />
        </div>

        {/* Preview area */}
        <div className="col-span-8 flex flex-col min-h-0">
          {/* Page navigation with Crop button */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              {/* Crop button */}
              <button
                onClick={() => setShowCropper(true)}
                disabled={!currentPage}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium transition-all ${croppedImages[currentPage?.pageNumber]
                    ? 'bg-green-100 text-green-700 hover:bg-green-200'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
              >
                <Crop className="w-4 h-4" />
                {croppedImages[currentPage?.pageNumber] ? 'Re-crop' : 'Crop'}
              </button>

              {/* Clear crop button (only show if cropped) */}
              {croppedImages[currentPage?.pageNumber] && (
                <button
                  onClick={() => {
                    setCroppedImages((prev) => {
                      const { [currentPage.pageNumber]: removed, ...rest } = prev;
                      return rest;
                    });
                    // Also clear processed image since source changed
                    setProcessedImages((prev) => {
                      const { [currentPage.pageNumber]: removed, ...rest } = prev;
                      return rest;
                    });
                  }}
                  className="px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                >
                  Clear Crop
                </button>
              )}
            </div>

            <div className="flex items-center gap-4">
              <button
                onClick={handlePrevPage}
                disabled={currentPageIndex === 0}
                className={`p-2 rounded-lg transition-colors ${currentPageIndex === 0
                    ? 'text-gray-300 cursor-not-allowed'
                    : 'text-gray-600 hover:bg-gray-100'
                  }`}
              >
                <ChevronLeft className="w-6 h-6" />
              </button>

              <div className="flex items-center gap-2">
                {selectedPageData.map((page, idx) => (
                  <button
                    key={page.pageNumber}
                    onClick={() => setCurrentPageIndex(idx)}
                    className={`w-8 h-8 rounded-lg text-sm font-medium transition-all ${idx === currentPageIndex
                        ? 'bg-blue-600 text-white'
                        : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                      } ${processedImages[page.pageNumber]
                        ? 'ring-2 ring-green-400 ring-offset-1'
                        : ''
                      } ${croppedImages[page.pageNumber]
                        ? 'ring-2 ring-orange-400 ring-offset-1'
                        : ''
                      }`}
                    title={`Page ${page.pageNumber}${processedImages[page.pageNumber] ? ' (processed)' : ''
                      }${croppedImages[page.pageNumber] ? ' (cropped)' : ''}`}
                  >
                    {page.pageNumber}
                  </button>
                ))}
              </div>

              <button
                onClick={handleNextPage}
                disabled={currentPageIndex === selectedPageData.length - 1}
                className={`p-2 rounded-lg transition-colors ${currentPageIndex === selectedPageData.length - 1
                    ? 'text-gray-300 cursor-not-allowed'
                    : 'text-gray-600 hover:bg-gray-100'
                  }`}
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            </div>

            {/* Spacer to balance layout */}
            <div className="w-24" />
          </div>

          {/* Image compare - use cropped image as original if available */}
          <div className="flex-1 min-h-0">
            <ImageCompare
              originalImage={croppedImages[currentPage?.pageNumber]?.dataUrl || currentPage?.thumbnail}
              processedImage={processedImages[currentPage?.pageNumber]}
              isProcessing={isProcessing}
            />
          </div>
        </div>
      </div>

      {/* Image Cropper Modal */}
      {showCropper && currentPage && (
        <ImageCropper
          imageSrc={currentPage.thumbnail}
          onCropComplete={handleCropComplete}
          onCancel={() => setShowCropper(false)}
          initialCrop={croppedImages[currentPage.pageNumber]?.cropData}
        />
      )}
    </div>
  );
}
