/**
 * Local code runner — executes submissions directly in the backend container
 * instead of Judge0. Used because Judge0 1.13.0's isolate sandbox requires
 * cgroup v1, which Docker Desktop (cgroup v2) does not provide.
 *
 * Supported languages (toolchains installed in the image — see Dockerfile):
 *   javascript -> node, python -> python3,
 *   cpp -> g++ (compile then run), java -> javac/java, go -> go run.
 *
 * Java note: the public class must be named `Main` (Judge0 convention), since
 * the source is written to Main.java and run as `java Main`.
 *
 * Returns the same result shape as judge0.js#runCode so the queue and clients
 * are unchanged. NOTE: this runs untrusted code WITHOUT sandboxing — acceptable
 * for a local single-user demo, not for a public/production deployment.
 */

import { spawn } from 'node:child_process';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { judge0RequestDuration } from '../metrics.js';

const RUN_TIMEOUT_MS     = 10_000;  // wall-clock run limit -> Time Limit Exceeded
const COMPILE_TIMEOUT_MS = 20_000;  // compile step limit
const MAX_OUTPUT         = 100_000; // cap captured stdout/stderr at ~100 KB

// Each runner names the source file, optional extra files, an optional compile
// step, and a run step. compile/run are (dir) => { bin, args, cwd?, env? }.
const RUNNERS = {
  javascript: {
    main: 'main.js',
    run: (d) => ({ bin: 'node', args: [join(d, 'main.js')] }),
  },
  python: {
    main: 'main.py',
    run: (d) => ({ bin: 'python3', args: [join(d, 'main.py')] }),
  },
  cpp: {
    main: 'main.cpp',
    compile: (d) => ({ bin: 'g++', args: ['-O2', '-std=c++17', '-o', join(d, 'prog'), join(d, 'main.cpp')] }),
    run: (d) => ({ bin: join(d, 'prog'), args: [] }),
  },
  java: {
    main: 'Main.java',
    compile: (d) => ({ bin: 'javac', args: ['-d', d, join(d, 'Main.java')] }),
    run: (d) => ({ bin: 'java', args: ['-cp', d, 'Main'] }),
  },
  go: {
    main: 'main.go',
    extraFiles: [{ name: 'go.mod', content: 'module main\n\ngo 1.21\n' }],
    run: (d) => ({ bin: 'go', args: ['run', '.'], cwd: d }),
  },
};

export async function runCode({ language, code, stdin = '' }) {
  const runner = RUNNERS[language];
  if (!runner) {
    return {
      stdout: '',
      stderr: `Language "${language}" is not supported by the local runner.`,
      compile_output: '',
      status: 'Runtime Error',
      statusId: 11,
      time: '0',
      memory: 0,
    };
  }

  const start = Date.now();
  const dir   = await mkdtemp(join(tmpdir(), 'cs-exec-'));
  const elapsed = () => ((Date.now() - start) / 1000).toFixed(3);

  try {
    await writeFile(join(dir, runner.main), code, 'utf8');
    for (const f of runner.extraFiles ?? []) {
      await writeFile(join(dir, f.name), f.content, 'utf8');
    }

    // ── Compile step (cpp / java) ──────────────────────────────────────────
    if (runner.compile) {
      const c  = runner.compile(dir);
      const cr = await execProcess(c.bin, c.args, '', { timeoutMs: COMPILE_TIMEOUT_MS, cwd: c.cwd, env: c.env });
      if (cr.timedOut || cr.code !== 0) {
        return {
          stdout: '',
          stderr: '',
          compile_output: (cr.stderr || cr.stdout) || (cr.timedOut ? 'Compilation timed out' : 'Compilation failed'),
          status: 'Compilation Error',
          statusId: 6,
          time: elapsed(),
          memory: 0,
        };
      }
    }

    // ── Run step ───────────────────────────────────────────────────────────
    const r  = runner.run(dir);
    const rr = await execProcess(r.bin, r.args, stdin, { timeoutMs: RUN_TIMEOUT_MS, cwd: r.cwd, env: r.env });
    const time = elapsed();
    judge0RequestDuration.observe(Date.now() - start);

    if (rr.timedOut) {
      return { stdout: rr.stdout, stderr: rr.stderr, compile_output: '', status: 'Time Limit Exceeded', statusId: 5, time, memory: 0 };
    }
    if (rr.code === 0) {
      return { stdout: rr.stdout, stderr: rr.stderr, compile_output: '', status: 'Accepted', statusId: 3, time, memory: 0 };
    }
    return {
      stdout: rr.stdout,
      stderr: rr.stderr || `Process exited with code ${rr.code}`,
      compile_output: '',
      status: 'Runtime Error (NZEC)',
      statusId: 11,
      time,
      memory: 0,
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function execProcess(bin, args, stdin, { timeoutMs = RUN_TIMEOUT_MS, cwd, env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
    });
    let stdout = '', stderr = '', timedOut = false;

    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);

    child.stdout.on('data', (d) => { if (stdout.length < MAX_OUTPUT) stdout += d.toString(); });
    child.stderr.on('data', (d) => { if (stderr.length < MAX_OUTPUT) stderr += d.toString(); });
    child.on('error', (err) => { clearTimeout(timer); resolve({ stdout, stderr: stderr + err.message, code: 1, timedOut }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ stdout, stderr, code, timedOut }); });

    if (stdin) child.stdin.write(stdin);
    child.stdin.end();
  });
}
