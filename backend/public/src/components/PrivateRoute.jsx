import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export function PrivateRoute({ children }) {
  const { user, loading } = useAuth();

  // Enquanto estiver verificando o token, não redireciona
  if (loading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
        <p>Carregando sessão...</p>
      </div>
    );
  }

  // Só redireciona após o carregamento confirmar que não há usuário
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
}