# `/api/docs` — make Scalar's "Test Request" target the `/api` prefix

**Date:** 2026-08-03
**Status:** **NOT IMPLEMENTED — superseded by using `muffin-api.<domain>/docs`.** Kept for the
root-cause analysis and the rejected-alternative reasoning. See "Why this was dropped" below.
**Scope (had it shipped):** `muffin-ui` only — one nginx location block, one verification check, docs.

## Why this was dropped

`https://muffin-api.<domain>/docs` serves the same Scalar page with the API at that origin's
**root**, so request execution is already correct there — no injection needed. Verified by firing
the relative paths Scalar resolves, from inside each docs page:

| call | from `muffin-api.<domain>/docs` | from `muffin.<domain>/api/docs` |
| --- | --- | --- |
| `GET /ok` | `200 application/json` `{"ok":true}` | `200 text/html` — the SPA shell |
| `POST /assistants/search` | `200 application/json`, real assistants | **`405 Not Allowed`** from nginx |
| `GET /info` | `200 application/json` | `200 text/html` — the SPA shell |

Two further findings removed the rest of the rationale:

- **The auth injection was unnecessary.** Scalar's test client already exposes `Select Auth Type`,
  `Headers`, `Clear All Headers`, `Cookies` and `Variables` tabs, so an `Authorization: Bearer`
  header can be set by hand with no `securitySchemes` in the document. That was the sole purpose of
  two of the three `sub_filter` lines.
