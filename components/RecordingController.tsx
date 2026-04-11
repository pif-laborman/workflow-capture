'use client';

import { useEffect, useRef, useCallback } from 'react';
import { AppState } from '@/lib/types';
import { useAppState } from '@/lib/state';
import { useMediaCapture } from '@/lib/hooks/useMediaCapture';
import { useFrameSampler } from '@/lib/hooks/useFrameSampler';
import { useSpeechRecognition } from '@/lib/hooks/useSpeechRecognition';
import { useTTS } from '@/lib/hooks/useTTS';
import { useEventLog } from '@/lib/hooks/useEventLog';
import { useObserveLoop } from '@/lib/hooks/useObserveLoop';
import RecordingScreen from './RecordingScreen';
import type { Interjection } from './RecordingScreen';
import type { InterjectionPayload } from '@/lib/hooks/useEventLog';
import { EventType } from '@/lib/types';

export default function RecordingController() {
  const { currentState, setState, sessionData, setSessionData } = useAppState();
  const startedRef = useRef(false);

  // Core hooks
  const mediaCapture = useMediaCapture();
  const speechRecognition = useSpeechRecognition();
  const tts = useTTS({
    onSpeakStart: () => speechRecognition.pause(),
    onSpeakEnd: () => speechRecognition.resume(),
  });
  const eventLog = useEventLog();

  // Frame sampler — wired to event log
  const { latestFrame } = useFrameSampler(
    mediaCapture.screenStream,
    mediaCapture.isCapturing,
    {
      onFrame: (frame) => {
        eventLog.addFrame(frame.data, frame.timestamp_ms);
      },
    }
  );

  // Stable refs for observe loop callbacks (avoid stale closures)
  const latestFrameRef = useRef<string | null>(null);
  latestFrameRef.current = latestFrame;

  const getLatestFrame = useCallback(() => latestFrameRef.current, []);

  // Observe loop
  const { observeCallCount } = useObserveLoop({
    isRecording: currentState === AppState.RecordingActive,
    getLatestFrame,
    getTranscriptWindow: eventLog.getTranscriptWindow,
    speak: tts.speak,
    pauseRecognition: speechRecognition.pause,
    resumeRecognition: speechRecognition.resume,
    addInterjection: eventLog.addInterjection,
  });

  // Count frames from events
  const framesCaptured = eventLog.events.filter(
    (e) => e.type === EventType.Frame
  ).length;

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
        speechRecognition.start();
        setState(AppState.RecordingActive);
      } catch {
        // If capture fails, go back to NewCapture
        startedRef.current = false;
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

  // Show recording screen (for both start and active states)
  return (
    <RecordingScreen
      hasTabAudio={mediaCapture.hasTabAudio}
      transcriptChunks={speechRecognition.transcriptChunks}
      interimText={speechRecognition.interimText}
      interjections={interjections}
      framesCaptured={framesCaptured}
      observeCallCount={observeCallCount}
      onStop={handleStop}
    />
  );
}
