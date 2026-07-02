import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider }   from './hooks/useAuth';
import ProtectedRoute     from './components/ProtectedRoute';
import ErrorBoundary      from './components/ErrorBoundary';
import Login              from './pages/Login';
import AuthCallback       from './pages/AuthCallback';
import Dashboard          from './pages/Dashboard';
import Room               from './pages/Room';
import SharedRoom         from './pages/SharedRoom';

export default function App() {
  return (
    <ErrorBoundary>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/"                 element={<Login />} />
          <Route path="/auth/callback"    element={<AuthCallback />} />
          <Route path="/shared/:token"    element={<SharedRoom />} />
          <Route
            path="/dashboard"
            element={<ProtectedRoute><Dashboard /></ProtectedRoute>}
          />
          <Route
            path="/room/:id"
            element={<ProtectedRoute><Room /></ProtectedRoute>}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
    </ErrorBoundary>
  );
}
