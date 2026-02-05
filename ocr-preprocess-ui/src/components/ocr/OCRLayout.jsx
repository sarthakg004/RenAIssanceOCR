import { ChevronLeft, Sparkles, CheckCircle2, AlertCircle } from 'lucide-react';

/**
 * OCRLayout Component
 * Full viewport 3-column responsive layout wrapper
 */
export default function OCRLayout({
  // Header props
  onBack,
  onComplete,
  processedCount,
  totalPages,
  hasAnyTranscript,
  backendOnline,
  // Panel contents
  leftSidebar,
  centerPanel,
  rightPanel,
}) {
  const progressPercent = totalPages > 0 ? (processedCount / totalPages) * 100 : 0;

  return (
    <div className="h-screen w-screen flex flex-col bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/40 overflow-hidden">
      {/* Header */}
      <header className="h-16 bg-white/80 backdrop-blur-md border-b border-gray-100/50 px-6 flex items-center justify-between shrink-0 shadow-sm">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 px-3 py-2 rounded-lg transition-all duration-200"
          >
            <ChevronLeft size={20} />
            <span className="text-sm font-medium">Back</span>
          </button>
          <div className="h-6 w-px bg-gray-200" />
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg text-white shadow-md shadow-blue-500/20">
              <Sparkles size={20} />
            </div>
            <div>
              <h1 className="text-lg font-bold bg-gradient-to-r from-gray-800 to-gray-600 bg-clip-text text-transparent">
                Gemini OCR
              </h1>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Progress */}
          <div className="flex items-center gap-3 px-4 py-2 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-100/50">
            <div className="flex items-center gap-2">
              <div className="w-28 h-2.5 bg-blue-100 rounded-full overflow-hidden shadow-inner">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-500 ease-out shadow-sm"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <span className="text-sm font-bold text-blue-700">
                {processedCount}/{totalPages}
              </span>
            </div>
          </div>

          {/* Complete button */}
          <button
            onClick={onComplete}
            disabled={!hasAnyTranscript}
            className={`px-5 py-2.5 rounded-xl font-semibold flex items-center gap-2 transition-all duration-200 ${hasAnyTranscript
                ? 'btn-primary'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              }`}
          >
            <CheckCircle2 size={18} />
            Complete
          </button>
        </div>
      </header>

      {/* Backend offline warning */}
      {backendOnline === false && (
        <div className="mx-6 mt-4 px-4 py-3 bg-red-50/80 backdrop-blur-sm border border-red-200 rounded-xl flex items-center gap-3 text-red-700 shrink-0 shadow-sm">
          <AlertCircle size={18} />
          <span className="text-sm">
            Backend not running. Start with:{' '}
            <code className="bg-red-100 px-2 py-0.5 rounded-md font-mono text-xs">
              uvicorn main:app --reload
            </code>
          </span>
        </div>
      )}

      {/* Main 3-column layout */}
      <main className="flex-1 p-4 overflow-hidden min-h-0">
        <div className="h-full flex gap-4">
          {/* Left Sidebar */}
          <aside className="w-64 shrink-0 flex flex-col gap-4 overflow-hidden min-h-0 lg:w-72">
            {leftSidebar}
          </aside>

          {/* Center Panel */}
          <div className="flex-1 min-w-0 min-h-0">
            {centerPanel}
          </div>

          {/* Right Panel */}
          <aside className="w-96 shrink-0 min-h-0 xl:w-[420px]">
            {rightPanel}
          </aside>
        </div>
      </main>
    </div>
  );
}
