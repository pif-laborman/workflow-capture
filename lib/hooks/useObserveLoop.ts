'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { ObserveRequest, ObserveResponse } from '@/lib/types';
import { getObservePrompt } from '@/lib/storage';

const FRAME_HISTORY_SIZE = 3;
/** Background poll interval for proactive questions during silence (ms) */
const PROACTIVE_POLL_MS = 2000;
/** Minimum seconds of silence before the background poll fires an observe call */
const PROACTIVE_SILENCE_THRESHOLD = 6;
/** Minimum cooldown between any two observe calls (ms) */
const MIN_OBSERVE_GAP_MS = 2000;
/** Grace period at session start: no proactive polls (ms) */
const WARMUP_GRACE_MS = 15000;
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

/** Debounce delay after a question (fast response) */
const QUESTION_DEBOUNCE_MS = 300;
/** Debounce delay after answering Claude's question (faster than proactive, slower than question) */
const REPLY_DEBOUNCE_MS = 2000;

/** Relative timestamp for structured logging */
let sessionStartMs = 0;
function t(): string {
  if (!sessionStartMs) return '[0.0s]';
  return `[${((Date.now() - sessionStartMs) / 1000).toFixed(1)}s]`;
}

export interface UseObserveLoopOptions {
  /** Whether recording is currently active */
  isRecording: boolean;
  /** Get the latest frame base64 string (from frame sampler) */
  getLatestFrame: () => string | null;
  /** Get transcript window text (from event log) */
  getTranscriptWindow: (lastNSeconds: number) => string;
  /** TTS speak function. Returns true if completed naturally, false if cancelled. */
  speak: (text: string) => Promise<boolean>;
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
    if (inFlightRef.current) {
      console.log(`${t()} observe: skipped (in flight) trigger=${trigger}`);
      return;
    }

    const opts = optionsRef.current;
    const frame = opts.getLatestFrame();
    if (!frame) return;

    const now = Date.now();
    const gapMs = now - lastObserveTimeRef.current;
    if (gapMs < MIN_OBSERVE_GAP_MS) {
      if (trigger === 'utterance_end') {
        console.log(`${t()} ${trigger}: skipped (gap ${gapMs}ms < ${MIN_OBSERVE_GAP_MS}ms)`);
      }
      return;
    }

    const transcriptWindow = opts.getTranscriptWindow(120);
    const secondsSilent = Math.floor((now - lastTranscriptGrowthRef.current) / 1000);
    const secSinceSpoke = lastSpeakTimeRef.current === 0
      ? 9999
      : Math.floor((now - lastSpeakTimeRef.current) / 1000);

    // Post-speak cooldown for utterance_end: don't fire right after Claude spoke or was interrupted
    if (trigger === 'utterance_end' && secSinceSpoke < 4) {
      console.log(`${t()} utterance_end: skipped (spoke ${secSinceSpoke}s ago, need 4s)`);
      return;
    }

    // Proactive poll guards
    if (trigger === 'proactive') {
      const sessionAge = now - sessionStartMs;
      if (sessionAge < WARMUP_GRACE_MS) return;
      if (secondsSilent < PROACTIVE_SILENCE_THRESHOLD) return;
      if (secSinceSpoke < 6) {
        console.log(`${t()} proactive: skipped (spoke ${secSinceSpoke}s ago, need 6s)`);
        return;
      }
      if (transcriptWindow.length === knownTranscriptLengthRef.current) {
        console.log(`${t()} proactive: skipped (no new transcript)`);
        return;
      }
    }

    knownTranscriptLengthRef.current = transcriptWindow.length;
    const userAskedDirectly = isUserAskingQuestion(transcriptWindow);

    console.log(`${t()} observe: firing trigger=${trigger} silent=${secondsSilent}s spoke=${secSinceSpoke}s direct=${userAskedDirectly} transcript=${transcriptWindow.length}ch`);

    // Track frame history
    const history = frameHistoryRef.current;
    history.push(frame);
    if (history.length > FRAME_HISTORY_SIZE) {
      history.shift();
    }

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
    const apiStart = Date.now();

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

    const apiMs = Date.now() - apiStart;

    if (!data) {
      console.log(`${t()} observe: API failed after ${apiMs}ms (${retries} retries)`);
      inFlightRef.current = false;
      return;
    }

    setObserveCallCount((c) => c + 1);
    console.log(`${t()} observe: API ${apiMs}ms speak=${data.speak} "${data.message?.slice(0, 50)}"`);

    if (data.speak && data.message) {
      setSpeakCount((c) => c + 1);
      opts.addInterjection(data.message, data.reason, Date.now());
      const ttsStart = Date.now();
      try {
        const completed = await opts.speak(data.message);
        const ttsMs = Date.now() - ttsStart;
        if (completed) {
          console.log(`${t()} tts: completed ${ttsMs}ms`);
          lastSpeakTimeRef.current = Date.now();
        } else {
          console.log(`${t()} tts: cancelled (user speaking) after ${ttsMs}ms`);
          lastSpeakTimeRef.current = Date.now();
          lastTranscriptGrowthRef.current = Date.now();
          // Clear any pending debounce timer from before the interruption
          if (speechEndTimerRef.current) {
            clearTimeout(speechEndTimerRef.current);
            speechEndTimerRef.current = null;
          }
        }
      } catch {
        console.log(`${t()} tts: error after ${Date.now() - ttsStart}ms`);
      }
    } else {
      setSilentCount((c) => c + 1);
    }

    inFlightRef.current = false;
  }, []);

  /**
   * Called on each final transcript chunk. Sets debounce timers based on context.
   */
  const noteTranscriptArrival = useCallback((chunkText: string) => {
    lastTranscriptGrowthRef.current = Date.now();
    if (speechEndTimerRef.current) {
      clearTimeout(speechEndTimerRef.current);
      speechEndTimerRef.current = null;
    }

    const preview = chunkText.trim().slice(0, 60);
    const isQuestion = chunkText.trim().endsWith('?');
    if (isQuestion) {
      console.log(`${t()} debounce: question detected "${preview}", ${QUESTION_DEBOUNCE_MS}ms timer`);
      speechEndTimerRef.current = setTimeout(() => {
        fireObserve('utterance_end');
      }, QUESTION_DEBOUNCE_MS);
      return;
    }

    // Check if replying to Claude's last question.
    // Only counts as a reply if this is the first or second user chunk
    // after Claude spoke. Beyond that, the user has moved on to narrating.
    const transcript = optionsRef.current.getTranscriptWindow(120);
    const lines = transcript.split('\n');
    const lastClaudeIdx = lines.findLastIndex((l) => l.startsWith('[CLAUDE]'));
    if (lastClaudeIdx >= 0) {
      const userLinesAfterClaude = lines.slice(lastClaudeIdx + 1).filter((l) => l.startsWith('[USER]'));
      if (userLinesAfterClaude.length <= 2) {
        console.log(`${t()} debounce: reply detected (${userLinesAfterClaude.length} chunks after Claude), ${REPLY_DEBOUNCE_MS}ms timer`);
        speechEndTimerRef.current = setTimeout(() => {
          fireObserve('utterance_end');
        }, REPLY_DEBOUNCE_MS);
        return;
      }
    }
    // Narration: no timer, proactive poll handles it
    console.log(`${t()} transcript: narration "${preview}" (no trigger)`);
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
    sessionStartMs = Date.now();
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
