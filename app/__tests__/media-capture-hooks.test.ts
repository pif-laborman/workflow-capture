import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useMediaCapture } from '@/lib/hooks/useMediaCapture';
import { useFrameSampler, TimestampedFrame } from '@/lib/hooks/useFrameSampler';
import { FRAME_INTERVAL_MS, JPEG_QUALITY } from '@/lib/constants';

// --- Mock helpers ---

function createMockTrack(kind: 'video' | 'audio', live = true): MediaStreamTrack {
  const listeners: Record<string, EventListener[]> = {};
  return {
    kind,
    readyState: live ? 'live' : 'ended',
    stop: vi.fn(),
    addEventListener: vi.fn((event: string, cb: EventListener) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(cb);
    }),
    removeEventListener: vi.fn(),
    getSettings: vi.fn(() => ({ width: 1920, height: 1080, displaySurface: 'monitor' })),
  } as unknown as MediaStreamTrack;
}

function createMockStream(tracks: MediaStreamTrack[]): MediaStream {
  return {
    getTracks: vi.fn(() => tracks),
    getVideoTracks: vi.fn(() => tracks.filter((t) => t.kind === 'video')),
    getAudioTracks: vi.fn(() => tracks.filter((t) => t.kind === 'audio')),
    id: `mock-stream-${Math.random()}`,
  } as unknown as MediaStream;
}

// --- Tests ---

