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

  const cancel = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  }, []);

  const speak = useCallback((text: string): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
      if (typeof window === 'undefined' || !window.speechSynthesis) {
        reject(new Error('SpeechSynthesis not available'));
        return;
      }

      // Cancel any ongoing speech
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);

      utterance.onstart = () => {
        setIsSpeaking(true);
        optionsRef.current.onSpeakStart?.();
      };

      utterance.onend = () => {
        setIsSpeaking(false);
        optionsRef.current.onSpeakEnd?.();
        resolve();
      };

      utterance.onerror = (event) => {
        setIsSpeaking(false);
        optionsRef.current.onSpeakEnd?.();
        // 'canceled' errors are expected when we call cancel()
        if (event.error === 'canceled') {
          resolve();
        } else {
          reject(new Error(`TTS error: ${event.error}`));
        }
      };

      window.speechSynthesis.speak(utterance);
    });
  }, []);

  // Cancel speech on unmount
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  return { speak, isSpeaking, cancel };
}
