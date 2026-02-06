"""
Progress Callback Utilities for Preprocessing Pipeline

Provides helpers for reporting progress during preprocessing operations.
"""

from typing import Callable, Optional, Dict, Any
from dataclasses import dataclass, field
import time


@dataclass
class ProgressInfo:
    """Information about current progress state"""
    step: str
    percent: float
    message: str = ""
    step_index: int = 0
    total_steps: int = 0
    elapsed_ms: int = 0


class ProgressCallback:
    """
    Progress callback handler for preprocessing operations.
    
    Tracks progress within individual operations and across the entire pipeline.
    """
    
    def __init__(
        self,
        on_progress: Optional[Callable[[ProgressInfo], None]] = None,
        step_name: str = "",
        step_index: int = 0,
        total_steps: int = 1,
    ):
        self.on_progress = on_progress
        self.step_name = step_name
        self.step_index = step_index
        self.total_steps = total_steps
        self.start_time = time.time()
        self._history: list[ProgressInfo] = []
    
    def __call__(self, percent: float, message: str = ""):
        """
        Report progress for current operation.
        
        Args:
            percent: Progress percentage (0.0 to 1.0) within current operation
            message: Optional status message
        """
        elapsed_ms = int((time.time() - self.start_time) * 1000)
        
        # Calculate overall progress
        # Each step contributes equally to total progress
        step_contribution = 1.0 / self.total_steps if self.total_steps > 0 else 1.0
        overall_percent = (self.step_index + percent) * step_contribution * 100
        
        info = ProgressInfo(
            step=self.step_name,
            percent=min(100, max(0, overall_percent)),
            message=message,
            step_index=self.step_index,
            total_steps=self.total_steps,
            elapsed_ms=elapsed_ms,
        )
        
        self._history.append(info)
        
        if self.on_progress:
            self.on_progress(info)
    
    def get_history(self) -> list[ProgressInfo]:
        """Get progress history"""
        return self._history.copy()


def create_progress_callback(
    on_progress: Optional[Callable[[ProgressInfo], None]] = None,
    step_name: str = "",
    step_index: int = 0,
    total_steps: int = 1,
) -> ProgressCallback:
    """
    Factory function to create a progress callback.
    
    Args:
        on_progress: Callback function to receive progress updates
        step_name: Name of the current operation/step
        step_index: Index of current step in pipeline (0-based)
        total_steps: Total number of steps in pipeline
    
    Returns:
        ProgressCallback instance
    """
    return ProgressCallback(
        on_progress=on_progress,
        step_name=step_name,
        step_index=step_index,
        total_steps=total_steps,
    )


class ProgressAggregator:
    """
    Aggregates progress from multiple pipeline steps.
    
    Collects timing and progress info for reporting.
    """
    
    def __init__(self):
        self.steps: list[Dict[str, Any]] = []
        self.start_time: Optional[float] = None
        self.end_time: Optional[float] = None
        self.current_step: Optional[str] = None
        self.current_percent: float = 0
    
    def start(self):
        """Mark pipeline start"""
        self.start_time = time.time()
        self.steps = []
    
    def step_started(self, step_name: str, index: int, total: int):
        """Mark step started"""
        self.current_step = step_name
        self.steps.append({
            "step": step_name,
            "index": index,
            "total": total,
            "start_time": time.time(),
            "end_time": None,
            "duration_ms": None,
            "success": None,
            "error": None,
        })
    
    def step_completed(self, success: bool = True, error: Optional[str] = None):
        """Mark current step completed"""
        if self.steps:
            step = self.steps[-1]
            step["end_time"] = time.time()
            step["duration_ms"] = int((step["end_time"] - step["start_time"]) * 1000)
            step["success"] = success
            step["error"] = error
    
    def update_progress(self, info: ProgressInfo):
        """Handle progress update from callback"""
        self.current_step = info.step
        self.current_percent = info.percent
    
    def finish(self):
        """Mark pipeline finished"""
        self.end_time = time.time()
    
    def get_summary(self) -> Dict[str, Any]:
        """Get progress summary for API response"""
        total_ms = 0
        if self.start_time and self.end_time:
            total_ms = int((self.end_time - self.start_time) * 1000)
        
        return {
            "total_duration_ms": total_ms,
            "steps": [
                {
                    "step": s["step"],
                    "duration_ms": s["duration_ms"],
                    "success": s["success"],
                    "error": s["error"],
                }
                for s in self.steps
            ],
            "final_percent": self.current_percent,
        }
