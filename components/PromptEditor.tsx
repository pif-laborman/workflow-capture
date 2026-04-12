'use client';

import { useState, useEffect, useRef } from 'react';
import { getObservePrompt, setObservePrompt, clearObservePrompt } from '@/lib/storage';
import { OBSERVE_SYSTEM_PROMPT } from '@/lib/prompts/observe';

interface PromptEditorProps {
  onClose: () => void;
}

export default function PromptEditor({ onClose }: PromptEditorProps) {
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState(false);
  const [isCustom, setIsCustom] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const custom = getObservePrompt();
    if (custom) {
      setValue(custom);
      setIsCustom(true);
    } else {
      setValue(OBSERVE_SYSTEM_PROMPT);
      setIsCustom(false);
    }
    // Focus textarea on open
    setTimeout(() => textareaRef.current?.focus(), 100);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleSave = () => {
    setObservePrompt(value);
    setIsCustom(true);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    clearObservePrompt();
    setValue(OBSERVE_SYSTEM_PROMPT);
    setIsCustom(false);
    setSaved(false);
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose();
  };

  const charCount = value.length;
  const lineCount = value.split('\n').length;

  return (
    <div
      className="prompt-backdrop"
      ref={backdropRef}
      onClick={handleBackdropClick}
      data-testid="prompt-editor-backdrop"
    >
      <div className="prompt-modal" data-testid="prompt-editor">
        <div className="prompt-header">
          <div className="prompt-header-left">
            <h2 className="prompt-title">Observer Prompt</h2>
            {isCustom ? (
              <span className="prompt-badge prompt-badge-custom">Custom</span>
            ) : (
              <span className="prompt-badge prompt-badge-default">Default</span>
            )}
          </div>
          <button
            className="prompt-close"
            onClick={onClose}
            data-testid="prompt-close"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <p className="prompt-description">
          This prompt controls how Claude observes your screen and decides when to ask questions during recording.
        </p>

        <div className="prompt-editor-wrap">
          <textarea
            ref={textareaRef}
            className="prompt-textarea"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setSaved(false);
            }}
            spellCheck={false}
            data-testid="prompt-textarea"
          />
        </div>

        <div className="prompt-footer">
          <div className="prompt-meta">
            <span className="prompt-meta-item">{lineCount} lines</span>
            <span className="prompt-meta-sep">&middot;</span>
            <span className="prompt-meta-item">{charCount} chars</span>
          </div>
          <div className="prompt-actions">
            {isCustom && (
              <button
                className="btn-outline"
                onClick={handleReset}
                data-testid="prompt-reset"
              >
                Reset to default
              </button>
            )}
            <button
              className="btn-primary"
              onClick={handleSave}
              data-testid="prompt-save"
            >
              {saved ? 'Saved' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