- **The write limit is not a base-URL problem.** Per `auth.py` ("Read-shared, write-authenticated
  threads") reads/searches are open, but creating a thread or starting a run requires sign-in —
  anonymous callers get `403` on create. Paste a Supabase user access token to launch runs. This is
  identical on both hostnames; neither this design nor any other nginx change would affect it.
  (`MUFFIN_API_TOKEN`, the fully-exempt `api-client` identity, is not set in the deployment, so
  there is no exempt shared token available.)

**Residual known nit:** the document has no `servers`, so Scalar's *displayed* curl sample is
relative on **both** pages (`curl /assistants`) and is not pasteable as-is. Execution is unaffected.
This cannot be fixed with nginx on the api host — Traefik routes straight to `langgraph-api` with no
proxy in between — so it would require the backend custom route described under
"Rejected alternatives". Judged not worth it.

## Problem

`https://muffin.rafiki.guru/api/docs` renders the API reference but every "Test Request" is
sent to the wrong origin. Reported as: *"it assumes that site is hosted at root uri
(`https://muffin.rafiki.guru/`), not `https://muffin.rafiki.guru/api/`"*.

### Root cause

The page is **Scalar** (`@scalar/api-reference` from jsDelivr), served by `langgraph-api` at
`/docs`. It does not fetch the spec — langgraph-api **inlines the whole document** into the HTML
as an escaped JSON string:

```html
<script>
  var configuration = {"content":"{\"openapi\":\"3.1.0\",...}"}
  document.getElementById('api-reference').dataset.configuration = JSON.stringify(configuration)
</script>
```

That document has **no `servers` key**, and the Scalar configuration object carries neither
`servers` nor `baseServerURL`. Per OpenAPI 3.1, an absent `servers` defaults to
`[{"url": "/"}]` — resolved against the page origin. So Scalar targets
`https://muffin.rafiki.guru/assistants`.

The `/api` prefix exists **only** because `deploy/nginx.conf` strips it
(`proxy_pass http://langgraph-api:8000/`, trailing slash). The backend has no idea it is mounted
under a prefix, so it cannot advertise one.

Measured — the Scalar address bar reads `POST | /assistants` with **no server segment**:

| URL | result |
| --- | --- |
| `muffin.rafiki.guru/ok` | `200` **`text/html`** — the SPA shell, via `try_files … /index.html` |
| `muffin.rafiki.guru/api/ok` | `200 {"ok":true}` |
| `muffin-api.rafiki.guru/ok` | `200 {"ok":true}` |

The failure is silent: the wrong URL returns **200 with HTML**, so Scalar reports success on a
nonsense response rather than surfacing a 404.

## Approach

Inject Scalar's documented `servers` option into the inlined configuration, in nginx, at the one
location that serves this page.

### Why this layer

- **Traefik routes by `Host` only.** Five routers (`api`/`chat`/`app`/`supabase`/`studio`), each a
  bare `Host()` rule; the sole middleware on `langgraph-api` is `api-cors`. There is no
  path-based routing and no `stripprefix` anywhere in the stack. Path concerns are deliberately
  delegated into the container — `muffin-ui`'s nginx owns `/api/` and `/supabase/`, agent-chat-ui
  owns its own via `LANGGRAPH_API_URL`. A `/api`-prefix artifact therefore belongs in the file
  that creates the prefix.
- **The image stays deployment-independent** — stated twice in the Dockerfile, which is why
  `EXPO_PUBLIC_API_URL=/api` is relative and why deployment-specific values arrive at runtime via
  `deploy/40-runtime-config.sh` → `/runtime-config.js`. The injected `{"url": "/api"}` is a
  **relative** URL reusing the constant the image already commits to. No new env var, no Jinja, no
  templating.

### Rejected alternatives

| Alternative | Why not |
| --- | --- |
| Backend custom route (`http.app` in `langgraph.json` shadowing `/docs`) | Supported upstream — *"routes you create are given priority over the system defaults"* — and prefix-agnostic if the shell derives its server from `new URL('.', location.href)`. But it touches `muffin-agent` (PR + CodeQL), rebuilds/redeploys the agent image, and makes us the owner of a docs shell upstream currently maintains. Disproportionate. **Keep as the fallback if upstream's template churns.** |
| 302 `/api/docs` → `muffin-api.<domain>/docs` | `muffin-api.rafiki.guru/docs` already works today (API at that origin's root, same allow-by-email Access policy). But that hostname is templated from `api_subdomain` and never hardcoded in an image; a redirect would either hardcode it or need new env plumbing through `40-runtime-config.sh` — more custom, not less. Also costs a second Access login and leaves the app host without docs. |
| Traefik middleware | No native response-body rewriting (plugin territory), and the stack uses no path middlewares at all. |
| Patch at container start, like `/runtime-config.js` | Not applicable — the docs HTML is generated per request by langgraph-api, not a static file in the image. |

## Design

A dedicated **exact-match** `location = /api/docs` in `deploy/nginx.conf`, which wins over the
existing `/api/` prefix block by nginx precedence. Three `sub_filter` directives:

| # | Anchor (verified to occur exactly once in the 138 KB page) | Injection | Purpose |
| --- | --- | --- | --- |
| 1 | `var configuration = {` | `"servers":[{"url":"/api",…}],` | fixes the base URL |
| 2 | `\"components\":{\"schemas\":{` | `\"securitySchemes\":{\"bearerAuth\":…},` | declares the scheme |
| 3 | `\"paths\":{` | `\"security\":[{\"bearerAuth\":[]}],` | attaches it — this is what renders the field |

Anchors 2–3 are inside the **escaped** JSON string, hence the `\"` form.

`proxy_set_header Accept-Encoding "";` is required so the upstream body is uncompressed and
therefore filterable. It lives on this block alone — putting it on the shared `/api/` block would
disable upstream compression for every API JSON response, and would also risk disturbing the
SSE-critical settings (`proxy_buffering off`, 3600s timeouts) that block carries.

`nginx:1.27-alpine` ships `--with-http_sub_module` (verified by running `nginx -V` in the arm64
image), so no base-image change is needed. `sub_filter` appears nowhere in `muffin-ui` or
`muffin-deployment` today — this is one new directive family in a file that already proxies.

### Evidence for the design

All four variants were driven headless against the **real** 138 KB page, patched exactly as nginx
would patch it:

| variant | server prefix | `Token` field |
| --- | --- | --- |
| `servers` only | yes | no |
| `+ securitySchemes` | yes | **no** — the scheme exists but attaches to nothing |
| `+` root-level `security` | yes | yes |
| `+ authentication.preferredSecurityScheme` | yes | yes — **identical to the row above** |

Two decisions follow:

- Root-level `security` is **required**, not optional garnish; anchor 2 alone does nothing visible.
- `authentication.preferredSecurityScheme` is **dropped as dead config** — there is only one
  scheme, so there is nothing to prefer.

Before/after, from the address bar Scalar renders:

```
upstream: POST | /assistants | Copy URL | Send post request to /assistants
patched:  POST | Server: | http://127.0.0.1:8791/api | /assistants |
                Send post request to http://127.0.0.1:8791/api/assistants
```

Zero `pageerror`s in every variant, so injecting into the escaped-JSON spec parses cleanly.

## Failure mode

If langgraph-api changes its docs template, the anchors stop matching and the filters **silently
no-op** — the page reverts to today's behaviour. Nothing breaks; nothing announces itself either.
That silence is the actual risk being managed, which is what the check below is for.

## Verification

**A local build cannot verify this change.** In local mode `verify-readme.mjs` stands in for nginx
with its own `node:http` server (mirroring `try_files` plus the `/api` and `/supabase` proxies), so
`deploy/nginx.conf` is never exercised. Only `--live` drives real nginx.

Rather than add a script, extend `scripts/verify-readme.mjs` with **one check block**, `--live`-gated
using the skip idiom the CF-credential checks already use
(`record(…, 'DIFFERS', 'skipped — …')`). It asserts:

1. the Scalar address bar shows `Server: <origin>/api`;
2. a `Token` input is present in the test client;
3. zero `pageerror`s (per the repo's React #418 lesson — errors surface as `pageerror`, not
   `console`);
4. a screenshot into `.verify-shots/`.

Assertions are **case-insensitive**, per the repo's standing caveat about uppercased labels.

## Accepted trade-off

Root-level `security` makes every operation across the spec's 49 paths *render* as auth-required,
while anonymous reads genuinely work — confirmed: `POST /assistants/search` returns `200` with no
bearer token. Scalar still sends without a token, so the effect is cosmetic. Scoping `security`
per-operation would mean an injection per operation and is not worth it. Recorded in `ROADMAP.md`.

## Out of scope

- `muffin-api.rafiki.guru/docs` — already correct; the API is at that origin's root.
- Making run creation work anonymously. `CF_ACCESS_TEAM_DOMAIN`/`CF_ACCESS_AUD` are unset in the
  deployment, so `auth.py`'s CF-JWT mode is off and Cloudflare Access is purely the perimeter;
  Test Requests run as anonymous. The `Token` field is what lets a signed-in user paste a Supabase
  access token to create runs.

## Deliverables

1. `deploy/nginx.conf` — the `location = /api/docs` block, commented with why the anchors exist and
   what happens when they stop matching.
2. `scripts/verify-readme.mjs` — one `--live`-gated check block.
3. `README.md` — a bullet describing the behaviour, which is what the check keeps honest.
4. `ROADMAP.md` — the cosmetic-`security` trade-off, and the note that the backend custom route is
   the durable fix if upstream's template churns.
5. `CLAUDE.md` — the lesson: langgraph-api's Scalar page inlines a spec with no `servers`, so any
   prefix-mounted docs page needs the prefix injected; and local `verify-readme` bypasses nginx.
