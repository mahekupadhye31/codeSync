import axios from 'axios';
import { judge0RequestDuration } from '../metrics.js';

// Judge0 CE language IDs
const LANGUAGE_IDS = {
  javascript: 63,
  python:     71,
  cpp:        54,
  java:       62,
  go:         60,
};

const STATUS_FINISHED  = new Set([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
const POLL_INTERVAL_MS = 600;
const MAX_POLLS        = 30; // 18 s total timeout

function b64encode(str) { return Buffer.from(str, 'utf8').toString('base64'); }
function b64decode(str) { return str ? Buffer.from(str, 'base64').toString('utf8') : ''; }

/**
 * Returns request headers for the self-hosted Judge0 CE instance.
 * The `X-Auth-Token` header matches the JUDGE0_AUTHN_TOKEN value in
 * judge0.conf (defaults to 'local_dev_token' for the Docker stack).
 * RapidAPI headers are no longer used.
 */
function getHeaders() {
  return {
    'Content-Type': 'application/json',
    Accept:         'application/json',
    'X-Auth-Token': process.env.JUDGE0_AUTH_TOKEN || 'local_dev_token',
  };
}

export async function runCode({ language, code, stdin = '' }) {
  const langId = LANGUAGE_IDS[language];
  if (!langId) throw new Error(`Unsupported language: ${language}`);

  const apiUrl = process.env.JUDGE0_API_URL;

  // Mock response when JUDGE0_API_URL is not set (local dev outside Docker)
  if (!apiUrl) {
    return {
      stdout:          `[Judge0 not configured — set JUDGE0_API_URL]\nCode (${language}):\n${code.slice(0, 200)}`,
      stderr:          '',
      compile_output:  '',
      status:          'Accepted',
      statusId:        3,
      time:            '0',
      memory:          0,
    };
  }

  const judgeStart = Date.now();

  // ── Submit ────────────────────────────────────────────────────────────────
  const { data: submission } = await axios.post(
    `${apiUrl}/submissions?base64_encoded=true&wait=false`,
    {
      source_code: b64encode(code),
      language_id: langId,
      stdin:       b64encode(stdin),
    },
    { headers: getHeaders(), timeout: 10_000 },
  );

  const token = submission.token;
  if (!token) throw new Error('Judge0 did not return a submission token');

  // ── Poll until finished ───────────────────────────────────────────────────
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const { data } = await axios.get(
      `${apiUrl}/submissions/${token}?base64_encoded=true`,
      { headers: getHeaders(), timeout: 10_000 },
    );

    if (STATUS_FINISHED.has(data.status?.id)) {
      judge0RequestDuration.observe(Date.now() - judgeStart);
      return {
        stdout:         b64decode(data.stdout),
        stderr:         b64decode(data.stderr),
        compile_output: b64decode(data.compile_output),
        status:         data.status?.description ?? 'Unknown',
        statusId:       data.status?.id ?? 0,
        time:           data.time ?? '0',
        memory:         data.memory ?? 0,
      };
    }
  }

  judge0RequestDuration.observe(Date.now() - judgeStart);
  throw new Error('Execution timed out');
}
