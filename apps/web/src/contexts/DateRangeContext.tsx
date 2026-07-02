import React, { createContext, useContext, useState, useCallback } from 'react';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type DatePreset = 'all' | 'today' | 'week' | 'month' | 'year' | 'custom';

export interface DateRange {
  from: string | null;
  to: string | null;
  preset: DatePreset;
}

interface DateRangeContextValue extends DateRange {
  setRange: (from: string | null, to: string | null, preset: DatePreset) => void;
  setPreset: (preset: DatePreset) => void;
  setCustomFrom: (from: string) => void;
  setCustomTo: (to: string) => void;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function computeRange(preset: DatePreset): { from: string | null; to: string | null } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  switch (preset) {
    case 'all':
      return { from: null, to: null };

    case 'today': {
      const t = toISODate(today);
      return { from: t, to: t };
    }

    case 'week': {
      // Start of current week (Saturday for Arabic-locale weeks, but use Monday as ISO)
      const day = today.getDay(); // 0 = Sunday
      const diff = day === 0 ? -6 : 1 - day;
      const start = new Date(today);
      start.setDate(today.getDate() + diff);
      return { from: toISODate(start), to: toISODate(today) };
    }

    case 'month': {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return { from: toISODate(start), to: toISODate(today) };
    }

    case 'year': {
      const start = new Date(today.getFullYear(), 0, 1);
      return { from: toISODate(start), to: toISODate(today) };
    }

    default:
      return { from: null, to: null };
  }
}

// ─── Context ───────────────────────────────────────────────────────────────────

const DateRangeContext = createContext<DateRangeContextValue | null>(null);

export function DateRangeProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DateRange>({
    from: null,
    to: null,
    preset: 'all',
  });

  const setRange = useCallback((from: string | null, to: string | null, preset: DatePreset) => {
    setState({ from, to, preset });
  }, []);

  const setPreset = useCallback((preset: DatePreset) => {
    if (preset === 'custom') {
      // keep existing from/to, just switch label
      setState((prev) => ({ ...prev, preset }));
    } else {
      const { from, to } = computeRange(preset);
      setState({ from, to, preset });
    }
  }, []);

  const setCustomFrom = useCallback((from: string) => {
    setState((prev) => ({ ...prev, from: from || null, preset: 'custom' }));
  }, []);

  const setCustomTo = useCallback((to: string) => {
    setState((prev) => ({ ...prev, to: to || null, preset: 'custom' }));
  }, []);

  const value: DateRangeContextValue = {
    ...state,
    setRange,
    setPreset,
    setCustomFrom,
    setCustomTo,
  };

  return (
    <DateRangeContext.Provider value={value}>
      {children}
    </DateRangeContext.Provider>
  );
}

export function useDateRange(): DateRangeContextValue {
  const ctx = useContext(DateRangeContext);
  if (!ctx) {
    throw new Error('useDateRange must be used within DateRangeProvider');
  }
  return ctx;
}
