import { useState, useCallback, useRef, useEffect } from 'react';
import { 
  getOperationById, 
  getRecommendedPipeline,
  createPipelineStep 
} from '../config/preprocessOperations';

/**
 * usePipeline - Custom hook for managing preprocessing pipeline state
 * 
 * Features:
 * - Pipeline array state management
 * - Add/remove/reorder operations
 * - Enable/disable operations
 * - Update operation parameters
 * - Sync between enabled operations and pipeline
 * - Debounced preview triggering
 */
export function usePipeline(options = {}) {
  const {
    onPreviewRequest,
    debounceMs = 500,
    initialPipeline = [],
  } = options;

  // Pipeline state - array of steps with order
  const [pipeline, setPipeline] = useState(initialPipeline);
  
  // Enabled operations state - map of operation settings
  const [enabledOperations, setEnabledOperations] = useState({});
  
  // Debounce timer ref
  const debounceTimer = useRef(null);

  // Sync pipeline from enabled operations
  const syncPipelineFromEnabled = useCallback((enabled) => {
    setPipeline(prev => {
      // Get currently enabled operation IDs
      const enabledIds = Object.entries(enabled)
        .filter(([_, val]) => val?.enabled)
        .map(([id]) => id);

      // Keep existing pipeline steps that are still enabled
      const existingSteps = prev.filter(step => enabledIds.includes(step.operationId));
      
      // Find new operations that need to be added
      const existingOperationIds = existingSteps.map(s => s.operationId);
      const newOperationIds = enabledIds.filter(id => !existingOperationIds.includes(id));
      
      // Create new steps for newly enabled operations
      const newSteps = newOperationIds.map((opId, index) => ({
        id: `${opId}-${Date.now()}-${index}`,
        operationId: opId,
        enabled: true,
        params: enabled[opId]?.params || getOperationById(opId)?.defaultParams || {},
        order: existingSteps.length + index,
      }));

      // Combine and update orders
      const combined = [...existingSteps, ...newSteps].map((step, index) => ({
        ...step,
        order: index,
        // Sync params from enabledOperations
        params: enabled[step.operationId]?.params || step.params,
      }));

      return combined;
    });
  }, []);

  // Toggle operation enabled state
  const toggleOperation = useCallback((operationId, enabled) => {
    setEnabledOperations(prev => {
      const operation = getOperationById(operationId);
      const newState = {
        ...prev,
        [operationId]: {
          enabled,
          params: prev[operationId]?.params || operation?.defaultParams || {},
        },
      };
      
      // Sync pipeline
      syncPipelineFromEnabled(newState);
      
      return newState;
    });

    // Trigger debounced preview
    triggerDebouncedPreview();
  }, [syncPipelineFromEnabled]);

  // Update operation parameters
  const updateOperationParams = useCallback((operationId, params) => {
    setEnabledOperations(prev => ({
      ...prev,
      [operationId]: {
        ...prev[operationId],
        params,
      },
    }));

    // Also update in pipeline
    setPipeline(prev => prev.map(step => 
      step.operationId === operationId
        ? { ...step, params }
        : step
    ));

    // Trigger debounced preview
    triggerDebouncedPreview();
  }, []);

  // Toggle pipeline step enabled state
  const togglePipelineStep = useCallback((stepId, enabled) => {
    setPipeline(prev => prev.map(step =>
      step.id === stepId
        ? { ...step, enabled }
        : step
    ));

    // Trigger debounced preview
    triggerDebouncedPreview();
  }, []);

  // Update pipeline step parameters
  const updatePipelineStepParams = useCallback((stepId, params) => {
    setPipeline(prev => {
      const updated = prev.map(step =>
        step.id === stepId
          ? { ...step, params }
          : step
      );
      
      // Sync back to enabledOperations
      const step = updated.find(s => s.id === stepId);
      if (step) {
        setEnabledOperations(prevEnabled => ({
          ...prevEnabled,
          [step.operationId]: {
            ...prevEnabled[step.operationId],
            params,
          },
        }));
      }
      
      return updated;
    });

    // Trigger debounced preview
    triggerDebouncedPreview();
  }, []);

  // Remove step from pipeline
  const removePipelineStep = useCallback((stepId) => {
    setPipeline(prev => {
      const step = prev.find(s => s.id === stepId);
      
      // Also disable in enabledOperations
      if (step) {
        setEnabledOperations(prevEnabled => ({
          ...prevEnabled,
          [step.operationId]: {
            ...prevEnabled[step.operationId],
            enabled: false,
          },
        }));
      }
      
      return prev.filter(s => s.id !== stepId).map((s, i) => ({ ...s, order: i }));
    });

    // Trigger debounced preview
    triggerDebouncedPreview();
  }, []);

  // Reorder pipeline steps
  const reorderPipeline = useCallback((fromIndex, toIndex) => {
    setPipeline(prev => {
      const result = [...prev];
      const [removed] = result.splice(fromIndex, 1);
      result.splice(toIndex, 0, removed);
      return result.map((step, index) => ({ ...step, order: index }));
    });

    // Trigger debounced preview
    triggerDebouncedPreview();
  }, []);

  // Add operation to pipeline
  const addOperation = useCallback((operationId) => {
    const operation = getOperationById(operationId);
    if (!operation) return;

    const newStep = createPipelineStep(operationId, pipeline.length);
    if (!newStep) return;

    setPipeline(prev => [...prev, newStep]);
    setEnabledOperations(prev => ({
      ...prev,
      [operationId]: {
        enabled: true,
        params: operation.defaultParams,
      },
    }));

    // Trigger debounced preview
    triggerDebouncedPreview();
  }, [pipeline.length]);

  // Apply recommended pipeline
  const applyRecommendedPipeline = useCallback(() => {
    const recommended = getRecommendedPipeline();
    setPipeline(recommended);

    // Update enabled operations
    const newEnabled = {};
    recommended.forEach(step => {
      newEnabled[step.operationId] = {
        enabled: true,
        params: step.params,
      };
    });
    setEnabledOperations(newEnabled);

    // Trigger debounced preview
    triggerDebouncedPreview();
  }, []);

  // Reset pipeline
  const resetPipeline = useCallback(() => {
    setPipeline([]);
    setEnabledOperations({});
    
    // Clear any pending preview
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
  }, []);

  // Trigger debounced preview request
  const triggerDebouncedPreview = useCallback(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    if (onPreviewRequest) {
      debounceTimer.current = setTimeout(() => {
        onPreviewRequest();
      }, debounceMs);
    }
  }, [onPreviewRequest, debounceMs]);

  // Get active (enabled) pipeline steps
  const getActivePipeline = useCallback(() => {
    return pipeline.filter(step => step.enabled);
  }, [pipeline]);

  // Build pipeline config for API
  const buildPipelineConfig = useCallback(() => {
    return getActivePipeline().map(step => ({
      op: step.operationId,
      params: step.params,
    }));
  }, [getActivePipeline]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, []);

  return {
    // State
    pipeline,
    enabledOperations,
    
    // Operations sidebar actions
    toggleOperation,
    updateOperationParams,
    
    // Pipeline stack actions
    togglePipelineStep,
    updatePipelineStepParams,
    removePipelineStep,
    reorderPipeline,
    addOperation,
    
    // Quick actions
    applyRecommendedPipeline,
    resetPipeline,
    
    // Utilities
    getActivePipeline,
    buildPipelineConfig,
  };
}

export default usePipeline;
