import { useState, useEffect, useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Zap,
  Image as ImageIcon,
} from 'lucide-react';

/**
 * Downscale a base64 image for preview to avoid browser memory issues
 * Keeps original for OCR processing, creates smaller version for display
 */
function useDownscaledImage(imageSrc, maxWidth = 1200, maxHeight = 1600) {
  const [previewSrc, setPreviewSrc] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!imageSrc) {
      setPreviewSrc(null);
      setError(false);
      return;
    }

    // If it's already a small image or blob URL, use directly
    if (imageSrc.startsWith('blob:') || imageSrc.length < 100000) {
      setPreviewSrc(imageSrc);
      return;
    }

    setIsLoading(true);
    setError(false);

    const img = new Image();
    
    img.onload = () => {
      try {
        // Check if downscaling is needed
        if (img.width <= maxWidth && img.height <= maxHeight) {
          setPreviewSrc(imageSrc);
          setIsLoading(false);
          return;
        }

        // Calculate new dimensions maintaining aspect ratio
        let newWidth = img.width;
        let newHeight = img.height;
        
        if (newWidth > maxWidth) {
          newHeight = (maxWidth / newWidth) * newHeight;
          newWidth = maxWidth;
        }
        if (newHeight > maxHeight) {
          newWidth = (maxHeight / newHeight) * newWidth;
          newHeight = maxHeight;
        }

        // Create canvas and draw scaled image
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(newWidth);
        canvas.height = Math.round(newHeight);
        
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        // Convert to blob URL for better memory efficiency
        canvas.toBlob((blob) => {
          if (blob) {
            const blobUrl = URL.createObjectURL(blob);
            setPreviewSrc(blobUrl);
          } else {
            // Fallback to data URL if blob fails
            setPreviewSrc(canvas.toDataURL('image/jpeg', 0.85));
          }
          setIsLoading(false);
        }, 'image/jpeg', 0.85);
      } catch (err) {
        console.error('Failed to downscale image:', err);
        setError(true);
        setIsLoading(false);
      }
    };

    img.onerror = () => {
      console.error('Failed to load image for preview');
      setError(true);
      setIsLoading(false);
    };

    img.src = imageSrc;

    // Cleanup blob URLs
    return () => {
      if (previewSrc && previewSrc.startsWith('blob:')) {
        URL.revokeObjectURL(previewSrc);
      }
    };
  }, [imageSrc, maxWidth, maxHeight]);

  return { previewSrc, isLoading, error };
}

/**
 * PagePreview Component
 * Large image preview with navigation and process controls
 */
