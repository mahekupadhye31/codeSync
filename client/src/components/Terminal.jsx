import { useEffect, useRef } from 'react';
import { Terminal }  from '@xterm/xterm';
import { FitAddon }  from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

export default function TerminalPanel({ roomId }) {
  const containerRef = useRef(null);
  const termRef      = useRef(null);
  const wsRef        = useRef(null);
  const fitRef       = useRef(null);

  useEffect(() => {
    const token = localStorage.getItem('cs_token');
    if (!token) return;

    const term = new Terminal({
      theme: {
        background:  '#0d1117',
        foreground:  '#e6edf3',
        cursor:      '#58a6ff',
        black:       '#484f58',
        brightBlack: '#6e7681',
      },
      fontFamily: '"Cascadia Code", "Fira Code", Menlo, monospace',
      fontSize:    13,
      lineHeight:  1.4,
      cursorBlink: true,
      scrollback:  5000,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current  = fit;

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url   = `${proto}://${window.location.host}/terminal?token=${token}&roomId=${roomId}`;
    const ws    = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    };

    ws.onmessage = (evt) => {
      if (typeof evt.data === 'string') term.write(evt.data);
      else evt.data.arrayBuffer().then((buf) => term.write(new Uint8Array(buf)));
    };

    ws.onclose = () => {
      term.write('\r\n\x1b[2m[connection closed]\x1b[0m\r\n');
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: 'input', data }));
    });

    const ro = new ResizeObserver(() => {
      try { fit.fit(); } catch {}
      if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      ws.close();
      term.dispose();
    };
  }, [roomId]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ padding: '4px 4px 0' }}
    />
  );
}
