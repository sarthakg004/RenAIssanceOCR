import React, { useState, useRef, useEffect } from 'react';
import { Eye, EyeOff, Maximize2, Minimize2, ZoomIn, ZoomOut, RotateCcw, GripVertical } from 'lucide-react';

export default function ImageCompare({
  originalImage,
  processedImage,
  isProcessing,
}) {
  const [mode, setMode] = useState('split'); // 'split', 'before', 'after', 'toggle'
  const [splitPosition, setSplitPosition] = useState(50);
  const [zoom, setZoom] = useState('fit'); // 'fit', 50, 100, 150, 200
  const [isDragging, setIsDragging] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef(null);
  const imageContainerRef = useRef(null);

  const handleMouseMove = (e) => {
    if (!isDragging || mode !== 'split') return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSplitPosition(percentage);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging]);

  const zoomLevels = ['fit', 50, 75, 100, 150, 200];
  const handleZoomIn = () => {
    const currentIndex = zoomLevels.indexOf(zoom);
    if (currentIndex < zoomLevels.length - 1) {
      setZoom(zoomLevels[currentIndex + 1]);
    }
  };
  const handleZoomOut = () => {
    const currentIndex = zoomLevels.indexOf(zoom);
    if (currentIndex > 0) {
      setZoom(zoomLevels[currentIndex - 1]);
    }
  };
  const handleResetZoom = () => setZoom('fit');

  const getZoomStyle = () => {
    if (zoom === 'fit') {
      return { width: '100%', height: '100%', objectFit: 'contain' };
    }
    return { transform: `scale(${zoom / 100})`, transformOrigin: 'center center' };
  };

  return (
    <div
      className={`bg-white rounded-xl shadow-card overflow-hidden transition-all ${
        isFullscreen ? 'fixed inset-4 z-50' : ''
      }`}
    >
      {/* Controls */}
      <div className="flex items-center justify-between p-4 border-b border-blue-100">
        <div className="flex items-center gap-2">
          {/* View mode buttons */}
          <div className="flex bg-blue-50 rounded-lg p-1">
            <button
              onClick={() => setMode('before')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
                mode === 'before'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-500 hover:text-blue-600'
              }`}
            >
              <Eye className="w-4 h-4 inline mr-1" />
              Before
            </button>
            <button
              onClick={() => setMode('split')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
                mode === 'split'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-500 hover:text-blue-600'
              }`}
            >
              Split
            </button>
            <button
              onClick={() => setMode('after')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
                mode === 'after'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-500 hover:text-blue-600'
              }`}
            >
              <EyeOff className="w-4 h-4 inline mr-1" />
              After
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Zoom controls */}
          <div className="flex items-center gap-1 bg-blue-50 rounded-lg p-1">
            <button
              onClick={handleZoomOut}
              className="p-1.5 rounded-md hover:bg-white hover:shadow-sm transition-all"
              disabled={zoom === 'fit' || zoomLevels.indexOf(zoom) === 0}
            >
              <ZoomOut className="w-4 h-4 text-gray-600" />
            </button>
            <select
              value={zoom}
              onChange={(e) => setZoom(e.target.value === 'fit' ? 'fit' : parseInt(e.target.value))}
              className="px-2 py-1 text-sm font-medium text-gray-600 bg-white border border-blue-200 rounded-md min-w-[5rem] text-center"
            >
              <option value="fit">Fit</option>
              <option value="50">50%</option>
              <option value="75">75%</option>
              <option value="100">100%</option>
              <option value="150">150%</option>
              <option value="200">200%</option>
            </select>
            <button
              onClick={handleZoomIn}
              className="p-1.5 rounded-md hover:bg-white hover:shadow-sm transition-all"
              disabled={zoomLevels.indexOf(zoom) === zoomLevels.length - 1}
            >
              <ZoomIn className="w-4 h-4 text-gray-600" />
            </button>
            <button
              onClick={handleResetZoom}
              className="p-1.5 rounded-md hover:bg-white hover:shadow-sm transition-all"
              title="Fit to view"
            >
              <RotateCcw className="w-4 h-4 text-gray-600" />
            </button>
          </div>

          {/* Fullscreen toggle */}
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-2 rounded-lg bg-blue-50 hover:bg-blue-100 transition-colors"
          >
            {isFullscreen ? (
              <Minimize2 className="w-5 h-5 text-blue-600" />
            ) : (
              <Maximize2 className="w-5 h-5 text-blue-600" />
            )}
          </button>
        </div>
      </div>

      {/* Image container */}
      <div
        ref={containerRef}
        className={`relative bg-gray-100 overflow-auto ${
          isFullscreen ? 'h-[calc(100%-60px)]' : 'h-[500px]'
        }`}
      >
        {isProcessing ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center">
              <div className="w-16 h-16 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
              <p className="mt-4 text-blue-600 font-medium">Processing...</p>
            </div>
          </div>
        ) : (
          <>
            {/* Original image (shown in before and split modes) */}
            {(mode === 'before' || mode === 'split') && originalImage && (
              <div
                ref={imageContainerRef}
                className={`absolute inset-0 flex items-center justify-center p-4 ${
                  mode === 'split' ? 'overflow-hidden' : ''
                }`}
                style={
                  mode === 'split'
                    ? { clipPath: `inset(0 ${100 - splitPosition}% 0 0)` }
                    : {}
                }
              >
                <img
                  src={originalImage}
                  alt="Original"
                  className={zoom === 'fit' ? 'max-w-full max-h-full object-contain' : 'max-w-none'}
                  style={zoom !== 'fit' ? { transform: `scale(${zoom / 100})` } : {}}
                  draggable={false}
                />
              </div>
            )}

            {/* Processed image (shown in after and split modes) */}
            {(mode === 'after' || mode === 'split') && (
              <div
                className={`absolute inset-0 flex items-center justify-center p-4 ${
                  mode === 'split' ? 'overflow-hidden' : ''
                }`}
                style={
                  mode === 'split'
                    ? { clipPath: `inset(0 0 0 ${splitPosition}%)` }
                    : {}
                }
              >
                {processedImage ? (
                  <img
                    src={processedImage}
                    alt="Processed"
                    className={zoom === 'fit' ? 'max-w-full max-h-full object-contain' : 'max-w-none'}
                    style={zoom !== 'fit' ? { transform: `scale(${zoom / 100})` } : {}}
                    draggable={false}
                  />
                ) : (
                  <div className="text-gray-400 text-center">
                    <p className="text-lg font-medium">No processed image yet</p>
                    <p className="text-sm mt-1">Apply preprocessing to see results</p>
                  </div>
                )}
              </div>
            )}

            {/* Split slider handle - improved visibility */}
            {mode === 'split' && (
              <div
                className="absolute top-0 bottom-0 w-1 cursor-ew-resize z-20"
                style={{ left: `calc(${splitPosition}% - 2px)` }}
                onMouseDown={() => setIsDragging(true)}
              >
                {/* Visible line */}
                <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-1 bg-blue-600 shadow-lg" />
                
                {/* Handle circle - more prominent */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center shadow-xl border-4 border-white cursor-grab active:cursor-grabbing">
                  <GripVertical className="w-5 h-5 text-white" />
                </div>

                {/* Labels - more visible */}
                <div className="absolute top-4 -translate-x-full -left-3 bg-blue-900/80 text-white text-xs font-medium px-3 py-1.5 rounded-lg shadow-md">
                  Original
                </div>
                <div className="absolute top-4 left-3 bg-green-700/80 text-white text-xs font-medium px-3 py-1.5 rounded-lg shadow-md">
                  Processed
                </div>
              </div>
            )}
          </>
        )}

        {/* Placeholder when no image */}
        {!originalImage && !isProcessing && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center text-gray-400">
              <p className="text-lg font-medium">No image selected</p>
              <p className="text-sm mt-1">Select a page to preview</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
