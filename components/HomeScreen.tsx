'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppState, SavedWorkflow } from '@/lib/types';
import { useAppState } from '@/lib/state';
import { getWorkflows } from '@/lib/storage';
import PromptEditor from '@/components/PromptEditor';

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function ConfidenceDots({ steps }: { steps: { notes: string }[] }) {
  return (
    <span className="confidence-dots" data-testid="confidence-dots">
      {steps.map((step, i) => {
        const hasNotes = step.notes && step.notes.trim().length > 0;
        const color = hasNotes ? 'var(--color-warning-text)' : 'var(--color-success)';
        return (
          <span
            key={i}
            className="confidence-dot"
            style={{ backgroundColor: color }}
          />
        );
      })}
    </span>
  );
}

export default function HomeScreen() {
  const { setState } = useAppState();
  const router = useRouter();
  const [workflows, setWorkflows] = useState<SavedWorkflow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showPromptEditor, setShowPromptEditor] = useState(false);

  useEffect(() => {
    setWorkflows(getWorkflows());
    setLoaded(true);
  }, []);

  if (!loaded) return null;

  const handleNewCapture = () => {
    setState(AppState.NewCapture);
  };

  const handleSelectWorkflow = (id: string) => {
    router.push(`/workflow/${id}`);
  };

  if (workflows.length === 0) {
    return (
      <div className="home-screen" data-testid="home-screen">
        {showPromptEditor && <PromptEditor onClose={() => setShowPromptEditor(false)} />}
        <div className="home-empty" data-testid="home-empty">
          <h1 className="home-brand">workflow capture</h1>
          <button
            className="prompt-settings-btn"
            onClick={() => setShowPromptEditor(true)}
            data-testid="settings-btn-empty"
            aria-label="Edit observer prompt"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6.5 1.5a1.5 1.5 0 013 0v.3a1.5 1.5 0 001 1.42l.26-.15a1.5 1.5 0 012.6 1.5l-.15.26a1.5 1.5 0 00.37 1.72h.3a1.5 1.5 0 010 3h-.3a1.5 1.5 0 00-1.42 1l.15.26a1.5 1.5 0 01-1.5 2.6l-.26-.15a1.5 1.5 0 00-1.72.37v.3a1.5 1.5 0 01-3 0v-.3a1.5 1.5 0 00-1-1.42l-.26.15a1.5 1.5 0 01-2.6-1.5l.15-.26a1.5 1.5 0 00-.37-1.72h-.3a1.5 1.5 0 010-3h.3a1.5 1.5 0 001.42-1l-.15-.26a1.5 1.5 0 011.5-2.6l.26.15a1.5 1.5 0 001.72-.37v-.3z" stroke="currentColor" strokeWidth="1.2"/><circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2"/></svg>
          </button>
          <p className="home-empty-message">No workflows yet</p>
          <button
            className="btn-primary"
            onClick={handleNewCapture}
            data-testid="start-first-capture"
          >
            Start your first capture
          </button>
        </div>
        <footer className="home-footer" data-testid="home-footer">
          <p>Workflows are stored in your browser&apos;s localStorage and will not persist across devices or if browser data is cleared.</p>
        </footer>
      </div>
    );
  }

  return (
    <div className="home-screen" data-testid="home-screen">
      {showPromptEditor && <PromptEditor onClose={() => setShowPromptEditor(false)} />}
      <header className="home-header">
        <div className="home-header-top">
          <h1 className="home-brand">workflow capture</h1>
          <button
            className="prompt-settings-btn"
            onClick={() => setShowPromptEditor(true)}
            data-testid="settings-btn"
            aria-label="Edit observer prompt"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6.5 1.5a1.5 1.5 0 013 0v.3a1.5 1.5 0 001 1.42l.26-.15a1.5 1.5 0 012.6 1.5l-.15.26a1.5 1.5 0 00.37 1.72h.3a1.5 1.5 0 010 3h-.3a1.5 1.5 0 00-1.42 1l.15.26a1.5 1.5 0 01-1.5 2.6l-.26-.15a1.5 1.5 0 00-1.72.37v.3a1.5 1.5 0 01-3 0v-.3a1.5 1.5 0 00-1-1.42l-.26.15a1.5 1.5 0 01-2.6-1.5l.15-.26a1.5 1.5 0 00-.37-1.72h-.3a1.5 1.5 0 010-3h.3a1.5 1.5 0 001.42-1l-.15-.26a1.5 1.5 0 011.5-2.6l.26.15a1.5 1.5 0 001.72-.37v-.3z" stroke="currentColor" strokeWidth="1.2"/><circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2"/></svg>
          </button>
        </div>
        <div className="home-header-row">
          <div>
            <h2 className="home-title">Your workflows</h2>
            <p className="home-subtitle">
              {workflows.length} workflow{workflows.length !== 1 ? 's' : ''} saved
            </p>
          </div>
          <button
            className="btn-primary"
            onClick={handleNewCapture}
            data-testid="new-capture-btn"
          >
            <span aria-hidden="true">+</span> New capture
          </button>
        </div>
      </header>

      <div className="workflow-list" data-testid="workflow-list">
        {workflows.map((wf) => (
          <button
            key={wf.id}
            className="card workflow-card"
            onClick={() => handleSelectWorkflow(wf.id)}
            data-testid={`workflow-card-${wf.id}`}
          >
            <div className="workflow-card-content">
              <div className="workflow-card-main">
                <h3 className="workflow-card-name">{wf.workflow.name}</h3>
                <p className="workflow-card-meta">
                  <span>{formatDate(wf.date)}</span>
                  <span className="meta-sep">&middot;</span>
                  <span>{formatDuration(wf.duration_ms)}</span>
                  <span className="meta-sep">&middot;</span>
                  <span>{wf.workflow.steps.length} step{wf.workflow.steps.length !== 1 ? 's' : ''}</span>
                  <span className="meta-sep">&middot;</span>
                  <span>{wf.workflow.open_questions.length} question{wf.workflow.open_questions.length !== 1 ? 's' : ''}</span>
                </p>
                <ConfidenceDots steps={wf.workflow.steps} />
              </div>
              <span className="workflow-card-arrow" aria-hidden="true">&rsaquo;</span>
            </div>
          </button>
        ))}
      </div>

      <footer className="home-footer" data-testid="home-footer">
        <p>Workflows are stored in your browser&apos;s localStorage and will not persist across devices or if browser data is cleared.</p>
      </footer>
    </div>
  );
}
