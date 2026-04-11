'use client';

import { useState } from 'react';
import { AppState } from '@/lib/types';
import {
  AppStateContext,
  SessionData,
  initialSessionData,
} from '@/lib/state';

function ScreenPlaceholder({ state }: { state: AppState }) {
  return (
    <div data-testid={`screen-${state}`} className="screen-placeholder">
      {state}
    </div>
  );
}

export default function AppShell() {
  const [currentState, setState] = useState<AppState>(AppState.Home);
  const [sessionData, setSessionData] = useState<SessionData>(initialSessionData);

  return (
    <AppStateContext.Provider
      value={{ currentState, setState, sessionData, setSessionData }}
    >
      <div data-testid="app-shell" className="app-shell">
        <ScreenPlaceholder state={currentState} />
      </div>
    </AppStateContext.Provider>
  );
}
