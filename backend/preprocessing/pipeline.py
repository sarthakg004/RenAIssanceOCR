"""
Preprocessing Pipeline Executor

Executes ordered preprocessing operations with progress tracking and error handling.
"""

import time
import traceback
from typing import Dict, Any, Optional, Callable, List
from dataclasses import dataclass, field
import numpy as np

from .operations import OP_REGISTRY, get_operation
from .progress import ProgressCallback, ProgressAggregator, ProgressInfo


@dataclass
class PipelineStep:
    """Configuration for a single pipeline step"""
    op: str
    params: Dict[str, Any] = field(default_factory=dict)
    enabled: bool = True


@dataclass
class PipelineResult:
    """Result of pipeline execution"""
    success: bool
    image: Optional[np.ndarray]
    progress_info: Dict[str, Any]
    errors: List[Dict[str, Any]] = field(default_factory=list)
    

class PipelineExecutor:
    """
    Executes preprocessing pipeline with progress tracking.
    
    Features:
    - Ordered operation execution
    - Per-step progress reporting
    - Error handling with continue option
    - Performance timing
    """
    
    def __init__(
        self,
        on_progress: Optional[Callable[[ProgressInfo], None]] = None,
        continue_on_error: bool = False,
    ):
        """
        Initialize pipeline executor.
        
        Args:
            on_progress: Callback for progress updates
            continue_on_error: If True, continue pipeline even if a step fails
        """
        self.on_progress = on_progress
        self.continue_on_error = continue_on_error
        self.aggregator = ProgressAggregator()
    
    def execute(
        self,
        image: np.ndarray,
        steps: List[Dict[str, Any]],
        preview_mode: bool = False,
    ) -> PipelineResult:
        """
        Execute the preprocessing pipeline.
        
        Args:
            image: Input image as numpy array
            steps: List of step configurations [{op, params, enabled}, ...]
            preview_mode: If True, may use faster but lower quality algorithms
        
        Returns:
            PipelineResult with processed image and progress info
        """
        self.aggregator.start()
        
        # Filter to enabled steps only
        active_steps = [
            PipelineStep(
                op=s.get("op", ""),
                params=s.get("params", {}),
                enabled=s.get("enabled", True)
            )
            for s in steps
            if s.get("enabled", True)
        ]
        
        if not active_steps:
            self.aggregator.finish()
            return PipelineResult(
                success=True,
                image=image,
                progress_info=self.aggregator.get_summary(),
            )
        
        total_steps = len(active_steps)
        current_image = image.copy()
        errors = []
        
        for i, step in enumerate(active_steps):
            step_name = step.op
            
            # Notify step started
            self.aggregator.step_started(step_name, i, total_steps)
            
            # Get operation function
            op_func = get_operation(step_name)
            
            if op_func is None:
                error_info = {
                    "step": step_name,
                    "index": i,
                    "error": f"Unknown operation: {step_name}",
                }
                errors.append(error_info)
                self.aggregator.step_completed(success=False, error=error_info["error"])
                
                if not self.continue_on_error:
                    self.aggregator.finish()
                    return PipelineResult(
                        success=False,
                        image=current_image,
                        progress_info=self.aggregator.get_summary(),
                        errors=errors,
                    )
                continue
            
            # Create progress callback for this step
            progress = ProgressCallback(
                on_progress=self._handle_step_progress,
                step_name=step_name,
                step_index=i,
                total_steps=total_steps,
            )
            
            try:
                # Apply preview mode adjustments if needed
                params = step.params.copy()
                if preview_mode:
                    params = self._adjust_params_for_preview(step_name, params)
                
                # Execute operation
                current_image = op_func(current_image, params, progress)
                
                self.aggregator.step_completed(success=True)
                
            except Exception as e:
                error_msg = str(e)
                error_trace = traceback.format_exc()
                
                error_info = {
                    "step": step_name,
                    "index": i,
                    "error": error_msg,
                    "traceback": error_trace,
                }
                errors.append(error_info)
                self.aggregator.step_completed(success=False, error=error_msg)
                
                if not self.continue_on_error:
                    self.aggregator.finish()
                    return PipelineResult(
                        success=False,
                        image=current_image,
                        progress_info=self.aggregator.get_summary(),
                        errors=errors,
                    )
        
        self.aggregator.finish()
        
        return PipelineResult(
            success=len(errors) == 0,
            image=current_image,
            progress_info=self.aggregator.get_summary(),
            errors=errors,
        )
    
    def _handle_step_progress(self, info: ProgressInfo):
        """Handle progress from individual step"""
        self.aggregator.update_progress(info)
        if self.on_progress:
            self.on_progress(info)
    
    def _adjust_params_for_preview(
        self,
        op_name: str,
        params: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Adjust parameters for faster preview processing.
        
        May reduce quality for speed in preview mode.
        """
        adjusted = params.copy()
        
        # Use faster methods in preview mode
        if op_name == "denoise":
            # Use bilateral instead of NLM for preview (faster)
            if adjusted.get("method") == "nlm":
                adjusted["method"] = "bilateral"
                adjusted["strength"] = min(adjusted.get("strength", 10), 10)
        
        return adjusted


def run_pipeline(
    image: np.ndarray,
    steps: List[Dict[str, Any]],
    on_progress: Optional[Callable[[ProgressInfo], None]] = None,
    continue_on_error: bool = False,
    preview_mode: bool = False,
) -> PipelineResult:
    """
    Convenience function to run preprocessing pipeline.
    
    Args:
        image: Input image as numpy array
        steps: List of step configurations [{op, params, enabled}, ...]
        on_progress: Optional callback for progress updates
        continue_on_error: If True, continue even if steps fail
        preview_mode: If True, use faster algorithms for preview
    
    Returns:
        PipelineResult with processed image and metadata
    
    Example:
        steps = [
            {"op": "grayscale", "params": {}, "enabled": True},
            {"op": "denoise", "params": {"method": "nlm", "strength": 10}, "enabled": True},
            {"op": "threshold", "params": {"method": "otsu"}, "enabled": True},
        ]
        
        result = run_pipeline(image, steps)
        if result.success:
            processed_image = result.image
    """
    executor = PipelineExecutor(
        on_progress=on_progress,
        continue_on_error=continue_on_error,
    )
    
    return executor.execute(image, steps, preview_mode=preview_mode)


def validate_pipeline_config(steps: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Validate pipeline configuration.
    
    Returns dict with 'valid' bool and 'errors' list.
    """
    errors = []
    
    if not isinstance(steps, list):
        return {"valid": False, "errors": ["Pipeline must be a list of steps"]}
    
    for i, step in enumerate(steps):
        if not isinstance(step, dict):
            errors.append(f"Step {i}: must be a dictionary")
            continue
        
        op = step.get("op")
        if not op:
            errors.append(f"Step {i}: missing 'op' field")
        elif op not in OP_REGISTRY:
            errors.append(f"Step {i}: unknown operation '{op}'")
        
        params = step.get("params")
        if params is not None and not isinstance(params, dict):
            errors.append(f"Step {i}: 'params' must be a dictionary")
    
    return {
        "valid": len(errors) == 0,
        "errors": errors,
    }
