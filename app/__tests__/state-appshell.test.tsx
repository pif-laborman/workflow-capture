import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { useState } from 'react';
import { AppState } from '@/lib/types';
import {
  AppStateContext,
  initialSessionData,
  useAppState,
} from '@/lib/state';
import AppShell from '@/components/AppShell';

const originalUserAgent = navigator.userAgent;

beforeEach(() => {
  // Simulate Chrome so AppShell doesn't show unsupported browser message
  Object.defineProperty(navigator, 'userAgent', {
    value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, 'userAgent', {
    value: originalUserAgent,
    configurable: true,
  });
});

describe('AppStateContext', () => {
  it('provides correct initial state via default context', () => {
    function Consumer() {
      const { currentState } = useAppState();
      return <span data-testid="state">{currentState}</span>;
    }
    render(<Consumer />);
    expect(screen.getByTestId('state').textContent).toBe(AppState.Home);
  });

  it('provides initial session data with empty defaults', () => {
    expect(initialSessionData.workflowName).toBe('');
    expect(initialSessionData.events).toEqual([]);
    expect(initialSessionData.workflowResult).toBeNull();
  });

  it('setState transitions to a new state', () => {
    let capturedSetState: (s: AppState) => void = () => {};

    function Wrapper({ children }: { children: React.ReactNode }) {
      const [currentState, setState] = useState(AppState.Home);
      capturedSetState = setState;
      return (
        <AppStateContext.Provider
          value={{
            currentState,
            setState,
            sessionData: initialSessionData,
            setSessionData: () => {},
            selectedWorkflowId: null,
            setSelectedWorkflowId: () => {},
          }}
        >
          {children}
        </AppStateContext.Provider>
      );
    }

    function Consumer() {
      const { currentState } = useAppState();
      return <span data-testid="state">{currentState}</span>;
    }

    render(
      <Wrapper>
        <Consumer />
      </Wrapper>
    );

    expect(screen.getByTestId('state').textContent).toBe('home');

    act(() => {
      capturedSetState(AppState.NewCapture);
    });
    expect(screen.getByTestId('state').textContent).toBe('new-capture');
  });

  it('all 6 AppState enum values are reachable via setState', () => {
    const allStates = Object.values(AppState);
    expect(allStates).toHaveLength(6);

    let capturedSetState: (s: AppState) => void = () => {};

    function Wrapper({ children }: { children: React.ReactNode }) {
      const [currentState, setState] = useState(AppState.Home);
      capturedSetState = setState;
      return (
        <AppStateContext.Provider
          value={{
            currentState,
            setState,
            sessionData: initialSessionData,
            setSessionData: () => {},
            selectedWorkflowId: null,
            setSelectedWorkflowId: () => {},
          }}
        >
          {children}
        </AppStateContext.Provider>
      );
    }

    function Consumer() {
      const { currentState } = useAppState();
      return <span data-testid="state">{currentState}</span>;
    }

    render(
      <Wrapper>
        <Consumer />
      </Wrapper>
    );

    for (const state of allStates) {
      act(() => {
        capturedSetState(state);
      });
      expect(screen.getByTestId('state').textContent).toBe(state);
    }
  });

  it('supports full state transition flow: home -> new-capture -> recording-start -> recording-active -> processing -> results -> home', () => {
    let capturedSetState: (s: AppState) => void = () => {};

    function Wrapper({ children }: { children: React.ReactNode }) {
      const [currentState, setState] = useState(AppState.Home);
      capturedSetState = setState;
      return (
        <AppStateContext.Provider
          value={{
            currentState,
            setState,
            sessionData: initialSessionData,
            setSessionData: () => {},
            selectedWorkflowId: null,
            setSelectedWorkflowId: () => {},
          }}
        >
          {children}
        </AppStateContext.Provider>
      );
    }

    function Consumer() {
      const { currentState } = useAppState();
      return <span data-testid="state">{currentState}</span>;
    }

    render(
      <Wrapper>
        <Consumer />
      </Wrapper>
    );

    const flow = [
      AppState.NewCapture,
      AppState.RecordingStart,
      AppState.RecordingActive,
      AppState.Processing,
      AppState.Results,
      AppState.Home,
    ];

    for (const state of flow) {
      act(() => {
        capturedSetState(state);
      });
      expect(screen.getByTestId('state').textContent).toBe(state);
    }
  });
});

describe('AppShell', () => {
  it('renders with app-shell container', () => {
    render(<AppShell />);
    expect(screen.getByTestId('app-shell')).toBeTruthy();
  });

  it('renders home screen by default', () => {
    render(<AppShell />);
    const homeScreen = screen.getByTestId('home-screen');
    expect(homeScreen).toBeTruthy();
  });

  it('provides state context to child components', () => {
    render(<AppShell />);
    // AppShell renders HomeScreen in home state
    expect(screen.getByTestId('home-screen')).toBeTruthy();
  });
});
