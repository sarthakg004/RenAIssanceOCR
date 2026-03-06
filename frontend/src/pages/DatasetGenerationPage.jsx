import React, { useState, useMemo } from 'react';
import {
  ArrowLeft,
  Download,
  Loader2,
  AlertTriangle,
  Check,
  Eye,
  Database,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

const API_BASE = 'http://localhost:8000';

/**
 * Dataset Generation page — shows alignment preview and export controls.
 *
 * Props:
 *   pages            - array of page objects with .pageNumber, .thumbnail
 *   selectedPages    - array of selected page numbers
 *   processedImages  - {pageNumber: dataUrl}
 *   transcript       - {pageKey: [lines]}
 *   allPagesBoxes    - {pageNumber: [polygon, ...]}
 *   onBack           - go back callback
 *   bookName         - user-supplied book name
 */
export default function DatasetGenerationPage({
  pages,
  selectedPages,
  processedImages,
  transcript,
  allPagesBoxes,
  onBack,
  bookName = 'dataset',
}) {
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState(null);
  const [previewIdx, setPreviewIdx] = useState(0);

  // Build per-page alignment data
  const alignmentData = useMemo(() => {
    if (!transcript || !allPagesBoxes) return [];

    const tKeys = Object.keys(transcript).sort((a, b) => {
      const na = parseInt(a), nb = parseInt(b);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a.localeCompare(b);
    });

    const data = [];

    for (const pageNum of selectedPages) {
      // Sort boxes top-to-bottom by the midpoint-Y of the top edge.
      // Take the two vertices with the smallest Y, average their Y — works for rotated boxes.
      const rawBoxes = allPagesBoxes[pageNum] || [];
      const boxes = [...rawBoxes].sort((a, b) => {
        const midTopY = poly => {
          const byY = [...poly].sort((p, q) => p[1] - q[1]);
          return (byY[0][1] + byY[1][1]) / 2;
        };
        return midTopY(a) - midTopY(b);
      });
      // Try to find matching transcript key
      const pageKey = tKeys.find((k) => {
        const n = parseInt(k);
        return n === pageNum || k === String(pageNum);
      });

      if (!pageKey) continue;

      const lines = transcript[pageKey] || [];
      const numPairs = Math.min(boxes.length, lines.length);

      const page = pages.find((p) => p.pageNumber === pageNum);
      const imageSrc = processedImages[pageNum] || page?.thumbnail;

      data.push({
        pageNumber: pageNum,
        pageKey,
        imageSrc,
        boxes,
        lines,
        numBoxes: boxes.length,
        numLines: lines.length,
        numPairs,
        mismatch: boxes.length !== lines.length,
      });
    }

    return data;
  }, [transcript, allPagesBoxes, selectedPages, pages, processedImages]);

  const totalPairs = alignmentData.reduce((s, d) => s + d.numPairs, 0);
  const totalMismatches = alignmentData.filter((d) => d.mismatch).length;

  const currentPreview = alignmentData[previewIdx] || null;

  const handleExport = async () => {
    setIsExporting(true);
    setExportError(null);

    try {
      // Build pages payload
      const pagesPayload = alignmentData.map((d) => ({
        page_key: String(d.pageNumber),
        image_data: d.imageSrc,
        boxes: d.boxes,
        lines: d.lines,
      }));

      const res = await fetch(`${API_BASE}/api/dataset/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pages: pagesPayload,
          book_name: bookName,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Export failed' }));
        throw new Error(err.detail || 'Export failed');
      }

      // Download the ZIP
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${bookName}_dataset.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err.message);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="h-full flex flex-col animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 px-4 pt-4">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="btn-ghost">
            <ArrowLeft className="w-5 h-5" />
            Back
          </button>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-lg text-white shadow-md">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-gray-800 to-gray-600 bg-clip-text text-transparent">
                Generate Dataset
              </h1>
              <p className="text-sm text-gray-500">
                {alignmentData.length} pages, {totalPairs} aligned pairs
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4 px-4 mb-6">
        <div className="bg-white/80 backdrop-blur-sm rounded-xl border border-gray-100 p-4 text-center shadow-sm">
          <p className="text-2xl font-bold text-emerald-600">{alignmentData.length}</p>
          <p className="text-xs text-gray-500 mt-1">Pages Matched</p>
        </div>
        <div className="bg-white/80 backdrop-blur-sm rounded-xl border border-gray-100 p-4 text-center shadow-sm">
          <p className="text-2xl font-bold text-blue-600">{totalPairs}</p>
          <p className="text-xs text-gray-500 mt-1">Line Pairs</p>
        </div>
        <div className="bg-white/80 backdrop-blur-sm rounded-xl border border-gray-100 p-4 text-center shadow-sm">
          <p className="text-2xl font-bold text-indigo-600">
            {alignmentData.reduce((s, d) => s + d.numBoxes, 0)}
          </p>
          <p className="text-xs text-gray-500 mt-1">Bounding Boxes</p>
        </div>
        <div className="bg-white/80 backdrop-blur-sm rounded-xl border border-gray-100 p-4 text-center shadow-sm">
          <p className={`text-2xl font-bold ${totalMismatches > 0 ? 'text-amber-600' : 'text-green-600'}`}>
            {totalMismatches}
          </p>
          <p className="text-xs text-gray-500 mt-1">Mismatches</p>
        </div>
      </div>

      <div className="flex-1 flex gap-6 px-4 pb-4 overflow-hidden">
        {/* Left: page list + preview */}
        <div className="flex-1 flex flex-col bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h3 className="font-bold text-gray-700 flex items-center gap-2">
              <Eye className="w-4 h-4" />
              Alignment Preview
            </h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPreviewIdx(Math.max(0, previewIdx - 1))}
                disabled={previewIdx === 0}
                className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm text-gray-500 min-w-[60px] text-center">
                {alignmentData.length > 0 ? `${previewIdx + 1} / ${alignmentData.length}` : '—'}
              </span>
              <button
                onClick={() => setPreviewIdx(Math.min(alignmentData.length - 1, previewIdx + 1))}
                disabled={previewIdx >= alignmentData.length - 1}
                className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {currentPreview ? (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="font-semibold text-gray-700">
                    Page {currentPreview.pageNumber}
                  </span>
                  {currentPreview.mismatch && (
                    <span className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 px-2.5 py-1 rounded-full">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {currentPreview.numBoxes} boxes / {currentPreview.numLines} lines
                    </span>
                  )}
                </div>

                {/* Aligned pairs table */}
                <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
                  {currentPreview.lines.slice(0, currentPreview.numPairs).map((line, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 p-2.5 bg-gray-50 rounded-lg text-sm"
                    >
                      <span className="text-xs font-mono text-gray-400 w-8 text-right flex-shrink-0">
                        {i + 1}
                      </span>
                      <span className="flex-1 text-gray-700 truncate">{line}</span>
                      {i < currentPreview.numBoxes && (
                        <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                      )}
                    </div>
                  ))}
                  {currentPreview.numLines > currentPreview.numPairs && (
                    <p className="text-xs text-amber-500 italic pl-11">
                      {currentPreview.numLines - currentPreview.numPairs} unmatched transcript line(s)
                    </p>
                  )}
                  {currentPreview.numBoxes > currentPreview.numPairs && (
                    <p className="text-xs text-amber-500 italic pl-11">
                      {currentPreview.numBoxes - currentPreview.numPairs} unmatched bounding box(es)
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-400">
                No alignment data available
              </div>
            )}
          </div>
        </div>

        {/* Right: export panel */}
        <div className="w-80 flex flex-col bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="font-bold text-gray-700 flex items-center gap-2">
              <Download className="w-4 h-4" />
              Export
            </h3>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <div className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/70 text-sm text-emerald-700">
              Downloads one ZIP with line images and transcript labels.
              <div className="text-xs text-emerald-600 mt-2 font-mono">
                {bookName}/page_N/images/line_label.png
              </div>
            </div>
          </div>

          {/* Export button */}
          <div className="p-4 border-t border-gray-100">
            {exportError && (
              <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">
                {exportError}
              </div>
            )}

            <button
              onClick={handleExport}
              disabled={isExporting || alignmentData.length === 0}
              className={`w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-bold text-white shadow-lg transition-all duration-200 ${
                isExporting || alignmentData.length === 0
                  ? 'bg-gray-300 cursor-not-allowed'
                  : 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:shadow-xl hover:-translate-y-0.5 shadow-emerald-500/30'
              }`}
            >
              {isExporting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Download className="w-5 h-5" />
                  Download Dataset
                </>
              )}
            </button>

            <p className="text-xs text-gray-400 text-center mt-2">
              {totalPairs} line images will be exported
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
