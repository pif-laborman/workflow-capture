'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { TranscriptChunk } from '@/lib/types';

/** Minimal interface for Web Speech API SpeechRecognition */
interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechRecognitionResultEvent {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      length: number;
      [index: number]: { transcript: string };
    };
  };
}

interface UseSpeechRecognitionReturn {
  start: () => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  transcriptChunks: TranscriptChunk[];
  interimText: string;
  isListening: boolean;
}

// Use vendor-prefixed SpeechRecognition if available
function getSpeechRecognitionCtor(): (new () => SpeechRecognitionInstance) | null {
  if (typeof window === 'undefined') return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function useSpeechRecognition(): UseSpeechRecognitionReturn {
  const [transcriptChunks, setTranscriptChunks] = useState<TranscriptChunk[]>([]);
  const [interimText, setInterimText] = useState('');
  const [isListening, setIsListening] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const activeRef = useRef(false); // true when we want recognition running (not paused/stopped)

  const handleResult = useCallback((event: SpeechRecognitionResultEvent) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result[0].transcript;
      if (result.isFinal) {
        const chunk: TranscriptChunk = {
          text,
          timestamp_ms: Date.now(),
          isFinal: true,
        };
        setTranscriptChunks((prev) => [...prev, chunk]);
      } else {
        interim += text;
      }
    }
    setInterimText(interim);
  }, []);

  const handleEnd = useCallback(() => {
    // Auto-restart if still active (browser sometimes stops recognition)
    if (activeRef.current && recognitionRef.current) {
      try {
        recognitionRef.current.start();
      } catch {
        // Already started or destroyed — ignore
      }
    } else {
      setIsListening(false);
    }
  }, []);

  const handleError = useCallback((event: { error: string }) => {
    // For non-fatal errors, let onend handle restart
    if (event.error === 'aborted' || event.error === 'no-speech') {
      return;
    }
    // Fatal errors — stop
    activeRef.current = false;
    setIsListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    // Clean up any existing instance
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch { /* ignore */ }
    }

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = handleResult;
    recognition.onend = handleEnd;
    recognition.onerror = handleError;

    recognitionRef.current = recognition;
    activeRef.current = true;
    setIsListening(true);
    setTranscriptChunks([]);
    setInterimText('');

    try {
      recognition.start();
    } catch {
      // ignore if already started
    }
  }, [handleResult, handleEnd, handleError]);

  const stop = useCallback(() => {
    activeRef.current = false;
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* ignore */ }
      recognitionRef.current = null;
    }
    setIsListening(false);
    setInterimText('');
  }, []);

  const pause = useCallback(() => {
    activeRef.current = false;
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* ignore */ }
    }
    setIsListening(false);
  }, []);

  const resume = useCallback(() => {
    if (recognitionRef.current) {
      activeRef.current = true;
      setIsListening(true);
      try {
        recognitionRef.current.start();
      } catch {
        // ignore if already started
      }
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      activeRef.current = false;
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch { /* ignore */ }
        recognitionRef.current = null;
      }
    };
  }, []);

  return {
    start,
    stop,
    pause,
    resume,
    transcriptChunks,
    interimText,
    isListening,
  };
}
