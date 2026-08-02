import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from './api';

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'member';
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ user: User }>('/api/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    try {
      const r = await api.post<{ user: User }>('/api/auth/login', { email, password });
      setUser(r.user);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) throw new Error('Invalid email or password');
      throw err;
    }
  };

  const logout = async () => {
    await api.post('/api/auth/logout');
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth outside AuthProvider');
  return value;
}
