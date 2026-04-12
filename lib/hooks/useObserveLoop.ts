'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { OBSERVE_INTERVAL_MS } from '@/lib/constants';
import { ObserveRequest, ObserveResponse } from '@/lib/types';
import { getObservePrompt } from '@/lib/storage';

const FRAME_HISTORY_SIZE = 3;

export interface UseObserveLoopOptions {
  /** Whether recording is currently active */
  isRecording: boolean;
  /** Get the latest frame base64 string (from frame sampler) */
  getLatestFrame: () => string | null;
  /** Get transcript window text (from event log) */
  getTranscriptWindow: (lastNSeconds: number) => string;
  /** TTS speak function - returns promise that resolves when speech ends */
  speak: (text: string) => Promise<void>;
  /** Add interjection to event log */
  addInterjection: (message: string, reason: string, timestamp_ms: number) => void;
  /** Get all previous interjection messages */
  getPreviousInterjections: () => string[];
}

export interface UseObserveLoopReturn {
  /** Number of observe API calls made this session */
  observeCallCount: number;
  /** Number of times Claude chose to speak */
  speakCount: number;
  /** Number of times Claude chose silence */
  silentCount: number;
}

export function useObserveLoop(options: UseObserveLoopOptions): UseObserveLoopReturn {
  const [observeCallCount, setObserveCallCount] = useState(0);
  const [speakCount, setSpeakCount] = useState(0);
  const [silentCount, setSilentCount] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastInterjectionTimeRef = useRef<number>(0);
  const inFlightRef = useRef(false);
  const frameHistoryRef = useRef<string[]>([]);
  const lastTranscriptLengthRef = useRef(0);
  const lastTranscriptChangeTimeRef = useRef(Date.now());
  const silenceStartFrameRef = useRef<string | null>(null);
  const wasUserSpeakingRef = useRef(false);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const tick = useCallback(async () => {
    // Skip if a previous request is still in flight
    if (inFlightRef.current) return;

    const opts = optionsRef.current;
    const frame = opts.getLatestFrame();
    if (!frame) return;

    const now = Date.now();

    const transcriptWindow = opts.getTranscriptWindow(120);

    // Silence detection: track how long since transcript grew
    const isUserSpeaking = transcriptWindow.length !== lastTranscriptLengthRef.current;
    if (isUserSpeaking) {
      lastTranscriptLengthRef.current = transcriptWindow.length;
      lastTranscriptChangeTimeRef.current = now;
      wasUserSpeakingRef.current = true;
      silenceStartFrameRef.current = null; // reset; will capture on next silent tick
    }
    const secondsSilent = Math.floor((now - lastTranscriptChangeTimeRef.current) / 1000);

    // Don't interrupt the user: only observe when they've paused for 3+ seconds
    if (secondsSilent < 3) return;

    // Capture the frame at the moment silence began (first tick after speech stops)
    if (wasUserSpeakingRef.current && !silenceStartFrameRef.current) {
      silenceStartFrameRef.current = frame;
      wasUserSpeakingRef.current = false;
    }

    const msSinceLastInterjection = lastInterjectionTimeRef.current === 0
      ? 999999
      : now - lastInterjectionTimeRef.current;

    // Track frame history (keep last N frames)
    const history = frameHistoryRef.current;
    history.push(frame);
    if (history.length > FRAME_HISTORY_SIZE) {
      history.shift();
    }

    const secondsSinceLastInterjection = lastInterjectionTimeRef.current === 0
      ? 9999
      : Math.floor(msSinceLastInterjection / 1000);

    // Build previous frames: silence-start frame first, then recent history
    const prevFrames: string[] = [];
    if (silenceStartFrameRef.current && silenceStartFrameRef.current !== frame) {
      prevFrames.push(silenceStartFrameRef.current);
    }
    for (const h of history.slice(0, -1)) {
      if (h !== silenceStartFrameRef.current) {
        prevFrames.push(h);
      }
    }

    const customPrompt = getObservePrompt();
    const body: ObserveRequest = {
      frame,
      previous_frames: prevFrames.length > 0 ? prevFrames : undefined,
      transcript_window: transcriptWindow,
      seconds_since_last_interjection: secondsSinceLastInterjection,
      seconds_silent: secondsSilent,
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
        // Pre-play check: has the user started speaking since we made the API call?
        const currentTranscript = opts.getTranscriptWindow(120);
        if (currentTranscript.length !== transcriptWindow.length) {
          // User started talking while we were waiting for Claude. Skip this interjection.
          setSilentCount((c) => c + 1);
        } else {
          // Brief pause to let Deepgram catch up, then re-check
          await new Promise((r) => setTimeout(r, 500));
          const recheckTranscript = opts.getTranscriptWindow(120);
          if (recheckTranscript.length !== transcriptWindow.length) {
            // User started talking during the pause. Skip.
            setSilentCount((c) => c + 1);
          } else {
            setSpeakCount((c) => c + 1);
            lastInterjectionTimeRef.current = Date.now();
            opts.addInterjection(data.message, data.reason, Date.now());
            try {
              await opts.speak(data.message);
            } catch (err) {
              console.error('TTS error during interjection:', err);
            }
          }
        }
      } else {
        setSilentCount((c) => c + 1);
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
    setSpeakCount(0);
    setSilentCount(0);
    lastInterjectionTimeRef.current = 0;
    inFlightRef.current = false;
    frameHistoryRef.current = [];
    lastTranscriptLengthRef.current = 0;
    silenceStartFrameRef.current = null;
    wasUserSpeakingRef.current = false;
    // Start with silence timer already past the gate so the first observe can fire
    // (the intro TTS plays during this window anyway)
    lastTranscriptChangeTimeRef.current = Date.now() - 10000;

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

  return { observeCallCount, speakCount, silentCount };
}
