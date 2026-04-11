import { describe, it, expect, beforeEach } from 'vitest';
import { saveWorkflow, getWorkflows, getWorkflow, deleteWorkflow } from '@/lib/storage';
import { SavedWorkflow } from '@/lib/types';

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
      ],
      open_questions: [],
      summary: 'A test summary',
    },
    session_events: [],
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('saveWorkflow', () => {
  it('writes a workflow to localStorage', () => {
    const wf = makeSavedWorkflow();
    saveWorkflow(wf);

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('wf-1');
  });

  it('prepends new workflows to existing ones', () => {
    const wf1 = makeSavedWorkflow({ id: 'wf-1', date: '2026-04-10T10:00:00Z' });
    const wf2 = makeSavedWorkflow({ id: 'wf-2', date: '2026-04-11T10:00:00Z' });
    saveWorkflow(wf1);
    saveWorkflow(wf2);

    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(raw).toHaveLength(2);
    // wf2 was prepended (unshift), so it's first in the raw array
    expect(raw[0].id).toBe('wf-2');
    expect(raw[1].id).toBe('wf-1');
  });
});

describe('getWorkflows', () => {
  it('returns empty array when nothing saved', () => {
    expect(getWorkflows()).toEqual([]);
  });

  it('returns workflows sorted by date descending', () => {
    const wf1 = makeSavedWorkflow({ id: 'wf-old', date: '2026-04-09T10:00:00Z' });
    const wf2 = makeSavedWorkflow({ id: 'wf-mid', date: '2026-04-10T10:00:00Z' });
    const wf3 = makeSavedWorkflow({ id: 'wf-new', date: '2026-04-11T10:00:00Z' });
    // Save in non-sorted order
    localStorage.setItem(STORAGE_KEY, JSON.stringify([wf2, wf1, wf3]));

    const result = getWorkflows();
    expect(result).toHaveLength(3);
    expect(result[0].id).toBe('wf-new');
    expect(result[1].id).toBe('wf-mid');
    expect(result[2].id).toBe('wf-old');
  });

  it('returns empty array on corrupted data', () => {
    localStorage.setItem(STORAGE_KEY, 'not valid json{{{');
    expect(getWorkflows()).toEqual([]);
  });
});

describe('getWorkflow', () => {
  it('returns a specific workflow by id', () => {
    const wf1 = makeSavedWorkflow({ id: 'wf-1' });
    const wf2 = makeSavedWorkflow({ id: 'wf-2', name: 'Second' });
    localStorage.setItem(STORAGE_KEY, JSON.stringify([wf1, wf2]));

    const result = getWorkflow('wf-2');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('wf-2');
    expect(result!.name).toBe('Second');
  });

  it('returns null for non-existent id', () => {
    const wf = makeSavedWorkflow({ id: 'wf-1' });
    localStorage.setItem(STORAGE_KEY, JSON.stringify([wf]));

    expect(getWorkflow('wf-999')).toBeNull();
  });

  it('returns null when storage is empty', () => {
    expect(getWorkflow('wf-1')).toBeNull();
  });
});

describe('deleteWorkflow', () => {
  it('removes a workflow by id', () => {
    const wf1 = makeSavedWorkflow({ id: 'wf-1' });
    const wf2 = makeSavedWorkflow({ id: 'wf-2' });
    localStorage.setItem(STORAGE_KEY, JSON.stringify([wf1, wf2]));

    deleteWorkflow('wf-1');

    const result = getWorkflows();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('wf-2');
  });

  it('does nothing when id not found', () => {
    const wf = makeSavedWorkflow({ id: 'wf-1' });
    localStorage.setItem(STORAGE_KEY, JSON.stringify([wf]));

    deleteWorkflow('wf-999');

    expect(getWorkflows()).toHaveLength(1);
  });
});
