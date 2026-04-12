import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { isSupportedBrowser } from '@/components/AppShell';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('isSupportedBrowser', () => {
  it('returns true for Chrome', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      configurable: true,
    });
    expect(isSupportedBrowser()).toBe(true);
  });

  it('returns true for Edge', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
      configurable: true,
    });
    expect(isSupportedBrowser()).toBe(true);
  });

  it('returns false for Firefox', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
      configurable: true,
    });
    expect(isSupportedBrowser()).toBe(false);
  });

  it('returns false for Safari', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
      configurable: true,
    });
    expect(isSupportedBrowser()).toBe(false);
  });
});

describe('Unsupported browser message', () => {
  it('shows unsupported browser message for Firefox', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
      configurable: true,
    });

    // Dynamic import after setting userAgent
    const { default: AppShell } = await import('@/components/AppShell');
    const { screen } = await import('@testing-library/react');

    render(<AppShell />);

    expect(screen.getByTestId('unsupported-browser')).toBeTruthy();
    expect(screen.getByText('Unsupported Browser')).toBeTruthy();
    expect(screen.getByText(/Chrome or Edge/)).toBeTruthy();
  });
});
