import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PanelSplitter } from '@web/components/ui/panel-splitter';
import {
  PANEL_PREFERENCES_KEY,
  readPanelPreferences,
} from '@web/features/workspace/use-panel-preferences';

const onChange = vi.fn();
afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('workspace panel preferences', () => {
  it('clamps stored sizes and falls back for invalid values', () => {
    localStorage.setItem(
      PANEL_PREFERENCES_KEY,
      JSON.stringify({
        chat: 5000,
        tabletChat: -1,
        overview: 'wide',
        wideOverview: 'no',
        tabletOverview: true,
      }),
    );
    expect(readPanelPreferences()).toEqual({
      chat: 480,
      tabletChat: 272,
      overview: 300,
      wideOverview: true,
      tabletOverview: true,
    });
    localStorage.setItem(PANEL_PREFERENCES_KEY, '{');
    expect(readPanelPreferences().chat).toBe(372);
  });
});

describe('panel splitter', () => {
  it('supports keyboard steps, limits and reverse direction', () => {
    const { rerender } = render(
      <PanelSplitter
        label="Resize"
        controls="panel"
        value={300}
        min={272}
        max={340}
        onChange={onChange}
      />,
    );
    const splitter = screen.getByRole('separator', { name: 'Resize' });
    fireEvent.keyDown(splitter, { key: 'ArrowLeft', shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(272);
    fireEvent.keyDown(splitter, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith(340);
    rerender(
      <PanelSplitter
        label="Resize"
        controls="panel"
        value={300}
        min={272}
        max={340}
        reverse
        onChange={onChange}
      />,
    );
    fireEvent.keyDown(splitter, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith(310);
    fireEvent.keyDown(splitter, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith(272);
  });
});
