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
const MIN_OBSERVE_GAP_MS = 2000;
/** Max retries on API error before giving up for this turn */
const MAX_RETRIES = 1;
/** Retry delay (ms) */
const RETRY_DELAY_MS = 1000;

/** Check if the user's last utterance is a question (ends with ?) */
function isUserAskingQuestion(transcriptWindow: string): boolean {
  const userLines = transcriptWindow.split('\n').filter((l) => l.startsWith('[USER]'));
  if (userLines.length === 0) return false;
  const lastLine = userLines[userLines.length - 1].trim();
  return lastLine.endsWith('?');
}

/** Debounce delay after narration (longer to avoid interrupting) */
const NARRATION_DEBOUNCE_MS = 2500;
/** Debounce delay after a question (shorter for quick response) */
const QUESTION_DEBOUNCE_MS = 300;

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
  /** Call when new transcript arrives (resets debounce timer + silence tracking) */
  noteTranscriptArrival: (chunkText: string) => void;
}

export function useObserveLoop(options: UseObserveLoopOptions): UseObserveLoopReturn {
  const [observeCallCount, setObserveCallCount] = useState(0);
  const [speakCount, setSpeakCount] = useState(0);
  const [silentCount, setSilentCount] = useState(0);
  const inFlightRef = useRef(false);
  const frameHistoryRef = useRef<string[]>([]);
  const lastObserveTimeRef = useRef(0);
  const lastSpeakTimeRef = useRef(0);
  // Track transcript length independently so we can detect silence
  // without resetting on every observe call
  const knownTranscriptLengthRef = useRef(0);
  const lastTranscriptGrowthRef = useRef(Date.now());
  const proactiveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speechEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  /**
   * Core observe call. Sends frame + transcript to Claude and handles response.
   */
  const fireObserve = useCallback(async (trigger: 'utterance_end' | 'proactive') => {
    console.log(`[observe] fireObserve trigger=${trigger}`);
    if (inFlightRef.current) { console.log('[observe] skipped: in flight'); return; }

    const opts = optionsRef.current;
    const frame = opts.getLatestFrame();
    if (!frame) { console.log('[observe] skipped: no frame'); return; }

    const now = Date.now();

    // Enforce minimum gap between calls
    if (now - lastObserveTimeRef.current < MIN_OBSERVE_GAP_MS) return;

    const transcriptWindow = opts.getTranscriptWindow(120);
    const transcriptLenAtCallStart = transcriptWindow.length;
    console.log(`[observe] transcript=${transcriptLenAtCallStart}ch: "${transcriptWindow.slice(-150)}"`);

    // Silence = time since last transcript growth (tracked externally)
    const secondsSilent = Math.floor((now - lastTranscriptGrowthRef.current) / 1000);

    // For proactive polls: only fire if user has been genuinely silent
    // AND Claude hasn't spoken in the last 5s (avoids TTS collision)
    if (trigger === 'proactive') {
      if (secondsSilent < PROACTIVE_SILENCE_THRESHOLD) return;
      const secSinceSpoke = lastSpeakTimeRef.current === 0
        ? 9999
        : Math.floor((now - lastSpeakTimeRef.current) / 1000);
      if (secSinceSpoke < 5) return;
    }

    // Update known length (for external tracking, not silence calc)
    knownTranscriptLengthRef.current = transcriptWindow.length;

    const userAskedDirectly = isUserAskingQuestion(transcriptWindow);

    // Track frame history
    const history = frameHistoryRef.current;
    history.push(frame);
    if (history.length > FRAME_HISTORY_SIZE) {
      history.shift();
    }

    // For direct questions, skip previous frames to reduce API latency
    const prevFrames = userAskedDirectly ? [] : history.slice(0, -1);
    const secondsSinceLastInterjection = lastSpeakTimeRef.current === 0
      ? 9999
      : Math.floor((now - lastSpeakTimeRef.current) / 1000);

    const customPrompt = getObservePrompt();
    const body: ObserveRequest = {
      frame,
      previous_frames: prevFrames.length > 0 ? prevFrames : undefined,
      transcript_window: transcriptWindow,
      seconds_since_last_interjection: secondsSinceLastInterjection,
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
          retries++;
          if (retries <= MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          }
          continue;
        }

        data = await res.json();
        break;
      } catch {
        retries++;
        if (retries <= MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        }
      }
    }

    if (!data) {
      inFlightRef.current = false;
      return;
    }

    setObserveCallCount((c) => c + 1);
    console.log(`[observe] response: speak=${data.speak} message="${data.message?.slice(0, 60)}"`);

    if (data.speak && data.message) {
      setSpeakCount((c) => c + 1);
      lastSpeakTimeRef.current = Date.now();
      // Always add to event log (visible as text in feed)
      opts.addInterjection(data.message, data.reason, Date.now());

      // Staleness check: has the user spoken since we started this call?
      // If so, they may have already answered; show as text only, skip audio.
      const currentLen = opts.getTranscriptWindow(120).length;
      if (currentLen > transcriptLenAtCallStart) {
        console.log('[observe] user spoke during API call, skipping TTS (text only)');
      } else {
        try {
          await opts.speak(data.message);
        } catch {
          // TTS failed; interjection already logged in event log
        }
      }
    } else {
      setSilentCount((c) => c + 1);
    }

    inFlightRef.current = false;
  }, []);

  /**
   * Called on each final transcript chunk. Resets a debounce timer:
   * if no new transcript arrives within SPEECH_END_DEBOUNCE_MS,
   * fires the observe call (user finished speaking).
   */
  const noteTranscriptArrival = useCallback((chunkText: string) => {
    lastTranscriptGrowthRef.current = Date.now();
    // Clear existing timer
    if (speechEndTimerRef.current) {
      clearTimeout(speechEndTimerRef.current);
    }
    // Questions get near-instant response; narration gets longer delay to avoid interrupting
    const isQuestion = chunkText.trim().endsWith('?');
    const delay = isQuestion ? QUESTION_DEBOUNCE_MS : NARRATION_DEBOUNCE_MS;
    speechEndTimerRef.current = setTimeout(() => {
      fireObserve('utterance_end');
    }, delay);
  }, [fireObserve]);

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
    lastSpeakTimeRef.current = 0;
    knownTranscriptLengthRef.current = 0;
    lastTranscriptGrowthRef.current = Date.now();

    proactiveTimerRef.current = setInterval(() => {
      fireObserve('proactive');
    }, PROACTIVE_POLL_MS);

    return () => {
      if (proactiveTimerRef.current !== null) {
        clearInterval(proactiveTimerRef.current);
        proactiveTimerRef.current = null;
      }
      if (speechEndTimerRef.current !== null) {
        clearTimeout(speechEndTimerRef.current);
        speechEndTimerRef.current = null;
      }
    };
  }, [options.isRecording, fireObserve]);

  return { observeCallCount, speakCount, silentCount, noteTranscriptArrival };
}
