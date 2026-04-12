import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { AppState } from '@/lib/types';
import { AppStateContext, initialSessionData, SessionData } from '@/lib/state';
import RecordingController from '@/components/RecordingController';

// --- Mocks ---

const mockStartCapture = vi.fn().mockResolvedValue(undefined);
const mockStopCapture = vi.fn();
const mockMediaCapture = {
  startCapture: mockStartCapture,
  stopCapture: mockStopCapture,
  isCapturing: false,
  screenStream: null as MediaStream | null,
  micStream: null as MediaStream | null,
  hasTabAudio: true,
  error: null,
};

vi.mock('@/lib/hooks/useMediaCapture', () => ({
  useMediaCapture: () => mockMediaCapture,
}));

const mockRecognitionStart = vi.fn();
const mockRecognitionStop = vi.fn();
const mockRecognitionPause = vi.fn();
const mockRecognitionResume = vi.fn();
const mockSpeechRecognition = {
  start: mockRecognitionStart,
  stop: mockRecognitionStop,
  pause: mockRecognitionPause,
  resume: mockRecognitionResume,
  transcriptChunks: [] as { text: string; timestamp_ms: number; isFinal: boolean }[],
  interimText: '',
  isListening: false,
};

vi.mock('@/lib/hooks/useSpeechRecognition', () => ({
  useSpeechRecognition: () => mockSpeechRecognition,
}));

const mockSpeak = vi.fn().mockResolvedValue(undefined);
const mockCancel = vi.fn();
let capturedTTSOptions: { onSpeakStart?: () => void; onSpeakEnd?: () => void } = {};

vi.mock('@/lib/hooks/useTTS', () => ({
  useTTS: (options: { onSpeakStart?: () => void; onSpeakEnd?: () => void }) => {
    capturedTTSOptions = options;
    return {
      speak: mockSpeak,
      isSpeaking: false,
      cancel: mockCancel,
    };
  },
}));

const mockAddFrame = vi.fn();
const mockAddTranscript = vi.fn();
const mockAddInterjection = vi.fn();
const mockGetTranscriptWindow = vi.fn().mockReturnValue('');
const mockClear = vi.fn();
const mockEvents: unknown[] = [];

vi.mock('@/lib/hooks/useEventLog', () => ({
  useEventLog: () => ({
    events: mockEvents,
    addFrame: mockAddFrame,
    addTranscript: mockAddTranscript,
    addInterjection: mockAddInterjection,
    getTranscriptWindow: mockGetTranscriptWindow,
    clear: mockClear,
  }),
}));

const mockObserveCallCount = { value: 0 };

vi.mock('@/lib/hooks/useObserveLoop', () => ({
  useObserveLoop: () => ({
    observeCallCount: mockObserveCallCount.value,
  }),
}));

// Mock RecordingScreen to avoid its internal complexities
vi.mock('@/components/RecordingScreen', () => ({
  default: function MockRecordingScreen(props: {
    hasTabAudio: boolean;
    transcriptChunks: unknown[];
    interimText: string;
    interjections: unknown[];
    framesCaptured: number;
    observeCallCount: number;
    onStop: () => void;
  }) {
    return (
      <div data-testid="mock-recording-screen">
        <span data-testid="has-tab-audio">{String(props.hasTabAudio)}</span>
        <span data-testid="transcript-count">{props.transcriptChunks.length}</span>
        <span data-testid="interim-text">{props.interimText}</span>
        <span data-testid="interjection-count">{props.interjections.length}</span>
        <span data-testid="frames-captured">{props.framesCaptured}</span>
        <span data-testid="observe-call-count">{props.observeCallCount}</span>
        <button data-testid="stop-btn" onClick={props.onStop}>Stop</button>
      </div>
    );
  },
}));

// --- Helpers ---

function renderWithState(state: AppState, sessionData?: Partial<SessionData>) {
  const setState = vi.fn();
  const setSessionData = vi.fn();
  const data = { ...initialSessionData, ...sessionData };

  const result = render(
    <AppStateContext.Provider
      value={{
        currentState: state,
        setState,
        sessionData: data,
        setSessionData,
        selectedWorkflowId: null,
        setSelectedWorkflowId: vi.fn(),
      }}
    >
      <RecordingController />
    </AppStateContext.Provider>
  );

  return { ...result, setState, setSessionData };
}

// --- Tests ---

