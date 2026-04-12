import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';
import { AppState, EventType, SessionEvent, WorkflowDocument } from '@/lib/types';
import { AppStateContext, SessionData, initialSessionData } from '@/lib/state';
import ProcessingScreen from '@/components/ProcessingScreen';

// --- Helpers ---

const mockSetState = vi.fn();
const mockSetSessionData = vi.fn();

function makeEvents(frameCount: number, interjectionCount: number, durationMs: number): SessionEvent[] {
  const events: SessionEvent[] = [];
  const startMs = 1000;
  for (let i = 0; i < frameCount; i++) {
    events.push({
      type: EventType.Frame,
      timestamp_ms: startMs + (i * (durationMs / Math.max(frameCount, 1))),
      payload: { frame_base64: 'data:image/jpeg;base64,abc' },
    });
  }
  for (let i = 0; i < interjectionCount; i++) {
    events.push({
      type: EventType.Interjection,
      timestamp_ms: startMs + (i * 10000),
      payload: { message: `Q${i}`, reason: 'missing_why' },
    });
  }
  // Ensure duration by adding a transcript at the end
  if (frameCount > 0 || interjectionCount > 0) {
    events.push({
      type: EventType.Transcript,
      timestamp_ms: startMs + durationMs,
      payload: { text: 'done', isFinal: true },
    });
  }
  return events;
}

const sampleWorkflow: WorkflowDocument = {
  name: 'Test Workflow',
  description: 'A test workflow',
  steps: [
    {
      step_number: 1,
      title: 'Step one',
      description: 'Do something',
      ui_element: 'button',
      action: 'click',
      notes: '',
      screenshot_timestamp_ms: null,
    },
  ],
  open_questions: [],
  summary: 'Test summary',
};

function renderWithContext(sessionData?: Partial<SessionData>) {
  const data: SessionData = {
    ...initialSessionData,
    workflowName: 'Test Workflow',
    events: makeEvents(47, 5, 202000), // 3 min 22 sec
    ...sessionData,
  };
  return render(
    <AppStateContext.Provider
      value={{
        currentState: AppState.Processing,
        setState: mockSetState,
        sessionData: data,
        setSessionData: mockSetSessionData,
        selectedWorkflowId: null,
        setSelectedWorkflowId: vi.fn(),
      }}
    >
      <ProcessingScreen />
    </AppStateContext.Provider>,
  );
}

// Mock fetch globally
const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockSetState.mockClear();
  mockSetSessionData.mockClear();
  mockFetch.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Helper to create a streaming response