export default function PagePreview({
  currentPage,
  currentIndex,
  totalPages,
  isProcessing,
  isPageProcessed,
  isAutoProcessing,
  rateLimitReady,
  waitSeconds,
  error,
  canProcess,
  onPrevPage,
  onNextPage,
  onProcess,
  onToggleAutoProcess,
}) {
  const pageNumber = currentIndex + 1;
  const imageSrc = currentPage?.processed || currentPage?.original;

  // Use downscaled image for preview to handle large images
  const { previewSrc, isLoading: isDownscaling, error: downscaleError } = useDownscaledImage(imageSrc);
  
  const [imageLoaded, setImageLoaded] = useState(false);

  // Reset loading state when page changes
  useEffect(() => {
    setImageLoaded(false);
  }, [currentIndex, previewSrc]);

  const showLoading = isDownscaling || (!imageLoaded && previewSrc && !downscaleError);
  const showError = downscaleError;
  const showPlaceholder = !imageSrc;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 bg-gradient-to-r from-blue-50 to-white border-b border-gray-100 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onPrevPage}
            disabled={currentIndex === 0}
            className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft size={20} />
          </button>
          <span className="font-semibold text-gray-800 min-w-[100px] text-center">
            Page {pageNumber} of {totalPages}
          </span>
          <button
            onClick={onNextPage}
            disabled={currentIndex === totalPages - 1}
            className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight size={20} />
          </button>
        </div>

        {isPageProcessed && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-green-50 text-green-600 text-xs font-medium rounded-full">
            <CheckCircle2 size={12} />
            Processed
          </span>
        )}
      </div>

      {/* Image Container */}
      <div className="flex-1 p-4 bg-gray-50 flex items-center justify-center overflow-hidden min-h-0 relative">
        {/* Loading skeleton */}
        {showLoading && (
          <div className="absolute inset-4 bg-gray-200 rounded-lg animate-pulse flex items-center justify-center">
            <div className="text-center text-gray-400">
              <Loader2 size={32} className="animate-spin mx-auto mb-2" />
              <p className="text-sm">{isDownscaling ? 'Preparing preview...' : 'Loading preview...'}</p>
            </div>
          </div>
        )}

        {/* Error state */}
        {showError && (
          <div className="text-center text-gray-400">
            <ImageIcon size={48} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">Failed to load image</p>
            <p className="text-xs mt-1">Image may be too large or corrupted</p>
          </div>
        )}

        {/* No image placeholder */}
        {showPlaceholder && (
          <div className="text-center text-gray-400">
            <ImageIcon size={48} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">No image selected</p>
          </div>
        )}

        {/* Image - use downscaled preview */}
        {previewSrc && !showError && (
          <img
            src={previewSrc}
            alt={`Page ${pageNumber}`}
            className={`max-w-full max-h-full object-contain rounded-lg shadow-md transition-opacity duration-300 ${
              imageLoaded ? 'opacity-100' : 'opacity-0'
            }`}
            onLoad={() => setImageLoaded(true)}
            onError={() => {}}
          />
        )}

        {/* Processing overlay */}
        {isProcessing && (
          <div className="absolute inset-4 bg-blue-500/10 backdrop-blur-sm rounded-lg flex items-center justify-center">
            <div className="bg-white rounded-xl shadow-lg px-6 py-4 text-center">
              <Loader2 size={32} className="animate-spin text-blue-600 mx-auto mb-2" />
              <p className="text-sm font-medium text-gray-700">Processing with Gemini...</p>
            </div>
          </div>
        )}
      </div>

      {/* Process Controls */}
      <div className="px-4 py-3 border-t border-gray-100 bg-white shrink-0">
        <div className="flex items-center gap-3">
          {/* Main Process Button */}
          <button
            onClick={onProcess}
            disabled={!canProcess || isProcessing || isPageProcessed}
            className={`
              flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold 
              transition-all duration-200
              ${!canProcess || isProcessing || isPageProcessed
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm hover:shadow-md active:scale-[0.98]'
              }
            `}
          >
            {isProcessing ? (
              <>
                <Loader2 size={20} className="animate-spin" />
                Processing...
              </>
            ) : isPageProcessed ? (
              <>
                <CheckCircle2 size={20} />
                Already Processed
              </>
            ) : (
              <>
                <Play size={20} />
                Process Page
              </>
            )}
          </button>

          {/* Auto Process Toggle */}
          <button
            onClick={onToggleAutoProcess}
            disabled={!canProcess}
            title={isAutoProcessing ? 'Stop auto-processing' : 'Auto-process all pages'}
            className={`
              px-4 py-3 rounded-xl font-medium transition-all duration-200
              ${isAutoProcessing
                ? 'bg-amber-500 text-white hover:bg-amber-600'
                : !canProcess
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }
            `}
          >
            {isAutoProcessing ? <Pause size={20} /> : <Zap size={20} />}
          </button>
        </div>

        {/* Rate limit / Error message */}
        {(error || !rateLimitReady) && (
          <div
            className={`mt-3 px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${
              !rateLimitReady
                ? 'bg-amber-50 text-amber-700 border border-amber-100'
                : 'bg-red-50 text-red-700 border border-red-100'
            }`}
          >
            <AlertCircle size={16} />
            {!rateLimitReady ? `Rate limited. Wait ${waitSeconds}s...` : error}
          </div>
        )}
      </div>
    </div>
  );
}
