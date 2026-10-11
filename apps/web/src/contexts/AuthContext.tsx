import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { User, LoginPayload, AuthResponse } from '../types';
import { useQueryClient } from '@tanstack/react-query';
import apiClient from '../lib/api';

export interface RegisterCompanyPayload {
  companyName: string;
  adminName: string;
  email: string;
  password: string;
  /** the company accepts the Terms of Service and Privacy Policy (required by the server) */
  acceptTerms: true;
}

interface AuthContextValue {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (payload: LoginPayload) => Promise<void>;
  registerCompany: (payload: RegisterCompanyPayload) => Promise<void>;
  logout: () => void;
  hasPermission: (code: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const queryClient = useQueryClient();

  // Rehydrate from localStorage on mount
  useEffect(() => {
    const storedToken = localStorage.getItem('auth_token');
    const storedUser = localStorage.getItem('auth_user');
    if (storedToken && storedUser) {
      try {
        setToken(storedToken);
        setUser(JSON.parse(storedUser) as User);
      } catch {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_user');
      }
    }
    setIsLoading(false);
  }, []);

  // A new session may belong to a different company — never show the previous one's cached data.
  const startSession = useCallback((newToken: string, newUser: User) => {
    queryClient.clear();
    localStorage.setItem('auth_token', newToken);
    localStorage.setItem('auth_user', JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  }, [queryClient]);

  const login = useCallback(async (payload: LoginPayload) => {
    const response = await apiClient.post<AuthResponse>('/auth/login', payload);
    startSession(response.data.token, response.data.user);
  }, [startSession]);

  const registerCompany = useCallback(async (payload: RegisterCompanyPayload) => {
    const response = await apiClient.post<AuthResponse>('/auth/register-tenant', payload);
    startSession(response.data.token, response.data.user);
  }, [startSession]);

  const logout = useCallback(() => {
    queryClient.clear();
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    setToken(null);
    setUser(null);
  }, [queryClient]);

  const hasPermission = useCallback(
    (code: string) => {
      if (!user) return false;
      // ADMIN has all permissions
      if (user.role.code === 'ADMIN') return true;
      return user.permissions.includes(code);
    },
    [user]
  );

  const value: AuthContextValue = {
    user,
    token,
    isAuthenticated: !!token && !!user,
    isLoading,
    login,
    registerCompany,
    logout,
    hasPermission,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}

export function usePermission(code: string): boolean {
  const { hasPermission } = useAuth();
  return hasPermission(code);
}
