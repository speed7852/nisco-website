// Deployment settings for the browser app. This file is public: never put secrets here.
// apiBase must also be listed in the connect-src of _headers, and this site's origin must be
// listed in ALLOWED_ORIGINS in worker/wrangler.toml.
// authMode must match AUTH_MODE in worker/wrangler.toml ("key" or "access"; see docs/ACCESS.md).
window.CAREER_AI_CONFIG = Object.freeze({
  apiBase: "https://nisco-career-ai-api.speedhome7852.workers.dev",
  authMode: "key",
});
