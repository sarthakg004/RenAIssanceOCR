import React, { useState, useCallback } from 'react';
import { Wand2, RotateCcw, Play, Settings2, Sparkles } from 'lucide-react';
import OperationControl from './OperationControl';

// Operation definitions matching the Python backend
const OPERATIONS = [
  {
    name: 'grayscale',
    label: 'Grayscale',
    description: 'Convert image to grayscale for better processing',
    controls: [],
  },
  {
    name: 'deskew',
    label: 'Deskew',
    description: 'Automatically correct image rotation and skew',
    controls: [],
  },
  {
    name: 'denoise',
    label: 'Denoise',
    description: 'Remove noise and artifacts from the image',
    controls: [
      {
        name: 'method',
        label: 'Method',
        type: 'select',
        default: 'nlm',
        options: [
          { value: 'nlm', label: 'Non-Local Means (Recommended)' },
          { value: 'bilateral', label: 'Bilateral Filter' },
        ],
      },
      {
        name: 'strength',
        label: 'Strength',
        type: 'slider',
        min: 1,
        max: 20,
        default: 10,
      },
    ],
  },
  {
    name: 'contrast',
    label: 'Contrast Enhancement',
    description: 'Improve image contrast using CLAHE algorithm',
    controls: [
      {
        name: 'method',
        label: 'Method',
        type: 'select',
        default: 'clahe',
        options: [{ value: 'clahe', label: 'CLAHE (Adaptive)' }],
      },
      {
        name: 'clipLimit',
        label: 'Clip Limit',
        type: 'slider',
        min: 1,
        max: 5,
        step: 0.5,
        default: 2,
      },
      {
        name: 'tileSize',
        label: 'Tile Size',
        type: 'slider',
        min: 4,
        max: 16,
        default: 8,
      },
    ],
  },
  {
    name: 'binarize',
    label: 'Binarization',
    description: 'Convert to black and white for clearer text',
    controls: [
      {
        name: 'method',
        label: 'Method',
        type: 'toggle',
        default: 'otsu',
        options: [
          { value: 'otsu', label: 'Otsu' },
          { value: 'adaptive', label: 'Adaptive' },
        ],
      },
      {
        name: 'blockSize',
        label: 'Block Size (Adaptive)',
        type: 'slider',
        min: 3,
        max: 31,
        step: 2,
        default: 15,
        showWhen: { method: 'adaptive' },
      },
    ],
  },
  {
    name: 'morph',
    label: 'Morphological Operations',
    description: 'Clean up text edges and remove small artifacts',
    controls: [
      {
        name: 'operation',
        label: 'Operation',
        type: 'select',
        default: 'open',
        options: [
          { value: 'open', label: 'Open (Remove noise)' },
          { value: 'close', label: 'Close (Fill gaps)' },
          { value: 'dilate', label: 'Dilate (Thicken)' },
          { value: 'erode', label: 'Erode (Thin)' },
        ],
      },
      {
        name: 'kernelSize',
        label: 'Kernel Size',
        type: 'slider',
        min: 1,
        max: 5,
        default: 2,
      },
      {
        name: 'iterations',
        label: 'Iterations',
        type: 'slider',
        min: 1,
        max: 5,
        default: 1,
      },
    ],
  },
];

// Recommended preprocessing pipeline
const RECOMMENDED_PIPELINE = {
  deskew: { enabled: true },
  denoise: { enabled: true, method: 'nlm', strength: 10 },
  contrast: { enabled: true, method: 'clahe', clipLimit: 2, tileSize: 8 },
  binarize: { enabled: true, method: 'adaptive', blockSize: 15 },
};

export default function PreprocessPanel({
  settings,
  onSettingsChange,
  onApply,
  onReset,
  isProcessing,
  hasChanges,
}) {
  const [expandedOp, setExpandedOp] = useState(null);

  const handleToggle = useCallback(
    (opName, enabled) => {
      onSettingsChange({
        ...settings,
        [opName]: {
          ...settings[opName],
          enabled,
        },
      });
    },
    [settings, onSettingsChange]
  );

  const handleValueChange = useCallback(
    (opName, controlName, value) => {
      onSettingsChange({
        ...settings,
        [opName]: {
          ...settings[opName],
          [controlName]: value,
        },
      });
    },
    [settings, onSettingsChange]
  );

  const handleApplyRecommended = () => {
    const newSettings = {};
    OPERATIONS.forEach((op) => {
      if (RECOMMENDED_PIPELINE[op.name]) {
        newSettings[op.name] = {
          ...RECOMMENDED_PIPELINE[op.name],
        };
      } else {
        newSettings[op.name] = { enabled: false };
      }
    });
    onSettingsChange(newSettings);
  };

  const getEnabledCount = () => {
    return Object.values(settings).filter((s) => s?.enabled).length;
  };

  return (
    <div className="bg-white rounded-xl shadow-card h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-blue-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-blue-600" />
            <h3 className="font-semibold text-gray-800">Preprocessing</h3>
            {getEnabledCount() > 0 && (
              <span className="px-2 py-0.5 bg-blue-100 text-blue-600 text-xs font-medium rounded-full">
                {getEnabledCount()} active
              </span>
            )}
          </div>
        </div>

        {/* Quick actions */}
        <div className="flex gap-2 mt-4">
          <button
            onClick={handleApplyRecommended}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-medium rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all shadow-md hover:shadow-lg"
          >
            <Sparkles className="w-4 h-4" />
            Recommended
          </button>
          <button
            onClick={onReset}
            className="px-4 py-2.5 bg-blue-50 text-blue-600 font-medium rounded-xl hover:bg-blue-100 transition-colors"
            title="Reset all"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Operations list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {OPERATIONS.map((op) => (
          <OperationControl
            key={op.name}
            name={op.name}
            label={op.label}
            description={op.description}
            enabled={settings[op.name]?.enabled || false}
            onToggle={handleToggle}
            controls={op.controls}
            values={settings[op.name] || {}}
            onValueChange={handleValueChange}
          />
        ))}
      </div>

      {/* Apply button */}
      <div className="p-4 border-t border-blue-100">
        <button
          onClick={onApply}
          disabled={isProcessing || getEnabledCount() === 0}
          className={`w-full flex items-center justify-center gap-2 px-6 py-3 font-semibold rounded-xl transition-all ${
            isProcessing || getEnabledCount() === 0
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700 shadow-md hover:shadow-lg'
          }`}
        >
          {isProcessing ? (
            <>
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <Play className="w-5 h-5" />
              Apply Preprocessing
            </>
          )}
        </button>

        {hasChanges && !isProcessing && (
          <p className="text-center text-xs text-amber-600 mt-2">
            Settings changed. Click apply to see results.
          </p>
        )}
      </div>
    </div>
  );
}
