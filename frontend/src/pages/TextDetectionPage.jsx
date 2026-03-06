import React from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ScanText,
  Server,
  WifiOff,
  Shield,
  Zap,
  Brain,
} from 'lucide-react';

export default function TextDetectionPage({
  processedImages,
  onBack,
  onNext,
}) {
  const processedCount = Object.keys(processedImages || {}).length;
  const canProceed = processedCount > 0;

  return (
    <div className="h-full flex flex-col animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="btn-ghost">
            <ArrowLeft className="w-5 h-5" />
            Back
          </button>

          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg text-white shadow-md shadow-blue-500/20">
              <ScanText className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-gray-800 to-gray-600 bg-clip-text text-transparent">
                Text Detection
              </h1>
              <p className="text-sm text-gray-500">
                {processedCount} preprocessed page{processedCount !== 1 ? 's' : ''} ready
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={() => onNext('layout-aware', 'paddleocr')}
          disabled={!canProceed}
          className={`btn-primary ${canProceed
            ? ''
            : 'opacity-50 cursor-not-allowed hover:translate-y-0'
            }`}
        >
          Detect Text
          <ArrowRight className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-700 rounded-full text-sm font-semibold mb-4 shadow-sm border border-blue-100">
            <ScanText className="w-4 h-4" />
            Layout-aware detection
          </div>
          <p className="text-gray-500 max-w-2xl mx-auto text-lg">
            Detection runs with the local layout-aware pipeline for clean line-level bounding boxes.
          </p>
        </div>

        <div className="max-w-3xl mx-auto animate-slide-up">
          <div className="bg-gradient-to-br from-teal-50/80 via-white to-emerald-50/80 backdrop-blur-sm rounded-2xl border border-teal-200/50 p-6 shadow-lg">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-gradient-to-br from-teal-500 to-emerald-600 rounded-xl text-white shadow-lg shadow-teal-500/30">
                <Server className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-gray-800 mb-2">
                  Layout-Aware Detection Pipeline
                </h3>
                <p className="text-gray-600 mb-4">
                  Two-stage local pipeline: layout model finds regions and text detector extracts line boxes inside each region.
                </p>

                <div className="grid md:grid-cols-2 gap-3">
                  <div className="bg-white/80 backdrop-blur-sm rounded-xl p-4 border border-teal-100 shadow-sm">
                    <p className="text-sm font-semibold text-gray-800 flex items-center gap-2"><WifiOff className="w-4 h-4 text-teal-600" /> Fully local</p>
                    <p className="text-xs text-gray-500 mt-1">No API keys and no cloud dependency.</p>
                  </div>
                  <div className="bg-white/80 backdrop-blur-sm rounded-xl p-4 border border-teal-100 shadow-sm">
                    <p className="text-sm font-semibold text-gray-800 flex items-center gap-2"><Shield className="w-4 h-4 text-teal-600" /> Private processing</p>
                    <p className="text-xs text-gray-500 mt-1">Images stay on your machine during detection.</p>
                  </div>
                  <div className="bg-white/80 backdrop-blur-sm rounded-xl p-4 border border-teal-100 shadow-sm">
                    <p className="text-sm font-semibold text-gray-800 flex items-center gap-2"><Zap className="w-4 h-4 text-teal-600" /> Fast inference</p>
                    <p className="text-xs text-gray-500 mt-1">GPU acceleration is used when available.</p>
                  </div>
                  <div className="bg-white/80 backdrop-blur-sm rounded-xl p-4 border border-teal-100 shadow-sm">
                    <p className="text-sm font-semibold text-gray-800 flex items-center gap-2"><Brain className="w-4 h-4 text-teal-600" /> Layout aware</p>
                    <p className="text-xs text-gray-500 mt-1">Handles complex page structure reliably.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="h-8" />
      </div>
    </div>
  );
}
