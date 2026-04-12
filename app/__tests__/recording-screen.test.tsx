import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import RecordingScreen, { RecordingScreenProps, Interjection } from '@/components/RecordingScreen';
import { AppStateContext, AppStateContextValue, initialSessionData } from '@/lib/state';
import { AppState, TranscriptChunk } from '@/lib/types';
import React from 'react';

function createMockContext(overrides: Partial<AppStateContextValue> = {}): AppStateContextValue {
  return {
    currentState: AppState.RecordingActive,
    setState: vi.fn(),
    sessionData: initialSessionData,
    setSessionData: vi.fn(),
    selectedWorkflowId: null,
    setSelectedWorkflowId: vi.fn(),
    ...overrides,
  };
}

function renderWithContext(
  props: Partial<RecordingScreenProps> = {},
  contextOverrides: Partial<AppStateContextValue> = {},
) {
  const defaultProps: RecordingScreenProps = {
    hasTabAudio: true,
    transcriptChunks: [],
    interimText: '',
    interjections: [],
    framesCaptured: 0,
    observeCallCount: 0,
    speakCount: 0,
    silentCount: 0,
    capturedFrames: [],
    onStop: vi.fn(),
    ...props,
  };

  const ctx = createMockContext(contextOverrides);

  return {
    ctx,
    props: defaultProps,
    ...render(
      <AppStateContext.Provider value={ctx}>
        <RecordingScreen {...defaultProps} />
      </AppStateContext.Provider>,
    ),
  };
}

