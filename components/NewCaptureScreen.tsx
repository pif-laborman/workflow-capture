'use client';

import { useState } from 'react';
import { AppState } from '@/lib/types';
import { useAppState } from '@/lib/state';

export default function NewCaptureScreen() {
  const { setState, setSessionData, sessionData } = useAppState();
  const [workflowName, setWorkflowName] = useState('');

  function handleBack() {
    setState(AppState.Home);
  }

  function handleStart() {
    setSessionData({
      ...sessionData,
      workflowName: workflowName.trim(),
    });
    setState(AppState.RecordingStart);
  }

  return (
    <div data-testid="new-capture-screen" className="new-capture-screen">
      <div className="new-capture-top">
        <button
          className="btn-outline"
          data-testid="back-button"
          onClick={handleBack}
        >
          &larr; Back
        </button>
      </div>

      <div className="new-capture-content">
        <h1 className="new-capture-headline">Show me how you work</h1>

        <p className="new-capture-contract">
          I&apos;ll watch your screen and listen as you go. When something isn&apos;t
          clear, I&apos;ll ask one short question, then get out of your way.
        </p>

        <p className="new-capture-hint">
          You&apos;ll choose a screen to share, then grant microphone access. After
          that, just work normally.
        </p>

        <input
          type="text"
          className="new-capture-input"
          data-testid="workflow-name-input"
          placeholder="Workflow name (optional)"
          value={workflowName}
          onChange={(e) => setWorkflowName(e.target.value)}
        />

        <button
          className="btn-primary"
          data-testid="start-recording-button"
          onClick={handleStart}
        >
          Start recording
        </button>

        <p className="new-capture-footer">
          Chrome or Edge · screen + microphone · nothing leaves this browser
        </p>
      </div>
    </div>
  );
}
