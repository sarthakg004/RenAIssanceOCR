import React from 'react';
import { FileText, Database, ArrowRight, Sparkles, BookOpen, Layers } from 'lucide-react';

/**
 * Landing page that presents two workflow modes:
 *   1. Generate OCR Dataset
 *   2. Perform OCR / Generate Transcript
 */
export default function HomePage({ onSelectMode }) {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 via-white to-blue-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-gray-100/50 sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-center">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/30">
              <BookOpen className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-gray-800 to-gray-600 bg-clip-text text-transparent">
                RenAIssance OCR
              </h1>
              <p className="text-xs text-gray-500">
                Historical document processing
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="max-w-5xl w-full">
          {/* Heading */}
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-full text-sm font-semibold text-blue-600 mb-6 shadow-sm border border-blue-100">
              <Sparkles className="w-4 h-4" />
              Choose Your Workflow
            </div>
            <h2 className="text-4xl font-bold bg-gradient-to-r from-gray-800 via-gray-700 to-gray-600 bg-clip-text text-transparent mb-4">
              What would you like to do?
            </h2>
            <p className="text-gray-500 max-w-2xl mx-auto text-lg">
              Both workflows share the same preprocessing and text detection pipeline.
              Choose based on your end goal.
            </p>
          </div>

          {/* Mode cards */}
          <div className="grid md:grid-cols-2 gap-8">
            {/* Dataset Mode */}
            <button
              onClick={() => onSelectMode('dataset')}
              className="group relative text-left p-8 rounded-2xl border-2 border-gray-200 bg-white/80 backdrop-blur-sm hover:border-emerald-400 hover:shadow-2xl hover:shadow-emerald-500/10 hover:-translate-y-1 transition-all duration-300 focus:outline-none focus:ring-4 focus:ring-emerald-200"
            >
              {/* Badge */}
              <div className="absolute -top-3 left-6 px-4 py-1.5 text-xs font-bold text-white rounded-full shadow-md bg-gradient-to-r from-emerald-500 to-teal-600">
                New
              </div>

              <div className="flex items-start gap-5 mb-6 mt-2">
                <div className="p-4 rounded-xl bg-gradient-to-br from-emerald-100 to-teal-100 text-emerald-600 group-hover:from-emerald-500 group-hover:to-teal-600 group-hover:text-white group-hover:shadow-lg group-hover:shadow-emerald-500/30 transition-all duration-300">
                  <Database className="w-8 h-8" />
                </div>
                <div className="flex-1">
                  <h3 className="text-2xl font-bold text-gray-800 mb-1">
                    Generate OCR Dataset
                  </h3>
                  <p className="text-sm text-gray-500">
                    Create training data for OCR models
                  </p>
                </div>
              </div>

              <p className="text-gray-600 mb-6 leading-relaxed">
                Upload book images and transcripts to generate aligned, line-level
                training datasets. Perfect for training TrOCR, CRNN, or PaddleOCR models
                on historical documents.
              </p>

              <div className="space-y-2 mb-6">
                {[
                  'Upload book images + transcript files',
                  'Automatic page-transcript matching',
                  'Preprocess & detect text lines',
                  'Manual bounding box correction',
                  'Export aligned training dataset',
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-gray-600">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                    {item}
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2 text-emerald-600 font-semibold group-hover:gap-3 transition-all duration-300">
                Start Dataset Generation
                <ArrowRight className="w-5 h-5" />
              </div>
            </button>

            {/* OCR Mode */}
            <button
              onClick={() => onSelectMode('ocr')}
              className="group relative text-left p-8 rounded-2xl border-2 border-gray-200 bg-white/80 backdrop-blur-sm hover:border-blue-400 hover:shadow-2xl hover:shadow-blue-500/10 hover:-translate-y-1 transition-all duration-300 focus:outline-none focus:ring-4 focus:ring-blue-200"
            >
              {/* Badge */}
              <div className="absolute -top-3 left-6 px-4 py-1.5 text-xs font-bold text-white rounded-full shadow-md bg-gradient-to-r from-blue-500 to-indigo-600">
                OCR
              </div>

              <div className="flex items-start gap-5 mb-6 mt-2">
                <div className="p-4 rounded-xl bg-gradient-to-br from-blue-100 to-indigo-100 text-blue-600 group-hover:from-blue-500 group-hover:to-indigo-600 group-hover:text-white group-hover:shadow-lg group-hover:shadow-blue-500/30 transition-all duration-300">
                  <FileText className="w-8 h-8" />
                </div>
                <div className="flex-1">
                  <h3 className="text-2xl font-bold text-gray-800 mb-1">
                    Perform OCR / Transcript
                  </h3>
                  <p className="text-sm text-gray-500">
                    Extract text from document images
                  </p>
                </div>
              </div>

              <p className="text-gray-600 mb-6 leading-relaxed">
                Upload document images and use AI-powered OCR to extract text.
                Supports multiple providers including Gemini, ChatGPT, and local
                PaddleOCR models.
              </p>

              <div className="space-y-2 mb-6">
                {[
                  'Upload PDF or images',
                  'Preprocess for optimal extraction',
                  'Detect text lines automatically',
                  'Run OCR with Gemini / PaddleOCR',
                  'Export transcript as TXT, DOCX, PDF',
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-gray-600">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
                    {item}
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2 text-blue-600 font-semibold group-hover:gap-3 transition-all duration-300">
                Start OCR Workflow
                <ArrowRight className="w-5 h-5" />
              </div>
            </button>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white/60 backdrop-blur-sm border-t border-gray-100 py-4">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <p className="text-sm text-gray-500 flex items-center justify-center gap-2">
            <span className="font-semibold text-gray-600">RenAIssance OCR</span>
            <span className="text-gray-300">|</span>
            <span className="text-blue-600 font-medium">Historical Document Processing</span>
          </p>
        </div>
      </footer>
    </div>
  );
}