function createStreamResponse(chunks: string[], status = 200) {
  let chunkIndex = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (chunkIndex < chunks.length) {
        controller.enqueue(new TextEncoder().encode(chunks[chunkIndex]));
        chunkIndex++;
      } else {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

function createJsonErrorResponse(error: string, status = 500) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ProcessingScreen', () => {
  describe('rendering', () => {
    it('shows spinner and headline', () => {
      mockFetch.mockReturnValue(new Promise(() => {})); // never resolves
      renderWithContext();

      expect(screen.getByTestId('processing-spinner')).toBeDefined();
      expect(screen.getByTestId('processing-headline').textContent).toBe('Building your workflow');
    });

    it('shows input summary with frame count, duration, and interjection count', () => {
      mockFetch.mockReturnValue(new Promise(() => {}));
      renderWithContext();

      const summary = screen.getByTestId('processing-summary').textContent;
      expect(summary).toContain('47 frames');
      expect(summary).toContain('3 min 22 sec');
      expect(summary).toContain('5 interjections');
    });

    it('shows singular interjection when count is 1', () => {
      mockFetch.mockReturnValue(new Promise(() => {}));
      renderWithContext({ events: makeEvents(10, 1, 60000) });

      const summary = screen.getByTestId('processing-summary').textContent;
      expect(summary).toContain('1 interjection');
      expect(summary).not.toContain('interjections');
    });

    it('shows progress steps', () => {
      mockFetch.mockReturnValue(new Promise(() => {}));
      renderWithContext();

      const steps = screen.getByTestId('processing-steps');
      expect(steps.querySelectorAll('li').length).toBe(3);
      expect(steps.textContent).toContain('Analyzing screen recordings...');
      expect(steps.textContent).toContain('Processing transcript...');
      expect(steps.textContent).toContain('Generating workflow steps...');
    });
  });

  describe('streaming finalize', () => {
    it('POSTs events and workflow name to /api/finalize', async () => {
      mockFetch.mockReturnValue(new Promise(() => {}));
      renderWithContext();

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('/api/finalize');
      expect(options.method).toBe('POST');
      const body = JSON.parse(options.body);
      expect(body.workflow_name).toBe('Test Workflow');
      expect(Array.isArray(body.events)).toBe(true);
    });

    it('parses streamed JSON and transitions to Results', async () => {
      const json = JSON.stringify(sampleWorkflow);
      mockFetch.mockResolvedValue(createStreamResponse([json.slice(0, 50), json.slice(50)]));

      await act(async () => {
        renderWithContext();
      });

      await waitFor(() => {
        expect(mockSetState).toHaveBeenCalledWith(AppState.Results);
      });

      expect(mockSetSessionData).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowResult: expect.objectContaining({ name: 'Test Workflow' }),
        }),
      );
    });

    it('parses JSON wrapped in markdown code blocks', async () => {
      const json = '```json\n' + JSON.stringify(sampleWorkflow) + '\n```';
      mockFetch.mockResolvedValue(createStreamResponse([json]));

      await act(async () => {
        renderWithContext();
      });

      await waitFor(() => {
        expect(mockSetState).toHaveBeenCalledWith(AppState.Results);
      });
    });

    it('uses default workflow name when empty', async () => {
      mockFetch.mockReturnValue(new Promise(() => {}));
      renderWithContext({ workflowName: '' });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.workflow_name).toBe('Untitled Workflow');
    });
  });

  describe('error states', () => {
    it('shows API key error with specific message', async () => {
      mockFetch.mockResolvedValue(
        createJsonErrorResponse('ANTHROPIC_API_KEY is not configured. Please set it in your environment variables.'),
      );

      await act(async () => {
        renderWithContext();
      });

      await waitFor(() => {
        expect(screen.getByTestId('processing-error-headline').textContent).toBe('API key not configured');
      });

      expect(screen.getByTestId('processing-error-message')).toBeDefined();
      // API key error should not show retry button
      expect(screen.queryByTestId('processing-retry-btn')).toBeNull();
      expect(screen.getByTestId('processing-home-btn')).toBeDefined();
    });

    it('shows generic error with retry and home buttons', async () => {
      mockFetch.mockResolvedValue(createJsonErrorResponse('Something failed', 500));

      await act(async () => {
        renderWithContext();
      });

      await waitFor(() => {
        expect(screen.getByTestId('processing-error-headline').textContent).toBe('Something went wrong');
      });

      expect(screen.getByTestId('processing-retry-btn')).toBeDefined();
      expect(screen.getByTestId('processing-home-btn')).toBeDefined();
    });

    it('shows error when streamed JSON is invalid', async () => {
      mockFetch.mockResolvedValue(createStreamResponse(['not valid json at all']));

      await act(async () => {
        renderWithContext();
      });

      await waitFor(() => {
        expect(screen.getByTestId('processing-error-message')).toBeDefined();
      });
    });

    it('shows error when workflow document is missing required fields', async () => {
      mockFetch.mockResolvedValue(createStreamResponse([JSON.stringify({ foo: 'bar' })]));

      await act(async () => {
        renderWithContext();
      });

      await waitFor(() => {
        expect(screen.getByTestId('processing-error-message').textContent).toContain('Invalid workflow document');
      });
    });

    it('Go home button navigates to Home state', async () => {
      mockFetch.mockResolvedValue(createJsonErrorResponse('fail', 500));

      await act(async () => {
        renderWithContext();
      });

      await waitFor(() => {
        expect(screen.getByTestId('processing-home-btn')).toBeDefined();
      });

      await act(async () => {
        screen.getByTestId('processing-home-btn').click();
      });

      expect(mockSetState).toHaveBeenCalledWith(AppState.Home);
    });

    it('handles fetch network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await act(async () => {
        renderWithContext();
      });

      await waitFor(() => {
        expect(screen.getByTestId('processing-error-message').textContent).toContain('Network error');
      });
    });

    it('handles streamed error object from Claude', async () => {
      const errorJson = JSON.stringify({ error: 'Rate limited' });
      mockFetch.mockResolvedValue(createStreamResponse([errorJson]));

      await act(async () => {
        renderWithContext();
      });

      await waitFor(() => {
        expect(screen.getByTestId('processing-error-message').textContent).toContain('Rate limited');
      });
    });
  });
});
