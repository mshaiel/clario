
/**
 * useRecordingTimer Hook
 * Consolidates duplicate timer logic into one file.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

interface UseRecordingTimerProps {
  duration?: number;
  onTimeUp?: () => void;
  onTick?: (remainingTime: number) => void;
}

export function useRecordingTimer({
  duration = 12,
  onTimeUp,
  onTick
}: UseRecordingTimerProps = {}) {
  const [remainingTime, setRemainingTime] = useState<number>(duration);
  const [isActive, setIsActive] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startTimer = useCallback(() => {
    if (isActive) return;
    
    setIsActive(true);
    setRemainingTime(duration);
    
    timerRef.current = setInterval(() => {
      setRemainingTime(prev => {
        const newTime = prev - 1;
        
        onTick?.(newTime);
        
        if (newTime <= 0) {
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          setIsActive(false);
          onTimeUp?.();
          return 0;
        }
        
        return newTime;
      });
    }, 1000);
  }, [duration, isActive, onTimeUp, onTick]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsActive(false);
  }, []);

  const resetTimer = useCallback(() => {
    stopTimer();
    setRemainingTime(duration);
  }, [stopTimer, duration]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  return {
    remainingTime,
    isActive,
    startTimer,
    stopTimer,
    resetTimer,
    progress: (duration - remainingTime) / duration,
  };
}
