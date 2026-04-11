export enum AppState {
  Home = 'home',
  NewCapture = 'new-capture',
  RecordingStart = 'recording-start',
  RecordingActive = 'recording-active',
  Processing = 'processing',
  Results = 'results',
}

export enum EventType {
  Frame = 'frame',
  Transcript = 'transcript',
  Interjection = 'interjection',
}

export interface SessionEvent {
  type: EventType;
  timestamp_ms: number;
  payload: unknown;
}

export interface TranscriptChunk {
  text: string;
  timestamp_ms: number;
  isFinal: boolean;
}

export interface ObserveRequest {
  frame: string;
  transcript_window: string;
  seconds_since_last_interjection: number;
}

export interface ObserveResponse {
  speak: boolean;
  message: string;
  reason: string;
}

export interface WorkflowStep {
  step_number: number;
  title: string;
  description: string;
  ui_element: string;
  action: string;
  notes: string;
  screenshot_timestamp_ms: number | null;
  confidence?: 'high' | 'medium' | 'low';
}

export interface WorkflowDocument {
  name: string;
  description: string;
  steps: WorkflowStep[];
  open_questions: string[];
  summary: string;
}

export interface SavedWorkflow {
  id: string;
  name: string;
  date: string;
  duration_ms: number;
  workflow: WorkflowDocument;
  session_events: SessionEvent[];
}
