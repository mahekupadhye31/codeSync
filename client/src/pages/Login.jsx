import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

const API_BASE   = import.meta.env.VITE_API_URL || '/api';
const GITHUB_URL = 'https://github.com/your-username/codesync'; // update before deploy

export default function Login() {
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) navigate('/dashboard', { replace: true });
  }, [user, navigate]);

  const urlParams = new URLSearchParams(window.location.search);
  const error = urlParams.get('error');

  return (
    <div className="animated-gradient min-h-screen flex flex-col items-center justify-center px-4">
      {/* Logo */}
      <div className="flex items-center gap-3 mb-10">
        <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/30">
          <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
        </div>
        <h1 className="text-3xl font-bold text-white">CodeSync</h1>
      </div>

      {/* Login card */}
      <div className="bg-dark-800/90 backdrop-blur border border-dark-600 rounded-2xl p-10 w-full max-w-md text-center shadow-2xl">
        <h2 className="text-xl font-semibold text-white mb-2">Real-time collaborative coding</h2>
        <p className="text-gray-400 text-sm mb-8">
          Edit code together with your team, in real time. No setup required.
        </p>

        {error && (
          <div className="mb-6 bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm">
            {error === 'oauth_denied'
              ? 'GitHub sign-in was cancelled.'
              : 'Something went wrong during sign-in. Please try again.'}
          </div>
        )}

        <a
          href={`${API_BASE}/auth/github`}
          className="flex items-center justify-center gap-3 bg-white text-gray-900 font-semibold rounded-xl px-6 py-3.5 hover:bg-gray-100 w-full"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.37 0 0 5.373 0 12c0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
          </svg>
          Sign in with GitHub
        </a>

        <p className="mt-6 text-xs text-gray-500">
          We only request <code className="text-gray-400">read:user</code> scope.{' '}
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="text-gray-400 hover:text-gray-300">
            View source
          </a>
        </p>
      </div>

      {/* Feature highlights */}
      <div className="grid grid-cols-3 gap-6 mt-10 max-w-lg text-center">
        {[
          {
            icon: (
              <svg className="w-6 h-6 mx-auto text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            ),
            label: 'Real-time sync',
            sub: 'OT-based, conflict-free',
          },
          {
            icon: (
              <svg className="w-6 h-6 mx-auto text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
              </svg>
            ),
            label: 'Multi-language execution',
            sub: 'Python, JS, C++, Java, Go',
          },
          {
            icon: (
              <svg className="w-6 h-6 mx-auto text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ),
            label: 'Version history',
            sub: 'Snapshots & restore',
          },
        ].map(({ icon, label, sub }) => (
          <div key={label} className="text-gray-400 text-sm bg-dark-800/50 rounded-xl p-4 border border-dark-600/50">
            <div className="mb-2">{icon}</div>
            <div className="font-medium text-gray-300">{label}</div>
            <div className="text-xs text-gray-500 mt-0.5">{sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
