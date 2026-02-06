import React, { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Cloud,
  Cpu,
  Zap,
  Shield,
  Server,
  Wifi,
  WifiOff,
  Check,
  ScanText,
  Brain,
  Sparkles,
  ExternalLink,
} from 'lucide-react';

const METHOD_OPTIONS = [
  {
    id: 'api',
    name: 'Gemini API',
    subtitle: 'Google AI Vision',
    icon: Sparkles,
    description:
      'Use Google\'s Gemini multimodal AI for text extraction. Excellent accuracy on both printed and handwritten documents with advanced language understanding.',
    features: [
      { icon: Zap, text: 'Fast processing', highlight: true },
      { icon: Shield, text: 'Excellent accuracy on all text types' },
      { icon: Wifi, text: 'Requires internet connection' },
      { icon: Brain, text: 'Advanced AI understanding' },
    ],
    pros: ['State-of-the-art accuracy', 'Handles complex layouts', 'Multi-language support'],
    cons: ['Requires API key', 'Rate limited (free tier)', 'Data sent to Google'],
    recommended: true,
    badge: 'Recommended',
    badgeColor: 'bg-gradient-to-r from-blue-600 to-indigo-600',
  },
  {
    id: 'local',
    name: 'Local Model',
    subtitle: 'CRAFT + Custom Recognition',
    icon: Cpu,
    description:
      'Use our trained CRAFT model for text detection combined with a custom recognition model. Optimized for historical and handwritten documents.',
    features: [
      { icon: WifiOff, text: 'Works offline', highlight: true },
      { icon: Shield, text: 'Data stays on your machine' },
      { icon: Brain, text: 'Custom trained for historical docs' },
      { icon: Server, text: 'Requires GPU (recommended)' },
    ],
    pros: ['No usage costs', 'Privacy preserved', 'Tuned for your documents'],
    cons: ['Requires local GPU', 'Initial model download', 'May be slower'],
    recommended: false,
    badge: 'Coming Soon',
    badgeColor: 'bg-gray-500',
    disabled: true,
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

  const handleMethodSelect = (methodId) => {
    const method = METHOD_OPTIONS.find(m => m.id === methodId);
    if (!method?.disabled) {
      setSelectedMethod(methodId);
    }
  };

  const canProceed = selectedMethod === 'api';

  return (
    <div className="h-full flex flex-col animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="btn-ghost"
          >
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
          onClick={() => onNext(selectedMethod, 'gemini')}
          disabled={!canProceed}
          className={`btn-primary ${canProceed
              ? ''
              : 'opacity-50 cursor-not-allowed hover:translate-y-0'
            }`}
        >
          Continue to OCR
          <ArrowRight className="w-5 h-5" />
        </button>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        {/* Intro */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-700 rounded-full text-sm font-semibold mb-4 shadow-sm border border-blue-100">
            <ScanText className="w-4 h-4" />
            Choose your text detection method
          </div>
          <p className="text-gray-500 max-w-2xl mx-auto text-lg">
            Select how you want to detect and recognize text in your documents.
            We recommend using the Gemini API for best results.
          </p>
        </div>

        {/* Method cards */}
        <div className="grid md:grid-cols-2 gap-6 max-w-5xl mx-auto mb-8">
          {METHOD_OPTIONS.map((method) => {
            const Icon = method.icon;
            const isSelected = selectedMethod === method.id;
            const isDisabled = method.disabled;

            return (
              <div
                key={method.id}
                onClick={() => handleMethodSelect(method.id)}
                className={`relative p-6 rounded-2xl border-2 transition-all duration-300 ${isDisabled
                    ? 'border-gray-200 bg-gray-50/80 cursor-not-allowed opacity-70'
                    : isSelected
                      ? 'border-blue-500 bg-gradient-to-br from-blue-50/80 to-indigo-50/80 shadow-xl shadow-blue-500/10 -translate-y-1'
                      : 'border-gray-200 bg-white/80 backdrop-blur-sm hover:border-blue-300 hover:shadow-lg hover:-translate-y-0.5 cursor-pointer'
                  }`}
              >
                {/* Badge */}
                <div
                  className={`absolute -top-3 left-6 px-4 py-1.5 text-xs font-bold text-white rounded-full shadow-md ${method.badgeColor}`}
                >
                  {method.badge}
                </div>

                {/* Selection indicator */}
                <div
                  className={`absolute top-4 right-4 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-300 ${isDisabled
                      ? 'border-gray-300 bg-gray-100'
                      : isSelected
                        ? 'border-blue-600 bg-gradient-to-br from-blue-500 to-indigo-600 shadow-md shadow-blue-500/30'
                        : 'border-gray-300 bg-white'
                    }`}
                >
                  {isSelected && !isDisabled && <Check className="w-4 h-4 text-white" strokeWidth={3} />}
                </div>

                {/* Header */}
                <div className="flex items-start gap-4 mb-4 mt-2">
                  <div
                    className={`p-3 rounded-xl transition-all duration-300 ${isDisabled
                        ? 'bg-gray-200 text-gray-400'
                        : isSelected
                          ? 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-lg shadow-blue-500/30'
                          : 'bg-gradient-to-br from-blue-100 to-indigo-100 text-blue-600'
                      }`}
                  >
                    <Icon className="w-7 h-7" />
                  </div>
                  <div>
                    <h3 className={`text-xl font-bold ${isDisabled ? 'text-gray-500' : 'text-gray-800'}`}>
                      {method.name}
                    </h3>
                    <p className={`text-sm ${isDisabled ? 'text-gray-400' : 'text-gray-500'}`}>
                      {method.subtitle}
                    </p>
                  </div>
                </div>

                {/* Description */}
                <p className={`mb-4 ${isDisabled ? 'text-gray-400' : 'text-gray-600'}`}>
                  {method.description}
                </p>

                {/* Features */}
                <div className="space-y-2 mb-4">
                  {method.features.map((feature, idx) => {
                    const FeatureIcon = feature.icon;
                    return (
                      <div
                        key={idx}
                        className={`flex items-center gap-2 text-sm ${isDisabled
                            ? 'text-gray-400'
                            : feature.highlight
                              ? 'text-blue-600 font-semibold'
                              : 'text-gray-600'
                          }`}
                      >
                        <FeatureIcon className="w-4 h-4" />
                        {feature.text}
                      </div>
                    );
                  })}
                </div>

                {/* Pros & Cons */}
                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-100">
                  <div>
                    <p className={`text-xs font-bold mb-2 ${isDisabled ? 'text-gray-400' : 'text-green-600'}`}>
                      PROS
                    </p>
                    <ul className="space-y-1">
                      {method.pros.map((pro, idx) => (
                        <li key={idx} className={`text-xs flex items-start gap-1.5 ${isDisabled ? 'text-gray-400' : 'text-gray-600'}`}>
                          <span className={`mt-0.5 ${isDisabled ? 'text-gray-400' : 'text-green-500'}`}>✓</span>
                          {pro}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className={`text-xs font-bold mb-2 ${isDisabled ? 'text-gray-400' : 'text-amber-600'}`}>
                      CONS
                    </p>
                    <ul className="space-y-1">
                      {method.cons.map((con, idx) => (
                        <li key={idx} className={`text-xs flex items-start gap-1.5 ${isDisabled ? 'text-gray-400' : 'text-gray-600'}`}>
                          <span className={`mt-0.5 ${isDisabled ? 'text-gray-400' : 'text-amber-500'}`}>•</span>
                          {con}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Gemini info card */}
        {selectedMethod === 'api' && (
          <div className="max-w-3xl mx-auto animate-slide-up">
            <div className="bg-gradient-to-br from-blue-50/80 via-white to-indigo-50/80 backdrop-blur-sm rounded-2xl border border-blue-200/50 p-6 shadow-lg">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl text-white shadow-lg shadow-blue-500/30">
                  <Sparkles className="w-6 h-6" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-gray-800 mb-2">
                    About Gemini API
                  </h3>
                  <p className="text-gray-600 mb-4">
                    Google's Gemini is a powerful multimodal AI that excels at understanding
                    and extracting text from images, including handwritten documents and
                    complex layouts.
                  </p>

                  <div className="grid md:grid-cols-3 gap-4">
                    <div className="bg-white/80 backdrop-blur-sm rounded-xl p-4 border border-blue-100 shadow-sm hover:shadow-md transition-shadow">
                      <div className="text-2xl mb-2">🔑</div>
                      <h4 className="font-bold text-gray-800 mb-1">API Key Required</h4>
                      <p className="text-xs text-gray-500">
                        Get your free API key from Google AI Studio
                      </p>
                    </div>
                    <div className="bg-white/80 backdrop-blur-sm rounded-xl p-4 border border-blue-100 shadow-sm hover:shadow-md transition-shadow">
                      <div className="text-2xl mb-2">⚡</div>
                      <h4 className="font-bold text-gray-800 mb-1">Rate Limited</h4>
                      <p className="text-xs text-gray-500">
                        Free tier: ~15 requests/minute with cooldown
                      </p>
                    </div>
                    <div className="bg-white/80 backdrop-blur-sm rounded-xl p-4 border border-blue-100 shadow-sm hover:shadow-md transition-shadow">
                      <div className="text-2xl mb-2">🎯</div>
                      <h4 className="font-bold text-gray-800 mb-1">High Accuracy</h4>
                      <p className="text-xs text-gray-500">
                        State-of-the-art on document understanding
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Local model info (shown when local method selected) */}
        {selectedMethod === 'local' && (
          <div className="max-w-3xl mx-auto animate-slide-up">
            <div className="bg-gradient-to-br from-gray-50 to-gray-100/80 backdrop-blur-sm rounded-2xl border border-gray-300 p-6 shadow-lg">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-gray-400 rounded-xl text-white">
                  <Cpu className="w-6 h-6" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-gray-600 mb-2">
                    Local Model - Coming Soon
                  </h3>
                  <p className="text-gray-500 mb-4">
                    We're working on integrating CRAFT text detection with a custom
                    recognition model optimized for historical documents. This will
                    allow offline processing with no API costs.
                  </p>
                  <p className="text-sm text-gray-400">
                    Stay tuned for updates!
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Bottom spacer */}
        <div className="h-8" />
      </div>
    </div>
  );
}
