'use client';

import { useEffect, useRef, useMemo, useState } from 'react';
import { AppState, TranscriptChunk } from '@/lib/types';
import { useAppState } from '@/lib/state';

export interface Interjection {
  timestamp_ms: number;
  reason: string;
  message: string;
}

export interface CapturedFrame {
  timestamp_ms: number;
  base64: string;
}

type FeedItem =
  | { kind: 'frame'; timestamp_ms: number; base64: string }
  | { kind: 'transcript'; timestamp_ms: number; text: string; isFinal: boolean };

export interface RecordingScreenProps {
  hasTabAudio: boolean;
  transcriptChunks: TranscriptChunk[];
  interimText: string;
  interjections: Interjection[];
  framesCaptured: number;
  observeCallCount: number;
  capturedFrames: CapturedFrame[];
  onStop: () => void;
}

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatTimestamp(ms: number, startMs: number): string {
  const elapsed = Math.max(0, ms - startMs);
  const totalSeconds = Math.floor(elapsed / 1000);
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
  capturedFrames,
  onStop,
}: RecordingScreenProps) {
  const { setState } = useAppState();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const feedEndRef = useRef<HTMLDivElement>(null);
  const observerEndRef = useRef<HTMLDivElement>(null);
  const startTimeRef = useRef(Date.now());

  // Build unified feed sorted by timestamp
  const feedItems = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = [];

    for (const frame of capturedFrames) {
      items.push({
        kind: 'frame',
        timestamp_ms: frame.timestamp_ms,
        base64: frame.base64,
      });
    }

    for (const chunk of transcriptChunks) {
      items.push({
        kind: 'transcript',
        timestamp_ms: chunk.timestamp_ms,
        text: chunk.text,
        isFinal: chunk.isFinal,
      });
    }

    items.sort((a, b) => a.timestamp_ms - b.timestamp_ms);
    return items;
  }, [capturedFrames, transcriptChunks]);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (feedEndRef.current && typeof feedEndRef.current.scrollIntoView === 'function') {
      feedEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [feedItems, interimText]);

  useEffect(() => {
    if (observerEndRef.current && typeof observerEndRef.current.scrollIntoView === 'function') {
      observerEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [interjections]);

  function handleStop() {
    onStop();
    setState(AppState.Processing);
  }

  const hasFeedContent = feedItems.length > 0 || interimText;

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
        {/* Left: Feed (frames + transcript merged) */}
        <div className="recording-panel" data-testid="transcript-panel">
          <div className="panel-header">
            <h2 className="panel-heading">Feed</h2>
            <span className="pill-badge pill-live" data-testid="live-badge">Live</span>
          </div>
          <div className="panel-scroll" data-testid="transcript-scroll">
            {!hasFeedContent ? (
              <p className="panel-empty-hint" data-testid="transcript-empty-hint">
                Start working and talk through what you&apos;re doing
              </p>
            ) : (
              <>
                {feedItems.map((item, i) => {
                  if (item.kind === 'frame') {
                    return (
                      <div
                        key={`f-${i}`}
                        className="feed-frame"
                        data-testid="feed-frame"
                      >
                        <span className="transcript-timestamp">
                          {formatTimestamp(item.timestamp_ms, startTimeRef.current)}
                        </span>
                        <div className="frame-thumbnail">
                          <img
                            src={`data:image/jpeg;base64,${item.base64}`}
                            alt={`Screen capture at ${formatTimestamp(item.timestamp_ms, startTimeRef.current)}`}
                          />
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div
                      key={`t-${i}`}
                      className={`transcript-block ${item.isFinal ? 'transcript-final' : 'transcript-interim'}`}
                      data-testid="transcript-block"
                    >
                      <span className="transcript-timestamp">
                        {formatTimestamp(item.timestamp_ms, startTimeRef.current)}
                      </span>
                      <span className="transcript-text">{item.text}</span>
                    </div>
                  );
                })}
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
            <div ref={feedEndRef} />
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
                      {formatTimestamp(item.timestamp_ms, startTimeRef.current)}
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
