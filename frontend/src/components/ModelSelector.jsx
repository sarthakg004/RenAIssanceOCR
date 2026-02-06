import { useState, useEffect } from 'react';
import { Key, AlertCircle, CheckCircle } from 'lucide-react';

/**
 * ModelSelector Component
 * Dropdown for selecting Gemini model with API key input
 */
export default function ModelSelector({ 
  apiKey, 
  onApiKeyChange, 
  selectedModel, 
  onModelChange,
  models = [],
  isKeyValid = null 
}) {
  const [showKey, setShowKey] = useState(false);

  return (
    <div className="bg-white rounded-xl shadow-md p-4 space-y-4">
      <h3 className="font-semibold text-gray-800 flex items-center gap-2">
        <Key size={18} className="text-blue-600" />
        Gemini Configuration
      </h3>
      
      {/* API Key Input */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          API Key
        </label>
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => onApiKeyChange(e.target.value)}
            placeholder="Enter your Gemini API key"
            className={`w-full px-3 py-2 pr-20 border rounded-lg focus:outline-none focus:ring-2 ${
              isKeyValid === true 
                ? 'border-green-300 focus:ring-green-500' 
                : isKeyValid === false 
                  ? 'border-red-300 focus:ring-red-500' 
                  : 'border-gray-300 focus:ring-blue-500'
            }`}
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-blue-600 hover:text-blue-800"
          >
            {showKey ? 'Hide' : 'Show'}
          </button>
        </div>
        {isKeyValid === false && (
          <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
            <AlertCircle size={14} />
            Invalid API key
          </p>
        )}
        {isKeyValid === true && (
          <p className="mt-1 text-sm text-green-600 flex items-center gap-1">
            <CheckCircle size={14} />
            API key verified
          </p>
        )}
      </div>
      
      {/* Model Selection */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Model
        </label>
        <select
          value={selectedModel}
          onChange={(e) => onModelChange(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-gray-500">
          {models.find(m => m.id === selectedModel)?.description || ''}
        </p>
      </div>
    </div>
  );
}
