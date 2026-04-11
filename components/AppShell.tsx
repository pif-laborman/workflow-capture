'use client';

import { useState } from 'react';
import { AppState } from '@/lib/types';
import {
  AppStateContext,
  SessionData,
  initialSessionData,
} from '@/lib/state';
import HomeScreen from '@/components/HomeScreen';
import NewCaptureScreen from '@/components/NewCaptureScreen';
import RecordingScreen from '@/components/RecordingScreen';

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
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);

  function renderScreen() {
    switch (currentState) {
      case AppState.Home:
        return <HomeScreen />;
      case AppState.NewCapture:
        return <NewCaptureScreen />;
      case AppState.RecordingActive:
        return (
          <RecordingScreen
            hasTabAudio={true}
            transcriptChunks={[]}
            interimText=""
            interjections={[]}
            framesCaptured={0}
            observeCallCount={0}
            onStop={() => {}}
          />
        );
      default:
        return <ScreenPlaceholder state={currentState} />;
    }
  }

  return (
    <AppStateContext.Provider
      value={{ currentState, setState, sessionData, setSessionData, selectedWorkflowId, setSelectedWorkflowId }}
    >
      <div data-testid="app-shell" className="app-shell">
        {renderScreen()}
      </div>
    </AppStateContext.Provider>
  );
}
