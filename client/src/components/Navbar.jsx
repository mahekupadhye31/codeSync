import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <header className="h-14 bg-dark-800 border-b border-dark-600 flex items-center px-6 gap-4 shrink-0">
      <Link to="/dashboard" className="flex items-center gap-2 font-semibold text-white hover:text-blue-400 transition-colors">
        <svg className="w-6 h-6 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
        </svg>
        CoEdit
      </Link>

      <div className="flex-1" />

      {user && (
        <div className="flex items-center gap-3">
          <img
            src={user.avatar_url}
            alt={user.username}
            className="w-8 h-8 rounded-full border border-dark-500"
          />
          <span className="text-sm text-gray-300 hidden sm:block">@{user.username}</span>
          <button
            onClick={handleLogout}
            className="text-sm text-gray-400 hover:text-white transition-colors px-3 py-1.5 rounded hover:bg-dark-700"
          >
            Sign out
          </button>
        </div>
      )}
    </header>
  );
}
