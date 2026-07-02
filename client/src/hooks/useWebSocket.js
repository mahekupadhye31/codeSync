import { useEffect, useRef, useCallback, useState } from 'react';

const WS_BASE = import.meta.env.VITE_WS_URL ||
  `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;

// Exponential backoff: 1s → 2s → 4s → 8s → 16s → 16s…
const BACKOFF = [1000, 2000, 4000, 8000, 16000];

// After this many failed reconnect attempts we surface a "give up" flag.
const MAX_ATTEMPTS_BEFORE_WARN = 5;

/**
 * useWebSocket(onMessage, onReconnect?)
 *
 * Returns:
 *   send(obj)        — serialize obj to JSON and send (noop when disconnected)
 *   isConnected      — boolean, true when WS is OPEN
 *   reconnectFailed  — boolean, true after MAX_ATTEMPTS_BEFORE_WARN failures
 *                      with no successful re-open; resets to false on reconnect
 *
 * onReconnect is called each time the socket successfully re-opens after
 * a drop, so the caller can re-join rooms etc.
 */
export function useWebSocket(onMessage, onReconnect) {
  const wsRef          = useRef(null);
  const attemptsRef    = useRef(0);
  const mountedRef     = useRef(true);
  const firstOpenRef   = useRef(true);
  const onMessageRef   = useRef(onMessage);
  const onReconnectRef = useRef(onReconnect);
  onMessageRef.current   = onMessage;
  onReconnectRef.current = onReconnect;

  const [isConnected,     setIsConnected]     = useState(false);
  const [reconnectFailed, setReconnectFailed] = useState(false);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    const token = localStorage.getItem('cs_token');
    if (!token) return;

    const ws = new WebSocket(`${WS_BASE}?token=${token}`);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) { ws.close(); return; }
      setIsConnected(true);
      setReconnectFailed(false);
      attemptsRef.current = 0;

      if (!firstOpenRef.current) {
        onReconnectRef.current?.();
      }
      firstOpenRef.current = false;
    };

    ws.onmessage = (evt) => {
      try {
        onMessageRef.current?.(JSON.parse(evt.data));
      } catch {
        // malformed message — ignore
      }
    };

    ws.onclose = () => {
      // Only the current socket may schedule a reconnect. Without this, a socket
      // that was intentionally superseded (e.g. React StrictMode's dev double-mount,
      // or a fast reconnect) fires onclose after mountedRef is restored and spawns an
      // extra connection — leaving multiple live sockets that each apply every remote
      // op, duplicating and reordering typed text.
      if (!mountedRef.current || wsRef.current !== ws) return;
      setIsConnected(false);
      attemptsRef.current += 1;

      if (attemptsRef.current >= MAX_ATTEMPTS_BEFORE_WARN) {
        setReconnectFailed(true);
      }

      const delay = BACKOFF[Math.min(attemptsRef.current - 1, BACKOFF.length - 1)];
      setTimeout(connect, delay);
    };

    ws.onerror = () => ws.close();
  }, []);

  useEffect(() => {
    mountedRef.current   = true;
    firstOpenRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback((obj) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }, []);

  return { send, isConnected, reconnectFailed };
}
