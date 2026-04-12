'use client';

import { useRef, useCallback, useState } from 'react';
import { EventType, SessionEvent } from '@/lib/types';

export interface FramePayload {
  frame_base64: string;
  significant: boolean;
}

export interface TranscriptPayload {
  text: string;
  isFinal: boolean;
}

export interface InterjectionPayload {
  message: string;
  reason: string;
}

export function useEventLog() {
  const eventsRef = useRef<SessionEvent[]>([]);
  // Counter to trigger re-renders when events change
  const [, setVersion] = useState(0);

  const addFrame = useCallback((base64: string, timestamp_ms: number, significant = false) => {
    const event: SessionEvent = {
      type: EventType.Frame,
      timestamp_ms,
      payload: { frame_base64: base64, significant } as FramePayload,
    };
    eventsRef.current.push(event);
    setVersion((v) => v + 1);
  }, []);

  const addTranscript = useCallback(
    (chunk: { text: string; isFinal: boolean; timestamp_ms: number }) => {
      const event: SessionEvent = {
        type: EventType.Transcript,
        timestamp_ms: chunk.timestamp_ms,
        payload: { text: chunk.text, isFinal: chunk.isFinal } as TranscriptPayload,
      };
      eventsRef.current.push(event);
      setVersion((v) => v + 1);
    },
    []
  );

  const addInterjection = useCallback(
    (message: string, reason: string, timestamp_ms: number) => {
      const event: SessionEvent = {
        type: EventType.Interjection,
        timestamp_ms,
        payload: { message, reason } as InterjectionPayload,
      };
      eventsRef.current.push(event);
      setVersion((v) => v + 1);
    },
    []
  );

  const getTranscriptWindow = useCallback((lastNSeconds: number): string => {
    const now = eventsRef.current.length > 0
      ? eventsRef.current[eventsRef.current.length - 1].timestamp_ms
      : 0;
    const cutoff = now - lastNSeconds * 1000;

    return eventsRef.current
      .filter(
        (e) =>
          e.type === EventType.Transcript &&
          e.timestamp_ms >= cutoff &&
          (e.payload as TranscriptPayload).isFinal
      )
      .map((e) => (e.payload as TranscriptPayload).text)
      .join(' ');
  }, []);

  const getPreviousInterjections = useCallback((): string[] => {
    return eventsRef.current
      .filter((e) => e.type === EventType.Interjection)
      .map((e) => (e.payload as InterjectionPayload).message);
  }, []);

  const clear = useCallback(() => {
    eventsRef.current = [];
    setVersion((v) => v + 1);
  }, []);

  return {
    events: eventsRef.current,
    addFrame,
    addTranscript,
    addInterjection,
    getTranscriptWindow,
    getPreviousInterjections,
    clear,
  };
}
