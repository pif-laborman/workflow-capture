'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAppState } from '@/lib/state';
import { AppState, EventType, WorkflowDocument, WorkflowStep } from '@/lib/types';
import { saveWorkflow as persistWorkflow, getWorkflow as loadWorkflow } from '@/lib/storage';

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function getConfidence(step: WorkflowStep): 'high' | 'medium' | 'low' {
  if (step.confidence) return step.confidence;
  // Derive from notes: empty notes = high, short notes = medium, long = low
  if (!step.notes || step.notes.trim().length === 0) return 'high';
  if (step.notes.trim().length > 100) return 'low';
  return 'medium';
}

function confidenceLabel(c: 'high' | 'medium' | 'low'): string {
  return c.charAt(0).toUpperCase() + c.slice(1);
}

interface StepCardProps {
  step: WorkflowStep;
}

function StepCard({ step }: StepCardProps) {
  const [expanded, setExpanded] = useState(false);
  const confidence = getConfidence(step);

  return (
    <div
      className="results-step-card card"
      data-testid={`step-card-${step.step_number}`}
      onClick={() => setExpanded(!expanded)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setExpanded(!expanded);
        }
      }}
    >
      <div className="step-card-header">
        <span className="step-card-number" data-testid="step-number">
          {String(step.step_number).padStart(2, '0')}
        </span>
        <span className="step-card-action" data-testid="step-action">{step.action}</span>
        <span
          className={`pill-badge pill-confidence pill-confidence-${confidence}`}
          data-testid="step-confidence"
        >
          {confidenceLabel(confidence)}
        </span>
        <span className="step-card-chevron" aria-hidden="true">
          {expanded ? '▾' : '▸'}
        </span>
      </div>
      {expanded && (
        <div className="step-card-details" data-testid="step-details">
          <div className="step-detail-row">
            <span className="step-detail-label">intent</span>
            <span className="step-detail-value">{step.description}</span>
          </div>
          <div className="step-detail-row">
            <span className="step-detail-label">screen_context</span>
            <span className="step-detail-value">{step.ui_element}</span>
          </div>
          {step.notes && step.notes.trim().length > 0 && (
            <div className="step-detail-row">
              <span className="step-detail-label">open_questions</span>
              <span className="step-detail-value">{step.notes}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ResultsScreen() {
  const { sessionData, setSessionData, setState, selectedWorkflowId, setSelectedWorkflowId } = useAppState();
  const router = useRouter();

  // Load workflow from selectedWorkflowId (viewing saved) or sessionData (just processed)
  let workflow: WorkflowDocument | null = null;
  let durationMs = 0;
  let sessionEvents = sessionData.events;
  let workflowName = sessionData.workflowName;
  let savedTranscript = '';

  if (selectedWorkflowId) {
    const found = loadWorkflow(selectedWorkflowId);
    if (found) {
      workflow = found.workflow;
      durationMs = found.duration_ms;
      sessionEvents = found.session_events;
      workflowName = found.name;
      savedTranscript = found.transcript || '';
    }
  } else {
    workflow = sessionData.workflowResult;
    if (sessionData.events.length >= 2) {
      const timestamps = sessionData.events.map(e => e.timestamp_ms);
      durationMs = Math.max(...timestamps) - Math.min(...timestamps);
    }
  }

  // Build transcript from events (for freshly processed workflows)
  // Interleaves user speech and Duvo interjections chronologically
  const transcript = savedTranscript || sessionEvents
    .filter((e) => e.type === EventType.Transcript || e.type === EventType.Interjection)
    .map((e) => {
      if (e.type === EventType.Interjection) {
        const p = e.payload as { message: string };
        return `Duvo: ${p.message}`;
      }
      const p = e.payload as { text: string; isFinal: boolean };
      return p.isFinal ? `You: ${p.text}` : '';
    })
    .filter(Boolean)
    .join('\n');

  // Save to localStorage on first render of a new workflow (not viewing a saved one)
  // Strip base64 frame data to stay within localStorage's 5MB limit
  const doSave = useCallback(() => {
    if (!workflow || selectedWorkflowId) return;
    try {
      const lightEvents = sessionEvents.map((e) => {
        if (e.type === EventType.Frame) {
          return {
            ...e,
            payload: { frame_captured: true, timestamp_ms: e.timestamp_ms },
          };
        }
        return e;
      });
      // Extract full transcript with both user and Duvo responses
      const transcript = sessionEvents
        .filter((e) => e.type === EventType.Transcript || e.type === EventType.Interjection)
        .map((e) => {
          if (e.type === EventType.Interjection) {
            const p = e.payload as { message: string };
            return `Duvo: ${p.message}`;
          }
          const p = e.payload as { text: string; isFinal: boolean };
          return p.isFinal ? `You: ${p.text}` : '';
        })
        .filter(Boolean)
        .join('\n');

      persistWorkflow({
        id: crypto.randomUUID(),
        name: workflowName || workflow.name,
        date: new Date().toISOString(),
        duration_ms: durationMs,
        workflow,
        session_events: lightEvents,
        transcript: transcript || undefined,
      });
    } catch {
      // Ignore storage errors
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save on mount (only for newly processed workflows)
  useState(() => {
    doSave();
  });

  if (!workflow) {
    return (
      <div className="results-screen" data-testid="results-screen">
        <div className="results-content">
          <p>No workflow data available.</p>
          <button
            className="btn-outline"
            onClick={() => {
              setSelectedWorkflowId(null);
              setState(AppState.Home);
            }}
          >
            Go home
          </button>
        </div>
      </div>
    );
  }

  const stepCount = workflow.steps.length;
  const questionCount = workflow.open_questions.length;

  const handleDownloadWorkflow = () => {
    const blob = new Blob([JSON.stringify(workflow, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'workflow.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadSession = () => {
    const blob = new Blob([JSON.stringify(sessionEvents, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'session-raw.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadTranscript = () => {
    if (!transcript) return;
    const blob = new Blob([transcript], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'transcript.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleAllWorkflows = () => {
    router.push('/');
  };

  const handleNewCapture = () => {
    setSelectedWorkflowId(null);
    setSessionData({ workflowName: '', events: [], workflowResult: null });
    router.push('/');
    // Small delay to ensure navigation, then set state
    setTimeout(() => setState(AppState.NewCapture), 50);
  };

  return (
    <div className="results-screen" data-testid="results-screen">
      <div className="results-content">
        {/* Header */}
        <div className="results-header">
          <div className="results-success-icon" data-testid="results-success-icon">✓</div>
          <h1 className="results-title" data-testid="results-title">{workflow.name}</h1>
        </div>

        {/* Stats row */}
        <div className="results-stats" data-testid="results-stats">
          <div className="results-stat">
            <span className="results-stat-value" data-testid="stat-steps">{stepCount}</span>
            <span className="results-stat-label">step{stepCount !== 1 ? 's' : ''}</span>
          </div>
          <div className="results-stat-divider" />
          <div className="results-stat">
            <span className="results-stat-value" data-testid="stat-questions">{questionCount}</span>
            <span className="results-stat-label">open question{questionCount !== 1 ? 's' : ''}</span>
          </div>
          <div className="results-stat-divider" />
          <div className="results-stat">
            <span className="results-stat-value" data-testid="stat-duration">{formatDuration(durationMs)}</span>
            <span className="results-stat-label">duration</span>
          </div>
        </div>

        {/* Download buttons */}
        <div className="results-downloads" data-testid="results-downloads">
          <button
            className="btn-primary"
            onClick={handleDownloadWorkflow}
            data-testid="download-workflow-btn"
          >
            ↓ Download workflow.json
          </button>
          <button
            className="btn-outline"
            onClick={handleDownloadSession}
            data-testid="download-session-btn"
          >
            ↓ Download session-raw.json
          </button>
          {transcript && (
            <button
              className="btn-outline"
              onClick={handleDownloadTranscript}
              data-testid="download-transcript-btn"
            >
              ↓ Download transcript.txt
            </button>
          )}
        </div>

        {/* Transcript section */}
        {transcript && (
          <div className="results-section">
            <h2 className="results-section-heading">Transcript</h2>
            <div className="results-transcript" data-testid="results-transcript">
              {transcript.split('\n').map((line, i) => (
                <p
                  key={i}
                  className={line.startsWith('Duvo:') ? 'transcript-line-duvo' : 'transcript-line-you'}
                >
                  {line}
                </p>
              ))}
            </div>
          </div>
        )}

        {/* Steps section */}
        <div className="results-section">
          <h2 className="results-section-heading" data-testid="steps-heading">Steps</h2>
          <div className="results-steps" data-testid="results-steps">
            {workflow.steps.map((step) => (
              <StepCard key={step.step_number} step={step} />
            ))}
          </div>
        </div>

        {/* Open questions section */}
        {questionCount > 0 && (
          <div className="results-questions-section" data-testid="results-questions">
            <h2 className="results-section-heading">Open questions</h2>
            <p className="results-questions-explanation">
              These questions were identified during the workflow analysis but remain unresolved.
              Consider addressing them to improve the workflow documentation.
            </p>
            <ol className="results-questions-list" data-testid="questions-list">
              {workflow.open_questions.map((q, i) => (
                <li key={i} className="results-question-item" data-testid={`question-${i}`}>
                  {q}
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Footer */}
        <div className="results-footer" data-testid="results-footer">
          <button
            className="btn-outline"
            onClick={handleAllWorkflows}
            data-testid="all-workflows-btn"
          >
            All workflows
          </button>
          <button
            className="btn-outline"
            onClick={handleNewCapture}
            data-testid="new-capture-btn"
          >
            New capture
          </button>
        </div>
      </div>
    </div>
  );
}
