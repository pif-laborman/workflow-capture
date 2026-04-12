'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

interface UseTTSOptions {
  onSpeakStart?: () => void;
  onSpeakEnd?: () => void;
}

interface UseTTSReturn {
  speak: (text: string) => Promise<void>;
  isSpeaking: boolean;
  cancel: () => void;
}

export function useTTS(options: UseTTSOptions = {}): UseTTSReturn {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    setIsSpeaking(false);
  }, []);

  const speak = useCallback((text: string): Promise<void> => {
    return new Promise<void>(async (resolve) => {
      // Cancel any ongoing speech
      cancel();

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
          signal: controller.signal,
        });

        if (!res.ok || controller.signal.aborted) {
          // Fall back to browser TTS on API failure
          fallbackSpeak(text, optionsRef, setIsSpeaking, resolve);
          return;
        }

        const blob = await res.blob();
        if (controller.signal.aborted) {
          resolve();
          return;
        }

        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;

        audio.onplay = () => {
          setIsSpeaking(true);
          optionsRef.current.onSpeakStart?.();
        };

        audio.onended = () => {
          setIsSpeaking(false);
          optionsRef.current.onSpeakEnd?.();
          URL.revokeObjectURL(url);
          audioRef.current = null;
          resolve();
        };

        audio.onerror = () => {
          setIsSpeaking(false);
          optionsRef.current.onSpeakEnd?.();
          URL.revokeObjectURL(url);
          audioRef.current = null;
          resolve();
        };

        audio.play().catch(() => {
          // Autoplay blocked or error; fall back to browser TTS
          URL.revokeObjectURL(url);
          audioRef.current = null;
          fallbackSpeak(text, optionsRef, setIsSpeaking, resolve);
        });
      } catch {
        // Network error or abort; fall back to browser TTS
        fallbackSpeak(text, optionsRef, setIsSpeaking, resolve);
      }
    });
  }, [cancel]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancel();
    };
  }, [cancel]);

  return { speak, isSpeaking, cancel };
}

/** Browser SpeechSynthesis fallback when Voxtral is unavailable */
function fallbackSpeak(
  text: string,
  optionsRef: React.RefObject<UseTTSOptions>,
  setIsSpeaking: (v: boolean) => void,
  resolve: () => void,
): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    resolve();
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);

  utterance.onstart = () => {
    setIsSpeaking(true);
    optionsRef.current?.onSpeakStart?.();
  };

  utterance.onend = () => {
    setIsSpeaking(false);
    optionsRef.current?.onSpeakEnd?.();
    resolve();
  };

  utterance.onerror = () => {
    setIsSpeaking(false);
    optionsRef.current?.onSpeakEnd?.();
    resolve();
  };

  window.speechSynthesis.speak(utterance);
}
