'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { OBSERVE_INTERVAL_MS } from '@/lib/constants';
import { ObserveRequest, ObserveResponse } from '@/lib/types';
import { getObservePrompt } from '@/lib/storage';

export interface UseObserveLoopOptions {
  /** Whether recording is currently active */
  isRecording: boolean;
  /** Get the latest frame base64 string (from frame sampler) */
  getLatestFrame: () => string | null;
  /** Get transcript window text (from event log) */
  getTranscriptWindow: (lastNSeconds: number) => string;
  /** TTS speak function - returns promise that resolves when speech ends */
  speak: (text: string) => Promise<void>;
  /** Pause speech recognition during TTS */
  pauseRecognition: () => void;
  /** Resume speech recognition after TTS */
  resumeRecognition: () => void;
  /** Add interjection to event log */
  addInterjection: (message: string, reason: string, timestamp_ms: number) => void;
  /** Get all previous interjection messages */
  getPreviousInterjections: () => string[];
}

export interface UseObserveLoopReturn {
  /** Number of observe API calls made this session */
  observeCallCount: number;
}

export function useObserveLoop(options: UseObserveLoopOptions): UseObserveLoopReturn {
  const [observeCallCount, setObserveCallCount] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastInterjectionTimeRef = useRef<number>(0);
  const inFlightRef = useRef(false);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const tick = useCallback(async () => {
    // Skip if a previous request is still in flight
    if (inFlightRef.current) return;

    const opts = optionsRef.current;
    const frame = opts.getLatestFrame();
    if (!frame) return;

    const transcriptWindow = opts.getTranscriptWindow(120);
    const now = Date.now();
    const secondsSinceLastInterjection = lastInterjectionTimeRef.current === 0
      ? 9999
      : Math.floor((now - lastInterjectionTimeRef.current) / 1000);

    const customPrompt = getObservePrompt();
    const body: ObserveRequest = {
      frame,
      transcript_window: transcriptWindow,
      seconds_since_last_interjection: secondsSinceLastInterjection,
      previous_interjections: opts.getPreviousInterjections(),
      ...(customPrompt ? { system_prompt: customPrompt } : {}),
    };

    inFlightRef.current = true;

    try {
      const res = await fetch('/api/observe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        console.error(`Observe API error: ${res.status}`);
        return;
      }

      const data: ObserveResponse = await res.json();
      setObserveCallCount((c) => c + 1);

      if (data.speak && data.message) {
        lastInterjectionTimeRef.current = Date.now();
        opts.addInterjection(data.message, data.reason, Date.now());
        opts.pauseRecognition();
        try {
          await opts.speak(data.message);
        } catch (err) {
          console.error('TTS error during interjection:', err);
        }
        opts.resumeRecognition();
      }
    } catch (err) {
      console.error('Observe loop fetch error:', err);
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!options.isRecording) {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Reset state for new recording
    setObserveCallCount(0);
    lastInterjectionTimeRef.current = 0;
    inFlightRef.current = false;

    intervalRef.current = setInterval(() => {
      tick();
    }, OBSERVE_INTERVAL_MS);

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [options.isRecording, tick]);

  return { observeCallCount };
}
