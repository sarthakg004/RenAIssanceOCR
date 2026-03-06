import React, { useCallback, useState } from 'react';
import {
  Upload,
  FileText,
  FileImage,
  X,
  Loader2,
  UploadCloud,
  ArrowRight,
  ArrowLeft,
  Check,
  AlertTriangle,
  Zap,
} from 'lucide-react';

/**
 * Transcript upload page for dataset generation mode.
 * Accepts TXT, DOCX, PDF, Markdown files.
 * Parses them via the backend and shows page/line counts.
 */
const API_BASE = 'http://localhost:8000';

export default function TranscriptUploadPage({
  onTranscriptParsed,
  onBack,
  onNext,
  parsedTranscript,
  pageCount,
  filterSummary,
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) processFile(files[0]);
  }, []);

  const handleFileInput = useCallback((e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) processFile(files[0]);
  }, []);

  const processFile = async (file) => {
    const validTypes = [
      'text/plain',
      'text/markdown',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    const validExts = ['.txt', '.md', '.markdown', '.pdf', '.docx'];
    const ext = '.' + file.name.split('.').pop().toLowerCase();

    if (!validTypes.includes(file.type) && !validExts.includes(ext)) {
      setError('Unsupported file type. Please upload TXT, DOCX, PDF, or Markdown.');
      return;
    }

    setSelectedFile(file);
    setError(null);
    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${API_BASE}/api/dataset/parse-transcript`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        throw new Error('Server error: ' + res.statusText);
      }

      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to parse transcript');
      }

      onTranscriptParsed(data.pages);
    } catch (err) {
      setError(err.message);
      onTranscriptParsed(null);
    } finally {
      setIsLoading(false);
    }
  };

  const transcript = parsedTranscript;
  const transcriptPageCount = transcript ? Object.keys(transcript).length : 0;
  const totalLines = transcript
    ? Object.values(transcript).reduce((s, lines) => s + lines.length, 0)
    : 0;
  const matchedPages = transcript
    ? Math.min(pageCount || 0, transcriptPageCount)
    : 0;

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <div className="max-w-4xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="btn-ghost">
            <ArrowLeft className="w-5 h-5" />
            Back
          </button>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-lg text-white shadow-md shadow-emerald-500/20">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-gray-800 to-gray-600 bg-clip-text text-transparent">
                Upload Transcript
              </h1>
              <p className="text-sm text-gray-500">
                Upload the text transcript for your book pages
              </p>
            </div>
          </div>
        </div>

        {transcript && (
          <button
            onClick={onNext}
            className="btn-primary"
          >
            Continue to Preprocessing
            <ArrowRight className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Step badge */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-50 to-teal-50 rounded-full text-sm font-semibold text-emerald-600 shadow-sm border border-emerald-100">
          <Zap className="w-4 h-4" />
          Upload Transcript
        </div>
        <p className="text-gray-500 max-w-xl mx-auto text-lg mt-3">
          Upload a transcript file containing the text of your book pages.
          Use page markers like <code className="text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded text-sm">PDF p1</code> to separate pages.
        </p>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative border-2 border-dashed rounded-2xl p-12 text-center transition-all duration-300 max-w-3xl mx-auto ${
          isDragging
            ? 'border-emerald-500 bg-emerald-50/80 scale-[1.02] shadow-xl shadow-emerald-500/30'
            : 'border-gray-300 bg-white/60 backdrop-blur-sm hover:border-emerald-400 hover:bg-emerald-50/30 hover:shadow-lg'
        } ${isLoading ? 'pointer-events-none opacity-60' : ''}`}
      >
        {isLoading ? (
          <div className="flex flex-col items-center">
            <Loader2 className="w-16 h-16 text-emerald-500 animate-spin" />
            <p className="mt-4 text-lg font-semibold text-emerald-600">
              Parsing transcript...
            </p>
          </div>
        ) : (
          <div>
            <div
              className={`mx-auto w-20 h-20 rounded-2xl flex items-center justify-center transition-all duration-500 ${
                isDragging
                  ? 'bg-gradient-to-br from-emerald-500 to-teal-600 scale-110 shadow-xl'
                  : 'bg-gradient-to-br from-emerald-100 to-teal-100'
              }`}
            >
              <UploadCloud
                className={`w-10 h-10 transition-all duration-300 ${
                  isDragging ? 'text-white animate-bounce' : 'text-emerald-500'
                }`}
              />
            </div>

            <h3 className="mt-5 text-xl font-bold text-gray-800">
              {isDragging ? 'Drop transcript file here!' : 'Drag & drop transcript file'}
            </h3>
            <p className="mt-2 text-gray-500">or</p>

            <label className="mt-4 inline-block">
              <input
                type="file"
                accept=".txt,.md,.markdown,.pdf,.docx"
                onChange={handleFileInput}
                className="hidden"
              />
              <span className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-semibold rounded-xl shadow-lg shadow-emerald-500/30 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200 cursor-pointer">
                <Upload className="w-5 h-5" />
                Browse Files
              </span>
            </label>

            <p className="mt-6 text-sm text-gray-400">
              Supports TXT, DOCX, PDF, Markdown
            </p>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mt-6 max-w-3xl mx-auto p-4 bg-red-50/80 border border-red-200 rounded-xl text-red-600 animate-fade-in">
          <p className="font-semibold">Error</p>
          <p className="text-sm mt-1">{error}</p>
        </div>
      )}

      {/* Selected file info */}
      {selectedFile && !isLoading && (
        <div className="mt-6 max-w-3xl mx-auto">
          <div className="flex items-center gap-4 p-4 bg-white/80 backdrop-blur-sm rounded-xl border border-gray-100 shadow-sm">
            <div className="p-2 bg-emerald-50 rounded-lg">
              <FileText className="w-6 h-6 text-emerald-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800 truncate">{selectedFile.name}</p>
              <p className="text-xs text-gray-400 mt-0.5">{formatFileSize(selectedFile.size)}</p>
            </div>
            {transcript && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-green-100 text-green-700 rounded-full text-sm font-semibold">
                <Check className="w-4 h-4" />
                Parsed
              </div>
            )}
          </div>
        </div>
      )}

      {/* Parse results */}
      {transcript && (
        <div className="mt-8 max-w-3xl mx-auto animate-slide-up">
          <h3 className="text-lg font-bold text-gray-800 mb-4">Transcript Summary</h3>

          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-white/80 backdrop-blur-sm rounded-xl border border-gray-100 p-5 text-center shadow-sm">
              <p className="text-3xl font-bold text-emerald-600">{transcriptPageCount}</p>
              <p className="text-sm text-gray-500 mt-1">Transcript Pages</p>
            </div>
            <div className="bg-white/80 backdrop-blur-sm rounded-xl border border-gray-100 p-5 text-center shadow-sm">
              <p className="text-3xl font-bold text-blue-600">{pageCount || 0}</p>
              <p className="text-sm text-gray-500 mt-1">Image Pages</p>
            </div>
            <div className="bg-white/80 backdrop-blur-sm rounded-xl border border-gray-100 p-5 text-center shadow-sm">
              <p className="text-3xl font-bold text-indigo-600">{totalLines}</p>
              <p className="text-sm text-gray-500 mt-1">Total Lines</p>
            </div>
          </div>

          {pageCount > 0 && transcriptPageCount !== pageCount && (
            <div className="flex items-start gap-3 p-4 bg-amber-50/80 border border-amber-200 rounded-xl text-amber-700 mb-4">
              <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Page Count Mismatch</p>
                <p className="text-sm mt-1">
                  {transcriptPageCount} transcript pages vs {pageCount} image pages.
                  Only {matchedPages} pages will be processed.
                </p>
              </div>
            </div>
          )}

          {filterSummary && (
            <div className="grid grid-cols-3 gap-3 mb-4 p-4 bg-emerald-50/80 border border-emerald-200 rounded-xl">
              <div className="text-center">
                <p className="text-xl font-bold text-gray-700">{filterSummary.total}</p>
                <p className="text-xs text-gray-500 mt-0.5">Images uploaded</p>
              </div>
              <div className="text-center">
                <p className="text-xl font-bold text-emerald-600">{filterSummary.transcriptPages}</p>
                <p className="text-xs text-gray-500 mt-0.5">Transcript pages</p>
              </div>
              <div className="text-center">
                <p className="text-xl font-bold text-teal-600">{filterSummary.processed}</p>
                <p className="text-xs text-gray-500 mt-0.5">Pages to process</p>
              </div>
            </div>
          )}

          {/* Preview of transcript pages */}
          <div className="space-y-3 max-h-64 overflow-y-auto">
            {Object.entries(transcript).map(([pageKey, lines]) => (
              <div
                key={pageKey}
                className="p-4 bg-white/80 backdrop-blur-sm rounded-xl border border-gray-100 shadow-sm"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-gray-700">
                    Page {pageKey}
                  </span>
                  <span className="text-xs text-gray-400">
                    {lines.length} line{lines.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="text-xs text-gray-500 space-y-0.5 max-h-20 overflow-y-auto">
                  {lines.slice(0, 5).map((line, i) => (
                    <p key={i} className="truncate">
                      {line}
                    </p>
                  ))}
                  {lines.length > 5 && (
                    <p className="text-gray-400 italic">...and {lines.length - 5} more lines</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Page marker help */}
      <div className="mt-10 max-w-3xl mx-auto">
        <details className="bg-white/80 backdrop-blur-sm rounded-xl border border-gray-100 shadow-sm">
          <summary className="px-6 py-4 cursor-pointer text-sm font-semibold text-gray-700 hover:text-emerald-600 transition-colors">
            How to format page markers in your transcript
          </summary>
          <div className="px-6 pb-5 text-sm text-gray-600 space-y-3">
            <p>Add page markers on separate lines to split your transcript into pages:</p>
            <div className="bg-gray-50 rounded-lg p-4 font-mono text-xs space-y-1">
              <p className="text-emerald-600 font-bold">PDF p1</p>
              <p>This is the text on page 1...</p>
              <p>Another line on page 1...</p>
              <p className="text-emerald-600 font-bold mt-2">PDF p2 - left</p>
              <p>Text on the left side of page 2...</p>
              <p className="text-emerald-600 font-bold mt-2">PDF p2 - right</p>
              <p>Text on the right side of page 2...</p>
            </div>
            <p className="text-gray-400">
              Supported formats: <code>PDF pN</code>, <code>PDF pN - left/right</code>,
              <code>--- Page N ---</code>, <code>[Page N]</code>
            </p>
          </div>
        </details>
      </div>
    </div>
  );
}