describe('RecordingScreen', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Set Date.now() to 0 so test timestamps (5000, 12000, etc.) become relative offsets
    vi.setSystemTime(0);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  describe('Top bar', () => {
    it('renders pulsing red dot, timer, and metrics', () => {
      renderWithContext();

      expect(screen.getByTestId('rec-dot')).toBeDefined();
      expect(screen.getByTestId('rec-timer')).toHaveTextContent('00:00');
      expect(screen.getByTestId('frames-count')).toHaveTextContent('0');
      expect(screen.getByTestId('observe-count')).toHaveTextContent('0');
      expect(screen.getByTestId('speak-count')).toHaveTextContent('0');
      expect(screen.getByTestId('silent-count')).toHaveTextContent('0');
    });

    it('increments timer every second', () => {
      renderWithContext();

      act(() => { vi.advanceTimersByTime(3000); });

      expect(screen.getByTestId('rec-timer')).toHaveTextContent('00:03');
    });

    it('formats timer as MM:SS for values over 60s', () => {
      renderWithContext();

      act(() => { vi.advanceTimersByTime(125000); });

      expect(screen.getByTestId('rec-timer')).toHaveTextContent('02:05');
    });

    it('displays correct metric counts', () => {
      renderWithContext({
        framesCaptured: 42,
        observeCallCount: 15,
        speakCount: 3,
        silentCount: 12,
      });

      expect(screen.getByTestId('frames-count')).toHaveTextContent('42');
      expect(screen.getByTestId('observe-count')).toHaveTextContent('15');
      expect(screen.getByTestId('speak-count')).toHaveTextContent('3');
      expect(screen.getByTestId('silent-count')).toHaveTextContent('12');
    });
  });

  describe('Stop button', () => {
    it('renders stop button and navigates to processing on click', () => {
      const onStop = vi.fn();
      const { ctx } = renderWithContext({ onStop });

      const stopBtn = screen.getByTestId('stop-button');
      expect(stopBtn).toHaveTextContent('Stop recording');

      fireEvent.click(stopBtn);

      expect(onStop).toHaveBeenCalledOnce();
      expect(ctx.setState).toHaveBeenCalledWith(AppState.Processing);
    });
  });

  describe('Warning banner', () => {
    it('shows warning when hasTabAudio is false', () => {
      renderWithContext({ hasTabAudio: false });

      const warning = screen.getByTestId('no-audio-warning');
      expect(warning).toHaveTextContent('Recording without tab audio');
    });

    it('does not show warning when hasTabAudio is true', () => {
      renderWithContext({ hasTabAudio: true });

      expect(screen.queryByTestId('no-audio-warning')).toBeNull();
    });
  });

  describe('Two-column layout', () => {
    it('renders transcript and observer panels', () => {
      renderWithContext();

      expect(screen.getByTestId('transcript-panel')).toBeDefined();
      expect(screen.getByTestId('observer-panel')).toBeDefined();
    });

    it('shows Live pill badge on transcript panel', () => {
      renderWithContext();

      expect(screen.getByTestId('live-badge')).toHaveTextContent('Live');
    });
  });

  describe('Empty states', () => {
    it('shows transcript empty hint when no chunks', () => {
      renderWithContext();

      expect(screen.getByTestId('transcript-empty-hint')).toHaveTextContent(
        'Start working and talk through what you\'re doing',
      );
    });

    it('shows observer empty hint when no interjections', () => {
      renderWithContext();

      expect(screen.getByTestId('observer-empty-hint')).toHaveTextContent(
        'I\'ll ask questions here when something isn\'t clear',
      );
    });
  });

  describe('Transcript blocks', () => {
    it('renders final transcript blocks with timestamp and text', () => {
      const chunks: TranscriptChunk[] = [
        { text: 'I clicked the button', timestamp_ms: 5000, isFinal: true },
        { text: 'Then I went to settings', timestamp_ms: 12000, isFinal: true },
      ];

      renderWithContext({ transcriptChunks: chunks });

      const blocks = screen.getAllByTestId('transcript-block');
      expect(blocks).toHaveLength(2);

      expect(blocks[0]).toHaveTextContent('00:05');
      expect(blocks[0]).toHaveTextContent('I clicked the button');
      expect(blocks[1]).toHaveTextContent('00:12');
      expect(blocks[1]).toHaveTextContent('Then I went to settings');
    });

    it('renders interim text with interim styling', () => {
      renderWithContext({ interimText: 'typing in progress...' });

      const interim = screen.getByTestId('transcript-interim');
      expect(interim).toHaveTextContent('typing in progress...');
      expect(interim.classList.contains('transcript-interim')).toBe(true);
    });

    it('hides empty hint when transcript chunks exist', () => {
      const chunks: TranscriptChunk[] = [
        { text: 'Hello', timestamp_ms: 1000, isFinal: true },
      ];

      renderWithContext({ transcriptChunks: chunks });

      expect(screen.queryByTestId('transcript-empty-hint')).toBeNull();
    });

    it('hides empty hint when only interim text exists', () => {
      renderWithContext({ interimText: 'typing...' });

      expect(screen.queryByTestId('transcript-empty-hint')).toBeNull();
    });
  });

  describe('Interjection cards', () => {
    it('renders interjection cards with timestamp, reason tag, and message', () => {
      const interjections: Interjection[] = [
        { timestamp_ms: 30000, reason: 'missing_why', message: 'Why did you choose that option?' },
        { timestamp_ms: 60000, reason: 'ambiguous', message: 'Which menu did you mean?' },
      ];

      renderWithContext({ interjections });

      const cards = screen.getAllByTestId('interjection-card');
      expect(cards).toHaveLength(2);

      expect(cards[0]).toHaveTextContent('00:30');
      expect(cards[0]).toHaveTextContent('missing_why');
      expect(cards[0]).toHaveTextContent('Why did you choose that option?');

      expect(cards[1]).toHaveTextContent('01:00');
      expect(cards[1]).toHaveTextContent('ambiguous');
      expect(cards[1]).toHaveTextContent('Which menu did you mean?');
    });

    it('shows reason tag as a pill badge', () => {
      const interjections: Interjection[] = [
        { timestamp_ms: 5000, reason: 'contradiction', message: 'Test' },
      ];

      renderWithContext({ interjections });

      const tag = screen.getByTestId('reason-tag');
      expect(tag).toHaveTextContent('contradiction');
      expect(tag.classList.contains('pill-badge')).toBe(true);
      expect(tag.classList.contains('pill-reason')).toBe(true);
    });

    it('hides observer empty hint when interjections exist', () => {
      const interjections: Interjection[] = [
        { timestamp_ms: 5000, reason: 'test', message: 'Test question' },
      ];

      renderWithContext({ interjections });

      expect(screen.queryByTestId('observer-empty-hint')).toBeNull();
    });
  });
});
