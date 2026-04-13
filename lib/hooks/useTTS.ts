'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

interface UseTTSOptions {
  onSpeakStart?: () => void;
  onSpeakEnd?: () => void;
}

interface UseTTSReturn {
  /** Speaks text. Returns true if completed naturally, false if cancelled/errored. */
  speak: (text: string) => Promise<boolean>;
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

  const speak = useCallback((text: string): Promise<boolean> => {
    return new Promise<boolean>(async (resolve) => {
      // Cancel any ongoing speech
      cancel();

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const fetchStart = Date.now();
        let res: Response | null = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          if (controller.signal.aborted) { resolve(false); return; }
          res = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
            signal: controller.signal,
          });
          if (res.ok || res.status !== 502) break;
          console.warn(`TTS: 502 on attempt ${attempt + 1}, retrying...`);
          await new Promise((r) => setTimeout(r, 1000));
        }

        if (!res || !res.ok || controller.signal.aborted) {
          console.warn(`TTS: API ${res?.status} after ${Date.now() - fetchStart}ms`);
          resolve(false);
          return;
        }

        console.log(`TTS: fetch ${Date.now() - fetchStart}ms`);
        const blob = await res.blob();
        if (controller.signal.aborted) {
          resolve(false);
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
          resolve(true); // completed naturally
        };

        audio.onerror = () => {
          console.warn('TTS: audio playback error - skipping interjection');
          setIsSpeaking(false);
          optionsRef.current.onSpeakEnd?.();
          URL.revokeObjectURL(url);
          audioRef.current = null;
          resolve(false);
        };

        audio.play().catch(() => {
          console.warn('TTS: autoplay blocked - skipping interjection');
          URL.revokeObjectURL(url);
          audioRef.current = null;
          resolve(false);
        });
      } catch {
        console.warn('TTS: network error - skipping interjection');
        resolve(false);
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

