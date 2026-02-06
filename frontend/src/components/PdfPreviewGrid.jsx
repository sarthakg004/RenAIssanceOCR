import React, { useState, useCallback, useEffect } from 'react';
import { CheckSquare, Square, Grid3X3, LayoutGrid, X, ZoomIn } from 'lucide-react';
import PageCard from './PageCard';

export default function PdfPreviewGrid({
  pages,
  selectedPages,
  onSelectionChange,
  onPagePreview,
}) {
  const [gridSize, setGridSize] = useState('medium'); // small, medium, large
  const [lastSelectedIndex, setLastSelectedIndex] = useState(null);
  const [previewPage, setPreviewPage] = useState(null);

  const gridClasses = {
    small: 'grid-cols-4 md:grid-cols-6 lg:grid-cols-8',
    medium: 'grid-cols-3 md:grid-cols-4 lg:grid-cols-6',
    large: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4',
  };

  const handleSelectPage = useCallback(
    (pageNumber, isRangeSelect) => {
      const pageIndex = pageNumber - 1;

      if (isRangeSelect && lastSelectedIndex !== null) {
        // Range select
        const start = Math.min(lastSelectedIndex, pageIndex);
        const end = Math.max(lastSelectedIndex, pageIndex);
        const rangePages = [];

        for (let i = start; i <= end; i++) {
          rangePages.push(i + 1);
        }

        const newSelection = new Set([...selectedPages, ...rangePages]);
        onSelectionChange(Array.from(newSelection));
      } else {
        // Toggle single selection
        const newSelection = selectedPages.includes(pageNumber)
          ? selectedPages.filter((p) => p !== pageNumber)
          : [...selectedPages, pageNumber];
        onSelectionChange(newSelection);
        setLastSelectedIndex(pageIndex);
      }
    },
    [selectedPages, lastSelectedIndex, onSelectionChange]
  );

  const handleSelectAll = () => {
    if (selectedPages.length === pages.length) {
      onSelectionChange([]);
    } else {
      onSelectionChange(pages.map((_, i) => i + 1));
    }
  };

  const handlePreview = (pageNumber) => {
    setPreviewPage(pageNumber);
    if (onPagePreview) {
      onPagePreview(pageNumber);
    }
  };

  const isAllSelected = selectedPages.length === pages.length && pages.length > 0;

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && previewPage) {
        setPreviewPage(null);
      }
      if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSelectAll();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewPage, pages.length]);

  return (
    <div className="animate-fade-in">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-6 p-4 bg-white rounded-xl shadow-card">
        <div className="flex items-center gap-4">
          <button
            onClick={handleSelectAll}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
              isAllSelected
                ? 'bg-blue-600 text-white'
                : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
            }`}
          >
            {isAllSelected ? (
              <CheckSquare className="w-5 h-5" />
            ) : (
              <Square className="w-5 h-5" />
            )}
            {isAllSelected ? 'Deselect All' : 'Select All'}
          </button>

          <span className="text-sm text-gray-500">
            {selectedPages.length} of {pages.length} pages selected
          </span>
        </div>

        {/* Grid size controls */}
        <div className="flex items-center gap-2 bg-blue-50 rounded-lg p-1">
          <button
            onClick={() => setGridSize('small')}
            className={`p-2 rounded-md transition-colors ${
              gridSize === 'small'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-500 hover:text-blue-600'
            }`}
            title="Small grid"
          >
            <Grid3X3 className="w-5 h-5" />
          </button>
          <button
            onClick={() => setGridSize('medium')}
            className={`p-2 rounded-md transition-colors ${
              gridSize === 'medium'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-500 hover:text-blue-600'
            }`}
            title="Medium grid"
          >
            <LayoutGrid className="w-5 h-5" />
          </button>
          <button
            onClick={() => setGridSize('large')}
            className={`p-2 rounded-md transition-colors ${
              gridSize === 'large'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-500 hover:text-blue-600'
            }`}
            title="Large grid"
          >
            <ZoomIn className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Grid */}
      <div className={`grid gap-4 ${gridClasses[gridSize]}`}>
        {pages.map((page, index) => (
          <PageCard
            key={index}
            pageNumber={index + 1}
            thumbnail={page.thumbnail}
            isSelected={selectedPages.includes(index + 1)}
            onSelect={handleSelectPage}
            onPreview={handlePreview}
          />
        ))}
      </div>

      {/* Lightbox preview */}
      {previewPage && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-8 animate-fade-in"
          onClick={() => setPreviewPage(null)}
        >
          <button
            onClick={() => setPreviewPage(null)}
            className="absolute top-4 right-4 p-2 bg-white/20 rounded-full hover:bg-white/30 transition-colors"
          >
            <X className="w-6 h-6 text-white" />
          </button>

          <div className="max-w-4xl max-h-full overflow-auto">
            <img
              src={pages[previewPage - 1]?.thumbnail}
              alt={`Page ${previewPage}`}
              className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white/20 backdrop-blur-sm px-4 py-2 rounded-full">
            <span className="text-white font-medium">
              Page {previewPage} of {pages.length}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
