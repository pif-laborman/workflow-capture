'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAppState } from '@/lib/state';
import { AppState, EventType, WorkflowDocument, WorkflowStep } from '@/lib/types';
import {
  saveWorkflow as persistWorkflow,
  getWorkflow as loadWorkflow,
  updateWorkflow,
} from '@/lib/storage';
import { getLogs } from '@/lib/logBuffer';

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function getConfidence(step: WorkflowStep): 'high' | 'medium' | 'low' {
  if (step.confidence) return step.confidence;
  if (!step.notes || step.notes.trim().length === 0) return 'high';
  if (step.notes.trim().length > 100) return 'low';
  return 'medium';
}

function confidenceLabel(c: 'high' | 'medium' | 'low'): string {
  return c.charAt(0).toUpperCase() + c.slice(1);
}

// Inline editable text field
interface EditableFieldProps {
  value: string;
  onSave: (value: string) => void;
  multiline?: boolean;
  className?: string;
  placeholder?: string;
}

function EditableField({ value, onSave, multiline, className, placeholder }: EditableFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  // Sync draft when value changes externally
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== value) {
      onSave(trimmed);
    }
  };

  const cancel = () => {
    setEditing(false);
    setDraft(value);
  };

  if (editing) {
    const sharedProps = {
      value: draft,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setDraft(e.target.value),
      onBlur: commit,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !multiline) {
          e.preventDefault();
          commit();
        }
        if (e.key === 'Enter' && multiline && e.metaKey) {
          e.preventDefault();
          commit();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
        }
      },
      className: `editable-input ${className || ''}`,
      placeholder,
    };

    if (multiline) {
      return (
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          rows={3}
          {...sharedProps}
        />
      );
    }
    return (
      <input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        type="text"
        {...sharedProps}
      />
    );
  }

  return (
    <span
      className={`editable-value ${className || ''} ${!value ? 'editable-placeholder' : ''}`}
      onClick={() => setEditing(true)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setEditing(true);
        }
      }}
      title="Click to edit"
    >
      {value || placeholder || 'Click to add...'}
    </span>
  );
}

interface StepCardProps {
  step: WorkflowStep;
  onUpdate: (field: keyof WorkflowStep, value: string) => void;
  onDelete: () => void;
  isDragOver?: boolean;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  onDragEnd: () => void;
}

