import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../services/api';

// SECURITY NOTE: Token is stored in localStorage which is accessible to XSS.
// For improved security, migrate to httpOnly secure cookies set by the backend.
// See: https://owasp.org/www-community/HttpOnly
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      api.get('/auth/me').then((res) => setUser(res.data)).catch(() => {
        localStorage.removeItem('token');
      });
    }
  }, []);

  async function login(email, password) {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('token', data.token);
    setUser(data.user);
  }

  function logout() {
    localStorage.removeItem('token');
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
