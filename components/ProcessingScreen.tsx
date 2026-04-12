'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useAppState } from '@/lib/state';
import { AppState, EventType, SessionEvent, WorkflowDocument } from '@/lib/types';

interface ProgressStep {
  label: string;
  done: boolean;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds} sec`;
  return `${minutes} min ${seconds} sec`;
}

export default function ProcessingScreen() {
  const { sessionData, setSessionData, setState } = useAppState();
  const [error, setError] = useState<string | null>(null);
  const [isApiKeyError, setIsApiKeyError] = useState(false);
  const [steps, setSteps] = useState<ProgressStep[]>([
    { label: 'Analyzing screen recordings...', done: false },
    { label: 'Processing transcript...', done: false },
    { label: 'Generating workflow steps...', done: false },
  ]);
  const hasStarted = useRef(false);

  // Compute input summary from session events
  const frameCount = sessionData.events.filter(e => e.type === EventType.Frame).length;
  const interjectionCount = sessionData.events.filter(e => e.type === EventType.Interjection).length;
  const timestamps = sessionData.events.map(e => e.timestamp_ms);
  const durationMs = timestamps.length >= 2 ? Math.max(...timestamps) - Math.min(...timestamps) : 0;

  const markStep = useCallback((index: number) => {
    setSteps(prev => prev.map((s, i) => i === index ? { ...s, done: true } : s));
  }, []);

  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

    const controller = new AbortController();

    async function finalize() {
      try {
        // Strip base64 frame data to keep payload under Vercel body limit.
        // Replace with a lightweight marker; Claude already observed frames live.
        const lightEvents: SessionEvent[] = sessionData.events.map((e) => {
          if (e.type === EventType.Frame) {
            return {
              ...e,
              payload: {
                frame_captured: true,
                timestamp_ms: e.timestamp_ms,
              },
            };
          }
          return e;
        });

        const response = await fetch('/api/finalize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            events: lightEvents,
            workflow_name: sessionData.workflowName || 'Untitled Workflow',
          }),
          signal: controller.signal,
        });

        // Check for non-streaming error responses (JSON with error field)
        if (!response.ok) {
          const contentType = response.headers.get('Content-Type') || '';
          if (contentType.includes('application/json')) {
            const errorBody = await response.json();
            if (errorBody.error?.includes('ANTHROPIC_API_KEY')) {
              setIsApiKeyError(true);
              setError('API key is not configured. Please set ANTHROPIC_API_KEY in your environment variables.');
            } else {
              setError(errorBody.error || 'Failed to generate workflow');
            }
          } else {
            setError(`Server error (${response.status})`);
          }
          return;
        }

        // Mark first step done once we start receiving data
        markStep(0);

        const reader = response.body?.getReader();
        if (!reader) {
          setError('No response body received');
          return;
        }

        const decoder = new TextDecoder();
        let accumulated = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          accumulated += decoder.decode(value, { stream: true });

          // Progress heuristics based on accumulated content
          if (accumulated.length > 100 && !steps[1].done) {
            markStep(1);
          }
        }

        // Final decode
        accumulated += decoder.decode();

        markStep(2);

        // Try to extract JSON from the response
        // Claude may wrap JSON in markdown code blocks
        let jsonStr = accumulated.trim();
        const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlockMatch) {
          jsonStr = codeBlockMatch[1].trim();
        }

        // Check if the streamed response itself is an error
        try {
          const parsed = JSON.parse(jsonStr);
          if (parsed.error) {
            if (typeof parsed.error === 'string' && parsed.error.includes('ANTHROPIC_API_KEY')) {
              setIsApiKeyError(true);
              setError('API key is not configured. Please set ANTHROPIC_API_KEY in your environment variables.');
            } else {
              setError(typeof parsed.error === 'string' ? parsed.error : 'Failed to generate workflow');
            }
            return;
          }
        } catch {
          // Not a JSON error, continue with parsing as WorkflowDocument
        }

        const workflow: WorkflowDocument = JSON.parse(jsonStr);

        // Validate basic structure
        if (!workflow.name || !Array.isArray(workflow.steps)) {
          setError('Invalid workflow document received');
          return;
        }

        setSessionData({ ...sessionData, workflowResult: workflow });
        setState(AppState.Results);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'An unexpected error occurred');
      }
    }

    finalize();

    return () => {
      controller.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="processing-screen" data-testid="processing-screen">
        <div className="processing-content">
          <div className="processing-error-icon" data-testid="processing-error-icon">!</div>
          <h1 className="processing-headline" data-testid="processing-error-headline">
            {isApiKeyError ? 'API key not configured' : 'Something went wrong'}
          </h1>
          <p className="processing-error-message" data-testid="processing-error-message">{error}</p>
          <div className="processing-error-actions">
            {!isApiKeyError && (
              <button
                className="btn-primary"
                data-testid="processing-retry-btn"
                onClick={() => {
                  hasStarted.current = false;
                  setError(null);
                  setIsApiKeyError(false);
                  setSteps([
                    { label: 'Analyzing screen recordings...', done: false },
                    { label: 'Processing transcript...', done: false },
                    { label: 'Generating workflow steps...', done: false },
                  ]);
                }}
              >
                Try again
              </button>
            )}
            <button
              className="btn-outline"
              data-testid="processing-home-btn"
              onClick={() => setState(AppState.Home)}
            >
              Go home
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="processing-screen" data-testid="processing-screen">
      <div className="processing-content">
        <div className="processing-spinner" data-testid="processing-spinner" />
        <h1 className="processing-headline" data-testid="processing-headline">
          Building your workflow
        </h1>
        <p className="processing-summary" data-testid="processing-summary">
          {frameCount} frames, {formatDuration(durationMs)}, {interjectionCount} interjection{interjectionCount !== 1 ? 's' : ''}
        </p>
        <ul className="processing-steps" data-testid="processing-steps">
          {steps.map((step, i) => (
            <li key={i} className={`processing-step ${step.done ? 'step-done' : 'step-pending'}`}>
              <span className="step-icon">{step.done ? '✓' : '○'}</span>
              <span className="step-label">{step.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
