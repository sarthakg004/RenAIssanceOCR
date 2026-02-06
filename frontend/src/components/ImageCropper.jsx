import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Crop, Check, X, RotateCcw, Maximize2, Lock, Unlock } from 'lucide-react';

/**
 * Mobile-style draggable image cropper
 * Features:
 * - Drag corners/edges to resize
 * - Drag center to move crop area
 * - Aspect ratio lock option
 * - Dark overlay outside crop area
 */
export default function ImageCropper({
  imageSrc,
  onCropComplete,
  onCancel,
  initialCrop = null,
}) {
  const containerRef = useRef(null);
  const imageRef = useRef(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [displayDimensions, setDisplayDimensions] = useState({ width: 0, height: 0 });
  
  // Crop box state (in percentage of displayed image)
  const [crop, setCrop] = useState({
    x: 10, // percentage from left
    y: 10, // percentage from top
    width: 80, // percentage width
    height: 80, // percentage height
  });
  
  const [isDragging, setIsDragging] = useState(false);
  const [dragType, setDragType] = useState(null); // 'move', 'nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [cropStart, setCropStart] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [aspectLocked, setAspectLocked] = useState(false);
  const [aspectRatio, setAspectRatio] = useState(null);

  // Load image and get dimensions
  useEffect(() => {
    if (!imageSrc) return;
    
    const img = new Image();
    img.onload = () => {
      setImageDimensions({ width: img.width, height: img.height });
      setImageLoaded(true);
    };
    img.src = imageSrc;
  }, [imageSrc]);

  // Calculate display dimensions when container resizes
  useEffect(() => {
    if (!containerRef.current || !imageLoaded) return;

    const updateDisplayDimensions = () => {
      const container = containerRef.current;
      const containerRect = container.getBoundingClientRect();
      const containerWidth = containerRect.width - 48; // padding
      const containerHeight = containerRect.height - 48;

      const imageAspect = imageDimensions.width / imageDimensions.height;
      const containerAspect = containerWidth / containerHeight;

      let displayWidth, displayHeight;
      if (imageAspect > containerAspect) {
        displayWidth = containerWidth;
        displayHeight = containerWidth / imageAspect;
      } else {
        displayHeight = containerHeight;
        displayWidth = containerHeight * imageAspect;
      }

      setDisplayDimensions({ width: displayWidth, height: displayHeight });
    };

    updateDisplayDimensions();
    window.addEventListener('resize', updateDisplayDimensions);
    return () => window.removeEventListener('resize', updateDisplayDimensions);
  }, [imageLoaded, imageDimensions]);

  // Initialize crop from props
  useEffect(() => {
    if (initialCrop) {
      setCrop(initialCrop);
    }
  }, [initialCrop]);

  // Lock aspect ratio based on current crop
  const handleLockAspect = () => {
    if (!aspectLocked) {
      setAspectRatio(crop.width / crop.height);
    }
    setAspectLocked(!aspectLocked);
  };

  // Reset crop to full image
  const handleResetCrop = () => {
    setCrop({ x: 5, y: 5, width: 90, height: 90 });
    setAspectLocked(false);
    setAspectRatio(null);
  };

  // Get cursor style for drag type
  const getCursor = (type) => {
    const cursors = {
      move: 'move',
      nw: 'nw-resize',
      ne: 'ne-resize',
      sw: 'sw-resize',
      se: 'se-resize',
      n: 'n-resize',
      s: 's-resize',
      e: 'e-resize',
      w: 'w-resize',
    };
    return cursors[type] || 'default';
  };

  // Handle mouse/touch start
  const handleDragStart = (e, type) => {
    e.preventDefault();
    e.stopPropagation();
    
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    setIsDragging(true);
    setDragType(type);
    setDragStart({ x: clientX, y: clientY });
    setCropStart({ ...crop });
  };

  // Handle mouse/touch move
  const handleDragMove = useCallback((e) => {
    if (!isDragging || !dragType) return;

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    const deltaX = ((clientX - dragStart.x) / displayDimensions.width) * 100;
    const deltaY = ((clientY - dragStart.y) / displayDimensions.height) * 100;

    let newCrop = { ...cropStart };

    if (dragType === 'move') {
      newCrop.x = Math.max(0, Math.min(100 - cropStart.width, cropStart.x + deltaX));
      newCrop.y = Math.max(0, Math.min(100 - cropStart.height, cropStart.y + deltaY));
    } else {
      // Handle resize
      const minSize = 10; // minimum 10% size

      if (dragType.includes('w')) {
        const newX = Math.max(0, Math.min(cropStart.x + cropStart.width - minSize, cropStart.x + deltaX));
        const widthDiff = cropStart.x - newX;
        newCrop.x = newX;
        newCrop.width = cropStart.width + widthDiff;
      }
      if (dragType.includes('e')) {
        newCrop.width = Math.max(minSize, Math.min(100 - cropStart.x, cropStart.width + deltaX));
      }
      if (dragType.includes('n')) {
        const newY = Math.max(0, Math.min(cropStart.y + cropStart.height - minSize, cropStart.y + deltaY));
        const heightDiff = cropStart.y - newY;
        newCrop.y = newY;
        newCrop.height = cropStart.height + heightDiff;
      }
      if (dragType.includes('s')) {
        newCrop.height = Math.max(minSize, Math.min(100 - cropStart.y, cropStart.height + deltaY));
      }

      // Apply aspect ratio lock
      if (aspectLocked && aspectRatio) {
        if (dragType.includes('e') || dragType.includes('w')) {
          newCrop.height = newCrop.width / aspectRatio;
          if (newCrop.y + newCrop.height > 100) {
            newCrop.height = 100 - newCrop.y;
            newCrop.width = newCrop.height * aspectRatio;
          }
        } else {
          newCrop.width = newCrop.height * aspectRatio;
          if (newCrop.x + newCrop.width > 100) {
            newCrop.width = 100 - newCrop.x;
            newCrop.height = newCrop.width / aspectRatio;
          }
        }
      }
    }

    setCrop(newCrop);
  }, [isDragging, dragType, dragStart, cropStart, displayDimensions, aspectLocked, aspectRatio]);

  // Handle mouse/touch end
  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    setDragType(null);
  }, []);

  // Add event listeners
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleDragMove);
      window.addEventListener('mouseup', handleDragEnd);
      window.addEventListener('touchmove', handleDragMove, { passive: false });
      window.addEventListener('touchend', handleDragEnd);
      return () => {
        window.removeEventListener('mousemove', handleDragMove);
        window.removeEventListener('mouseup', handleDragEnd);
        window.removeEventListener('touchmove', handleDragMove);
        window.removeEventListener('touchend', handleDragEnd);
      };
    }
  }, [isDragging, handleDragMove, handleDragEnd]);

  // Apply crop and return cropped image
  const handleApplyCrop = async () => {
    if (!imageRef.current) return;

    // Create canvas and draw cropped region
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    // Calculate actual pixel coordinates from percentages
    const actualX = (crop.x / 100) * imageDimensions.width;
    const actualY = (crop.y / 100) * imageDimensions.height;
    const actualWidth = (crop.width / 100) * imageDimensions.width;
    const actualHeight = (crop.height / 100) * imageDimensions.height;

    canvas.width = actualWidth;
    canvas.height = actualHeight;

    // Create a temporary image to draw from
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    await new Promise((resolve) => {
      img.onload = resolve;
      img.src = imageSrc;
    });

    ctx.drawImage(
      img,
      actualX, actualY, actualWidth, actualHeight,
      0, 0, actualWidth, actualHeight
    );

    const croppedDataUrl = canvas.toDataURL('image/png');
    onCropComplete(croppedDataUrl, {
      x: crop.x,
      y: crop.y,
      width: crop.width,
      height: crop.height,
    });
  };

  // Render handle for crop box
  const renderHandle = (position, cursor) => {
    const baseClasses = "absolute w-4 h-4 bg-white border-2 border-blue-500 rounded-full shadow-lg z-20 transition-transform hover:scale-125";
    const positions = {
      nw: 'top-0 left-0 -translate-x-1/2 -translate-y-1/2',
      ne: 'top-0 right-0 translate-x-1/2 -translate-y-1/2',
      sw: 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2',
      se: 'bottom-0 right-0 translate-x-1/2 translate-y-1/2',
      n: 'top-0 left-1/2 -translate-x-1/2 -translate-y-1/2',
      s: 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2',
      e: 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2',
      w: 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2',
    };

    return (
      <div
        className={`${baseClasses} ${positions[position]}`}
        style={{ cursor: getCursor(position) }}
        onMouseDown={(e) => handleDragStart(e, position)}
        onTouchStart={(e) => handleDragStart(e, position)}
      />
    );
  };

  if (!imageSrc) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-100 rounded-xl">
        <p className="text-gray-500">No image to crop</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-gray-900/80 border-b border-gray-700">
        <div className="flex items-center gap-4">
          <Crop className="w-6 h-6 text-blue-400" />
          <h2 className="text-lg font-semibold text-white">Crop Image</h2>
        </div>

        <div className="flex items-center gap-3">
          {/* Aspect lock button */}
          <button
            onClick={handleLockAspect}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
              aspectLocked 
                ? 'bg-blue-500 text-white' 
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
            title={aspectLocked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
          >
            {aspectLocked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
            <span className="text-sm font-medium">
              {aspectLocked ? 'Locked' : 'Lock Ratio'}
            </span>
          </button>

          {/* Reset button */}
          <button
            onClick={handleResetCrop}
            className="flex items-center gap-2 px-3 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            <span className="text-sm font-medium">Reset</span>
          </button>

          {/* Full image button */}
          <button
            onClick={() => setCrop({ x: 0, y: 0, width: 100, height: 100 })}
            className="flex items-center gap-2 px-3 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors"
          >
            <Maximize2 className="w-4 h-4" />
            <span className="text-sm font-medium">Full Image</span>
          </button>
        </div>
      </div>

      {/* Crop area */}
      <div 
        ref={containerRef}
        className="flex-1 flex items-center justify-center p-6 overflow-hidden"
      >
        {imageLoaded && displayDimensions.width > 0 && (
          <div 
            className="relative"
            style={{
              width: displayDimensions.width,
              height: displayDimensions.height,
            }}
          >
            {/* Original image */}
            <img
              ref={imageRef}
              src={imageSrc}
              alt="To crop"
              className="absolute inset-0 w-full h-full object-contain select-none pointer-events-none"
              draggable={false}
            />

            {/* Dark overlay outside crop area */}
            <div 
              className="absolute inset-0 pointer-events-none"
              style={{
                background: `linear-gradient(to right, 
                  rgba(0,0,0,0.7) ${crop.x}%, 
                  transparent ${crop.x}%, 
                  transparent ${crop.x + crop.width}%, 
                  rgba(0,0,0,0.7) ${crop.x + crop.width}%
                )`,
              }}
            />
            <div 
              className="absolute pointer-events-none"
              style={{
                left: `${crop.x}%`,
                width: `${crop.width}%`,
                top: 0,
                height: `${crop.y}%`,
                background: 'rgba(0,0,0,0.7)',
              }}
            />
            <div 
              className="absolute pointer-events-none"
              style={{
                left: `${crop.x}%`,
                width: `${crop.width}%`,
                top: `${crop.y + crop.height}%`,
                bottom: 0,
                background: 'rgba(0,0,0,0.7)',
              }}
            />

            {/* Crop box */}
            <div
              className="absolute border-2 border-white shadow-xl"
              style={{
                left: `${crop.x}%`,
                top: `${crop.y}%`,
                width: `${crop.width}%`,
                height: `${crop.height}%`,
                cursor: isDragging && dragType === 'move' ? 'grabbing' : 'grab',
              }}
              onMouseDown={(e) => handleDragStart(e, 'move')}
              onTouchStart={(e) => handleDragStart(e, 'move')}
            >
              {/* Grid lines (rule of thirds) */}
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/30" />
                <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white/30" />
                <div className="absolute top-1/3 left-0 right-0 h-px bg-white/30" />
                <div className="absolute top-2/3 left-0 right-0 h-px bg-white/30" />
              </div>

              {/* Corner handles */}
              {renderHandle('nw')}
              {renderHandle('ne')}
              {renderHandle('sw')}
              {renderHandle('se')}

              {/* Edge handles */}
              {renderHandle('n')}
              {renderHandle('s')}
              {renderHandle('e')}
              {renderHandle('w')}
            </div>

            {/* Dimensions display */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/80 text-white px-3 py-1.5 rounded-lg text-sm font-mono">
              {Math.round((crop.width / 100) * imageDimensions.width)} × {Math.round((crop.height / 100) * imageDimensions.height)} px
            </div>
          </div>
        )}
      </div>

      {/* Footer with actions */}
      <div className="flex items-center justify-between px-6 py-4 bg-gray-900/80 border-t border-gray-700">
        <p className="text-sm text-gray-400">
          Drag corners or edges to resize • Drag center to move
        </p>

        <div className="flex items-center gap-3">
          <button
            onClick={onCancel}
            className="flex items-center gap-2 px-5 py-2.5 bg-gray-700 text-white font-medium rounded-xl hover:bg-gray-600 transition-colors"
          >
            <X className="w-4 h-4" />
            Cancel
          </button>
          <button
            onClick={handleApplyCrop}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors shadow-lg"
          >
            <Check className="w-4 h-4" />
            Apply Crop
          </button>
        </div>
      </div>
    </div>
  );
}
