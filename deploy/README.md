# Deploying muffin-ui

`muffin-ui` is packaged as a Docker image (this directory's `../Dockerfile`):
the Expo web export served by nginx, which reverse-proxies `/api` →
`langgraph-api` (same-origin, like the chat UI). It runs as a Swarm service
behind Traefik at `muffin.<domain>`, alongside the legacy chat UI at
`muffin-chat.<domain>`.

- **`nginx.conf`** — the nginx server config baked into the image (static SPA +
  `/api` proxy). Edit it here; it's `COPY`-ed in by [`../Dockerfile`](../Dockerfile).

The Swarm / Traefik / Cloudflare wiring (the `muffin-ui` service, the
`muffin` app subdomain, API CORS, Cloudflare DNS + Access) lives in the separate
[`muffin-deployment`](https://github.com/gururafiki/muffin-deployment) repo and
is already in place. The image is built by
[`../.github/workflows/build.yml`](../.github/workflows/build.yml) and pulled as
`ghcr.io/gururafiki/muffin-ui:latest` by that repo's deploy.
