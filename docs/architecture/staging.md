# Staging through a Cloudflare Tunnel

Staging is the dev stack on the internet: the same containers, database and
files, reached at three hostnames. A Cloudflare Tunnel carries them. The
`coretask-tunnel` container dials out to Cloudflare, so no port is opened on
the machine and nothing changes on its network.

| Hostname                     | Routed to                      | For                                     |
| ---------------------------- | ------------------------------ | --------------------------------------- |
| `staging.coretask.org`       | `http://coretask-webapp:5173`  | the app (Vite dev server)               |
| `staging-api.coretask.org`   | `http://coretask-api:3000`     | REST, WebSocket, callbacks and webhooks |
| `staging-files.coretask.org` | `http://coretask-storage:9000` | attachments, on presigned URLs          |

The files hostname is needed because the browser uploads and downloads
attachments straight from storage. `localhost:9000` means nothing to anyone
else's browser.

## One-time setup in Cloudflare

1. **DNS on Cloudflare.** Add `coretask.org` to the Cloudflare account (Free
   plan), then set the domain's nameservers at the registrar (Hostinger) to the
   two Cloudflare gives. The registration can stay at Hostinger. A tunnel only
   needs Cloudflare to answer for the zone.
2. **The tunnel.** Zero Trust › Networks › Tunnels › Create a tunnel
   (Cloudflared). Copy its token into `.env` as `CLOUDFLARE_TUNNEL_TOKEN`.
3. **Public hostnames.** On the tunnel, add the three routes in the table. The
   service type is HTTP, and the URL is the container's name and port on the
   compose network. Cloudflare creates the DNS records.
4. **Access (recommended).** The stack holds real company data. Put a
   Cloudflare Access application in front of `staging.coretask.org`, allowing
   the team's e-mail domains. Leave the API and files hostnames outside it: the
   API signs everyone in itself, and is what outside services such as Asana
   webhooks call. Presigned URLs are their own permission.

## The stack's settings

In the root `.env`:

```dotenv
# The app answers on both origins. The first one is used in e-mail links.
WEB_URL=http://localhost:5173,https://staging.coretask.org
# The page served as staging calls the staging API.
VITE_API_ORIGINS_BY_HOST=staging.coretask.org=https://staging-api.coretask.org
# Presigned URLs point at the files hostname, from localhost too.
STORAGE_PUBLIC_ENDPOINT=https://staging-files.coretask.org
CLOUDFLARE_TUNNEL_TOKEN=<the tunnel's token>
```

Then recreate what reads them and start the tunnel:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d coretask-api coretask-worker coretask-webapp coretask-storage-init
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile tunnel up -d coretask-tunnel
```

`coretask-storage-init` sets the bucket's CORS rule from `WEB_URL`, so the
staging origin can PUT and GET files.

How each piece copes with two origins:

- **API.** `WEB_URL` is the CORS allowlist, comma-separated. The WebSocket
  gateway accepts any origin and authenticates the socket itself.
- **Webapp.** One dev server answers on both hosts. `VITE_API_ORIGINS_BY_HOST`
  swaps the API origin for a page served on a listed host (`env.ts`), so
  `localhost:5173` keeps calling the local API. Vite admits any
  `*.coretask.org` Host (`server.allowedHosts`).
- **Sign-in cookie.** The refresh cookie stays on the API's own host
  (`COOKIE_DOMAIN` empty). `staging` and `staging-api` are one site
  (`coretask.org`), so the `SameSite=lax` cookie travels with the app's
  requests. A session on staging and one on localhost are separate.
- **Files.** RustFS checks each presigned URL against the Host it arrives with.
  The tunnel passes `staging-files.coretask.org` through unchanged, so URLs
  signed for that hostname verify.

## Before it goes public

- The dev seed account (`SEED_USER_EMAIL`) has a password published in
  `.env.example`. Lock it, or change its password, before starting the tunnel.
- `NODE_ENV` stays `development`. Errors carry more detail and the Swagger UI
  is served at `/api/docs`. Treat staging as internal, behind Access.
- Stopping the tunnel (`docker stop coretask-tunnel`) takes staging off the
  internet at once. The local stack carries on.
