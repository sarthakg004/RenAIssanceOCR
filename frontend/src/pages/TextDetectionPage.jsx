import React, { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Cpu,
  Check,
  ScanText,
  Sparkles,
  MessageSquare,
  Bot,
  Globe,
  KeyRound,
  Lock,
} from 'lucide-react';

const METHOD_OPTIONS = [
  {
    id: 'api',
    name: 'Gemini',
    icon: Sparkles,
    tagline: 'Google\'s multimodal AI with state-of-the-art document understanding',
    gradient: 'from-blue-500 to-indigo-600',
    lightGradient: 'from-blue-50 to-indigo-50',
    borderColor: 'border-blue-500',
    accentColor: 'text-blue-600',
    shadowColor: 'shadow-blue-500/20',
    recommended: true,
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    icon: MessageSquare,
    tagline: 'OpenAI GPT-4 Vision with powerful multimodal OCR capabilities',
    gradient: 'from-green-500 to-emerald-600',
    lightGradient: 'from-green-50 to-emerald-50',
    borderColor: 'border-green-500',
    accentColor: 'text-green-600',
    shadowColor: 'shadow-green-500/20',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    icon: Bot,
    tagline: 'Cost-effective AI with strong reasoning and open-source foundation',
    gradient: 'from-purple-500 to-violet-600',
    lightGradient: 'from-purple-50 to-violet-50',
    borderColor: 'border-purple-500',
    accentColor: 'text-purple-600',
    shadowColor: 'shadow-purple-500/20',
  },
  {
    id: 'qwen',
    name: 'Qwen',
    icon: Globe,
    tagline: 'Alibaba\'s vision models with dedicated OCR and multilingual support',
    gradient: 'from-orange-500 to-amber-600',
    lightGradient: 'from-orange-50 to-amber-50',
    borderColor: 'border-orange-500',
    accentColor: 'text-orange-600',
    shadowColor: 'shadow-orange-500/20',
  },
];

export default function TextDetectionPage({
  pages,
  selectedPages,
  processedImages,
  onBack,
  onNext,
}) {
  const [selectedMethod, setSelectedMethod] = useState('api');

  const processedCount = Object.keys(processedImages || {}).length;

  const providerMap = {
    'api': 'gemini',
    'chatgpt': 'chatgpt',
    'deepseek': 'deepseek',
    'qwen': 'qwen',
  };

  return (
    <div className="h-full flex flex-col animate-fade-in">
      {/* Header */}
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
          onClick={() => onNext(selectedMethod, providerMap[selectedMethod] || 'gemini')}
          className="btn-primary"
        >
          Continue to OCR
          <ArrowRight className="w-5 h-5" />
        </button>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        {/* Intro */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-700 rounded-full text-sm font-semibold mb-3 shadow-sm border border-blue-100">
            <ScanText className="w-4 h-4" />
            Choose your OCR engine
          </div>
          <p className="text-gray-500 max-w-xl mx-auto">
            Select an AI provider to extract text from your documents.
          </p>
        </div>

        {/* Method cards — 4 in a row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 max-w-5xl mx-auto mb-10 px-2">
          {METHOD_OPTIONS.map((method) => {
            const Icon = method.icon;
            const isSelected = selectedMethod === method.id;

            return (
              <div
                key={method.id}
                onClick={() => setSelectedMethod(method.id)}
                className={`relative group rounded-2xl border-2 p-5 cursor-pointer transition-all duration-300 ${isSelected
                    ? `${method.borderColor} bg-gradient-to-br ${method.lightGradient} shadow-xl ${method.shadowColor} -translate-y-1`
                    : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-lg hover:-translate-y-0.5'
                  }`}
              >
                {/* Recommended badge */}
                {method.recommended && (
                  <div className={`absolute -top-2.5 left-1/2 -translate-x-1/2 px-3 py-0.5 text-[10px] font-bold text-white rounded-full bg-gradient-to-r ${method.gradient} shadow-md`}>
                    RECOMMENDED
                  </div>
                )}

                {/* Selection indicator */}
                <div
                  className={`absolute top-3 right-3 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all duration-200 ${isSelected
                      ? `border-transparent bg-gradient-to-br ${method.gradient} shadow-sm`
                      : 'border-gray-300 bg-white'
                    }`}
                >
                  {isSelected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                </div>

                {/* Icon */}
                <div
                  className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 transition-all duration-300 ${isSelected
                      ? `bg-gradient-to-br ${method.gradient} text-white shadow-lg ${method.shadowColor}`
                      : `bg-gradient-to-br ${method.lightGradient} ${method.accentColor}`
                    }`}
                >
                  <Icon className="w-6 h-6" />
                </div>

                {/* Name */}
                <h3 className="text-lg font-bold text-gray-800 mb-1.5">
                  {method.name}
                </h3>

                {/* Tagline */}
                <p className="text-xs text-gray-500 leading-relaxed mb-3">
                  {method.tagline}
                </p>

                {/* API Key tag */}
                <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold ${isSelected ? `${method.accentColor} bg-white/80` : 'text-gray-500 bg-gray-100'
                  }`}>
                  <KeyRound className="w-3 h-3" />
                  API Key Required
                </div>
              </div>
            );
          })}
        </div>

        {/* Local model teaser — subtle, below the main cards */}
        <div className="max-w-5xl mx-auto px-2 mb-8">
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-50 border border-gray-200/80">
            <div className="p-2 bg-gray-200 rounded-lg text-gray-400">
              <Cpu className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-sm font-semibold text-gray-500">Local Model</span>
              <span className="text-xs text-gray-400 ml-2">CRAFT + Custom Recognition — offline processing</span>
            </div>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-gray-200 text-gray-500 text-[10px] font-bold rounded-full shrink-0">
              <Lock className="w-3 h-3" />
              COMING SOON
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
