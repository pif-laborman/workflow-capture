import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useEventLog, FramePayload, TranscriptPayload, InterjectionPayload } from '@/lib/hooks/useEventLog';
import { EventType } from '@/lib/types';

afterEach(() => {
  cleanup();
});

describe('useEventLog', () => {
  it('starts with an empty event log', () => {
    const { result } = renderHook(() => useEventLog());
    expect(result.current.events).toEqual([]);
  });

  describe('addFrame', () => {
    it('appends a frame event with base64 payload and timestamp', () => {
      const { result } = renderHook(() => useEventLog());

      act(() => {
        result.current.addFrame('abc123base64', 1000);
      });

      expect(result.current.events).toHaveLength(1);
      const event = result.current.events[0];
      expect(event.type).toBe(EventType.Frame);
      expect(event.timestamp_ms).toBe(1000);
      expect((event.payload as FramePayload).frame_base64).toBe('abc123base64');
    });

    it('appends multiple frame events', () => {
      const { result } = renderHook(() => useEventLog());

      act(() => {
        result.current.addFrame('frame1', 1000);
        result.current.addFrame('frame2', 2000);
      });

      expect(result.current.events).toHaveLength(2);
      expect((result.current.events[0].payload as FramePayload).frame_base64).toBe('frame1');
      expect((result.current.events[1].payload as FramePayload).frame_base64).toBe('frame2');
    });
  });

  describe('addTranscript', () => {
    it('appends a transcript event with text and isFinal', () => {
      const { result } = renderHook(() => useEventLog());

      act(() => {
        result.current.addTranscript({ text: 'hello world', isFinal: true, timestamp_ms: 1500 });
      });

      expect(result.current.events).toHaveLength(1);
      const event = result.current.events[0];
      expect(event.type).toBe(EventType.Transcript);
      expect(event.timestamp_ms).toBe(1500);
      const payload = event.payload as TranscriptPayload;
      expect(payload.text).toBe('hello world');
      expect(payload.isFinal).toBe(true);
    });

    it('handles interim transcript chunks', () => {
      const { result } = renderHook(() => useEventLog());

      act(() => {
        result.current.addTranscript({ text: 'partial', isFinal: false, timestamp_ms: 1000 });
      });

      const payload = result.current.events[0].payload as TranscriptPayload;
      expect(payload.isFinal).toBe(false);
    });
  });

  describe('addInterjection', () => {
    it('appends an interjection event with message and reason', () => {
      const { result } = renderHook(() => useEventLog());

      act(() => {
        result.current.addInterjection('Why did you click that?', 'missing_why', 3000);
      });

      expect(result.current.events).toHaveLength(1);
      const event = result.current.events[0];
      expect(event.type).toBe(EventType.Interjection);
      expect(event.timestamp_ms).toBe(3000);
      const payload = event.payload as InterjectionPayload;
      expect(payload.message).toBe('Why did you click that?');
      expect(payload.reason).toBe('missing_why');
    });
  });

  describe('chronological ordering', () => {
    it('events are ordered chronologically when added in order', () => {
      const { result } = renderHook(() => useEventLog());

      act(() => {
        result.current.addFrame('f1', 1000);
        result.current.addTranscript({ text: 'hello', isFinal: true, timestamp_ms: 1500 });
        result.current.addInterjection('question', 'reason', 2000);
        result.current.addFrame('f2', 2500);
      });

      expect(result.current.events).toHaveLength(4);
      expect(result.current.events[0].timestamp_ms).toBe(1000);
      expect(result.current.events[1].timestamp_ms).toBe(1500);
      expect(result.current.events[2].timestamp_ms).toBe(2000);
      expect(result.current.events[3].timestamp_ms).toBe(2500);

      expect(result.current.events[0].type).toBe(EventType.Frame);
      expect(result.current.events[1].type).toBe(EventType.Transcript);
      expect(result.current.events[2].type).toBe(EventType.Interjection);
      expect(result.current.events[3].type).toBe(EventType.Frame);
    });
  });

  describe('getTranscriptWindow', () => {
    it('returns concatenated final transcript text from last N seconds', () => {
      const { result } = renderHook(() => useEventLog());

      act(() => {
        result.current.addTranscript({ text: 'old text', isFinal: true, timestamp_ms: 1000 });
        result.current.addTranscript({ text: 'recent text', isFinal: true, timestamp_ms: 9000 });
        result.current.addTranscript({ text: 'latest text', isFinal: true, timestamp_ms: 10000 });
      });

      let window: string = '';
      act(() => {
        window = result.current.getTranscriptWindow(5);
      });

      // Last event is at 10000ms, 5s window = cutoff at 5000ms
      // "old text" at 1000ms is excluded, "recent text" at 9000ms and "latest text" at 10000ms included
      expect(window).toBe('recent text latest text');
    });

    it('excludes interim (non-final) transcript chunks', () => {
      const { result } = renderHook(() => useEventLog());

      act(() => {
        result.current.addTranscript({ text: 'final one', isFinal: true, timestamp_ms: 5000 });
        result.current.addTranscript({ text: 'interim', isFinal: false, timestamp_ms: 6000 });
        result.current.addTranscript({ text: 'final two', isFinal: true, timestamp_ms: 7000 });
      });

      let window: string = '';
      act(() => {
        window = result.current.getTranscriptWindow(10);
      });

      expect(window).toBe('final one final two');
    });

    it('returns empty string when no events exist', () => {
      const { result } = renderHook(() => useEventLog());

      let window: string = '';
      act(() => {
        window = result.current.getTranscriptWindow(10);
      });

      expect(window).toBe('');
    });

    it('returns empty string when no transcripts in window', () => {
      const { result } = renderHook(() => useEventLog());

      act(() => {
        result.current.addFrame('frame', 1000);
        result.current.addTranscript({ text: 'very old', isFinal: true, timestamp_ms: 1000 });
        result.current.addFrame('frame2', 20000);
      });

      let window: string = '';
      act(() => {
        window = result.current.getTranscriptWindow(5);
      });

      // Last event at 20000ms, 5s window = cutoff at 15000ms, transcript at 1000ms is excluded
      expect(window).toBe('');
    });

    it('ignores non-transcript events', () => {
      const { result } = renderHook(() => useEventLog());

      act(() => {
        result.current.addFrame('frame', 5000);
        result.current.addTranscript({ text: 'hello', isFinal: true, timestamp_ms: 6000 });
        result.current.addInterjection('question', 'reason', 7000);
      });

      let window: string = '';
      act(() => {
        window = result.current.getTranscriptWindow(10);
      });

      expect(window).toBe('hello');
    });
  });

  describe('clear', () => {
    it('resets the event log to empty', () => {
      const { result } = renderHook(() => useEventLog());

      act(() => {
        result.current.addFrame('frame', 1000);
        result.current.addTranscript({ text: 'text', isFinal: true, timestamp_ms: 2000 });
        result.current.addInterjection('msg', 'reason', 3000);
      });

      expect(result.current.events).toHaveLength(3);

      act(() => {
        result.current.clear();
      });

      expect(result.current.events).toHaveLength(0);
    });

    it('allows adding events after clear', () => {
      const { result } = renderHook(() => useEventLog());

      act(() => {
        result.current.addFrame('frame1', 1000);
      });

      act(() => {
        result.current.clear();
      });

      act(() => {
        result.current.addFrame('frame2', 2000);
      });

      expect(result.current.events).toHaveLength(1);
      expect((result.current.events[0].payload as FramePayload).frame_base64).toBe('frame2');
    });
  });
});
