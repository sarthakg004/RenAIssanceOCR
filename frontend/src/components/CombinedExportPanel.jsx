import { useState } from 'react';
import { Download, FileText, File, FileType, Loader2 } from 'lucide-react';
import { exportTranscripts, downloadBlob } from '../services/geminiApi';

/**
 * CombinedExportPanel Component
 * Export all transcripts as a single combined document
 */
export default function CombinedExportPanel({ transcripts, disabled = false }) {
  const [exporting, setExporting] = useState(null);
  const [error, setError] = useState(null);

  const processedCount = Object.values(transcripts).filter((t) => t?.length > 0).length;
  const totalPages = Object.keys(transcripts).length;

  const handleExport = async (format) => {
    if (disabled || exporting) return;

    setExporting(format);
    setError(null);

    try {
      const blob = await exportTranscripts(transcripts, format);
      const timestamp = new Date().toISOString().slice(0, 10);
      const filename = `transcript_${timestamp}.${format}`;
      downloadBlob(blob, filename);
    } catch (err) {
      setError(`Export failed: ${err.message}`);
    } finally {
      setExporting(null);
    }
  };

  const exportOptions = [
    { format: 'txt', icon: FileText, label: 'Plain Text', ext: '.txt' },
    { format: 'docx', icon: File, label: 'Word Document', ext: '.docx' },
    { format: 'pdf', icon: FileType, label: 'PDF Document', ext: '.pdf' },
  ];

  return (
    <div className="bg-white rounded-xl shadow-md p-4">
      <h3 className="font-semibold text-gray-800 flex items-center gap-2 mb-3">
        <Download size={18} className="text-blue-600" />
        Export Combined Transcript
      </h3>

      <p className="text-sm text-gray-600 mb-4">
        {processedCount} of {totalPages} pages processed
      </p>

      <div className="space-y-2">
        {exportOptions.map(({ format, icon: Icon, label, ext }) => (
          <button
            key={format}
            onClick={() => handleExport(format)}
            disabled={disabled || processedCount === 0 || exporting}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors ${
              disabled || processedCount === 0
                ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                : 'bg-white hover:bg-blue-50 text-gray-700 border-gray-300 hover:border-blue-400'
            }`}
          >
            {exporting === format ? (
              <Loader2 size={18} className="animate-spin text-blue-600" />
            ) : (
              <Icon size={18} className={disabled || processedCount === 0 ? 'text-gray-400' : 'text-blue-600'} />
            )}
            <span className="flex-1 text-left">{label}</span>
            <span className="text-xs text-gray-400">{ext}</span>
          </button>
        ))}
      </div>

      {error && (
        <p className="mt-3 text-sm text-red-600">{error}</p>
      )}

      <p className="mt-4 text-xs text-gray-500">
        Pages will be combined in order with dividers between each page.
      </p>
    </div>
  );
}
