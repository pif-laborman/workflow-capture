'use client';

import { useEffect, useRef, useState } from 'react';
import { AppState, TranscriptChunk } from '@/lib/types';
import { useAppState } from '@/lib/state';

export interface Interjection {
  timestamp_ms: number;
  reason: string;
  message: string;
}

export interface RecordingScreenProps {
  hasTabAudio: boolean;
  transcriptChunks: TranscriptChunk[];
  interimText: string;
  interjections: Interjection[];
  framesCaptured: number;
  observeCallCount: number;
  onStop: () => void;
}

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function RecordingScreen({
  hasTabAudio,
  transcriptChunks,
  interimText,
  interjections,
  framesCaptured,
  observeCallCount,
  onStop,
}: RecordingScreenProps) {
  const { setState } = useAppState();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const observerEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (transcriptEndRef.current && typeof transcriptEndRef.current.scrollIntoView === 'function') {
      transcriptEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [transcriptChunks, interimText]);

  useEffect(() => {
    if (observerEndRef.current && typeof observerEndRef.current.scrollIntoView === 'function') {
      observerEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [interjections]);

  function handleStop() {
    onStop();
    setState(AppState.Processing);
  }

  return (
    <div data-testid="recording-screen" className="recording-screen">
      {/* Top bar */}
      <div className="recording-top-bar" data-testid="top-bar">
        <div className="recording-status">
          <span className="rec-dot" data-testid="rec-dot" />
          <span className="rec-timer" data-testid="rec-timer">
            {formatTime(elapsedSeconds)}
          </span>
        </div>

        <div className="recording-metrics" data-testid="recording-metrics">
          <span className="metric">
            <span className="metric-value" data-testid="frames-count">{framesCaptured}</span>
            <span className="metric-label">frames</span>
          </span>
          <span className="metric">
            <span className="metric-value" data-testid="observe-count">{observeCallCount}</span>
            <span className="metric-label">observe</span>
          </span>
          <span className="metric">
            <span className="metric-value" data-testid="interjection-count">{interjections.length}</span>
            <span className="metric-label">interjections</span>
          </span>
        </div>

        <button
          className="btn-stop"
          data-testid="stop-button"
          onClick={handleStop}
        >
          Stop recording
        </button>
      </div>

      {/* Warning banner */}
      {!hasTabAudio && (
        <div className="recording-warning" data-testid="no-audio-warning">
          Recording without tab audio
        </div>
      )}

      {/* Two-column layout */}
      <div className="recording-columns">
        {/* Left: Transcript */}
        <div className="recording-panel" data-testid="transcript-panel">
          <div className="panel-header">
            <h2 className="panel-heading">Transcript</h2>
            <span className="pill-badge pill-live" data-testid="live-badge">Live</span>
          </div>
          <div className="panel-scroll" data-testid="transcript-scroll">
            {transcriptChunks.length === 0 && !interimText ? (
              <p className="panel-empty-hint" data-testid="transcript-empty-hint">
                Start working and talk through what you&apos;re doing
              </p>
            ) : (
              <>
                {transcriptChunks.map((chunk, i) => (
                  <div
                    key={i}
                    className={`transcript-block ${chunk.isFinal ? 'transcript-final' : 'transcript-interim'}`}
                    data-testid="transcript-block"
                  >
                    <span className="transcript-timestamp">
                      {formatTimestamp(chunk.timestamp_ms)}
                    </span>
                    <span className="transcript-text">{chunk.text}</span>
                  </div>
                ))}
                {interimText && (
                  <div
                    className="transcript-block transcript-interim"
                    data-testid="transcript-interim"
                  >
                    <span className="transcript-text">{interimText}</span>
                  </div>
                )}
              </>
            )}
            <div ref={transcriptEndRef} />
          </div>
        </div>

        {/* Divider */}
        <div className="recording-divider" />

        {/* Right: Observer */}
        <div className="recording-panel" data-testid="observer-panel">
          <div className="panel-header">
            <h2 className="panel-heading">Observer</h2>
          </div>
          <div className="panel-scroll" data-testid="observer-scroll">
            {interjections.length === 0 ? (
              <p className="panel-empty-hint" data-testid="observer-empty-hint">
                I&apos;ll ask questions here when something isn&apos;t clear
              </p>
            ) : (
              interjections.map((item, i) => (
                <div
                  key={i}
                  className="interjection-card"
                  data-testid="interjection-card"
                >
                  <div className="interjection-meta">
                    <span className="interjection-timestamp">
                      {formatTimestamp(item.timestamp_ms)}
                    </span>
                    <span className="pill-badge pill-reason" data-testid="reason-tag">
                      {item.reason}
                    </span>
                  </div>
                  <p className="interjection-text">{item.message}</p>
                </div>
              ))
            )}
            <div ref={observerEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
