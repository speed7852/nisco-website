#!/usr/bin/env bash
# Fails if personal documents, local secret files or likely credentials are committed under
# career-ai/ or the Career AI workflows. Run from the repository root:
#   bash career-ai/scripts/check-repo-hygiene.sh
set -euo pipefail

status=0

documents=$(git ls-files -- 'career-ai' | grep -iE '\.(pdf|docx?|odt|rtf|pages|xlsx?|csv)$|(^|/)\.dev\.vars|(^|/)\.env(\.|$)' || true)
if [ -n "$documents" ]; then
  echo "::error::Personal documents or local secret files must not be committed:"
  echo "$documents"
  status=1
fi

if git grep -nIE 'BEGIN [A-Z ]*PRIVATE KEY|APP_ACCESS_KEY *= *"[^"]{8,}"|(CLOUDFLARE_API_TOKEN|CAREER_AI_ACCESS_KEY) *[:=] *[A-Za-z0-9_-]{20,}' \
  -- 'career-ai' '.github/workflows/deploy-career-ai.yml' '.github/workflows/test-career-ai.yml'; then
  echo "::error::A line above looks like a committed credential. Use Worker or GitHub Actions secrets instead."
  status=1
fi

# Test data must be synthetic: every email address under career-ai/ (outside the vendored
# third-party library) must use a reserved example domain (RFC 2606 / RFC 6761).
emails=$(git grep -hoIE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' -- 'career-ai' ':!career-ai/frontend/vendor' ':!**/package-lock.json' \
  | grep -viE '@([a-z0-9-]+\.)*(example\.(com|org|net)|example|test|invalid|localhost)$' | sort -u || true)
if [ -n "$emails" ]; then
  echo "::error::Only synthetic addresses on reserved example domains may be committed under career-ai/:"
  echo "$emails"
  status=1
fi

if [ "$status" -eq 0 ]; then
  echo "Career AI repository hygiene check passed."
fi
exit "$status"
