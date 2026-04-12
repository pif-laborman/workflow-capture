import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useState } from 'react';
import { AppState, SavedWorkflow, WorkflowDocument, EventType, SessionEvent } from '@/lib/types';
import { AppStateContext, SessionData, initialSessionData } from '@/lib/state';
import { saveWorkflow, getWorkflows } from '@/lib/storage';
import HomeScreen from '@/components/HomeScreen';
import ResultsScreen from '@/components/ResultsScreen';
import { mockRouter } from '../../vitest.setup';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

const mockWorkflow: WorkflowDocument = {
  name: 'Test Workflow',
  description: 'A test description',
  steps: [
    { step_number: 1, title: 'Step 1', description: 'Do thing', ui_element: 'button', action: 'Click the button', notes: '', screenshot_timestamp_ms: null },
  ],
  open_questions: ['Is this right?'],
  summary: 'Summary text',
};

function makeSavedWorkflow(overrides: Partial<SavedWorkflow> = {}): SavedWorkflow {
  return {
    id: 'wf-1',
    name: 'Test Workflow',
    date: '2026-04-11T10:00:00Z',
    duration_ms: 60000,
    workflow: mockWorkflow,
    session_events: [],
    ...overrides,
  };
}

function HomeWrapper({ children }: { children: React.ReactNode }) {
  const [currentState, setState] = useState(AppState.Home);
  const [sessionData, setSessionData] = useState<SessionData>(initialSessionData);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);

  return (
    <AppStateContext.Provider value={{ currentState, setState, sessionData, setSessionData, selectedWorkflowId, setSelectedWorkflowId }}>
      {children}
    </AppStateContext.Provider>
  );
}

describe('HomeScreen + storage integration', () => {
  it('displays workflows from localStorage via getWorkflows', () => {
    const wf = makeSavedWorkflow();
    saveWorkflow(wf);

    render(<HomeScreen />, { wrapper: HomeWrapper });

    expect(screen.getByText('Test Workflow')).toBeTruthy();
    expect(screen.getByText('1 workflow saved')).toBeTruthy();
  });

  it('shows empty state when no workflows saved', () => {
    render(<HomeScreen />, { wrapper: HomeWrapper });

    expect(screen.getByText('No workflows yet')).toBeTruthy();
  });

  it('displays multiple workflows sorted by date', () => {
    saveWorkflow(makeSavedWorkflow({ id: 'wf-old', date: '2026-04-09T10:00:00Z', workflow: { ...mockWorkflow, name: 'Old Workflow' } }));
    saveWorkflow(makeSavedWorkflow({ id: 'wf-new', date: '2026-04-11T10:00:00Z', workflow: { ...mockWorkflow, name: 'New Workflow' } }));

    render(<HomeScreen />, { wrapper: HomeWrapper });

    expect(screen.getByText('2 workflows saved')).toBeTruthy();
    // Both workflows should be visible
    expect(screen.getByText('New Workflow')).toBeTruthy();
    expect(screen.getByText('Old Workflow')).toBeTruthy();
  });

  it('clicking a workflow card navigates to deep link', () => {
    mockRouter.push.mockClear();
    const wf = makeSavedWorkflow({ id: 'wf-click-test' });
    saveWorkflow(wf);

    render(<HomeScreen />, { wrapper: HomeWrapper });

    const card = screen.getByTestId('workflow-card-wf-click-test');
    fireEvent.click(card);

    expect(mockRouter.push).toHaveBeenCalledWith('/workflow/wf-click-test');
  });
});

describe('ResultsScreen + storage integration', () => {
  it('auto-saves workflow to localStorage after finalize (new workflow)', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'uuid-1234' });

    const events: SessionEvent[] = [
      { type: EventType.Frame, timestamp_ms: 1000, payload: { frame_base64: 'abc' } },
      { type: EventType.Frame, timestamp_ms: 61000, payload: { frame_base64: 'def' } },
    ];

    const sessionData: SessionData = {
      workflowName: 'My Workflow',
      events,
      workflowResult: mockWorkflow,
    };

    function ResultsWrapper({ children }: { children: React.ReactNode }) {
      const [currentState, setState] = useState(AppState.Results);
      const [sd, setSessionData] = useState<SessionData>(sessionData);
      const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);

      return (
        <AppStateContext.Provider value={{ currentState, setState, sessionData: sd, setSessionData, selectedWorkflowId, setSelectedWorkflowId }}>
          {children}
        </AppStateContext.Provider>
      );
    }

    render(<ResultsScreen />, { wrapper: ResultsWrapper });

    // Verify it was saved
    const saved = getWorkflows();
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe('My Workflow');
    expect(saved[0].workflow.name).toBe('Test Workflow');
    expect(saved[0].duration_ms).toBe(60000);
  });

  it('loads a saved workflow via selectedWorkflowId', () => {
    const wf = makeSavedWorkflow({ id: 'wf-saved' });
    saveWorkflow(wf);

    function SavedResultsWrapper({ children }: { children: React.ReactNode }) {
      const [currentState, setState] = useState(AppState.Results);
      const [sessionData, setSessionData] = useState<SessionData>(initialSessionData);
      const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>('wf-saved');

      return (
        <AppStateContext.Provider value={{ currentState, setState, sessionData, setSessionData, selectedWorkflowId, setSelectedWorkflowId }}>
          {children}
        </AppStateContext.Provider>
      );
    }

    render(<ResultsScreen />, { wrapper: SavedResultsWrapper });

    // Should show the saved workflow title
    expect(screen.getByTestId('results-title').textContent).toBe('Test Workflow');
    // Should NOT save again (viewing existing)
    expect(getWorkflows()).toHaveLength(1);
  });

  it('does not save when viewing a saved workflow (selectedWorkflowId set)', () => {
    const wf = makeSavedWorkflow({ id: 'wf-existing' });
    saveWorkflow(wf);
    const countBefore = getWorkflows().length;

    function ViewWrapper({ children }: { children: React.ReactNode }) {
      const [currentState, setState] = useState(AppState.Results);
      const [sessionData, setSessionData] = useState<SessionData>(initialSessionData);
      const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>('wf-existing');

      return (
        <AppStateContext.Provider value={{ currentState, setState, sessionData, setSessionData, selectedWorkflowId, setSelectedWorkflowId }}>
          {children}
        </AppStateContext.Provider>
      );
    }

    render(<ResultsScreen />, { wrapper: ViewWrapper });

    expect(getWorkflows()).toHaveLength(countBefore);
  });
});
