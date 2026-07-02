import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Ensure a single React instance and pre-bundle every dependency at startup,
  // so Vite never re-optimizes mid-session (which leaves a long-lived tab with a
  // mixed module graph / duplicate React → "Cannot read properties of null (reading 'useRef')").
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'react-router-dom',
      'jwt-decode',
      'diff-match-patch',
      '@codemirror/state',
      '@codemirror/view',
      '@codemirror/commands',
      '@codemirror/language',
      '@codemirror/autocomplete',
      '@codemirror/theme-one-dark',
      '@codemirror/lang-javascript',
      '@codemirror/lang-python',
      '@codemirror/lang-cpp',
      '@codemirror/lang-java',
      '@codemirror/lang-go',
      '@replit/codemirror-indentation-markers',
      '@xterm/xterm',
      '@xterm/addon-fit',
    ],
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    hmr: {
      // When behind nginx on port 80 inside Docker, the browser HMR WS
      // connects back on the port it loaded the page from.
      clientPort: process.env.HMR_CLIENT_PORT
        ? parseInt(process.env.HMR_CLIENT_PORT, 10)
        : 5173,
    },
  },
});
