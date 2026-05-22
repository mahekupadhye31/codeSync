import axios from 'axios';

const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_URL = 'https://api.github.com/user';

export function buildAuthorizationUrl() {
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    redirect_uri: process.env.GITHUB_CALLBACK_URL,
    scope: 'read:user',
  });
  return `https://github.com/login/oauth/authorize?${params}`;
}

export async function exchangeCodeForToken(code) {
  const { data } = await axios.post(
    GITHUB_TOKEN_URL,
    {
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: process.env.GITHUB_CALLBACK_URL,
    },
    { headers: { Accept: 'application/json' } }
  );

  if (data.error) {
    throw new Error(`GitHub OAuth error: ${data.error_description}`);
  }

  return data.access_token;
}

export async function fetchGitHubUser(accessToken) {
  const { data } = await axios.get(GITHUB_USER_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });

  return {
    github_id: String(data.id),
    username: data.login,
    avatar_url: data.avatar_url,
  };
}
