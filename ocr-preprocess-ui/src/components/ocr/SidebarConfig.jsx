import { useState } from 'react';
import {
  Key,
  Eye,
  EyeOff,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  ShieldX,
  RefreshCw,
} from 'lucide-react';

/**
 * SidebarConfig Component
 * API configuration panel with proper async validation
 */
export default function SidebarConfig({
  apiKey,
  onApiKeyChange,
  selectedModel,
  onModelChange,
  models = [],
  isKeyValid,
  isValidating,
  onVerifyKey,
  backendOnline,
}) {
  const [showKey, setShowKey] = useState(false);

  const getKeyStatusBadge = () => {
    if (isValidating) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 text-blue-600 text-xs font-medium rounded-full">
          <Loader2 size={12} className="animate-spin" />
          Verifying...
        </span>
      );
    }
    if (isKeyValid === true) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-green-50 text-green-600 text-xs font-medium rounded-full">
          <ShieldCheck size={12} />
          Valid
        </span>
      );
    }
    if (isKeyValid === false) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-red-50 text-red-600 text-xs font-medium rounded-full">
          <ShieldX size={12} />
          Invalid
        </span>
      );
    }
    return null;
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-gradient-to-r from-blue-50 to-white border-b border-gray-100">
        <h3 className="font-semibold text-gray-800 flex items-center gap-2">
          <Key size={18} className="text-blue-600" />
          API Configuration
        </h3>
      </div>

      <div className="p-4 space-y-4">
        {/* Backend Status */}
        {backendOnline === false && (
          <div className="px-3 py-2 bg-red-50 border border-red-100 rounded-lg">
            <p className="text-xs text-red-600 flex items-center gap-1.5">
              <AlertCircle size={14} />
              Backend offline
            </p>
          </div>
        )}

        {/* API Key Input */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700">
              Gemini API Key
            </label>
            {getKeyStatusBadge()}
          </div>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => onApiKeyChange(e.target.value)}
              placeholder="Enter your API key..."
              className="w-full px-3 py-2.5 pr-20 text-sm border border-gray-200 rounded-lg 
                       focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400
                       transition-colors bg-gray-50 focus:bg-white"
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
              <button
                onClick={() => setShowKey(!showKey)}
                className="p-1.5 text-gray-400 hover:text-gray-600 rounded transition-colors"
                title={showKey ? 'Hide key' : 'Show key'}
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Verify Button */}
          <button
            onClick={onVerifyKey}
            disabled={!apiKey || apiKey.length < 10 || isValidating}
            className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-2 
                     text-sm font-medium rounded-lg transition-colors
                     disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed
                     bg-blue-50 text-blue-600 hover:bg-blue-100"
          >
            {isValidating ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Verifying...
              </>
            ) : (
              <>
                <RefreshCw size={14} />
                Verify API Key
              </>
            )}
          </button>
        </div>

        {/* Model Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Model
          </label>
          <select
            value={selectedModel}
            onChange={(e) => onModelChange(e.target.value)}
            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg 
                     focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400
                     transition-colors bg-gray-50 focus:bg-white cursor-pointer"
          >
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-gray-500 leading-relaxed">
            {models.find((m) => m.id === selectedModel)?.description || ''}
          </p>
        </div>
      </div>
    </div>
  );
}
