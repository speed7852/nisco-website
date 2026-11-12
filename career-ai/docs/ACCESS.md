# Cloudflare Access design

**Status: designed and implemented in the Worker; not configured or enabled in Cloudflare.**
Production uses `AUTH_MODE = "key"` (private key exchanged for an 8-hour session, rate limited).
Nothing in this repository turns Access on.

## Why

In key mode one shared secret protects the API. Cloudflare Access moves sign-in to Cloudflare's
identity layer (one-time PIN to your email, or Google/Microsoft), adds per-user policies and audit
logs, and keeps unauthenticated traffic away from the Worker. Access is free for up to 50 users.

## What the Worker already does in `AUTH_MODE = "access"`

`worker/src/auth/access-jwt.ts` and `worker/src/auth/index.ts`:

- reads the token from `Cf-Access-Jwt-Assertion` (set by Access on proxied requests) or the
  `CF_Authorization` cookie;
- accepts RS256 only, finds the key by `kid` in `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`
  (cached 10 minutes, refetched once on an unknown `kid` for key rotation);
- verifies the signature, `iss` equals the team domain, `aud` contains `ACCESS_AUD`, `exp` and `nbf`
  (60 s leeway);
- optionally requires the email to be in `ACCESS_ALLOWED_EMAILS` (403 otherwise);
- disables `POST /api/session`; session tokens and the raw key are not accepted;
- fails closed (503) if `ACCESS_TEAM_DOMAIN` or `ACCESS_AUD` is missing.

`test/access-jwt.test.ts` covers valid tokens, wrong audience/issuer, expiry, not-before, a foreign
signing key, `alg: none` and HS256, unknown `kid`, tampered payloads and the allow-list.

## The cross-origin problem, and the recommended topology

Today the app is on `*.pages.dev` and the API on `*.workers.dev`. These are different sites. Access
sets its cookie per hostname, and browsers increasingly block cross-site cookies, so a page on
`pages.dev` cannot reliably send the API's Access cookie to `workers.dev`.

**Recommended:** serve the API from the same hostname as the app. A Pages Function at
`frontend/functions/api/[[path]].ts` forwards `/api/*` to the Worker through a service binding, and
one Access application protects the Pages hostname. Access then injects `Cf-Access-Jwt-Assertion` on
every request, the function passes it on, and the Worker verifies it. No CORS is needed, and the Worker's
public `workers.dev` route can be turned off. This changes the Pages deployment (functions directory
and a service binding), so it is a separate, reviewed change and is **not** part of Phase 0/1.

## Steps to enable (after the same-origin change)

Dashboard names change over time; if a label differs, look for the closest equivalent.

1. **Zero Trust organisation.** Cloudflare dashboard > Zero Trust. Choose a team name; the team domain
   is `https://<team>.cloudflareaccess.com`. Select the Free plan.
2. **Login method.** Zero Trust > Settings > Authentication. One-time PIN is enabled by default; add
   Google or Microsoft if preferred.
3. **Application.** Zero Trust > Access > Applications > Add an application > Self-hosted.
   - Name: `NISCO Career AI`.
   - Domain: the Pages hostname that serves the app and `/api`. For a `pages.dev` hostname, the Pages
     project's settings also offer an access-policy option for preview deployments; a custom domain
     on a Cloudflare zone is the most reliable choice.
   - Session duration: 8 hours.
4. **Policy.** Action *Allow*; Include *Emails*: your email address only.
5. **Audience tag.** Open the application > Overview, copy *Application Audience (AUD) Tag*.
6. **Worker settings** in `worker/wrangler.toml`:
   ```toml
   AUTH_MODE = "access"
   ACCESS_TEAM_DOMAIN = "https://<team>.cloudflareaccess.com"
   ACCESS_AUD = "<AUD tag>"
   ACCESS_ALLOWED_EMAILS = "<your email>"
   ```
   These are identifiers, not secrets. Set `ALLOWED_ORIGINS` to the app hostname.
7. **Frontend.** In `frontend/config.js` set `authMode: "access"` and `apiBase: ""` (same origin).
   Update `connect-src` in `frontend/_headers` to `'self'`.
8. Deploy through the normal pull request into `career-ai-deploy`.

## Verify

1. In a private window, open the app: Cloudflare's sign-in page must appear before the app.
2. After signing in, the app loads without asking for the access key.
3. `curl -i https://<app-host>/api/profile` without a cookie returns a redirect or 403 from Access,
   never data.
4. Worker logs show no `access_jwt_rejected` events for your own requests.

## Roll back to key mode

Set `AUTH_MODE = "key"` and `config.js` `authMode: "key"`, redeploy, then remove or disable the
Access application.
