'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { FRAME_INTERVAL_MS, JPEG_QUALITY } from '@/lib/constants';

const DIFF_THUMB_SIZE = 16;
const DIFF_THRESHOLD = 15; // average pixel delta (0-255) to count as significant change

export interface TimestampedFrame {
  data: string; // base64 JPEG
  timestamp_ms: number;
  significant: boolean;
}

interface UseFrameSamplerOptions {
  onFrame?: (frame: TimestampedFrame) => void;
}

interface UseFrameSamplerReturn {
  latestFrame: string | null;
}

/**
 * Downscales an image to a tiny canvas and returns its pixel data for comparison.
 * Returns null if the canvas context can't be obtained.
 */
function getThumbnailPixels(
  source: HTMLCanvasElement,
  thumbCanvas: HTMLCanvasElement
): Uint8ClampedArray | null {
  thumbCanvas.width = DIFF_THUMB_SIZE;
  thumbCanvas.height = DIFF_THUMB_SIZE;
  const ctx = thumbCanvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, DIFF_THUMB_SIZE, DIFF_THUMB_SIZE);
  return ctx.getImageData(0, 0, DIFF_THUMB_SIZE, DIFF_THUMB_SIZE).data;
}

/**
 * Computes the average per-channel pixel difference between two RGBA arrays.
 */
function pixelDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let totalDiff = 0;
  const pixelCount = a.length / 4;
  for (let i = 0; i < a.length; i += 4) {
    totalDiff += Math.abs(a[i] - b[i]);       // R
    totalDiff += Math.abs(a[i + 1] - b[i + 1]); // G
    totalDiff += Math.abs(a[i + 2] - b[i + 2]); // B
  }
  return totalDiff / (pixelCount * 3);
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
  const thumbCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastSignificantPixelsRef = useRef<Uint8ClampedArray | null>(null);
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
    if (thumbCanvasRef.current) {
      thumbCanvasRef.current = null;
    }
    lastSignificantPixelsRef.current = null;
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

    // Create offscreen canvas for full-res capture
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvasRef.current = canvas;

    // Create tiny canvas for diff comparison
    const thumbCanvas = document.createElement('canvas');
    thumbCanvasRef.current = thumbCanvas;

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

        // Determine significance via thumbnail pixel diff
        // Falls back to marking all frames as significant if canvas ops fail
        let significant = true;
        try {
          const currentPixels = getThumbnailPixels(canvas, thumbCanvas);
          if (currentPixels) {
            if (!lastSignificantPixelsRef.current) {
              // First frame is always significant
              lastSignificantPixelsRef.current = new Uint8ClampedArray(currentPixels);
            } else {
              const diff = pixelDiff(lastSignificantPixelsRef.current, currentPixels);
              if (diff >= DIFF_THRESHOLD) {
                lastSignificantPixelsRef.current = new Uint8ClampedArray(currentPixels);
              } else {
                significant = false;
              }
            }
          }
        } catch {
          // Canvas diff not available; treat frame as significant
        }

        const frame: TimestampedFrame = {
          data: base64,
          timestamp_ms: Date.now(),
          significant,
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
