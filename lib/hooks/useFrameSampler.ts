'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { FRAME_INTERVAL_MS, JPEG_QUALITY } from '@/lib/constants';

export interface TimestampedFrame {
  data: string; // base64 JPEG
  timestamp_ms: number;
}

interface UseFrameSamplerOptions {
  onFrame?: (frame: TimestampedFrame) => void;
}

interface UseFrameSamplerReturn {
  latestFrame: string | null;
}

export function useFrameSampler(
  screenStream: MediaStream | null,
  isCapturing: boolean,
  options?: UseFrameSamplerOptions
): UseFrameSamplerReturn {
  const [latestFrame, setLatestFrame] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onFrameRef = useRef(options?.onFrame);

  // Keep callback ref in sync
  onFrameRef.current = options?.onFrame;

  const cleanup = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
      videoRef.current = null;
    }
    if (canvasRef.current) {
      canvasRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isCapturing || !screenStream) {
      cleanup();
      if (!isCapturing) {
        setLatestFrame(null);
      }
      return;
    }

    const videoTrack = screenStream.getVideoTracks()[0];
    if (!videoTrack) {
      cleanup();
      return;
    }

    const settings = videoTrack.getSettings();
    const width = settings.width || 1280;
    const height = settings.height || 720;

    // Create offscreen video element
    const video = document.createElement('video');
    video.srcObject = screenStream;
    video.muted = true;
    video.playsInline = true;
    videoRef.current = video;

    // Create offscreen canvas
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvasRef.current = canvas;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      cleanup();
      return;
    }

    const sampleFrame = () => {
      if (video.readyState >= video.HAVE_CURRENT_DATA) {
        ctx.drawImage(video, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
        // Strip the data:image/jpeg;base64, prefix
        const base64 = dataUrl.split(',')[1] || '';
        const frame: TimestampedFrame = {
          data: base64,
          timestamp_ms: Date.now(),
        };
        setLatestFrame(base64);
        onFrameRef.current?.(frame);
      }
    };

    video.play().then(() => {
      // Sample immediately, then at interval
      sampleFrame();
      intervalRef.current = setInterval(sampleFrame, FRAME_INTERVAL_MS);
    }).catch(() => {
      // Video play failed — can happen if stream ended
      cleanup();
    });

    return () => {
      cleanup();
    };
  }, [isCapturing, screenStream, cleanup]);

  return { latestFrame };
}
