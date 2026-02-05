import { useState } from 'react';
import {
  FileText,
  Copy,
  Check,
  Download,
  RotateCcw,
  Type,
  Loader2,
  File,
  FileType,
} from 'lucide-react';

/**
 * TranscriptPanel Component
 * Large scrollable transcript viewer with copy/export functionality
 */
export default function TranscriptPanel({
  pageNumber,
  transcript,
  originalTranscript,
  isProcessing,
  isProcessed,
  hasAnyTranscript,
  processedCount,
  onTranscriptChange,
  onReset,
  onExport,
  exporting,
}) {
  const [copied, setCopied] = useState(false);
  const [monospace, setMonospace] = useState(true);

  const hasChanges = transcript !== originalTranscript;

  const handleCopy = async () => {
    if (transcript) {
      await navigator.clipboard.writeText(transcript);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownloadTxt = () => {
    if (!transcript) return;
    const blob = new Blob([transcript], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `page_${pageNumber}_transcript.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white/90 backdrop-blur-sm rounded-2xl border border-gray-100 shadow-lg overflow-hidden flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 bg-gradient-to-r from-blue-50/80 via-white to-indigo-50/50 border-b border-gray-100/80 flex items-center justify-between shrink-0">
        <h3 className="font-bold text-gray-800 flex items-center gap-2">
          <div className="p-1.5 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg text-white">
            <FileText size={14} />
          </div>
          Transcript
          {isProcessed && (
            <span className="text-xs text-gray-500 font-normal">
              — Page {pageNumber}
            </span>
          )}
        </h3>

        {/* Actions */}
        <div className="flex items-center gap-1">
          {isProcessed && transcript && (
            <>
              {/* Monospace toggle */}
              <button
                onClick={() => setMonospace(!monospace)}
                className={`p-2 rounded-lg transition-all duration-200 ${monospace
                    ? 'bg-blue-100 text-blue-600 shadow-sm'
                    : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                  }`}
                title={monospace ? 'Switch to sans-serif' : 'Switch to monospace'}
              >
                <Type size={16} />
              </button>

              {/* Copy button */}
              <button
                onClick={handleCopy}
                className={`p-2 rounded-lg transition-all duration-200 ${copied
                    ? 'bg-green-100 text-green-600'
                    : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                  }`}
                title="Copy to clipboard"
              >
                {copied ? (
                  <Check size={16} />
                ) : (
                  <Copy size={16} />
                )}
              </button>

              {/* Download single page */}
              <button
                onClick={handleDownloadTxt}
                className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all duration-200"
                title="Download this page as TXT"
              >
                <Download size={16} />
              </button>

              {/* Reset button */}
              {hasChanges && (
                <button
                  onClick={onReset}
                  className="p-2 rounded-lg text-amber-500 hover:text-amber-600 hover:bg-amber-50 transition-all duration-200"
                  title="Reset to original"
                >
                  <RotateCcw size={16} />
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Transcript Content */}
      <div className="flex-1 relative min-h-0">
        {isProcessing ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-blue-50/50 to-indigo-50/50">
            <div className="relative">
              <Loader2 size={48} className="animate-spin text-blue-600" />
              <div className="absolute inset-0 blur-xl bg-blue-400/30 animate-pulse" />
            </div>
            <p className="text-blue-600 font-semibold mt-4">Extracting text...</p>
            <p className="text-blue-500 text-sm">This may take a few seconds</p>
          </div>
        ) : !isProcessed ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 bg-gradient-to-br from-gray-50/50 to-gray-100/30">
            <div className="p-4 bg-gradient-to-br from-gray-100 to-gray-50 rounded-2xl">
              <FileText size={48} className="opacity-40" />
            </div>
            <p className="font-semibold mt-4">No transcript yet</p>
            <p className="text-sm">Process this page to extract text</p>
          </div>
        ) : (
          <textarea
            value={transcript || ''}
            onChange={(e) => onTranscriptChange(e.target.value)}
            className={`w-full h-full p-4 resize-none focus:outline-none text-sm leading-relaxed 
                       border-0 focus:ring-0 bg-transparent ${monospace ? 'font-mono' : 'font-sans'}`}
            placeholder="Transcript will appear here..."
          />
        )}
      </div>

      {/* Footer with stats */}
      {isProcessed && transcript && (
        <div className="px-4 py-2.5 border-t border-gray-100 bg-gradient-to-r from-gray-50 to-white flex items-center justify-between text-xs text-gray-500 shrink-0">
          <span className="font-medium">{transcript.length.toLocaleString()} characters</span>
          {hasChanges && (
            <span className="text-amber-600 font-semibold flex items-center gap-1.5 px-2 py-1 bg-amber-50 rounded-full">
              <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
              Modified
            </span>
          )}
        </div>
      )}

      {/* Export Panel */}
      {hasAnyTranscript && (
        <div className="px-4 py-4 border-t border-gray-200 bg-gradient-to-r from-white to-gray-50/50 shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-bold text-gray-700 flex items-center gap-2">
              <div className="p-1.5 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg text-white">
                <Download size={12} />
              </div>
              Export All
            </h4>
            <span className="text-xs text-gray-500 font-medium bg-gray-100 px-2 py-1 rounded-full">
              {processedCount} pages
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {[
              { format: 'txt', icon: FileText, label: 'TXT' },
              { format: 'docx', icon: File, label: 'DOCX' },
              { format: 'pdf', icon: FileType, label: 'PDF' },
            ].map(({ format, icon: Icon, label }) => (
              <button
                key={format}
                onClick={() => onExport(format)}
                disabled={exporting}
                className="flex flex-col items-center gap-2 py-3 rounded-xl border border-gray-200 
                         bg-white hover:border-blue-300 hover:bg-blue-50 hover:shadow-md 
                         hover:-translate-y-0.5 transition-all duration-200
                         disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
              >
                {exporting === format ? (
                  <Loader2 size={20} className="animate-spin text-blue-600" />
                ) : (
                  <Icon size={20} className="text-blue-600" />
                )}
                <span className="text-xs font-semibold text-gray-700">{label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
