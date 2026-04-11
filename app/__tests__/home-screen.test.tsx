import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useState } from 'react';
import { AppState, SavedWorkflow } from '@/lib/types';
import { AppStateContext, initialSessionData } from '@/lib/state';
import HomeScreen from '@/components/HomeScreen';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const STORAGE_KEY = 'workflow-capture-sessions';

function makeSavedWorkflow(overrides: Partial<SavedWorkflow> = {}): SavedWorkflow {
  return {
    id: 'wf-1',
    name: 'Test Workflow',
    date: '2026-04-11T10:00:00Z',
    duration_ms: 125000,
    workflow: {
      name: 'Test Workflow',
      description: 'A test workflow',
      steps: [
        { step_number: 1, title: 'Step 1', description: 'Do thing', ui_element: 'button', action: 'click', notes: '', screenshot_timestamp_ms: null },
        { step_number: 2, title: 'Step 2', description: 'Check result', ui_element: 'panel', action: 'verify', notes: 'Might need review', screenshot_timestamp_ms: 1000 },
      ],
      open_questions: ['Is step 2 correct?'],
      summary: 'A test summary',
    },
    session_events: [],
    ...overrides,
  };
}

function createWrapper() {
  let capturedState = AppState.Home;
  let capturedWorkflowId: string | null = null;

  function Wrapper({ children }: { children: React.ReactNode }) {
    const [currentState, setState] = useState(AppState.Home);
    const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);

    capturedState = currentState;
    capturedWorkflowId = selectedWorkflowId;

    // Expose setters via a side channel
    (Wrapper as unknown as Record<string, unknown>).__setState = setState;
    (Wrapper as unknown as Record<string, unknown>).__setSelectedWorkflowId = setSelectedWorkflowId;

    return (
      <AppStateContext.Provider
        value={{
          currentState,
          setState,
          sessionData: initialSessionData,
          setSessionData: () => {},
          selectedWorkflowId,
          setSelectedWorkflowId,
        }}
      >
        {children}
      </AppStateContext.Provider>
    );
  }

  return {
    Wrapper,
    getState: () => capturedState,
    getWorkflowId: () => capturedWorkflowId,
  };
}

describe('HomeScreen — empty state', () => {
  it('shows "No workflows yet" message when localStorage is empty', () => {
    const { Wrapper } = createWrapper();
    render(<Wrapper><HomeScreen /></Wrapper>);
    expect(screen.getByTestId('home-empty')).toBeTruthy();
    expect(screen.getByText('No workflows yet')).toBeTruthy();
  });

  it('shows "Start your first capture" CTA button', () => {
    const { Wrapper } = createWrapper();
    render(<Wrapper><HomeScreen /></Wrapper>);
    expect(screen.getByTestId('start-first-capture')).toBeTruthy();
    expect(screen.getByText('Start your first capture')).toBeTruthy();
  });

  it('shows footer with localStorage warning', () => {
    const { Wrapper } = createWrapper();
    render(<Wrapper><HomeScreen /></Wrapper>);
    const footer = screen.getByTestId('home-footer');
    expect(footer).toBeTruthy();
    expect(footer.textContent).toContain('localStorage');
  });

  it('clicking CTA navigates to new-capture state', () => {
    const { Wrapper, getState } = createWrapper();
    render(<Wrapper><HomeScreen /></Wrapper>);
    fireEvent.click(screen.getByTestId('start-first-capture'));
    expect(getState()).toBe(AppState.NewCapture);
  });
});

