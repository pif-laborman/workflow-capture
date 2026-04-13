'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { TranscriptChunk } from '@/lib/types';

interface UseSpeechRecognitionReturn {
  start: (micStream?: MediaStream) => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  transcriptChunks: TranscriptChunk[];
  interimText: string;
  isListening: boolean;
  /** Register a callback fired when Deepgram detects end-of-utterance */
  onUtteranceEnd: (cb: () => void) => void;
}

interface DeepgramResult {
  channel?: {
    alternatives?: Array<{
      transcript?: string;
    }>;
  };
  is_final?: boolean;
}

const DEEPGRAM_WS_URL = 'wss://api.deepgram.com/v1/listen';
const DEEPGRAM_PARAMS = [
  'model=nova-2',
  'language=en',
  'smart_format=true',
  'interim_results=true',
  'utterance_end_ms=1500',
  'endpointing=300',
  'encoding=linear16',
  'sample_rate=16000',
  'channels=1',
].join('&');

/**
 * Captures raw PCM audio from a MediaStream at 16kHz mono.
 * Returns a cleanup function to disconnect the pipeline.
 */
function createAudioPipeline(
  stream: MediaStream,
  onAudioData: (data: ArrayBuffer) => void,
): { audioCtx: AudioContext; cleanup: () => void } {
  const audioCtx = new AudioContext({ sampleRate: 16000 });
  const source = audioCtx.createMediaStreamSource(stream);

  // ScriptProcessor: buffer size 4096 at 16kHz = 256ms chunks
  const processor = audioCtx.createScriptProcessor(4096, 1, 1);

  processor.onaudioprocess = (event) => {
    const float32 = event.inputBuffer.getChannelData(0);
    // Convert Float32 [-1,1] to Int16 PCM
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    onAudioData(int16.buffer);
  };

  source.connect(processor);
  processor.connect(audioCtx.destination);

  const cleanup = () => {
    processor.disconnect();
    source.disconnect();
    audioCtx.close().catch(() => {});
  };

  return { audioCtx, cleanup };
}

export function useSpeechRecognition(): UseSpeechRecognitionReturn {
  const [transcriptChunks, setTranscriptChunks] = useState<TranscriptChunk[]>([]);
  const [interimText, setInterimText] = useState('');
  const [isListening, setIsListening] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCleanupRef = useRef<(() => void) | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const activeRef = useRef(false);
  const utteranceEndCbRef = useRef<(() => void) | null>(null);

  const onUtteranceEnd = useCallback((cb: () => void) => {
    utteranceEndCbRef.current = cb;
  }, []);

  const cleanupConnection = useCallback(() => {
    if (wsRef.current) {
      try {
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'CloseStream' }));
        }
        wsRef.current.close();
      } catch { /* ignore */ }
      wsRef.current = null;
    }
    if (audioCleanupRef.current) {
      audioCleanupRef.current();
      audioCleanupRef.current = null;
    }
    audioCtxRef.current = null;
  }, []);

  const start = useCallback((micStream?: MediaStream) => {
    if (typeof window === 'undefined') return;

    activeRef.current = true;
    setTranscriptChunks([]);
    setInterimText('');
    setIsListening(true);

    (async () => {
      try {
        // Use provided mic stream or request one
        const stream = micStream || await navigator.mediaDevices.getUserMedia({ audio: true });

        // Fetch Deepgram API key from server
        const tokenRes = await fetch('/api/deepgram-token');
        if (!tokenRes.ok) {
          console.error('Failed to fetch Deepgram token');
          activeRef.current = false;
          setIsListening(false);
          return;
        }
        const { key } = await tokenRes.json();

        if (!activeRef.current) return;

        // Open WebSocket to Deepgram
        const ws = new WebSocket(`${DEEPGRAM_WS_URL}?${DEEPGRAM_PARAMS}`, ['token', key]);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!activeRef.current) {
            ws.close();
            return;
          }
          const { audioCtx, cleanup } = createAudioPipeline(stream, (data) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(data);
            }
          });
          audioCtxRef.current = audioCtx;
          audioCleanupRef.current = cleanup;
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);

            // Deepgram fires UtteranceEnd when it detects end-of-speech
            if (msg.type === 'UtteranceEnd') {
              utteranceEndCbRef.current?.();
              return;
            }

            const result: DeepgramResult = msg;
            const transcript = result.channel?.alternatives?.[0]?.transcript || '';

            if (!transcript) return;

            if (result.is_final) {
              const chunk: TranscriptChunk = {
                text: transcript,
                timestamp_ms: Date.now(),
                isFinal: true,
              };
              setTranscriptChunks((prev) => [...prev, chunk]);
              setInterimText('');
            } else {
              setInterimText(transcript);
            }
          } catch { /* ignore malformed messages */ }
        };

        ws.onerror = () => {
          cleanupConnection();
          activeRef.current = false;
          setIsListening(false);
        };

        ws.onclose = () => {
          if (activeRef.current) {
            cleanupConnection();
            activeRef.current = false;
            setIsListening(false);
          }
        };
      } catch (err) {
        console.error('Deepgram speech recognition failed:', err);
        cleanupConnection();
        activeRef.current = false;
        setIsListening(false);
      }
    })();
  }, [cleanupConnection]);

  const stop = useCallback(() => {
    activeRef.current = false;
    cleanupConnection();
    setIsListening(false);
    setInterimText('');
  }, [cleanupConnection]);

  const pause = useCallback(() => {
    activeRef.current = false;
    if (audioCtxRef.current && audioCtxRef.current.state === 'running') {
      audioCtxRef.current.suspend().catch(() => {});
    }
    setIsListening(false);
  }, []);

  const resume = useCallback(() => {
    activeRef.current = true;
    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => {});
    }
    setIsListening(true);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      activeRef.current = false;
      cleanupConnection();
    };
  }, [cleanupConnection]);

  return {
    start,
    stop,
    pause,
    resume,
    transcriptChunks,
    interimText,
    isListening,
    onUtteranceEnd,
  };
}
