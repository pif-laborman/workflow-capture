'use client';

import { useState, useEffect } from 'react';
import { AppState } from '@/lib/types';
import {
  AppStateContext,
  SessionData,
  initialSessionData,
} from '@/lib/state';
import HomeScreen from '@/components/HomeScreen';
import NewCaptureScreen from '@/components/NewCaptureScreen';
import RecordingController from '@/components/RecordingController';
import ProcessingScreen from '@/components/ProcessingScreen';
import ResultsScreen from '@/components/ResultsScreen';

function ScreenPlaceholder({ state }: { state: AppState }) {
  return (
    <div data-testid={`screen-${state}`} className="screen-placeholder">
      {state}
    </div>
  );
}

export function isSupportedBrowser(): boolean {
  if (typeof navigator === 'undefined') return true; // SSR — assume supported
  const ua = navigator.userAgent;
  const isChrome = /Chrome\//.test(ua) && !/Edg\//.test(ua);
  const isEdge = /Edg\//.test(ua);
  return isChrome || isEdge;
}

function UnsupportedBrowserMessage() {
  return (
    <div data-testid="unsupported-browser" className="unsupported-browser">
      <div className="unsupported-browser-content">
        <h1 className="unsupported-browser-headline">Unsupported Browser</h1>
        <p className="unsupported-browser-text">
          Workflow Capture requires screen sharing and speech recognition APIs that are only available in Google Chrome or Microsoft Edge.
        </p>
        <p className="unsupported-browser-hint">
          Please open this page in Chrome or Edge to continue.
        </p>
      </div>
    </div>
  );
}

export default function AppShell() {
  const [currentState, setState] = useState<AppState>(AppState.Home);
  const [sessionData, setSessionData] = useState<SessionData>(initialSessionData);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [browserSupported, setBrowserSupported] = useState(true);

  useEffect(() => {
    setBrowserSupported(isSupportedBrowser());
  }, []);

  if (!browserSupported) {
    return <UnsupportedBrowserMessage />;
  }

  function renderScreen() {
    switch (currentState) {
      case AppState.Home:
        return <HomeScreen />;
      case AppState.NewCapture:
        return <NewCaptureScreen />;
      case AppState.RecordingStart:
      case AppState.RecordingActive:
        return <RecordingController />;
      case AppState.Processing:
        return <ProcessingScreen />;
      case AppState.Results:
        return <ResultsScreen />;
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