describe('useMediaCapture', () => {
  let mockGetDisplayMedia: ReturnType<typeof vi.fn>;
  let mockGetUserMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGetDisplayMedia = vi.fn();
    mockGetUserMedia = vi.fn();

    // Set up navigator.mediaDevices
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getDisplayMedia: mockGetDisplayMedia,
        getUserMedia: mockGetUserMedia,
      },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('initializes with default state', () => {
    const { result } = renderHook(() => useMediaCapture());

    expect(result.current.isCapturing).toBe(false);
    expect(result.current.screenStream).toBeNull();
    expect(result.current.micStream).toBeNull();
    expect(result.current.hasTabAudio).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('startCapture calls getDisplayMedia and getUserMedia', async () => {
    const screenTrack = createMockTrack('video');
    const screenAudioTrack = createMockTrack('audio');
    const screenStream = createMockStream([screenTrack, screenAudioTrack]);
    const micTrack = createMockTrack('audio');
    const micStream = createMockStream([micTrack]);

    mockGetDisplayMedia.mockResolvedValue(screenStream);
    mockGetUserMedia.mockResolvedValue(micStream);

    const { result } = renderHook(() => useMediaCapture());

    await act(async () => {
      await result.current.startCapture();
    });

    expect(mockGetDisplayMedia).toHaveBeenCalledWith({
      video: { displaySurface: 'monitor' },
      audio: true,
      preferCurrentTab: false,
      selfBrowserSurface: 'exclude',
      systemAudio: 'include',
    });
    expect(mockGetUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(result.current.isCapturing).toBe(true);
    expect(result.current.screenStream).toBe(screenStream);
    expect(result.current.micStream).toBe(micStream);
    expect(result.current.hasTabAudio).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('sets hasTabAudio to false when screen share has no audio track', async () => {
    const screenTrack = createMockTrack('video');
    const screenStream = createMockStream([screenTrack]); // No audio tracks
    const micTrack = createMockTrack('audio');
    const micStream = createMockStream([micTrack]);

    mockGetDisplayMedia.mockResolvedValue(screenStream);
    mockGetUserMedia.mockResolvedValue(micStream);

    const { result } = renderHook(() => useMediaCapture());

    await act(async () => {
      await result.current.startCapture();
    });

    expect(result.current.hasTabAudio).toBe(false);
    expect(result.current.isCapturing).toBe(true);
  });

  it('stopCapture stops all media tracks', async () => {
    const screenVideoTrack = createMockTrack('video');
    const screenAudioTrack = createMockTrack('audio');
    const screenStream = createMockStream([screenVideoTrack, screenAudioTrack]);
    const micTrack = createMockTrack('audio');
    const micStream = createMockStream([micTrack]);

    mockGetDisplayMedia.mockResolvedValue(screenStream);
    mockGetUserMedia.mockResolvedValue(micStream);

    const { result } = renderHook(() => useMediaCapture());

    await act(async () => {
      await result.current.startCapture();
    });

    act(() => {
      result.current.stopCapture();
    });

    expect(screenVideoTrack.stop).toHaveBeenCalled();
    expect(screenAudioTrack.stop).toHaveBeenCalled();
    expect(micTrack.stop).toHaveBeenCalled();
    expect(result.current.isCapturing).toBe(false);
    expect(result.current.screenStream).toBeNull();
    expect(result.current.micStream).toBeNull();
  });

  it('rejects tab or window shares (non-monitor surface)', async () => {
    const screenTrack = createMockTrack('video');
    (screenTrack.getSettings as ReturnType<typeof vi.fn>).mockReturnValue({
      width: 1920,
      height: 1080,
      displaySurface: 'browser',
    });
    const screenStream = createMockStream([screenTrack]);

    mockGetDisplayMedia.mockResolvedValue(screenStream);

    const { result } = renderHook(() => useMediaCapture());

    await act(async () => {
      await result.current.startCapture();
    });

    expect(result.current.error).toContain('entire screen');
    expect(result.current.isCapturing).toBe(false);
    expect(screenTrack.stop).toHaveBeenCalled();
  });

  it('sets error when getDisplayMedia fails', async () => {
    mockGetDisplayMedia.mockRejectedValue(new Error('Permission denied'));

    const { result } = renderHook(() => useMediaCapture());

    await act(async () => {
      await result.current.startCapture();
    });

    expect(result.current.error).toBe('Permission denied');
    expect(result.current.isCapturing).toBe(false);
  });

  it('sets error and stops screen share when getUserMedia fails', async () => {
    const screenTrack = createMockTrack('video');
    const screenStream = createMockStream([screenTrack]);

    mockGetDisplayMedia.mockResolvedValue(screenStream);
    mockGetUserMedia.mockRejectedValue(new Error('Mic blocked'));

    const { result } = renderHook(() => useMediaCapture());

    await act(async () => {
      await result.current.startCapture();
    });

    expect(result.current.error).toContain('Microphone access denied');
    expect(result.current.isCapturing).toBe(false);
    // Screen tracks should be stopped on mic failure
    expect(screenTrack.stop).toHaveBeenCalled();
  });
});

describe('useFrameSampler', () => {
  let mockToDataURL: ReturnType<typeof vi.fn>;
  let mockDrawImage: ReturnType<typeof vi.fn>;
  let mockGetContext: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();

    mockDrawImage = vi.fn();
    mockToDataURL = vi.fn().mockReturnValue('data:image/jpeg;base64,AAAA');
    mockGetContext = vi.fn().mockReturnValue({
      drawImage: mockDrawImage,
    });

    // Mock document.createElement to return controlled video/canvas elements
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') {
        const canvas = originalCreateElement('canvas');
        canvas.getContext = mockGetContext as typeof canvas.getContext;
        canvas.toDataURL = mockToDataURL as typeof canvas.toDataURL;
        return canvas;
      }
      if (tag === 'video') {
        const video = originalCreateElement('video');
        // Mock play to resolve immediately
        video.play = vi.fn().mockResolvedValue(undefined);
        // Set readyState to HAVE_CURRENT_DATA (2)
        Object.defineProperty(video, 'readyState', { value: 2, writable: true });
        Object.defineProperty(video, 'HAVE_CURRENT_DATA', { value: 2 });
        return video;
      }
      return originalCreateElement(tag);
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns null frame when not capturing', () => {
    const { result } = renderHook(() => useFrameSampler(null, false));
    expect(result.current.latestFrame).toBeNull();
  });

  it('returns null frame when stream is null', () => {
    const { result } = renderHook(() => useFrameSampler(null, true));
    expect(result.current.latestFrame).toBeNull();
  });

  it('samples frame when capturing with a stream', async () => {
    const videoTrack = createMockTrack('video');
    const stream = createMockStream([videoTrack]);

    const { result } = renderHook(() => useFrameSampler(stream, true));

    // Let video.play() resolve
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Frame should have been sampled immediately after play
    expect(mockDrawImage).toHaveBeenCalled();
    expect(mockToDataURL).toHaveBeenCalledWith('image/jpeg', JPEG_QUALITY);
    expect(result.current.latestFrame).toBe('AAAA');
  });

  it('samples frames at FRAME_INTERVAL_MS interval', async () => {
    const videoTrack = createMockTrack('video');
    const stream = createMockStream([videoTrack]);

    renderHook(() => useFrameSampler(stream, true));

    // Let video.play() resolve
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Reset call counts after initial sample
    mockDrawImage.mockClear();

    // Advance by one interval
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FRAME_INTERVAL_MS);
    });

    expect(mockDrawImage).toHaveBeenCalledTimes(1);

    // Advance another interval
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FRAME_INTERVAL_MS);
    });

    expect(mockDrawImage).toHaveBeenCalledTimes(2);
  });

  it('calls onFrame callback with timestamped frame', async () => {
    const videoTrack = createMockTrack('video');
    const stream = createMockStream([videoTrack]);
    const onFrame = vi.fn();

    vi.spyOn(Date, 'now').mockReturnValue(1234567890);

    renderHook(() => useFrameSampler(stream, true, { onFrame }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(onFrame).toHaveBeenCalledWith({
      data: 'AAAA',
      timestamp_ms: 1234567890,
    } satisfies TimestampedFrame);
  });

  it('cleans up interval when capturing stops', async () => {
    const videoTrack = createMockTrack('video');
    const stream = createMockStream([videoTrack]);

    const { rerender } = renderHook(
      ({ s, c }) => useFrameSampler(s, c),
      { initialProps: { s: stream as MediaStream | null, c: true } }
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    mockDrawImage.mockClear();

    // Stop capturing
    rerender({ s: null, c: false });

    // Advance time — should not sample any more frames
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FRAME_INTERVAL_MS * 5);
    });

    expect(mockDrawImage).not.toHaveBeenCalled();
  });

  it('uses canvas dimensions from video track settings', async () => {
    const videoTrack = createMockTrack('video');
    (videoTrack.getSettings as ReturnType<typeof vi.fn>).mockReturnValue({
      width: 3840,
      height: 2160,
    });
    const stream = createMockStream([videoTrack]);

    renderHook(() => useFrameSampler(stream, true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // The canvas should have been created — we verify via drawImage which uses width/height
    expect(mockDrawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 3840, 2160);
  });
});
