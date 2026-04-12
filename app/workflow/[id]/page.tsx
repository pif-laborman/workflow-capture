'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getWorkflow } from '@/lib/storage';
import type { SavedWorkflow } from '@/lib/types';
import ResultsScreen from '@/components/ResultsScreen';
import {
  AppStateContext,
  initialSessionData,
} from '@/lib/state';
import { AppState } from '@/lib/types';

export default function WorkflowPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [workflow, setWorkflow] = useState<SavedWorkflow | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const found = getWorkflow(id);
    setWorkflow(found);
    setLoaded(true);
  }, [id]);

  if (!loaded) return null;

  if (!workflow) {
    return (
      <div className="processing-screen">
        <div className="processing-content">
          <h1 className="processing-headline">Workflow not found</h1>
          <p className="processing-error-message">
            This workflow may have been recorded in a different browser, or localStorage was cleared.
          </p>
          <button className="btn-primary" onClick={() => router.push('/')}>
            Go home
          </button>
        </div>
      </div>
    );
  }

  // Provide a minimal app state context so ResultsScreen works
  return (
    <AppStateContext.Provider
      value={{
        currentState: AppState.Results,
        setState: (state) => {
          if (state === AppState.Home) router.push('/');
          if (state === AppState.NewCapture) router.push('/');
        },
        sessionData: initialSessionData,
        setSessionData: () => {},
        selectedWorkflowId: id,
        setSelectedWorkflowId: () => {},
      }}
    >
      <div className="app-shell">
        <ResultsScreen />
      </div>
    </AppStateContext.Provider>
  );
}
