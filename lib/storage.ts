import { SavedWorkflow } from './types';

const STORAGE_KEY = 'workflow-capture-sessions';
const PROMPT_KEY = 'workflow-capture-observe-prompt';

export function saveWorkflow(workflow: SavedWorkflow): void {
  const existing = getWorkflows();
  existing.unshift(workflow);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
}

export function getWorkflows(): SavedWorkflow[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedWorkflow[];
    // Sort by date descending
    return parsed.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  } catch {
    return [];
  }
}

export function getWorkflow(id: string): SavedWorkflow | null {
  const workflows = getWorkflows();
  return workflows.find(w => w.id === id) ?? null;
}

export function deleteWorkflow(id: string): void {
  const workflows = getWorkflows().filter(w => w.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(workflows));
}

export function getObservePrompt(): string | null {
  try {
    return localStorage.getItem(PROMPT_KEY);
  } catch {
    return null;
  }
}

export function setObservePrompt(prompt: string): void {
  localStorage.setItem(PROMPT_KEY, prompt);
}

export function clearObservePrompt(): void {
  localStorage.removeItem(PROMPT_KEY);
}
