import { describe, it, expect } from 'vitest';
import {
  AppState,
  EventType,
} from '@/lib/types';
import type {
  SessionEvent,
  TranscriptChunk,
  ObserveRequest,
  ObserveResponse,
  WorkflowStep,
  WorkflowDocument,
  SavedWorkflow,
} from '@/lib/types';
import {
  OBSERVE_INTERVAL_MS,
  COOLDOWN_MS,
  FRAME_INTERVAL_MS,
  JPEG_QUALITY,
  MAX_KEYFRAMES,
} from '@/lib/constants';
import { OBSERVE_SYSTEM_PROMPT } from '@/lib/prompts/observe';
import { FINALIZE_SYSTEM_PROMPT } from '@/lib/prompts/finalize';

describe('AppState enum', () => {
  it('has all 6 states', () => {
    expect(AppState.Home).toBe('home');
    expect(AppState.NewCapture).toBe('new-capture');
    expect(AppState.RecordingStart).toBe('recording-start');
    expect(AppState.RecordingActive).toBe('recording-active');
    expect(AppState.Processing).toBe('processing');
    expect(AppState.Results).toBe('results');
  });

  it('has exactly 6 members', () => {
    const values = Object.values(AppState);
    expect(values).toHaveLength(6);
  });
});

describe('EventType enum', () => {
  it('has all 3 types', () => {
    expect(EventType.Frame).toBe('frame');
    expect(EventType.Transcript).toBe('transcript');
    expect(EventType.Interjection).toBe('interjection');
  });
});

describe('Type interfaces compile correctly', () => {
  it('SessionEvent can be constructed', () => {
    const event: SessionEvent = {
      type: EventType.Frame,
      timestamp_ms: 1000,
      payload: { data: 'test' },
    };
    expect(event.type).toBe(EventType.Frame);
    expect(event.timestamp_ms).toBe(1000);
  });

  it('TranscriptChunk can be constructed', () => {
    const chunk: TranscriptChunk = {
      text: 'hello',
      timestamp_ms: 500,
      isFinal: true,
    };
    expect(chunk.text).toBe('hello');
    expect(chunk.isFinal).toBe(true);
  });

  it('ObserveRequest can be constructed', () => {
    const req: ObserveRequest = {
      frame: 'base64data',
      transcript_window: 'user said something',
      seconds_since_last_interjection: 25,
      previous_interjections: ['Why did you click that?'],
    };
    expect(req.frame).toBe('base64data');
    expect(req.seconds_since_last_interjection).toBe(25);
  });

  it('ObserveResponse can be constructed', () => {
    const res: ObserveResponse = {
      speak: true,
      message: 'Why did you click that?',
      reason: 'missing_why',
    };
    expect(res.speak).toBe(true);
    expect(res.reason).toBe('missing_why');
  });

  it('WorkflowStep can be constructed', () => {
    const step: WorkflowStep = {
      step_number: 1,
      title: 'Open settings',
      description: 'Click the gear icon',
      ui_element: 'Settings button',
      action: 'click',
      notes: '',
      screenshot_timestamp_ms: 5000,
    };
    expect(step.step_number).toBe(1);
    expect(step.screenshot_timestamp_ms).toBe(5000);
  });

  it('WorkflowDocument can be constructed', () => {
    const doc: WorkflowDocument = {
      name: 'Test Workflow',
      description: 'A test',
      steps: [],
      open_questions: ['Why step 3?'],
      summary: 'Summary text',
    };
    expect(doc.steps).toHaveLength(0);
    expect(doc.open_questions).toHaveLength(1);
  });

  it('SavedWorkflow can be constructed', () => {
    const saved: SavedWorkflow = {
      id: 'abc-123',
      name: 'My Workflow',
      date: '2026-04-11',
      duration_ms: 60000,
      workflow: {
        name: 'My Workflow',
        description: 'desc',
        steps: [],
        open_questions: [],
        summary: 'sum',
      },
      session_events: [],
    };
    expect(saved.id).toBe('abc-123');
    expect(saved.duration_ms).toBe(60000);
  });
});

describe('Constants', () => {
  it('OBSERVE_INTERVAL_MS is 2000', () => {
    expect(OBSERVE_INTERVAL_MS).toBe(2000);
  });

  it('COOLDOWN_MS is 15000', () => {
    expect(COOLDOWN_MS).toBe(15000);
  });

  it('FRAME_INTERVAL_MS is 1000', () => {
    expect(FRAME_INTERVAL_MS).toBe(1000);
  });

  it('JPEG_QUALITY is 0.7', () => {
    expect(JPEG_QUALITY).toBe(0.7);
  });

  it('MAX_KEYFRAMES is 60', () => {
    expect(MAX_KEYFRAMES).toBe(60);
  });
});

describe('Observe system prompt', () => {
  it('is a non-empty string', () => {
    expect(typeof OBSERVE_SYSTEM_PROMPT).toBe('string');
    expect(OBSERVE_SYSTEM_PROMPT.length).toBeGreaterThan(100);
  });

  it('mentions intervention triggers', () => {
    const lower = OBSERVE_SYSTEM_PROMPT.toLowerCase();
    expect(lower).toContain('missing');
    expect(lower).toContain('contradiction');
    expect(lower).toContain('ambiguous generalization');
    expect(lower).toContain('apparent error');
    expect(lower).toContain('implicit step');
  });

  it('forces JSON output format', () => {
    expect(OBSERVE_SYSTEM_PROMPT).toContain('"speak"');
    expect(OBSERVE_SYSTEM_PROMPT).toContain('"message"');
    expect(OBSERVE_SYSTEM_PROMPT).toContain('"reason"');
  });

  it('requires one-sentence messages referencing visible screen content', () => {
    expect(OBSERVE_SYSTEM_PROMPT).toContain('ONE sentence');
    expect(OBSERVE_SYSTEM_PROMPT).toContain('visible on screen');
  });
});

describe('Finalize system prompt', () => {
  it('is a non-empty string', () => {
    expect(typeof FINALIZE_SYSTEM_PROMPT).toBe('string');
    expect(FINALIZE_SYSTEM_PROMPT.length).toBeGreaterThan(100);
  });

  it('references the workflow document schema fields', () => {
    expect(FINALIZE_SYSTEM_PROMPT).toContain('"name"');
    expect(FINALIZE_SYSTEM_PROMPT).toContain('"steps"');
    expect(FINALIZE_SYSTEM_PROMPT).toContain('"open_questions"');
    expect(FINALIZE_SYSTEM_PROMPT).toContain('"summary"');
    expect(FINALIZE_SYSTEM_PROMPT).toContain('"step_number"');
  });

  it('instructs deduplication and ambiguity resolution', () => {
    expect(FINALIZE_SYSTEM_PROMPT).toContain('Deduplicate');
    expect(FINALIZE_SYSTEM_PROMPT).toContain('ambiguit');
  });
});