describe('HomeScreen — populated state', () => {
  beforeEach(() => {
    const workflows = [
      makeSavedWorkflow({ id: 'wf-1', name: 'Login Flow', workflow: { ...makeSavedWorkflow().workflow, name: 'Login Flow' } }),
      makeSavedWorkflow({
        id: 'wf-2',
        name: 'Checkout Process',
        date: '2026-04-10T14:30:00Z',
        duration_ms: 300000,
        workflow: {
          name: 'Checkout Process',
          description: 'Checkout',
          steps: [
            { step_number: 1, title: 'Add to cart', description: 'Add item', ui_element: 'button', action: 'click', notes: '', screenshot_timestamp_ms: null },
          ],
          open_questions: [],
          summary: 'Checkout flow',
        },
      }),
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workflows));
  });

  it('renders workflow list with correct count', () => {
    const { Wrapper } = createWrapper();
    render(<Wrapper><HomeScreen /></Wrapper>);
    expect(screen.getByTestId('workflow-list')).toBeTruthy();
    expect(screen.getByText('2 workflows saved')).toBeTruthy();
  });

  it('shows "Your workflows" heading and brand', () => {
    const { Wrapper } = createWrapper();
    render(<Wrapper><HomeScreen /></Wrapper>);
    expect(screen.getByText('Your workflows')).toBeTruthy();
    expect(screen.getByText('workflow capture')).toBeTruthy();
  });

  it('renders workflow cards with name, date, step count, and question count', () => {
    const { Wrapper } = createWrapper();
    render(<Wrapper><HomeScreen /></Wrapper>);

    // First workflow
    const card1 = screen.getByTestId('workflow-card-wf-1');
    expect(card1.textContent).toContain('Login Flow');
    expect(card1.textContent).toContain('2 steps');
    expect(card1.textContent).toContain('1 question');

    // Second workflow
    const card2 = screen.getByTestId('workflow-card-wf-2');
    expect(card2.textContent).toContain('Checkout Process');
    expect(card2.textContent).toContain('1 step');
    expect(card2.textContent).toContain('0 questions');
  });

  it('renders confidence dots per step', () => {
    const { Wrapper } = createWrapper();
    render(<Wrapper><HomeScreen /></Wrapper>);
    const dots = screen.getAllByTestId('confidence-dots');
    expect(dots.length).toBe(2);
    // First workflow has 2 steps -> 2 dots
    expect(dots[0].children.length).toBe(2);
    // Second workflow has 1 step -> 1 dot
    expect(dots[1].children.length).toBe(1);
  });

  it('shows "New capture" button with plus icon', () => {
    const { Wrapper } = createWrapper();
    render(<Wrapper><HomeScreen /></Wrapper>);
    const btn = screen.getByTestId('new-capture-btn');
    expect(btn.textContent).toContain('New capture');
    expect(btn.textContent).toContain('+');
  });

  it('clicking "New capture" navigates to new-capture state', () => {
    const { Wrapper, getState } = createWrapper();
    render(<Wrapper><HomeScreen /></Wrapper>);
    fireEvent.click(screen.getByTestId('new-capture-btn'));
    expect(getState()).toBe(AppState.NewCapture);
  });

  it('clicking a workflow card navigates to results with selectedWorkflowId set', () => {
    const { Wrapper, getState, getWorkflowId } = createWrapper();
    render(<Wrapper><HomeScreen /></Wrapper>);
    fireEvent.click(screen.getByTestId('workflow-card-wf-2'));
    expect(getState()).toBe(AppState.Results);
    expect(getWorkflowId()).toBe('wf-2');
  });

  it('shows footer with localStorage warning', () => {
    const { Wrapper } = createWrapper();
    render(<Wrapper><HomeScreen /></Wrapper>);
    const footer = screen.getByTestId('home-footer');
    expect(footer.textContent).toContain('localStorage');
  });

  it('displays formatted duration', () => {
    const { Wrapper } = createWrapper();
    render(<Wrapper><HomeScreen /></Wrapper>);
    // 125000ms = 2m 5s
    const card = screen.getByTestId('workflow-card-wf-1');
    expect(card.textContent).toContain('2m 5s');
  });
});

describe('HomeScreen — edge cases', () => {
  it('handles corrupted localStorage gracefully', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json{{{');
    const { Wrapper } = createWrapper();
    render(<Wrapper><HomeScreen /></Wrapper>);
    // Falls back to empty state
    expect(screen.getByTestId('home-empty')).toBeTruthy();
  });

  it('uses singular "workflow" for count of 1', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([makeSavedWorkflow()]));
    const { Wrapper } = createWrapper();
    render(<Wrapper><HomeScreen /></Wrapper>);
    expect(screen.getByText('1 workflow saved')).toBeTruthy();
  });
});
