'use client';

import { createContext, useContext } from 'react';
import { AppState, SessionEvent, WorkflowDocument } from './types';

export interface SessionData {
  workflowName: string;
  events: SessionEvent[];
  workflowResult: WorkflowDocument | null;
}

export interface AppStateContextValue {
  currentState: AppState;
  setState: (state: AppState) => void;
  sessionData: SessionData;
  setSessionData: (data: SessionData) => void;
}

export const initialSessionData: SessionData = {
  workflowName: '',
  events: [],
  workflowResult: null,
};

export const AppStateContext = createContext<AppStateContextValue>({
  currentState: AppState.Home,
  setState: () => {},
  sessionData: initialSessionData,
  setSessionData: () => {},
});

export function useAppState() {
  return useContext(AppStateContext);
}
