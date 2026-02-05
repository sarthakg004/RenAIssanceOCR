import { useState, useEffect, useRef, useCallback } from 'react';
import { CheckCircle2, Image as ImageIcon, Loader2 } from 'lucide-react';

/**
 * Create a thumbnail from a large image
 */
function createThumbnail(imageSrc, maxSize = 200) {
  return new Promise((resolve, reject) => {
    // If already small or a blob URL, use directly
    if (imageSrc.startsWith('blob:') || imageSrc.length < 50000) {
      resolve(imageSrc);
      return;
    }

    const img = new Image();
    img.onload = () => {
      try {
        // Calculate thumbnail size
        let width = img.width;
        let height = img.height;
        
        if (width > height) {
          if (width > maxSize) {
            height = (maxSize / width) * height;
            width = maxSize;
          }
        } else {
          if (height > maxSize) {
            width = (maxSize / height) * width;
            height = maxSize;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = Math.round(width);
        canvas.height = Math.round(height);
        
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'medium';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        // Use blob URL for better memory efficiency
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(URL.createObjectURL(blob));
          } else {
            resolve(canvas.toDataURL('image/jpeg', 0.7));
          }
        }, 'image/jpeg', 0.7);
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imageSrc;
  });
}

/**
 * PageThumbnailList Component
 * Scrollable list of page thumbnails with lazy loading
 */
export default function PageThumbnailList({
  images,
  currentIndex,
  processedPages,
  onPageSelect,
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="px-4 py-3 bg-gradient-to-r from-blue-50 to-white border-b border-gray-100 flex items-center justify-between shrink-0">
        <h3 className="font-semibold text-gray-800 flex items-center gap-2">
          <ImageIcon size={18} className="text-blue-600" />
          Pages
        </h3>
        <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
          {images.length}
        </span>
      </div>

      {/* Thumbnails */}
      <div className="flex-1 overflow-y-auto p-3 min-h-0">
        <div className="grid grid-cols-2 gap-2">
          {images.map((img, index) => (
            <ThumbnailItem
              key={index}
              image={img}
              index={index}
              isActive={index === currentIndex}
              isProcessed={processedPages.has(index + 1)}
              onClick={() => onPageSelect(index)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * ThumbnailItem - Single thumbnail with lazy loading and downscaling
 */
function ThumbnailItem({ image, index, isActive, isProcessed, onClick }) {
  const [thumbnailSrc, setThumbnailSrc] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(false);
  const containerRef = useRef(null);
  const hasStartedLoading = useRef(false);

  const imageSrc = image.processed || image.original;

  // Lazy load and create thumbnail using IntersectionObserver
  useEffect(() => {
    if (!imageSrc || hasStartedLoading.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !hasStartedLoading.current) {
            hasStartedLoading.current = true;
            setIsLoading(true);

            createThumbnail(imageSrc, 200)
              .then((thumb) => {
                setThumbnailSrc(thumb);
                setIsLoading(false);
              })
              .catch((err) => {
                console.error('Thumbnail creation failed:', err);
                setError(true);
                setIsLoading(false);
              });
          }
        });
      },
      { threshold: 0.1, rootMargin: '50px' }
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, [imageSrc]);

  // Cleanup blob URLs
  useEffect(() => {
    return () => {
      if (thumbnailSrc && thumbnailSrc.startsWith('blob:')) {
        URL.revokeObjectURL(thumbnailSrc);
      }
    };
  }, [thumbnailSrc]);

  const pageNumber = index + 1;

  return (
    <button
      ref={containerRef}
      onClick={onClick}
      className={`
        relative aspect-[3/4] rounded-lg overflow-hidden transition-all duration-200
        border-2 group
        ${isActive
          ? 'border-blue-500 ring-2 ring-blue-200 shadow-md'
          : isProcessed
            ? 'border-green-300 hover:border-green-400'
            : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'
        }
      `}
    >
      {/* Loading state */}
      {(isLoading || (!thumbnailSrc && !error)) && (
        <div className="absolute inset-0 bg-gray-100 animate-pulse flex items-center justify-center">
          {isLoading ? (
            <Loader2 size={16} className="text-gray-400 animate-spin" />
          ) : (
            <ImageIcon size={20} className="text-gray-300" />
          )}
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="absolute inset-0 bg-gray-100 flex items-center justify-center">
          <ImageIcon size={20} className="text-gray-400" />
        </div>
      )}

      {/* Image */}
      {thumbnailSrc && !error && (
        <img
          src={thumbnailSrc}
          alt={`Page ${pageNumber}`}
          className="w-full h-full object-cover"
        />
      )}

      {/* Processed indicator */}
      {isProcessed && (
        <div className="absolute top-1.5 right-1.5">
          <CheckCircle2
            size={16}
            className="text-green-500 bg-white rounded-full shadow-sm"
          />
        </div>
      )}

      {/* Page number label */}
      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent pt-4 pb-1">
        <span className="block text-center text-white text-xs font-medium">
          {pageNumber}
        </span>
      </div>

      {/* Active indicator ring */}
      {isActive && (
        <div className="absolute inset-0 border-2 border-blue-500 rounded-lg pointer-events-none" />
      )}
    </button>
  );
}
