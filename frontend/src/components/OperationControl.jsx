import React from 'react';
import { ChevronDown } from 'lucide-react';

export default function OperationControl({
  name,
  label,
  description,
  enabled,
  onToggle,
  controls,
  values,
  onValueChange,
}) {
  return (
    <div
      className={`p-4 rounded-xl border-2 transition-all duration-200 ${
        enabled
          ? 'border-blue-500 bg-blue-50/50'
          : 'border-blue-100 bg-white hover:border-blue-200'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onToggle(name, e.target.checked)}
            className="mt-1"
          />
          <div>
            <h4 className="font-medium text-gray-800">{label}</h4>
            <p className="text-sm text-gray-500 mt-0.5">{description}</p>
          </div>
        </div>
      </div>

      {/* Controls */}
      {enabled && controls && controls.length > 0 && (
        <div className="mt-4 pl-8 space-y-4 animate-slide-up">
          {controls.map((control) => (
            <div key={control.name} className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-gray-600">
                  {control.label}
                </label>
                {control.type === 'slider' && (
                  <span className="text-sm text-blue-600 font-medium">
                    {values[control.name] ?? control.default}
                  </span>
                )}
              </div>

              {control.type === 'slider' && (
                <input
                  type="range"
                  min={control.min}
                  max={control.max}
                  step={control.step || 1}
                  value={values[control.name] ?? control.default}
                  onChange={(e) =>
                    onValueChange(name, control.name, parseFloat(e.target.value))
                  }
                  className="w-full"
                />
              )}

              {control.type === 'select' && (
                <div className="relative">
                  <select
                    value={values[control.name] ?? control.default}
                    onChange={(e) =>
                      onValueChange(name, control.name, e.target.value)
                    }
                    className="w-full appearance-none bg-white border border-blue-200 rounded-lg px-4 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    {control.options.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                </div>
              )}

              {control.type === 'toggle' && (
                <div className="flex items-center gap-3">
                  {control.options.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() =>
                        onValueChange(name, control.name, opt.value)
                      }
                      className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
                        (values[control.name] ?? control.default) === opt.value
                          ? 'bg-blue-600 text-white'
                          : 'bg-blue-100 text-blue-600 hover:bg-blue-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