describe('RecordingController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockMediaCapture.isCapturing = false;
    mockMediaCapture.screenStream = null;
    mockMediaCapture.hasTabAudio = true;
    mockMediaCapture.error = null;
    mockSpeechRecognition.transcriptChunks = [];
    mockSpeechRecognition.interimText = '';
    mockEvents.length = 0;
    mockObserveCallCount.value = 0;
    capturedTTSOptions = {};
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  describe('Initialization (RecordingStart)', () => {
    it('calls startCapture and speech recognition on RecordingStart', async () => {
      await act(async () => {
        renderWithState(AppState.RecordingStart);
      });

      expect(mockStartCapture).toHaveBeenCalledTimes(1);

      // Advance past 3-second countdown
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });

      expect(mockRecognitionStart).toHaveBeenCalledTimes(1);
    });

    it('transitions to RecordingActive after successful capture start', async () => {
      const { setState } = await act(async () => {
        return renderWithState(AppState.RecordingStart);
      });

      // Advance past 3-second countdown
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });

      expect(setState).toHaveBeenCalledWith(AppState.RecordingActive);
    });

    it('transitions to NewCapture if capture fails', async () => {
      mockStartCapture.mockRejectedValueOnce(new Error('Permission denied'));

      const { setState } = await act(async () => {
        return renderWithState(AppState.RecordingStart);
      });

      expect(setState).toHaveBeenCalledWith(AppState.NewCapture);
    });
  });

  describe('Props passing to RecordingScreen', () => {
    it('passes hasTabAudio from media capture', async () => {
      mockMediaCapture.hasTabAudio = false;

      await act(async () => {
        renderWithState(AppState.RecordingActive);
      });

      expect(screen.getByTestId('has-tab-audio').textContent).toBe('false');
    });

    it('passes transcript chunks from speech recognition', async () => {
      mockSpeechRecognition.transcriptChunks = [
        { text: 'hello', timestamp_ms: 1000, isFinal: true },
        { text: 'world', timestamp_ms: 2000, isFinal: true },
      ];

      await act(async () => {
        renderWithState(AppState.RecordingActive);
      });

      expect(screen.getByTestId('transcript-count').textContent).toBe('2');
    });

    it('passes interim text from speech recognition', async () => {
      mockSpeechRecognition.interimText = 'typing...';

      await act(async () => {
        renderWithState(AppState.RecordingActive);
      });

      expect(screen.getByTestId('interim-text').textContent).toBe('typing...');
    });

    it('passes observe call count from observe loop', async () => {
      mockObserveCallCount.value = 5;

      await act(async () => {
        renderWithState(AppState.RecordingActive);
      });

      expect(screen.getByTestId('observe-call-count').textContent).toBe('5');
    });

    it('counts frames from event log', async () => {
      mockEvents.push(
        { type: 'frame', timestamp_ms: 1000, payload: { frame_base64: 'abc' } },
        { type: 'frame', timestamp_ms: 2000, payload: { frame_base64: 'def' } },
        { type: 'transcript', timestamp_ms: 1500, payload: { text: 'hi', isFinal: true } }
      );

      await act(async () => {
        renderWithState(AppState.RecordingActive);
      });

      expect(screen.getByTestId('frames-captured').textContent).toBe('2');
    });

    it('extracts interjections from event log', async () => {
      mockEvents.push(
        { type: 'interjection', timestamp_ms: 5000, payload: { message: 'Why?', reason: 'missing_why' } },
        { type: 'interjection', timestamp_ms: 10000, payload: { message: 'How?', reason: 'ambiguous' } }
      );

      await act(async () => {
        renderWithState(AppState.RecordingActive);
      });

      expect(screen.getByTestId('interjection-count').textContent).toBe('2');
    });
  });

  describe('Stop recording', () => {
    it('stops all hooks on stop', async () => {
      await act(async () => {
        renderWithState(AppState.RecordingActive);
      });

      await act(async () => {
        screen.getByTestId('stop-btn').click();
      });

      expect(mockStopCapture).toHaveBeenCalledTimes(1);
      expect(mockRecognitionStop).toHaveBeenCalledTimes(1);
      expect(mockCancel).toHaveBeenCalledTimes(1);
    });

    it('copies events to session data on stop', async () => {
      mockEvents.push(
        { type: 'frame', timestamp_ms: 1000, payload: { frame_base64: 'abc' } }
      );

      const { setSessionData } = await act(async () => {
        return renderWithState(AppState.RecordingActive);
      });

      await act(async () => {
        screen.getByTestId('stop-btn').click();
      });

      expect(setSessionData).toHaveBeenCalledTimes(1);
      const callArg = setSessionData.mock.calls[0][0];
      expect(callArg.events).toHaveLength(1);
      expect(callArg.events[0].type).toBe('frame');
    });
  });

  describe('Renders for RecordingScreen', () => {
    it('renders mock recording screen', async () => {
      await act(async () => {
        renderWithState(AppState.RecordingActive);
      });

      expect(screen.getByTestId('mock-recording-screen')).toBeInTheDocument();
    });
  });
});
