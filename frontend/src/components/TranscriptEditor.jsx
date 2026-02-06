import { useState, useRef, useEffect } from 'react';
import { Edit3, Save, RotateCcw, Copy, Check } from 'lucide-react';

/**
 * TranscriptEditor Component
 * Editable text area for a single page transcript
 */
export default function TranscriptEditor({
  pageNumber,
  transcript,
  originalTranscript,
  onTranscriptChange,
  isProcessing = false,
  isProcessed = false,
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef(null);

  const hasChanges = transcript !== originalTranscript;

  const handleCopy = async () => {
    if (transcript) {
      await navigator.clipboard.writeText(transcript);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleReset = () => {
    onTranscriptChange(originalTranscript);
  };

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isEditing]);

  return (
    <div className="bg-white rounded-xl shadow-md overflow-hidden h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
        <span className="font-medium text-gray-700">Page {pageNumber}</span>
        <div className="flex items-center gap-2">
          {isProcessed && transcript && (
            <>
              <button
                onClick={handleCopy}
                className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                title="Copy transcript"
              >
                {copied ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
              </button>
              {hasChanges && (
                <button
                  onClick={handleReset}
                  className="p-1.5 text-gray-500 hover:text-amber-600 hover:bg-amber-50 rounded transition-colors"
                  title="Reset to original"
                >
                  <RotateCcw size={16} />
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 relative">
        {isProcessing ? (
          <div className="absolute inset-0 flex items-center justify-center bg-blue-50">
            <div className="text-center">
              <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
              <p className="text-sm text-blue-600">Processing with Gemini...</p>
            </div>
          </div>
        ) : !isProcessed ? (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
            <p className="text-sm text-gray-500">Not yet processed</p>
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            value={transcript || ''}
            onChange={(e) => onTranscriptChange(e.target.value)}
            className="w-full h-full p-4 resize-none focus:outline-none text-sm font-mono leading-relaxed"
            placeholder="Transcript will appear here..."
          />
        )}
      </div>

      {/* Footer with status */}
      {isProcessed && transcript && (
        <div className="px-4 py-1.5 bg-gray-50 border-t border-gray-200 flex items-center justify-between text-xs text-gray-500">
          <span>{transcript.length} characters</span>
          {hasChanges && (
            <span className="text-amber-600 flex items-center gap-1">
              <Edit3 size={12} />
              Modified
            </span>
          )}
        </div>
      )}
    </div>
  );
}
