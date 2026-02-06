/**
 * Preprocessing Operations Configuration
 * 
 * Simplified set of essential preprocessing operations for OCR.
 */

// ========== OPERATION CATEGORIES ==========

export const OPERATION_CATEGORIES = [
  {
    id: 'basic',
    label: 'Basic Processing',
    icon: 'Sliders',
    description: 'Essential image adjustments',
  },
  {
    id: 'enhancement',
    label: 'Enhancement',
    icon: 'Sparkles',
    description: 'Improve image quality and clarity',
  },
  {
    id: 'binarization',
    label: 'Binarization',
    icon: 'Contrast',
    description: 'Convert to black and white',
  },
];

// ========== OPERATION DEFINITIONS ==========

export const OPERATIONS = [
  // ===== BASIC PROCESSING =====
  {
    id: 'normalize',
    name: 'Normalize',
    category: 'basic',
    tooltip: 'Normalize image brightness and contrast levels to improve overall quality.',
    controls: [
      {
        id: 'strength',
        label: 'Strength',
        type: 'slider',
        min: 0,
        max: 100,
        step: 5,
        default: 50,
        unit: '%',
      },
    ],
    defaultParams: { strength: 50 },
  },
  {
    id: 'grayscale',
    name: 'Grayscale',
    category: 'basic',
    tooltip: 'Convert image to grayscale. Often improves OCR accuracy for color documents.',
    controls: [],
    defaultParams: {},
  },
  {
    id: 'deskew',
    name: 'Deskew',
    category: 'basic',
    tooltip: 'Automatically detect and correct image rotation/skew from scanning.',
    controls: [
      {
        id: 'maxAngle',
        label: 'Max Angle',
        type: 'slider',
        min: 1,
        max: 45,
        step: 1,
        default: 15,
        unit: '°',
      },
    ],
    defaultParams: { maxAngle: 15 },
  },

  // ===== ENHANCEMENT =====
  {
    id: 'denoise',
    name: 'Denoise',
    category: 'enhancement',
    tooltip: 'Remove noise and grain from the image while preserving text edges.',
    controls: [
      {
        id: 'method',
        label: 'Method',
        type: 'select',
        options: [
          { value: 'nlm', label: 'Non-Local Means' },
          { value: 'bilateral', label: 'Bilateral Filter' },
          { value: 'gaussian', label: 'Gaussian Blur' },
        ],
        default: 'nlm',
      },
      {
        id: 'strength',
        label: 'Strength',
        type: 'slider',
        min: 1,
        max: 20,
        step: 1,
        default: 10,
      },
    ],
    defaultParams: { method: 'nlm', strength: 10 },
  },
  {
    id: 'contrast',
    name: 'Contrast',
    category: 'enhancement',
    tooltip: 'Enhance image contrast using adaptive histogram equalization (CLAHE).',
    controls: [
      {
        id: 'clipLimit',
        label: 'Clip Limit',
        type: 'slider',
        min: 1,
        max: 10,
        step: 0.5,
        default: 2,
      },
      {
        id: 'tileSize',
        label: 'Tile Size',
        type: 'slider',
        min: 2,
        max: 16,
        step: 2,
        default: 8,
      },
    ],
    defaultParams: { clipLimit: 2, tileSize: 8 },
  },
  {
    id: 'sharpen',
    name: 'Sharpen',
    category: 'enhancement',
    tooltip: 'Sharpen text edges for crisper, more defined characters.',
    controls: [
      {
        id: 'amount',
        label: 'Amount',
        type: 'slider',
        min: 0,
        max: 100,
        step: 5,
        default: 50,
        unit: '%',
      },
      {
        id: 'radius',
        label: 'Radius',
        type: 'slider',
        min: 0.5,
        max: 3,
        step: 0.5,
        default: 1,
        unit: 'px',
      },
    ],
    defaultParams: { amount: 50, radius: 1 },
  },

  // ===== BINARIZATION =====
  {
    id: 'threshold',
    name: 'Threshold',
    category: 'binarization',
    tooltip: 'Convert to black and white. Choose between automatic (Otsu) or adaptive methods.',
    controls: [
      {
        id: 'method',
        label: 'Method',
        type: 'select',
        options: [
          { value: 'otsu', label: 'Otsu (Auto)' },
          { value: 'adaptive', label: 'Adaptive' },
          { value: 'sauvola', label: 'Sauvola' },
        ],
        default: 'otsu',
      },
      {
        id: 'blockSize',
        label: 'Block Size',
        type: 'slider',
        min: 3,
        max: 51,
        step: 2,
        default: 15,
        showWhen: { method: ['adaptive', 'sauvola'] },
      },
      {
        id: 'k',
        label: 'Sensitivity',
        type: 'slider',
        min: 0.1,
        max: 0.9,
        step: 0.1,
        default: 0.5,
        showWhen: { method: ['sauvola'] },
      },
    ],
    defaultParams: { method: 'otsu', blockSize: 15, k: 0.5 },
  },
];

// ========== HELPER FUNCTIONS ==========

/**
 * Get operations grouped by category
 */
export function getOperationsByCategory() {
  const grouped = {};
  OPERATION_CATEGORIES.forEach(cat => {
    grouped[cat.id] = OPERATIONS.filter(op => op.category === cat.id);
  });
  return grouped;
}

/**
 * Get operation by ID
 */
export function getOperationById(id) {
  return OPERATIONS.find(op => op.id === id);
}

/**
 * Create a default pipeline step from an operation
 */
export function createPipelineStep(operationId, order = 0) {
  const operation = getOperationById(operationId);
  if (!operation) return null;
  
  return {
    id: `${operationId}-${Date.now()}`,
    operationId: operationId,
    enabled: true,
    params: { ...operation.defaultParams },
    order: order,
  };
}

/**
 * Get default recommended pipeline
 */
export function getRecommendedPipeline() {
  return [
    createPipelineStep('grayscale', 0),
    createPipelineStep('deskew', 1),
    createPipelineStep('denoise', 2),
    createPipelineStep('contrast', 3),
    createPipelineStep('threshold', 4),
  ].filter(Boolean);
}

/**
 * Validate and check if a control should be shown
 */
export function shouldShowControl(control, currentParams) {
  if (!control.showWhen) return true;
  
  return Object.entries(control.showWhen).every(([key, value]) => {
    if (Array.isArray(value)) {
      return value.includes(currentParams[key]);
    }
    return currentParams[key] === value;
  });
}

export default OPERATIONS;
