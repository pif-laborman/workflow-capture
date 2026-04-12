import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useObserveLoop, UseObserveLoopOptions } from '@/lib/hooks/useObserveLoop';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function createMockOptions(overrides: Partial<UseObserveLoopOptions> = {}): UseObserveLoopOptions {
  return {
    isRecording: false,
    getLatestFrame: vi.fn(() => 'base64frame'),
    getTranscriptWindow: vi.fn(() => ''),
    speak: vi.fn(() => Promise.resolve()),
    addInterjection: vi.fn(),
    getPreviousInterjections: vi.fn(() => []),
    ...overrides,
  };
}

describe('useObserveLoop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not start interval when isRecording is false', () => {
    const options = createMockOptions({ isRecording: false });
    renderHook(() => useObserveLoop(options));

    vi.advanceTimersByTime(4000);
    expect(options.getLatestFrame).not.toHaveBeenCalled();
  });

  it('starts interval when isRecording is true and fires every ~2s', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ speak: false, message: '', reason: '' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const options = createMockOptions({ isRecording: true });
    renderHook(() => useObserveLoop(options));

    // First tick at 2s
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Second tick at 4s
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('POSTs correct body to /api/observe', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ speak: false, message: '', reason: '' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    // Use empty transcript so the silence gate passes immediately
    const options = createMockOptions({
      isRecording: true,
      getLatestFrame: vi.fn(() => 'testframe123'),
    });

    renderHook(() => useObserveLoop(options));

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/observe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: expect.any(String),
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.frame).toBe('testframe123');
    expect(body.transcript_window).toBe('');
    expect(body.seconds_since_last_interjection).toBe(9999); // no prior interjection
  });

  it('skips tick when getLatestFrame returns null', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const options = createMockOptions({
      isRecording: true,
      getLatestFrame: vi.fn(() => null),
    });

    renderHook(() => useObserveLoop(options));

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('increments observeCallCount on successful response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ speak: false, message: '', reason: '' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const options = createMockOptions({ isRecording: true });
    const { result } = renderHook(() => useObserveLoop(options));

    expect(result.current.observeCallCount).toBe(0);

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.observeCallCount).toBe(1);
  });

  it('triggers TTS, pauses recognition, and adds interjection on speak:true', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        speak: true,
        message: 'Can you explain why you clicked that?',
        reason: 'missing_why',
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const options = createMockOptions({ isRecording: true });
    renderHook(() => useObserveLoop(options));

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      // Advance past the 500ms pre-play pause
      vi.advanceTimersByTime(600);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(options.addInterjection).toHaveBeenCalledWith(
      'Can you explain why you clicked that?',
      'missing_why',
      expect.any(Number)
    );
    expect(options.speak).toHaveBeenCalledWith('Can you explain why you clicked that?');
  });

  it('does not trigger TTS or add interjection on speak:false', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ speak: false, message: '', reason: '' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const options = createMockOptions({ isRecording: true });
    renderHook(() => useObserveLoop(options));

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(options.speak).not.toHaveBeenCalled();
    expect(options.addInterjection).not.toHaveBeenCalled();
  });

  it('handles fetch errors gracefully without crashing', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
    vi.stubGlobal('fetch', mockFetch);

    const options = createMockOptions({ isRecording: true });
    renderHook(() => useObserveLoop(options));

    // Should not throw
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('handles non-ok HTTP responses gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });
    vi.stubGlobal('fetch', mockFetch);

    const options = createMockOptions({ isRecording: true });
    const { result } = renderHook(() => useObserveLoop(options));

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Should not increment count on error
    expect(result.current.observeCallCount).toBe(0);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('stops interval when recording stops', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ speak: false, message: '', reason: '' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const options = createMockOptions({ isRecording: true });
    const { rerender } = renderHook(
      (props: UseObserveLoopOptions) => useObserveLoop(props),
      { initialProps: options }
    );

    // One tick
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Stop recording
    const stoppedOptions = { ...options, isRecording: false };
    rerender(stoppedOptions);

    // More time passes — no more calls
    await act(async () => {
      vi.advanceTimersByTime(4000);
      await Promise.resolve();
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('stops interval on unmount', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ speak: false, message: '', reason: '' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const options = createMockOptions({ isRecording: true });
    const { unmount } = renderHook(() => useObserveLoop(options));

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    unmount();

    await act(async () => {
      vi.advanceTimersByTime(4000);
      await Promise.resolve();
    });
    // No additional calls after unmount
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('resumes recognition even if TTS speak rejects', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        speak: true,
        message: 'question',
        reason: 'missing_why',
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const options = createMockOptions({
      isRecording: true,
      speak: vi.fn().mockRejectedValue(new Error('TTS failed')),
    });

    renderHook(() => useObserveLoop(options));

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Recognition should still be resumed even after TTS failure
    consoleSpy.mockRestore();
  });

  it('resets observeCallCount when recording restarts', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ speak: false, message: '', reason: '' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const options = createMockOptions({ isRecording: true });
    const { result, rerender } = renderHook(
      (props: UseObserveLoopOptions) => useObserveLoop(props),
      { initialProps: options }
    );

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.observeCallCount).toBe(1);

    // Stop
    rerender({ ...options, isRecording: false });

    // Restart
    await act(async () => {
      rerender({ ...options, isRecording: true });
    });
    expect(result.current.observeCallCount).toBe(0);
  });
});
