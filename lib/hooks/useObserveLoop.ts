'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { ObserveRequest, ObserveResponse } from '@/lib/types';
import { getObservePrompt } from '@/lib/storage';

const FRAME_HISTORY_SIZE = 3;
/** Background poll interval for proactive questions during long silence (ms) */
const PROACTIVE_POLL_MS = 18000;
/** Minimum seconds of silence before the background poll fires an observe call */
const PROACTIVE_SILENCE_THRESHOLD = 12;
/** Minimum cooldown between any two observe calls (ms) */
const MIN_OBSERVE_GAP_MS = 3000;
/** Max retries on API error before giving up for this turn */
const MAX_RETRIES = 2;
/** Retry delay base (ms), doubled each retry */
const RETRY_DELAY_MS = 1000;

/** Patterns that indicate the user is talking directly to Claude */
const DIRECT_QUESTION_PATTERNS = [
  /any\s*questions/i,
  /do\s*you\s*(have|see|notice|think)/i,
  /what\s*do\s*you\s*think/i,
  /does\s*that\s*make\s*sense/i,
  /anything\s*(else|unclear|you\s*want)/i,
  /is\s*that\s*clear/i,
  /can\s*you\s*(see|tell|explain)/i,
  /your\s*thoughts/i,
  /\bclaude\b/i,
  /what\s*should\s*i/i,
  /am\s*i\s*missing/i,
];

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
  /** Register for utterance-end events from Deepgram */
  onUtteranceEnd: (cb: () => void) => void;
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
  const inFlightRef = useRef(false);
  const frameHistoryRef = useRef<string[]>([]);
  const lastObserveTimeRef = useRef(0);
  const lastTranscriptLengthRef = useRef(0);
  const lastTranscriptChangeTimeRef = useRef(Date.now());
  const proactiveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  /**
   * Core observe call. Sends frame + transcript to Claude and handles response.
   * `trigger` indicates what caused the call (for logging/tuning).
   */
  const fireObserve = useCallback(async (trigger: 'utterance_end' | 'proactive') => {
    // Don't stack concurrent requests
    if (inFlightRef.current) return;

    const opts = optionsRef.current;
    const frame = opts.getLatestFrame();
    if (!frame) return;

    const now = Date.now();

    // Enforce minimum gap between calls
    if (now - lastObserveTimeRef.current < MIN_OBSERVE_GAP_MS) return;

    const transcriptWindow = opts.getTranscriptWindow(120);

    // For proactive polls: only fire if user has been genuinely silent
    if (trigger === 'proactive') {
      const secondsSilent = Math.floor((now - lastTranscriptChangeTimeRef.current) / 1000);
      if (secondsSilent < PROACTIVE_SILENCE_THRESHOLD) return;
    }

    // Track transcript changes for silence detection
    if (transcriptWindow.length !== lastTranscriptLengthRef.current) {
      lastTranscriptLengthRef.current = transcriptWindow.length;
      lastTranscriptChangeTimeRef.current = now;
    }

    const secondsSilent = Math.floor((now - lastTranscriptChangeTimeRef.current) / 1000);
    const lastChunk = transcriptWindow.slice(-200);
    const userAskedDirectly = DIRECT_QUESTION_PATTERNS.some((p) => p.test(lastChunk));

    // Track frame history
    const history = frameHistoryRef.current;
    history.push(frame);
    if (history.length > FRAME_HISTORY_SIZE) {
      history.shift();
    }

    const prevFrames = history.slice(0, -1);
    const secondsSinceLastObserve = lastObserveTimeRef.current === 0
      ? 9999
      : Math.floor((now - lastObserveTimeRef.current) / 1000);

    const customPrompt = getObservePrompt();
    const body: ObserveRequest = {
      frame,
      previous_frames: prevFrames.length > 0 ? prevFrames : undefined,
      transcript_window: transcriptWindow,
      seconds_since_last_interjection: secondsSinceLastObserve,
      seconds_silent: secondsSilent,
      previous_interjections: opts.getPreviousInterjections(),
      ...(customPrompt ? { system_prompt: customPrompt } : {}),
      ...(userAskedDirectly ? { user_asked_directly: true } : {}),
    };

    inFlightRef.current = true;
    lastObserveTimeRef.current = now;

    let retries = 0;
    let data: ObserveResponse | null = null;

    while (retries <= MAX_RETRIES) {
      try {
        const res = await fetch('/api/observe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          console.error(`Observe API error: ${res.status} (attempt ${retries + 1})`);
          retries++;
          if (retries <= MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * retries));
          }
          continue;
        }

        data = await res.json();
        break;
      } catch (err) {
        console.error(`Observe fetch error (attempt ${retries + 1}):`, err);
        retries++;
        if (retries <= MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * retries));
        }
      }
    }

    if (!data) {
      inFlightRef.current = false;
      return;
    }

    setObserveCallCount((c) => c + 1);

    if (data.speak && data.message) {
      setSpeakCount((c) => c + 1);
      opts.addInterjection(data.message, data.reason, Date.now());
      try {
        await opts.speak(data.message);
      } catch (err) {
        console.error('TTS error during interjection:', err);
      }
    } else {
      setSilentCount((c) => c + 1);
    }

    inFlightRef.current = false;
  }, []);

  // Wire up utterance-end trigger
  useEffect(() => {
    if (!options.isRecording) return;
    options.onUtteranceEnd(() => {
      fireObserve('utterance_end');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.isRecording, options.onUtteranceEnd, fireObserve]);

  // Background proactive poll for long silences
  useEffect(() => {
    if (!options.isRecording) {
      if (proactiveTimerRef.current !== null) {
        clearInterval(proactiveTimerRef.current);
        proactiveTimerRef.current = null;
      }
      return;
    }

    // Reset state for new recording
    setObserveCallCount(0);
    setSpeakCount(0);
    setSilentCount(0);
    inFlightRef.current = false;
    frameHistoryRef.current = [];
    lastObserveTimeRef.current = 0;
    lastTranscriptLengthRef.current = 0;
    lastTranscriptChangeTimeRef.current = Date.now();

    proactiveTimerRef.current = setInterval(() => {
      fireObserve('proactive');
    }, PROACTIVE_POLL_MS);

    return () => {
      if (proactiveTimerRef.current !== null) {
        clearInterval(proactiveTimerRef.current);
        proactiveTimerRef.current = null;
      }
    };
  }, [options.isRecording, fireObserve]);

  return { observeCallCount, speakCount, silentCount };
}