function StepCard({ step, onUpdate, onDelete, isDragOver, onDragStart, onDragOver, onDrop, onDragEnd }: StepCardProps) {
  const [expanded, setExpanded] = useState(false);
  const confidence = getConfidence(step);

  return (
    <div
      className={`results-step-card card ${isDragOver ? 'step-card-drag-over' : ''}`}
      data-testid={`step-card-${step.step_number}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        onDragOver(e);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      onDragEnd={onDragEnd}
    >
      <div
        className="step-card-header"
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
        <span className="step-card-drag-handle" title="Drag to reorder" aria-label="Drag to reorder">⠿</span>
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
            <span className="step-detail-label">action</span>
            <EditableField
              value={step.action}
              onSave={(v) => onUpdate('action', v)}
              className="step-detail-value"
              placeholder="What happens in this step"
            />
          </div>
          <div className="step-detail-row">
            <span className="step-detail-label">intent</span>
            <EditableField
              value={step.description}
              onSave={(v) => onUpdate('description', v)}
              className="step-detail-value"
              multiline
              placeholder="Why this step exists"
            />
          </div>
          <div className="step-detail-row">
            <span className="step-detail-label">screen_context</span>
            <EditableField
              value={step.ui_element}
              onSave={(v) => onUpdate('ui_element', v)}
              className="step-detail-value"
              placeholder="UI element or screen area"
            />
          </div>
          <div className="step-detail-row">
            <span className="step-detail-label">notes</span>
            <EditableField
              value={step.notes}
              onSave={(v) => onUpdate('notes', v)}
              className="step-detail-value"
              multiline
              placeholder="Additional notes"
            />
          </div>
          <div className="step-card-actions">
            <button
              className="btn-delete-step"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              title="Remove this step"
            >
              Remove step
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CopyLogsButton() {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    const logs = getLogs();
    if (!logs) return;
    try {
      await navigator.clipboard.writeText(logs);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: open in new tab
      const w = window.open('', '_blank');
      if (w) {
        w.document.write(`<pre>${logs.replace(/</g, '&lt;')}</pre>`);
        w.document.close();
      }
    }
  };
  return (
    <button
      className="btn-outline"
      onClick={handleCopy}
      data-testid="copy-logs-btn"
    >
      {copied ? 'Copied!' : 'Copy logs'}
    </button>
  );
}

export default function ResultsScreen() {
  const { sessionData, setSessionData, setState, selectedWorkflowId, setSelectedWorkflowId } = useAppState();
  const router = useRouter();

  // Editable workflow state
  const [editableWorkflow, setEditableWorkflow] = useState<WorkflowDocument | null>(null);
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [sessionEvents, setSessionEvents] = useState(sessionData.events);
  const [workflowName, setWorkflowName] = useState(sessionData.workflowName);
  const [savedTranscript, setSavedTranscript] = useState('');
  const [mapSvg, setMapSvg] = useState<string | null>(null);
  const [mapGenerating, setMapGenerating] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  // Load data on mount
  useState(() => {
    if (selectedWorkflowId) {
      const found = loadWorkflow(selectedWorkflowId);
      if (found) {
        setEditableWorkflow(structuredClone(found.workflow));
        setWorkflowId(found.id);
        setDurationMs(found.duration_ms);
        setSessionEvents(found.session_events);
        setWorkflowName(found.name);
        setSavedTranscript(found.transcript || '');
        if (found.map_svg) setMapSvg(found.map_svg);
      }
    } else {
      if (sessionData.workflowResult) {
        setEditableWorkflow(structuredClone(sessionData.workflowResult));
      }
      if (sessionData.events.length >= 2) {
        const timestamps = sessionData.events.map(e => e.timestamp_ms);
        setDurationMs(Math.max(...timestamps) - Math.min(...timestamps));
      }
    }
  });

  // Persist changes to localStorage
  const persistChanges = useCallback((updated: WorkflowDocument) => {
    if (!workflowId) return;
    try {
      updateWorkflow(workflowId, { workflow: updated });
    } catch {
      // Ignore storage errors
    }
  }, [workflowId]);

  // Step mutations
  const updateStep = useCallback((stepNumber: number, field: keyof WorkflowStep, value: string) => {
    setEditableWorkflow((prev) => {
      if (!prev) return prev;
      const updated = {
        ...prev,
        steps: prev.steps.map((s) =>
          s.step_number === stepNumber ? { ...s, [field]: value } : s
        ),
      };
      persistChanges(updated);
      return updated;
    });
  }, [persistChanges]);

  const deleteStep = useCallback((stepNumber: number) => {
    setEditableWorkflow((prev) => {
      if (!prev) return prev;
      const filtered = prev.steps
        .filter((s) => s.step_number !== stepNumber)
        .map((s, i) => ({ ...s, step_number: i + 1 }));
      const updated = { ...prev, steps: filtered };
      persistChanges(updated);
      return updated;
    });
  }, [persistChanges]);

  // Drag and drop reordering
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);

  const reorderSteps = useCallback((fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    setEditableWorkflow((prev) => {
      if (!prev) return prev;
      const steps = [...prev.steps];
      const [moved] = steps.splice(fromIdx, 1);
      steps.splice(toIdx, 0, moved);
      const renumbered = steps.map((s, i) => ({ ...s, step_number: i + 1 }));
      const updated = { ...prev, steps: renumbered };
      persistChanges(updated);
      return updated;
    });
  }, [persistChanges]);

  const addStep = useCallback(() => {
    setEditableWorkflow((prev) => {
      if (!prev) return prev;
      const newStep: WorkflowStep = {
        step_number: prev.steps.length + 1,
        title: '',
        description: '',
        ui_element: '',
        action: 'New step',
        notes: '',
        screenshot_timestamp_ms: null,
      };
      const updated = { ...prev, steps: [...prev.steps, newStep] };
      persistChanges(updated);
      return updated;
    });
  }, [persistChanges]);

  // Open question mutations
  const updateQuestion = useCallback((index: number, value: string) => {
    setEditableWorkflow((prev) => {
      if (!prev) return prev;
      const questions = [...prev.open_questions];
      questions[index] = value;
      const updated = { ...prev, open_questions: questions };
      persistChanges(updated);
      return updated;
    });
  }, [persistChanges]);

  const deleteQuestion = useCallback((index: number) => {
    setEditableWorkflow((prev) => {
      if (!prev) return prev;
      const questions = prev.open_questions.filter((_, i) => i !== index);
      const updated = { ...prev, open_questions: questions };
      persistChanges(updated);
      return updated;
    });
  }, [persistChanges]);

  const addQuestion = useCallback(() => {
    setEditableWorkflow((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, open_questions: [...prev.open_questions, ''] };
      persistChanges(updated);
      return updated;
    });
  }, [persistChanges]);

  // Workflow-level field updates
  const updateWorkflowField = useCallback((field: 'name' | 'description' | 'summary', value: string) => {
    setEditableWorkflow((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, [field]: value };
      persistChanges(updated);
      return updated;
    });
  }, [persistChanges]);

  // Generate process map (streamed to avoid Vercel timeout)
  const handleGenerateMap = useCallback(async () => {
    if (!editableWorkflow) return;
    setMapGenerating(true);
    setMapError(null);
    setMapSvg(null);
    try {
      const res = await fetch('/api/generate-map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow: editableWorkflow }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to generate map');
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response stream');
      const decoder = new TextDecoder();
      let accumulated = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
      }
      // Strip markdown fences if present
      let svg = accumulated.trim();
      if (svg.startsWith('```')) {
        svg = svg.replace(/^```(?:svg|xml)?\s*/, '').replace(/\s*```$/, '');
      }
      if (!svg.includes('<svg')) {
        throw new Error('Generated content is not valid SVG');
      }
      setMapSvg(svg);
      if (workflowId) {
        updateWorkflow(workflowId, { map_svg: svg });
      }
    } catch (err) {
      setMapError(err instanceof Error ? err.message : 'Failed to generate map');
    } finally {
      setMapGenerating(false);
    }
  }, [editableWorkflow, workflowId]);

  // Save on first render for newly processed workflows
  const doSave = useCallback(() => {
    if (!editableWorkflow || selectedWorkflowId) return;
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

      const id = crypto.randomUUID();
      persistWorkflow({
        id,
        name: workflowName || editableWorkflow.name,
        date: new Date().toISOString(),
        duration_ms: durationMs,
        workflow: editableWorkflow,
        session_events: lightEvents,
        transcript: transcript || undefined,
      });
      setWorkflowId(id);
      setSavedTranscript(transcript);
    } catch {
      // Ignore storage errors
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save on mount (only for newly processed workflows)
  useState(() => {
    doSave();
  });

  // Build transcript
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

  if (!editableWorkflow) {
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

  const workflow = editableWorkflow;
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
    setTimeout(() => setState(AppState.NewCapture), 50);
  };

  return (
    <div className="results-screen" data-testid="results-screen">
      <div className="results-content">
        {/* Header */}
        <div className="results-header">
          <div className="results-success-icon" data-testid="results-success-icon">✓</div>
          <h1 className="results-title" data-testid="results-title">
            <EditableField
              value={workflow.name}
              onSave={(v) => updateWorkflowField('name', v)}
              className="editable-title"
              placeholder="Workflow name"
            />
          </h1>
        </div>

        {/* Description */}
        {(workflow.description || workflowId) && (
          <div className="results-description">
            <EditableField
              value={workflow.description}
              onSave={(v) => updateWorkflowField('description', v)}
              className="editable-description"
              multiline
              placeholder="Add a description..."
            />
          </div>
        )}

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
            {workflow.steps.map((step, idx) => (
              <StepCard
                key={step.step_number}
                step={step}
                onUpdate={(field, value) => updateStep(step.step_number, field, value)}
                onDelete={() => deleteStep(step.step_number)}
                isDragOver={dropIdx === idx && dragIdx !== idx}
                onDragStart={() => setDragIdx(idx)}
                onDragOver={() => setDropIdx(idx)}
                onDrop={() => {
                  if (dragIdx !== null) reorderSteps(dragIdx, idx);
                  setDragIdx(null);
                  setDropIdx(null);
                }}
                onDragEnd={() => {
                  setDragIdx(null);
                  setDropIdx(null);
                }}
              />
            ))}
          </div>
          <button
            className="btn-add-step"
            onClick={addStep}
            data-testid="add-step-btn"
          >
            + Add step
          </button>
        </div>

        {/* Process map section */}
        <div className="results-section">
          <div className="results-map-header">
            <h2 className="results-section-heading">Process map</h2>
            <button
              className={mapSvg ? 'btn-outline' : 'btn-primary'}
              onClick={handleGenerateMap}
              disabled={mapGenerating}
              data-testid="generate-map-btn"
            >
              {mapGenerating ? 'Generating...' : mapSvg ? 'Regenerate' : 'Generate map'}
            </button>
          </div>
          {mapError && (
            <p className="results-map-error">{mapError}</p>
          )}
          {mapSvg && (
            <div
              className="results-map-container"
              data-testid="process-map"
              dangerouslySetInnerHTML={{ __html: mapSvg }}
            />
          )}
        </div>

        {/* Open questions section */}
        <div className="results-questions-section" data-testid="results-questions">
          <h2 className="results-section-heading">Open questions</h2>
          {questionCount === 0 && (
            <p className="results-questions-explanation">No open questions.</p>
          )}
          <ol className="results-questions-list" data-testid="questions-list">
            {workflow.open_questions.map((q, i) => (
              <li key={i} className="results-question-item" data-testid={`question-${i}`}>
                <EditableField
                  value={q}
                  onSave={(v) => updateQuestion(i, v)}
                  className="editable-question"
                  placeholder="Type a question..."
                />
                <button
                  className="btn-delete-question"
                  onClick={() => deleteQuestion(i)}
                  title="Remove question"
                  aria-label="Remove question"
                >
                  ×
                </button>
              </li>
            ))}
          </ol>
          <button
            className="btn-add-step"
            onClick={addQuestion}
            data-testid="add-question-btn"
          >
            + Add question
          </button>
        </div>

        {/* Summary */}
        {(workflow.summary || workflowId) && (
          <div className="results-section">
            <h2 className="results-section-heading">Summary</h2>
            <EditableField
              value={workflow.summary}
              onSave={(v) => updateWorkflowField('summary', v)}
              className="editable-summary"
              multiline
              placeholder="Process summary..."
            />
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
          <CopyLogsButton />
        </div>
      </div>
    </div>
  );
}
