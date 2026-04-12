import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useState } from 'react';
import { AppState } from '@/lib/types';
import { AppStateContext, SessionData, initialSessionData } from '@/lib/state';
import NewCaptureScreen from '@/components/NewCaptureScreen';

afterEach(() => {
  cleanup();
});

function createWrapper() {
  let capturedState = AppState.NewCapture;
  let capturedSessionData: SessionData = { ...initialSessionData };

  function Wrapper({ children }: { children: React.ReactNode }) {
    const [currentState, setState] = useState(AppState.NewCapture);
    const [sessionData, setSessionData] = useState<SessionData>({ ...initialSessionData });

    capturedState = currentState;
    capturedSessionData = sessionData;

    return (
      <AppStateContext.Provider
        value={{
          currentState,
          setState: (s) => {
            capturedState = s;
            setState(s);
          },
          sessionData,
          setSessionData: (d) => {
            capturedSessionData = d;
            setSessionData(d);
          },
          selectedWorkflowId: null,
          setSelectedWorkflowId: () => {},
        }}
      >
        {children}
      </AppStateContext.Provider>
    );
  }

  return {
    Wrapper,
    getState: () => capturedState,
    getSessionData: () => capturedSessionData,
  };
}

describe('NewCaptureScreen', () => {
  describe('content rendering', () => {
    it('renders the headline', () => {
      const { Wrapper } = createWrapper();
      render(<NewCaptureScreen />, { wrapper: Wrapper });
      expect(screen.getByText('Show me how you work')).toBeDefined();
    });

    it('renders the contract text', () => {
      const { Wrapper } = createWrapper();
      render(<NewCaptureScreen />, { wrapper: Wrapper });
      expect(
        screen.getByText(/I'll watch your screen and listen as you go/)
      ).toBeDefined();
    });

    it('renders the permission hint', () => {
      const { Wrapper } = createWrapper();
      render(<NewCaptureScreen />, { wrapper: Wrapper });
      expect(
        screen.getByText(/You'll choose a screen to share/)
      ).toBeDefined();
    });

    it('renders the workflow name input with placeholder', () => {
      const { Wrapper } = createWrapper();
      render(<NewCaptureScreen />, { wrapper: Wrapper });
      const input = screen.getByTestId('workflow-name-input') as HTMLInputElement;
      expect(input.placeholder).toBe('Workflow name (optional)');
      expect(input.value).toBe('');
    });

    it('renders the start recording button', () => {
      const { Wrapper } = createWrapper();
      render(<NewCaptureScreen />, { wrapper: Wrapper });
      expect(screen.getByTestId('start-recording-button')).toBeDefined();
      expect(screen.getByText('Start recording')).toBeDefined();
    });

    it('renders the back button', () => {
      const { Wrapper } = createWrapper();
      render(<NewCaptureScreen />, { wrapper: Wrapper });
      expect(screen.getByTestId('back-button')).toBeDefined();
    });

    it('renders the footer note', () => {
      const { Wrapper } = createWrapper();
      render(<NewCaptureScreen />, { wrapper: Wrapper });
      expect(
        screen.getByText(/Chrome or Edge · screen \+ microphone · nothing leaves this browser/)
      ).toBeDefined();
    });
  });

  describe('navigation', () => {
    it('back button navigates to home', () => {
      const { Wrapper, getState } = createWrapper();
      render(<NewCaptureScreen />, { wrapper: Wrapper });

      fireEvent.click(screen.getByTestId('back-button'));
      expect(getState()).toBe(AppState.Home);
    });

    it('start button navigates to recording-start', () => {
      const { Wrapper, getState } = createWrapper();
      render(<NewCaptureScreen />, { wrapper: Wrapper });

      fireEvent.click(screen.getByTestId('start-recording-button'));
      expect(getState()).toBe(AppState.RecordingStart);
    });

    it('start button stores workflow name in session data', () => {
      const { Wrapper, getSessionData } = createWrapper();
      render(<NewCaptureScreen />, { wrapper: Wrapper });

      const input = screen.getByTestId('workflow-name-input');
      fireEvent.change(input, { target: { value: 'My Workflow' } });
      fireEvent.click(screen.getByTestId('start-recording-button'));

      expect(getSessionData().workflowName).toBe('My Workflow');
    });

    it('start button trims whitespace from workflow name', () => {
      const { Wrapper, getSessionData } = createWrapper();
      render(<NewCaptureScreen />, { wrapper: Wrapper });

      const input = screen.getByTestId('workflow-name-input');
      fireEvent.change(input, { target: { value: '  Spaced Name  ' } });
      fireEvent.click(screen.getByTestId('start-recording-button'));

      expect(getSessionData().workflowName).toBe('Spaced Name');
    });

    it('start button works with empty workflow name', () => {
      const { Wrapper, getState, getSessionData } = createWrapper();
      render(<NewCaptureScreen />, { wrapper: Wrapper });

      fireEvent.click(screen.getByTestId('start-recording-button'));

      expect(getState()).toBe(AppState.RecordingStart);
      expect(getSessionData().workflowName).toBe('');
    });
  });

  describe('input behavior', () => {
    it('workflow name input accepts text', () => {
      const { Wrapper } = createWrapper();
      render(<NewCaptureScreen />, { wrapper: Wrapper });

      const input = screen.getByTestId('workflow-name-input') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'Test Name' } });
      expect(input.value).toBe('Test Name');
    });
  });
});
