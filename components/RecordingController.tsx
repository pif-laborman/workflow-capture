'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { AppState } from '@/lib/types';
import { useAppState } from '@/lib/state';
import { useMediaCapture } from '@/lib/hooks/useMediaCapture';
import { useFrameSampler } from '@/lib/hooks/useFrameSampler';
import { useSpeechRecognition } from '@/lib/hooks/useSpeechRecognition';
import { useTTS } from '@/lib/hooks/useTTS';
import { useEventLog } from '@/lib/hooks/useEventLog';
import { useObserveLoop } from '@/lib/hooks/useObserveLoop';
import RecordingScreen from './RecordingScreen';
import type { Interjection, CapturedFrame } from './RecordingScreen';
import type { InterjectionPayload, FramePayload } from '@/lib/hooks/useEventLog';
import { EventType } from '@/lib/types';

const COUNTDOWN_HINTS: Record<number, string> = {
  3: 'Switch to the tab you want to record',
  2: 'Start talking when you see the red dot',
  1: 'Say what you do and why as you go',
};

/** Short beep via Web Audio API. Final tick is higher pitch. */
async function playCountdownBeep(isFinal: boolean) {
  try {
    const ctx = new AudioContext();
    // Chrome requires explicit resume after user gesture
    if (ctx.state === 'suspended') await ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = isFinal ? 880 : 660;
    gain.gain.value = 0.15;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.stop(ctx.currentTime + 0.15);
    setTimeout(() => ctx.close(), 300);
  } catch {
    // Audio context unavailable; skip beep
  }
}

export default function RecordingController() {
  const { currentState, setState, sessionData, setSessionData } = useAppState();
  const startedRef = useRef(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  // Core hooks
  const mediaCapture = useMediaCapture();
  const speechRecognition = useSpeechRecognition();
  const tts = useTTS();
  const eventLog = useEventLog();

  // Refs for transcript sync (declared here, effect after observe loop)
  const addTranscriptRef = useRef(eventLog.addTranscript);
  addTranscriptRef.current = eventLog.addTranscript;

  // Interrupt: cancel TTS when user starts speaking (watch both interim and final)
  const prevChunkCountRef = useRef(0);
  const prevInterimRef = useRef('');
  useEffect(() => {
    if (!tts.isSpeaking) {
      prevChunkCountRef.current = speechRecognition.transcriptChunks.length;
      prevInterimRef.current = speechRecognition.interimText;
      return;
    }
    // Check final chunks
    const currentCount = speechRecognition.transcriptChunks.length;
    if (currentCount > prevChunkCountRef.current) {
      tts.cancel();
      prevChunkCountRef.current = currentCount;
      return;
    }
    // Check interim text (arrives faster from Deepgram)
    if (speechRecognition.interimText && speechRecognition.interimText !== prevInterimRef.current) {
      tts.cancel();
    }
    prevInterimRef.current = speechRecognition.interimText;
  }, [speechRecognition.transcriptChunks.length, speechRecognition.interimText, tts]);

  // Frame sampler — wired to event log
  const { latestFrame } = useFrameSampler(
    mediaCapture.screenStream,
    mediaCapture.isCapturing,
    {
      onFrame: (frame) => {
        eventLog.addFrame(frame.data, frame.timestamp_ms, frame.significant);
      },
    }
  );

  // Stable refs for observe loop callbacks (avoid stale closures)
  const latestFrameRef = useRef<string | null>(null);
  latestFrameRef.current = latestFrame;

  const getLatestFrame = useCallback(() => latestFrameRef.current, []);

  // Observe loop (utterance-end-driven + slow proactive poll)
  const { observeCallCount, speakCount, silentCount, noteTranscriptArrival } = useObserveLoop({
    isRecording: currentState === AppState.RecordingActive,
    getLatestFrame,
    getTranscriptWindow: eventLog.getTranscriptWindow,
    speak: tts.speak,
    addInterjection: eventLog.addInterjection,
    getPreviousInterjections: eventLog.getPreviousInterjections,
  });

  // Wire transcript directly into event log via synchronous callback
  // Also triggers the speech-end debounce timer in the observe loop
  const noteArrivalRef = useRef(noteTranscriptArrival);
  noteArrivalRef.current = noteTranscriptArrival;
  useEffect(() => {
    speechRecognition.onFinalTranscript((chunk) => {
      addTranscriptRef.current(chunk);
      noteArrivalRef.current();
    });
  }, [speechRecognition.onFinalTranscript]);

  // Count frames from events
  const framesCaptured = eventLog.events.filter(
    (e) => e.type === EventType.Frame
  ).length;

  // Build captured frames array for feed (only significant frames)
  const capturedFrames: CapturedFrame[] = eventLog.events
    .filter((e) => e.type === EventType.Frame && (e.payload as FramePayload).significant)
    .map((e) => {
      const p = e.payload as FramePayload;
      return {
        timestamp_ms: e.timestamp_ms,
        base64: p.frame_base64,
      };
    });

  // Build interjections array for UI
  const interjections: Interjection[] = eventLog.events
    .filter((e) => e.type === EventType.Interjection)
    .map((e) => {
      const p = e.payload as InterjectionPayload;
      return {
        timestamp_ms: e.timestamp_ms,
        reason: p.reason,
        message: p.message,
      };
    });

  // Start capture when entering RecordingStart
  useEffect(() => {
    if (currentState !== AppState.RecordingStart) return;
    if (startedRef.current) return;
    startedRef.current = true;

    async function initCapture() {
      try {
        await mediaCapture.startCapture();

        // 3-second countdown with beep and guidance text
        for (let i = 3; i >= 1; i--) {
          setCountdown(i);
          playCountdownBeep(i === 1);
          await new Promise((r) => setTimeout(r, 1000));
        }
        setCountdown(null);

        // Go straight to recording; no spoken intro
        setState(AppState.RecordingActive);
        speechRecognition.start(mediaCapture.micStream || undefined);
      } catch {
        // If capture fails, go back to NewCapture
        startedRef.current = false;
        setCountdown(null);
        setState(AppState.NewCapture);
      }
    }

    initCapture();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentState]);

  // Handle stop
  const handleStop = useCallback(() => {
    mediaCapture.stopCapture();
    speechRecognition.stop();
    tts.cancel();

    // Collect events into session data
    const events = [...eventLog.events];
    setSessionData({
      ...sessionData,
      events,
    });

    startedRef.current = false;
    // RecordingScreen's handleStop calls setState(Processing) so we don't do it here
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaCapture, speechRecognition, tts, eventLog, sessionData, setSessionData]);

  // Countdown overlay while user switches to target tab
  if (countdown !== null) {
    return (
      <div className="countdown-overlay" data-testid="countdown-overlay">
        <div className="countdown-content">
          <div className="countdown-number" data-testid="countdown-number">{countdown}</div>
          <p className="countdown-hint">{COUNTDOWN_HINTS[countdown] ?? ''}</p>
        </div>
      </div>
    );
  }

  // Show recording screen (for both start and active states)
  return (
    <RecordingScreen
      hasTabAudio={mediaCapture.hasTabAudio}
      transcriptChunks={speechRecognition.transcriptChunks}
      interimText={speechRecognition.interimText}
      interjections={interjections}
      framesCaptured={framesCaptured}
      observeCallCount={observeCallCount}
      speakCount={speakCount}
      silentCount={silentCount}
      capturedFrames={capturedFrames}
      onStop={handleStop}
    />
  );
}
