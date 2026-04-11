import { MAX_KEYFRAMES } from '@/lib/constants';
import type { SessionEvent } from '@/lib/types';
import { EventType } from '@/lib/types';

/**
 * Select keyframes from the event log.
 * If total frame events exceed MAX_KEYFRAMES, evenly sample down.
 * Non-frame events are always kept.
 */
export function selectKeyframes(events: SessionEvent[]): SessionEvent[] {
  const frames: SessionEvent[] = [];
  const nonFrames: SessionEvent[] = [];

  for (const event of events) {
    if (event.type === EventType.Frame) {
      frames.push(event);
    } else {
      nonFrames.push(event);
    }
  }

  if (frames.length <= MAX_KEYFRAMES) {
    return events;
  }

  // Evenly sample frames
  const step = frames.length / MAX_KEYFRAMES;
  const sampled: SessionEvent[] = [];
  for (let i = 0; i < MAX_KEYFRAMES; i++) {
    sampled.push(frames[Math.floor(i * step)]);
  }

  // Merge sampled frames with non-frame events, sorted by timestamp
  const merged = [...sampled, ...nonFrames];
  merged.sort((a, b) => a.timestamp_ms - b.timestamp_ms);
  return merged;
}
