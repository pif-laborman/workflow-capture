import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { AppState, EventType, SessionEvent, WorkflowDocument, WorkflowStep } from '@/lib/types';
import { AppStateContext, SessionData, initialSessionData } from '@/lib/state';
import ResultsScreen from '@/components/ResultsScreen';
import { mockRouter } from '../../vitest.setup';

// --- Helpers ---

const mockSetState = vi.fn();
const mockSetSessionData = vi.fn();
const mockSetSelectedWorkflowId = vi.fn();

function makeStep(overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return {
    step_number: 1,
    title: 'Step one',
    description: 'Do something important',
    ui_element: 'Submit button',
    action: 'Click the submit button',
    notes: '',
    screenshot_timestamp_ms: null,
    ...overrides,
  };
}

function makeWorkflow(overrides: Partial<WorkflowDocument> = {}): WorkflowDocument {
  return {
    name: 'Test Workflow',
    description: 'A test workflow',
    steps: [makeStep()],
    open_questions: [],
    summary: 'Test summary',
    ...overrides,
  };
}

function makeEvents(durationMs: number): SessionEvent[] {
  return [
    { type: EventType.Frame, timestamp_ms: 1000, payload: { frame_base64: 'abc' } },
    { type: EventType.Transcript, timestamp_ms: 1000 + durationMs, payload: { text: 'done', isFinal: true } },
  ];
}

function renderWithContext(
  sessionOverrides: Partial<SessionData> = {},
  selectedWorkflowId: string | null = null,
) {
  const data: SessionData = {
    ...initialSessionData,
    workflowResult: makeWorkflow(),
    events: makeEvents(60000),
    ...sessionOverrides,
  };

  return render(
    <AppStateContext.Provider
      value={{
        currentState: AppState.Results,
        setState: mockSetState,
        sessionData: data,
        setSessionData: mockSetSessionData,
        selectedWorkflowId,
        setSelectedWorkflowId: mockSetSelectedWorkflowId,
      }}
    >
      <ResultsScreen />
    </AppStateContext.Provider>,
  );
}

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();

// Mock crypto.randomUUID
const mockRandomUUID = vi.fn(() => 'test-uuid-123');

