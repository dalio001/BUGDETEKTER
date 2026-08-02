import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Overview } from './pages/Overview';
import { Issues } from './pages/Issues';
import { IssueDetail } from './pages/IssueDetail';
import { NewReport } from './pages/NewReport';
import { Projects } from './pages/Projects';
import { Tokens } from './pages/Tokens';

function Protected() {
  const { user, loading } = useAuth();
  if (loading) return <div className="empty">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Layout />;
}

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Protected />}>
            <Route path="/" element={<Overview />} />
            <Route path="/issues" element={<Issues />} />
            <Route path="/issues/:id" element={<IssueDetail />} />
            <Route path="/report" element={<NewReport />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/tokens" element={<Tokens />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
