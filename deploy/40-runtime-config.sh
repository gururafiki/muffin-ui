#!/bin/sh
# Runs at container start (nginx image /docker-entrypoint.d/). Writes the
# deployment's PUBLIC runtime config into the web root so the SPA can read
# window.__MUFFIN_CONFIG__ (loaded via src/app/+html.tsx before the app bundle).
#
# Env (from the muffin-deployment stack; both optional):
#   SUPABASE_ANON_KEY  public anon key — enables the in-app Account features
#   SUPABASE_URL       Supabase base URL (default: same-origin /supabase proxy)
#
# When SUPABASE_ANON_KEY is empty the app treats accounts as off (unchanged
# behaviour for images run without the env).
set -eu

out=/usr/share/nginx/html/runtime-config.js
cat > "$out" <<EOF
window.__MUFFIN_CONFIG__ = {
  "supabaseUrl": "${SUPABASE_URL:-/supabase}",
  "supabaseAnonKey": "${SUPABASE_ANON_KEY:-}"
};
EOF
echo "runtime-config.js written (supabase accounts: $([ -n "${SUPABASE_ANON_KEY:-}" ] && echo on || echo off))"
