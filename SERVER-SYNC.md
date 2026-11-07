# Server Sync (your own server)

Remindate can keep `remindate.json` on your own server instead of (or next to) GitHub.
The server is one small file, `scripts/remindate-sync-server.js`, that only needs Node.js 18+ (no packages).

## 1. Pick a host
Anything that runs Node.js and has **https** and a **persistent disk** works, for example:

- **Railway** or **Render** (paid plan, add a volume / persistent disk and point `DATA_DIR` to it)
- A **VPS** (Hetzner, DigitalOcean, TransIP, …) behind Caddy or nginx for https

## 2. Start the server
Set these environment variables on the host:

| Variable | Value |
|---|---|
| `SYNC_TOKEN` | a long secret (at least 16 characters). Running the script without it prints a random one you can use. |
| `DATA_DIR` | the folder on the persistent disk, e.g. `/data` |
| `ALLOW_ORIGIN` | optional: `https://vharixce.github.io` so only your Remindate site may sync |

Start command: `node scripts/remindate-sync-server.js`

Check it works: open `https://<your-server>/health` → it shows `"ok"`.

## 3. Connect Remindate
Explorer → **Sync Settings** → **Server Sync**:

- Server address: `https://<your-server>/remindate.json`
- Access token: your `SYNC_TOKEN`
- Tick *Sync automatically after changes*, press **Test connection**, then **Save**.

Do this on every device. "Sync now" syncs both GitHub and the server when both are set up.

## Notes
- The server keeps the previous version as `notes.backup.json`.
- Email reminders read your notes from GitHub, so keep GitHub Sync on if you use them.
- Any other server works too if it follows the same API: `GET`/`PUT` on one URL, `Authorization: Bearer <token>`, ETag + `If-Match` (412 on conflict), and CORS that exposes `ETag`.
