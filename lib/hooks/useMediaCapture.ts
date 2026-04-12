'use client';

import { useState, useCallback, useRef } from 'react';

interface UseMediaCaptureReturn {
  startCapture: () => Promise<void>;
  stopCapture: () => void;
  isCapturing: boolean;
  screenStream: MediaStream | null;
  micStream: MediaStream | null;
  hasTabAudio: boolean;
  error: string | null;
}

export function useMediaCapture(): UseMediaCaptureReturn {
  const [isCapturing, setIsCapturing] = useState(false);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [hasTabAudio, setHasTabAudio] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Use refs to track streams for cleanup in track-ended handler
  const screenStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);

  const stopCapture = useCallback(() => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }
    setScreenStream(null);
    setMicStream(null);
    setIsCapturing(false);
    setHasTabAudio(false);
  }, []);

  const startCapture = useCallback(async () => {
    setError(null);

    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'monitor' },
        audio: true,
        // @ts-expect-error preferCurrentTab is not in TS types yet
        preferCurrentTab: false,
        // @ts-expect-error systemAudio is not in TS types yet
        systemAudio: 'include',
      });

      // Reject if user picked a tab or window instead of entire screen
      const videoTrack = screen.getVideoTracks()[0];
      const surface = videoTrack?.getSettings().displaySurface;
      if (surface && surface !== 'monitor') {
        screen.getTracks().forEach((track) => track.stop());
        throw new Error(
          'Please share your entire screen, not a single tab or window.'
        );
      }

      // Check if screen share includes audio
      const audioTracks = screen.getAudioTracks();
      setHasTabAudio(audioTracks.length > 0);

      // Listen for user stopping screen share via browser UI
      if (videoTrack) {
        videoTrack.addEventListener('ended', () => {
          stopCapture();
        });
      }

      let mic: MediaStream;
      try {
        mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (micErr) {
        // If mic fails, stop screen share too
        screen.getTracks().forEach((track) => track.stop());
        throw new Error(
          `Microphone access denied: ${micErr instanceof Error ? micErr.message : String(micErr)}`
        );
      }

      screenStreamRef.current = screen;
      micStreamRef.current = mic;
      setScreenStream(screen);
      setMicStream(mic);
      setIsCapturing(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setIsCapturing(false);
    }
  }, [stopCapture]);

  return {
    startCapture,
    stopCapture,
    isCapturing,
    screenStream,
    micStream,
    hasTabAudio,
    error,
  };
}
