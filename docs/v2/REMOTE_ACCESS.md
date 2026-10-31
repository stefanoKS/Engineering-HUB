# Remote Access

V2 is meant to be used from outside the office. Two supported topologies are provided; both keep
the database private and rely on TLS plus the application's own Google sign-in.

## 1. Option A — public host name with automatic TLS (Caddy)

`deploy/docker-compose.yml` publishes only ports 80/443 and runs Caddy in front of the API.
Caddy obtains and renews a Let's Encrypt certificate for `APP_DOMAIN` automatically.

Requirements:
* a DNS `A`/`AAAA` record for `APP_DOMAIN` pointing at the host's public address,
* inbound 80 and 443 reachable from the internet (80 is needed for the HTTP-01 challenge; if it
  is closed, use DNS-01),
* `APP_DOMAIN` and `PUBLIC_ORIGIN=https://<APP_DOMAIN>` in `deploy/.env`,
* the same origin added to the OAuth client's authorised JavaScript origins.

What Caddy does (`deploy/caddy/Caddyfile`):
* terminates TLS and redirects HTTP to HTTPS (automatic),
* sets HSTS, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`,
  `Permissions-Policy`, and removes the `Server` header,
* proxies `/api/*` and the web bundle to `api:8080`.

The API additionally sets its own CSP and `no-store` headers; the proxy does not weaken them.

## 2. Option B — Cloudflare Tunnel (no inbound port, no public IP)

Use this when the host must not expose inbound ports, or when the office has no static address.

```bash
# once, on a trusted machine
cloudflared tunnel login
cloudflared tunnel create engineering-hub
cloudflared tunnel route dns engineering-hub engineering-hub.example.co.jp
# place the JSON credentials next to the compose file
cp ~/.cloudflared/<tunnel-uuid>.json deploy/cloudflared/credentials.json
```

Edit `deploy/cloudflared/config.yml` (tunnel UUID and host name), then:

```bash
docker compose --profile tunnel up -d cloudflared
```

The tunnel connects **outbound** to Cloudflare; the host needs no open inbound port. Requests
arrive at `http://api:8080` inside the Compose network, so TLS terminates at Cloudflare and the
API sees the forwarded address only when `TRUST_PROXY` is enabled.

Then enforce access in Cloudflare:
1. **Access → Applications → Add an application → Self-hosted**, hostname `APP_DOMAIN`.
2. Policy: allow the company Google Workspace domain (or an explicit group), default deny.
3. Session duration: 8–12 hours, matching the application session.
4. Optional service token for monitoring only — never for a human account.

Cloudflare Access is **defence in depth**, not the application's authorization. The API still
verifies the Google ID token, the e-mail domain (`MANAGER_WEB_ALLOWED_DOMAINS`) and the database
role. A request that reaches the API without those fails closed.

## 3. What not to do

* Do not publish port 5432 or 8080 to the internet. Compose binds the API to `127.0.0.1:8080`
  and the database has no published port.
* Do not disable the Google sign-in because "the tunnel is private". Cloudflare Access is not the
  identity source for role checks.
* Do not add a shared password, a personal token or a login form; the product rules forbid it.
* Do not enable `TRUST_PROXY` without a proxy in front of the API, or the rate limiter and the
  logged client address become forgeable.
* Do not run the tunnel and a public port 80/443 at the same time unless you intend both.

## 4. Configuration reference

| Variable | Used by | Meaning |
| --- | --- | --- |
| `APP_DOMAIN` | Caddy | host name for the certificate and site block |
| `PUBLIC_ORIGIN` | API | expected browser origin for the CSRF/Origin check |
| `ALLOWED_ORIGINS` | API | extra accepted origins (for example a pre-production name) |
| `TRUST_PROXY` | API | honour `X-Forwarded-*`; enable only behind a proxy |
| `MANAGER_WEB_ALLOWED_DOMAINS` | API | e-mail domains allowed to sign in (mandatory) |
| `HOST` / `PORT` | API | bind address inside the container |

## 5. Verification status

| Criterion | Status | Note |
| --- | --- | --- |
| Local HTTP run of the stack (`api`, `worker`, `db`) | PASS | tests and the benchmark exercise the API against real PostgreSQL |
| Compose file schema and network topology review | PASS | `npm run validate` checks ports, secrets and profiles |
| Public TLS certificate issued for a real domain | BLOCKED | needs DNS control and an internet-facing host |
| Cloudflare Tunnel connected to a real zone | BLOCKED | needs a Cloudflare account, tunnel and Access policy |
| External access from a phone / outside the office | BLOCKED | needs a deployed host |
| Rate limiting behind the proxy | NOT_RUN | per-process limit; move it to the proxy for multi-instance |

No live remote-access test has been performed for this repository.
