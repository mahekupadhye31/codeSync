import { Router } from 'express';
import { buildAuthorizationUrl, exchangeCodeForToken, fetchGitHubUser } from '../auth/github.js';
import { signToken } from '../auth/jwt.js';
import { requireAuth } from '../middleware/auth.js';
import { query } from '../db/index.js';
import { authAttemptsTotal } from '../metrics.js';

const router = Router();

// Redirect browser to GitHub OAuth consent screen
router.get('/github', (_req, res) => {
  res.redirect(buildAuthorizationUrl());
});

// GitHub posts the code here after user authorises
router.get('/github/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error || !code) {
    return res.redirect(`${process.env.CLIENT_URL}/?error=oauth_denied`);
  }

  try {
    const accessToken = await exchangeCodeForToken(code);
    const githubUser = await fetchGitHubUser(accessToken);

    // Upsert user — update username/avatar in case they changed on GitHub
    const { rows } = await query(
      `INSERT INTO users (github_id, username, avatar_url)
       VALUES ($1, $2, $3)
       ON CONFLICT (github_id) DO UPDATE
         SET username   = EXCLUDED.username,
             avatar_url = EXCLUDED.avatar_url
       RETURNING id, github_id, username, avatar_url`,
      [githubUser.github_id, githubUser.username, githubUser.avatar_url]
    );

    const user = rows[0];
    const token = signToken({
      sub: user.id,
      github_id: user.github_id,
      username: user.username,
      avatar_url: user.avatar_url,
    });

    authAttemptsTotal.inc({ provider: 'github', result: 'success' });
    // Send token to the frontend via redirect query param
    res.redirect(`${process.env.CLIENT_URL}/auth/callback?token=${token}`);
  } catch (err) {
    console.error('OAuth callback error:', err.message);
    authAttemptsTotal.inc({ provider: 'github', result: 'failure' });
    res.redirect(`${process.env.CLIENT_URL}/?error=oauth_failed`);
  }
});

// Dev-only backdoor for load tests — disabled in production
if (process.env.NODE_ENV === 'test') {
  router.post('/dev', async (req, res) => {
    const username = String(req.body?.username || `load-${Date.now()}`).slice(0, 64);
    const { rows } = await query(
      `INSERT INTO users (github_id, username, avatar_url)
       VALUES ($1, $2, '')
       ON CONFLICT (github_id) DO UPDATE SET username = EXCLUDED.username
       RETURNING id, username, avatar_url`,
      [`dev-${username}`, username]
    );
    const user  = rows[0];
    const token = signToken({ sub: user.id, username: user.username, avatar_url: '' });
    res.json({ token, userId: user.id });
  });
}

// Return the profile of the currently authenticated user
router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await query(
    'SELECT id, github_id, username, avatar_url, created_at FROM users WHERE id = $1',
    [req.user.sub]
  );
  if (!rows.length) return res.status(404).json({ message: 'User not found' });
  res.json(rows[0]);
});

export default router;
