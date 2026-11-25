import { useCallback, useEffect, useState } from 'react';

export const PANEL_PREFERENCES_KEY = 'covibes.workspace.panels.v1';
export const CHAT_LIMITS = { min: 272, max: 480 } as const;
export const OVERVIEW_LIMITS = { min: 260, max: 380 } as const;
export type PanelPreferences = {
  chat: number;
  tabletChat: number;
  overview: number;
  wideOverview: boolean;
  tabletOverview: boolean;
};
const DEFAULTS: PanelPreferences = {
  chat: 372,
  tabletChat: 300,
  overview: 300,
  wideOverview: true,
  tabletOverview: false,
};

export function clampPanel(value: number, min: number, max: number) {
  return Math.min(Math.max(min, max), Math.max(min, value));
}
function bounded(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? clampPanel(value, min, max)
    : fallback;
}
export function readPanelPreferences(): PanelPreferences {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PANEL_PREFERENCES_KEY) ?? 'null');
    if (!value || typeof value !== 'object') return DEFAULTS;
    const stored = value as Partial<Record<keyof PanelPreferences, unknown>>;
    return {
      chat: bounded(stored.chat, DEFAULTS.chat, CHAT_LIMITS.min, CHAT_LIMITS.max),
      tabletChat: bounded(stored.tabletChat, DEFAULTS.tabletChat, CHAT_LIMITS.min, CHAT_LIMITS.max),
      overview: bounded(
        stored.overview,
        DEFAULTS.overview,
        OVERVIEW_LIMITS.min,
        OVERVIEW_LIMITS.max,
      ),
      wideOverview: typeof stored.wideOverview === 'boolean' ? stored.wideOverview : true,
      tabletOverview: typeof stored.tabletOverview === 'boolean' ? stored.tabletOverview : false,
    };
  } catch {
    return DEFAULTS;
  }
}
/** Only geometry preferences are stored, never project identity, messages or draft content. */
export function usePanelPreferences() {
  const [preferences, setPreferences] = useState(readPanelPreferences);
  useEffect(() => {
    try {
      localStorage.setItem(PANEL_PREFERENCES_KEY, JSON.stringify(preferences));
    } catch {
      /* Refused device storage does not block the controls. */
    }
  }, [preferences]);
  const update = useCallback((patch: Partial<PanelPreferences>) => {
    setPreferences((previous) => ({ ...previous, ...patch }));
  }, []);
  return [preferences, update] as const;
}
