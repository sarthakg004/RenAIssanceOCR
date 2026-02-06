import { useState, useEffect, useCallback } from 'react';
import { Clock, Check } from 'lucide-react';
import { getRateLimitStatus } from '../services/geminiApi';

/**
 * RateLimitTimer Component
 * Shows countdown for rate limit with visual progress
 */
export default function RateLimitTimer({ onReady, pollInterval = 1000 }) {
  const [waitSeconds, setWaitSeconds] = useState(0);
  const [isReady, setIsReady] = useState(true);

  const checkStatus = useCallback(async () => {
    try {
      const status = await getRateLimitStatus();
      setIsReady(status.ready);
      setWaitSeconds(Math.ceil(status.wait_seconds || 0));
      if (status.ready && onReady) {
        onReady();
      }
    } catch (error) {
      // Backend not available, assume ready
      setIsReady(true);
      setWaitSeconds(0);
    }
  }, [onReady]);

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, pollInterval);
    return () => clearInterval(interval);
  }, [checkStatus, pollInterval]);

  // Local countdown for smoother display
  useEffect(() => {
    if (waitSeconds > 0) {
      const timer = setTimeout(() => {
        setWaitSeconds((prev) => Math.max(0, prev - 1));
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [waitSeconds]);

  if (isReady && waitSeconds === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-green-100 text-green-700 rounded-lg text-sm">
        <Check size={16} />
        <span>Ready to process</span>
      </div>
    );
  }

  const progress = ((20 - waitSeconds) / 20) * 100;

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-amber-50 border border-amber-200 rounded-lg">
      <Clock size={18} className="text-amber-600 animate-pulse" />
      <div className="flex-1">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm text-amber-800">Rate limit cooldown</span>
          <span className="text-sm font-medium text-amber-700">
            {waitSeconds}s
          </span>
        </div>
        <div className="h-1.5 bg-amber-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-amber-500 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}
