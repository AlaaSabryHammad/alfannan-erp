import React, { createContext, useContext, useState, useCallback } from 'react';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface BranchSelection {
  branchId: number | null; // null = كافة الفروع
  branchName: string | null;
}

interface BranchContextValue extends BranchSelection {
  setBranch: (branchId: number | null, branchName: string | null) => void;
}

// ─── Persistence ───────────────────────────────────────────────────────────────

const STORAGE_KEY = 'alfannan.selectedBranch';

function loadSelection(): BranchSelection {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.branchId === 'number' && typeof parsed.branchName === 'string') {
        return { branchId: parsed.branchId, branchName: parsed.branchName };
      }
    }
  } catch {
    // corrupted storage — fall through to default
  }
  return { branchId: null, branchName: null };
}

// ─── Context ───────────────────────────────────────────────────────────────────

const BranchContext = createContext<BranchContextValue | null>(null);

export function BranchProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<BranchSelection>(loadSelection);

  const setBranch = useCallback((branchId: number | null, branchName: string | null) => {
    setState({ branchId, branchName });
    try {
      if (branchId == null) {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ branchId, branchName }));
      }
    } catch {
      // storage unavailable (private mode) — selection still works for the session
    }
  }, []);

  return (
    <BranchContext.Provider value={{ ...state, setBranch }}>
      {children}
    </BranchContext.Provider>
  );
}

export function useBranch(): BranchContextValue {
  const ctx = useContext(BranchContext);
  if (!ctx) {
    throw new Error('useBranch must be used within BranchProvider');
  }
  return ctx;
}
