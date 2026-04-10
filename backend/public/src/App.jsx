import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { PrivateRoute } from './components/PrivateRoute';
import LoginPage from './pages/admin/LoginPage';
import DashboardPage from './pages/admin/DashboardPage';
import AgendamentosPage from './pages/admin/AgendamentosPage';
import PublicFornecedorPage from './pages/PublicFornecedorPage';
import PublicMotoristaPage from './pages/PublicMotoristaPage';

function Home() {
  return (
    <div style={{ padding: 24 }}>
      <h1>Agendamento de Descarga</h1>
      <p><Link to="/public/agendar">Portal transportadora/fornecedor</Link></p>
      <p><Link to="/login">Área interna</Link></p>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/public/agendar" element={<PublicFornecedorPage />} />
          <Route path="/public/motorista" element={<PublicMotoristaPage />} />
          <Route path="/dashboard" element={<PrivateRoute><DashboardPage /></PrivateRoute>} />
          <Route path="/agendamentos" element={<PrivateRoute><AgendamentosPage /></PrivateRoute>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