beforeEach(() => {
  vi.stubGlobal('localStorage', localStorageMock);
  vi.stubGlobal('crypto', { randomUUID: mockRandomUUID });
  localStorageMock.clear();
  mockSetState.mockClear();
  mockSetSessionData.mockClear();
  mockSetSelectedWorkflowId.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// --- Tests ---

describe('ResultsScreen', () => {
  describe('Header rendering', () => {
    it('renders green check icon and workflow title', () => {
      renderWithContext();
      const icon = screen.getByTestId('results-success-icon');
      expect(icon.textContent).toBe('✓');
      expect(screen.getByTestId('results-title').textContent).toBe('Test Workflow');
    });

    it('renders custom workflow title', () => {
      renderWithContext({ workflowResult: makeWorkflow({ name: 'My Custom Flow' }) });
      expect(screen.getByTestId('results-title').textContent).toBe('My Custom Flow');
    });
  });

  describe('Stats row', () => {
    it('shows correct step count', () => {
      const workflow = makeWorkflow({
        steps: [makeStep({ step_number: 1 }), makeStep({ step_number: 2 }), makeStep({ step_number: 3 })],
      });
      renderWithContext({ workflowResult: workflow });
      expect(screen.getByTestId('stat-steps').textContent).toBe('3');
    });

    it('shows correct open questions count', () => {
      const workflow = makeWorkflow({
        open_questions: ['Q1?', 'Q2?'],
      });
      renderWithContext({ workflowResult: workflow });
      expect(screen.getByTestId('stat-questions').textContent).toBe('2');
    });

    it('shows duration', () => {
      renderWithContext({ events: makeEvents(90000) }); // 1m 30s
      expect(screen.getByTestId('stat-duration').textContent).toBe('1m 30s');
    });
  });

  describe('Step cards', () => {
    it('renders correct number of step cards', () => {
      const workflow = makeWorkflow({
        steps: [
          makeStep({ step_number: 1, action: 'Click A' }),
          makeStep({ step_number: 2, action: 'Click B' }),
          makeStep({ step_number: 3, action: 'Click C' }),
        ],
      });
      renderWithContext({ workflowResult: workflow });
      expect(screen.getByTestId('step-card-1')).toBeTruthy();
      expect(screen.getByTestId('step-card-2')).toBeTruthy();
      expect(screen.getByTestId('step-card-3')).toBeTruthy();
    });

    it('displays step number with zero padding', () => {
      renderWithContext();
      const numbers = screen.getAllByTestId('step-number');
      expect(numbers[0].textContent).toBe('01');
    });

    it('displays action text', () => {
      renderWithContext();
      const actions = screen.getAllByTestId('step-action');
      expect(actions[0].textContent).toBe('Click the submit button');
    });

    it('renders high confidence badge (green) when no notes', () => {
      renderWithContext({ workflowResult: makeWorkflow({ steps: [makeStep({ notes: '' })] }) });
      const badge = screen.getByTestId('step-confidence');
      expect(badge.textContent).toBe('High');
      expect(badge.classList.contains('pill-confidence-high')).toBe(true);
    });

    it('renders medium confidence badge (yellow) when short notes', () => {
      renderWithContext({ workflowResult: makeWorkflow({ steps: [makeStep({ notes: 'Some note' })] }) });
      const badge = screen.getByTestId('step-confidence');
      expect(badge.textContent).toBe('Medium');
      expect(badge.classList.contains('pill-confidence-medium')).toBe(true);
    });

    it('renders low confidence badge (red) when long notes', () => {
      const longNotes = 'This is a very long note that exceeds one hundred characters because it has a lot of detail about the uncertainty of this particular step.';
      renderWithContext({ workflowResult: makeWorkflow({ steps: [makeStep({ notes: longNotes })] }) });
      const badge = screen.getByTestId('step-confidence');
      expect(badge.textContent).toBe('Low');
      expect(badge.classList.contains('pill-confidence-low')).toBe(true);
    });

    it('uses explicit confidence field when provided', () => {
      renderWithContext({
        workflowResult: makeWorkflow({
          steps: [makeStep({ confidence: 'low', notes: '' })],
        }),
      });
      const badge = screen.getByTestId('step-confidence');
      expect(badge.textContent).toBe('Low');
      expect(badge.classList.contains('pill-confidence-low')).toBe(true);
    });

    it('expands on click to show intent, screen_context, and open_questions', () => {
      const step = makeStep({
        description: 'Navigate to settings',
        ui_element: 'Settings gear icon',
        notes: 'User might need admin access',
      });
      renderWithContext({ workflowResult: makeWorkflow({ steps: [step] }) });

      // Not expanded initially
      expect(screen.queryByTestId('step-details')).toBeNull();

      // Click to expand
      fireEvent.click(screen.getByTestId('step-card-1'));

      const details = screen.getByTestId('step-details');
      expect(details).toBeTruthy();
      expect(details.textContent).toContain('intent');
      expect(details.textContent).toContain('Navigate to settings');
      expect(details.textContent).toContain('screen_context');
      expect(details.textContent).toContain('Settings gear icon');
      expect(details.textContent).toContain('open_questions');
      expect(details.textContent).toContain('User might need admin access');
    });

    it('collapses on second click', () => {
      renderWithContext();
      fireEvent.click(screen.getByTestId('step-card-1'));
      expect(screen.getByTestId('step-details')).toBeTruthy();
      fireEvent.click(screen.getByTestId('step-card-1'));
      expect(screen.queryByTestId('step-details')).toBeNull();
    });
  });

  describe('Open questions section', () => {
    it('renders open questions with warm background', () => {
      const workflow = makeWorkflow({
        open_questions: ['Why is this step needed?', 'What happens on failure?'],
      });
      renderWithContext({ workflowResult: workflow });

      const section = screen.getByTestId('results-questions');
      expect(section).toBeTruthy();
      expect(section.classList.contains('results-questions-section')).toBe(true);

      expect(screen.getByTestId('question-0').textContent).toBe('Why is this step needed?');
      expect(screen.getByTestId('question-1').textContent).toBe('What happens on failure?');
    });

    it('renders explanation text', () => {
      const workflow = makeWorkflow({ open_questions: ['Q?'] });
      renderWithContext({ workflowResult: workflow });
      const section = screen.getByTestId('results-questions');
      expect(section.textContent).toContain('These questions were identified');
    });

    it('does not render questions section when empty', () => {
      renderWithContext({ workflowResult: makeWorkflow({ open_questions: [] }) });
      expect(screen.queryByTestId('results-questions')).toBeNull();
    });
  });

  describe('Download buttons', () => {
    it('renders both download buttons', () => {
      renderWithContext();
      expect(screen.getByTestId('download-workflow-btn')).toBeTruthy();
      expect(screen.getByTestId('download-session-btn')).toBeTruthy();
    });

    it('download workflow.json creates correct blob', () => {
      // Track anchors appended to body for download
      const clickedAnchors: HTMLAnchorElement[] = [];
      const origCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = origCreateElement(tag);
        if (tag === 'a') {
          vi.spyOn(el as HTMLAnchorElement, 'click').mockImplementation(() => {
            clickedAnchors.push(el as HTMLAnchorElement);
          });
        }
        return el;
      });

      const mockCreateObjectURL = vi.fn<(obj: Blob) => string>(() => 'blob:test-url');
      const mockRevokeObjectURL = vi.fn();
      vi.stubGlobal('URL', { createObjectURL: mockCreateObjectURL, revokeObjectURL: mockRevokeObjectURL });

      renderWithContext();
      fireEvent.click(screen.getByTestId('download-workflow-btn'));

      expect(mockCreateObjectURL).toHaveBeenCalledOnce();
      const blob = mockCreateObjectURL.mock.calls[0]![0];
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('application/json');
      expect(clickedAnchors).toHaveLength(1);
      expect(clickedAnchors[0].download).toBe('workflow.json');
    });

    it('download session-raw.json creates correct blob', () => {
      const clickedAnchors: HTMLAnchorElement[] = [];
      const origCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = origCreateElement(tag);
        if (tag === 'a') {
          vi.spyOn(el as HTMLAnchorElement, 'click').mockImplementation(() => {
            clickedAnchors.push(el as HTMLAnchorElement);
          });
        }
        return el;
      });

      const mockCreateObjectURL = vi.fn<(obj: Blob) => string>(() => 'blob:test-url');
      const mockRevokeObjectURL = vi.fn();
      vi.stubGlobal('URL', { createObjectURL: mockCreateObjectURL, revokeObjectURL: mockRevokeObjectURL });

      renderWithContext();
      fireEvent.click(screen.getByTestId('download-session-btn'));

      expect(mockCreateObjectURL).toHaveBeenCalledOnce();
      const blob = mockCreateObjectURL.mock.calls[0]![0];
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('application/json');
      expect(clickedAnchors).toHaveLength(1);
      expect(clickedAnchors[0].download).toBe('session-raw.json');
    });
  });

  describe('Footer navigation', () => {
    it('All workflows button navigates to home', () => {
      mockRouter.push.mockClear();
      renderWithContext();
      fireEvent.click(screen.getByTestId('all-workflows-btn'));
      expect(mockRouter.push).toHaveBeenCalledWith('/');
    });

    it('New capture button navigates to home', () => {
      mockRouter.push.mockClear();
      renderWithContext();
      fireEvent.click(screen.getByTestId('new-capture-btn'));
      expect(mockRouter.push).toHaveBeenCalledWith('/');
      expect(mockSetSelectedWorkflowId).toHaveBeenCalledWith(null);
    });
  });

  describe('No workflow fallback', () => {
    it('shows fallback when no workflow data', () => {
      renderWithContext({ workflowResult: null, events: [] });
      expect(screen.getByText('No workflow data available.')).toBeTruthy();
    });
  });
});
