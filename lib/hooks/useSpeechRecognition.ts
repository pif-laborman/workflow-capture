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
  /** Register a callback fired synchronously on each final transcript chunk */
  onFinalTranscript: (cb: (chunk: TranscriptChunk) => void) => void;
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
  'utterance_end_ms=800',
  'endpointing=300',
  'encoding=linear16',
  'sample_rate=16000',
  'channels=1',
].join('&');

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 1000;

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
  const finalTranscriptCbRef = useRef<((chunk: TranscriptChunk) => void) | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onUtteranceEnd = useCallback((cb: () => void) => {
    utteranceEndCbRef.current = cb;
  }, []);

  const onFinalTranscript = useCallback((cb: (chunk: TranscriptChunk) => void) => {
    finalTranscriptCbRef.current = cb;
  }, []);

  const closeWs = useCallback(() => {
    if (wsRef.current) {
      try {
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'CloseStream' }));
        }
        wsRef.current.close();
      } catch { /* ignore */ }
      wsRef.current = null;
    }
  }, []);

  const cleanupAll = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    closeWs();
    if (audioCleanupRef.current) {
      audioCleanupRef.current();
      audioCleanupRef.current = null;
    }
    audioCtxRef.current = null;
    micStreamRef.current = null;
    reconnectAttemptsRef.current = 0;
  }, [closeWs]);

  /**
   * Connect (or reconnect) the Deepgram WebSocket.
   * Reuses the existing mic stream and audio pipeline on reconnect.
   */
  const connectWs = useCallback(async (stream: MediaStream) => {
    // Fetch a fresh Deepgram API key
    try {
      const tokenRes = await fetch(`/api/deepgram-token?t=${Date.now()}`, { cache: 'no-store' });
      if (!tokenRes.ok) {
        console.error('[deepgram] Token fetch failed:', tokenRes.status);
        return;
      }
      const { key } = await tokenRes.json();
      console.log(`[deepgram] Got token: ${key?.slice(0, 8)}... (${key?.length} chars)`);

      if (!activeRef.current) return;

      // Close old WS if any (but keep audio pipeline)
      closeWs();

      const wsUrl = `${DEEPGRAM_WS_URL}?${DEEPGRAM_PARAMS}&token=${key}`;
      console.log('[deepgram] Connecting WS...');
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!activeRef.current) {
          ws.close();
          return;
        }
        reconnectAttemptsRef.current = 0;
        setIsListening(true);

        // Only create audio pipeline on first connect (not reconnect)
        if (!audioCleanupRef.current) {
          const { audioCtx, cleanup } = createAudioPipeline(stream, (data) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(data);
            }
          });
          audioCtxRef.current = audioCtx;
          audioCleanupRef.current = cleanup;
        } else {
          // Reconnect: rebuild audio pipeline to wire to new WS
          // (old pipeline still sends to old closed WS)
          if (audioCleanupRef.current) {
            audioCleanupRef.current();
            audioCleanupRef.current = null;
          }
          const { audioCtx, cleanup } = createAudioPipeline(stream, (data) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(data);
            }
          });
          audioCtxRef.current = audioCtx;
          audioCleanupRef.current = cleanup;
        }
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
            // Fire callback synchronously BEFORE React state update
            // so event log has the chunk before any UtteranceEnd fires
            finalTranscriptCbRef.current?.(chunk);
            setTranscriptChunks((prev) => [...prev, chunk]);
            setInterimText('');
          } else {
            setInterimText(transcript);
          }
        } catch { /* ignore malformed messages */ }
      };

      ws.onerror = (ev) => {
        console.error('[deepgram] WS error:', ev);
      };

      ws.onclose = (ev) => {
        console.warn(`[deepgram] WS closed: code=${ev.code} reason="${ev.reason}" clean=${ev.wasClean}`);
        wsRef.current = null;
        if (!activeRef.current) return;

        // Auto-reconnect with backoff
        if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttemptsRef.current);
          reconnectAttemptsRef.current++;
          console.warn(`[deepgram] WS closed, reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current})`);
          setIsListening(false);
          reconnectTimerRef.current = setTimeout(() => {
            if (activeRef.current && micStreamRef.current) {
              connectWs(micStreamRef.current);
            }
          }, delay);
        } else {
          console.error('[deepgram] Max reconnect attempts reached, giving up');
          setIsListening(false);
        }
      };
    } catch (err) {
      console.error('Deepgram connection failed:', err);
    }
  }, [closeWs]);

  const start = useCallback((micStream?: MediaStream) => {
    if (typeof window === 'undefined') return;

    activeRef.current = true;
    reconnectAttemptsRef.current = 0;
    setTranscriptChunks([]);
    setInterimText('');
    setIsListening(true);

    (async () => {
      try {
        const stream = micStream || await navigator.mediaDevices.getUserMedia({ audio: true });
        micStreamRef.current = stream;

        if (!activeRef.current) return;
        await connectWs(stream);
      } catch (err) {
        console.error('Deepgram speech recognition failed:', err);
        cleanupAll();
        activeRef.current = false;
        setIsListening(false);
      }
    })();
  }, [connectWs, cleanupAll]);

  const stop = useCallback(() => {
    activeRef.current = false;
    cleanupAll();
    setIsListening(false);
    setInterimText('');
  }, [cleanupAll]);

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
      cleanupAll();
    };
  }, [cleanupAll]);

  return {
    start,
    stop,
    pause,
    resume,
    transcriptChunks,
    interimText,
    isListening,
    onUtteranceEnd,
    onFinalTranscript,
  };
}
