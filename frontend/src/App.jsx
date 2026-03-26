import { Routes, Route, Link } from 'react-router-dom';
import { HomePage } from './pages/public/HomePage.jsx';
import { MotoristaPage } from './pages/portal-motorista/MotoristaPage.jsx';
import { TransportadoraPage } from './pages/portal-transportadora/TransportadoraPage.jsx';
import { DashboardPage } from './pages/dashboard/DashboardPage.jsx';

export default function App() {
  return (
    <div>
      <header className="topbar">
        <div className="container nav">
          <strong>Agendamento de Descarga</strong>
          <nav>
            <Link to="/">Início</Link>
            <Link to="/motorista">Motorista</Link>
            <Link to="/transportadora">Transportadora</Link>
            <Link to="/dashboard">Dashboard</Link>
          </nav>
        </div>
      </header>

      <main className="container">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/motorista" element={<MotoristaPage />} />
          <Route path="/transportadora" element={<TransportadoraPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
        </Routes>
      </main>
    </div>
  );
}
