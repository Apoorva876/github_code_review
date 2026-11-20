import { Router } from 'express';
import { redactSensitiveText } from '../services/geminiReviewService.ts';
import {
  clearSessionFromRequest,
  consumeOAuthState,
  createGitHubAuthorizeUrl,
  exchangeGitHubCodeForSession,
  getGitHubCallbackUrl,
  getSessionFromRequest,
  isGitHubOAuthConfigured,
  setSessionCookie,
} from '../services/githubAuthService.ts';

export const authApiRouter = Router();
export const oauthCallbackRouter = Router();

authApiRouter.get('/github/status', (req, res) => {
  const session = getSessionFromRequest(req);
  const configured = isGitHubOAuthConfigured();
  const callbackUrl = getGitHubCallbackUrl(req);

  res.json({
    configured,
    authenticated: Boolean(session),
    user: session?.user ?? null,
    scopes: session?.scopes ?? [],
    hasPrivateScope: Boolean(
      session?.scopes.some((s) => s === 'repo' || s === 'public_repo') &&
        session?.scopes.includes('repo')
    ),
    callbackUrl,
  });
});

authApiRouter.get('/github/url', (req, res) => {
  try {
    const url = createGitHubAuthorizeUrl(req);
    return res.json({ url });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'GitHub OAuth is not configured.';
    return res.status(503).json({
      error: message,
      callbackUrl: getGitHubCallbackUrl(req),
    });
  }
});

authApiRouter.post('/github/logout', (req, res) => {
  clearSessionFromRequest(req, res);
  res.json({ ok: true });
});

function renderPopupHtml(params: {
  ok: boolean;
  message: string;
}): string {
  const safeMessage = params.message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const eventType = params.ok ? 'OAUTH_AUTH_SUCCESS' : 'OAUTH_AUTH_ERROR';

  const safeJson = (val: unknown) =>
    JSON.stringify(val)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>CodeRubric GitHub Authentication</title>
    <style>
      body { font-family: system-ui, -apple-system, sans-serif; background: #0B0F17; color: #E2E8F0; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; text-align: center; }
      .card { max-width: 420px; background: #111827; border: 1px solid #1E293B; border-radius: 8px; padding: 24px; }
      h1 { font-size: 16px; margin: 0 0 8px; }
      p { font-size: 13px; color: #94A3B8; margin: 0; line-height: 1.5; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${params.ok ? 'GitHub Connected' : 'Authentication Failed'}</h1>
      <p>${safeMessage}</p>
    </div>
    <script>
      (function() {
        var payload = { type: ${safeJson(eventType)}, message: ${safeJson(params.message)} };
        if (window.opener) {
          window.opener.postMessage(payload, '*');
          ${params.ok ? 'setTimeout(function() { window.close(); }, 300);' : ''}
        } else {
          setTimeout(function() { window.location.href = '/#repositories'; }, 1200);
        }
      })();
    </script>
  </body>
</html>`;
}

oauthCallbackRouter.get(['/auth/github/callback', '/auth/github/callback/'], async (req, res) => {
  const errorParam = req.query.error as string | undefined;
  const errorDesc = req.query.error_description as string | undefined;
  if (errorParam) {
    return res
      .status(400)
      .send(renderPopupHtml({ ok: false, message: errorDesc || errorParam }));
  }

  const code = String(req.query.code ?? '').trim();
  const state = String(req.query.state ?? '').trim();

  if (!code || !state || !consumeOAuthState(state)) {
    return res.status(400).send(
      renderPopupHtml({
        ok: false,
        message: 'Invalid or expired OAuth state parameter. Please retry signing in.',
      })
    );
  }

  try {
    const redirectUri = getGitHubCallbackUrl(req);
    const session = await exchangeGitHubCodeForSession(code, redirectUri);
    setSessionCookie(res, session.sessionId);
    return res.send(
      renderPopupHtml({
        ok: true,
        message: `Signed in as @${session.user.login}. You may close this window.`,
      })
    );
  } catch (err) {
    const raw = err instanceof Error ? err.message : 'GitHub token exchange failed.';
    return res.status(500).send(renderPopupHtml({ ok: false, message: redactSensitiveText(raw) }));
  }
});
