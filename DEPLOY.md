# VPS deploy (Docker + Caddy)

## DNS

- `@` A `91.218.247.176`
- `www` A `91.218.247.176`

## First-time setup

1. Copy the repo to the server, e.g. `/opt/ai-startup`.
2. Create `.env` on the server using `.env.production.example`.
3. Ensure the `deploy` user has access:
   - `chown -R deploy:deploy /opt/ai-startup`
   - `usermod -aG docker deploy`
4. Setup SSH key for `git pull`:
   - As user `deploy`: `ssh-keygen -t ed25519 -C "deploy-key-for-git-pull" -f ~/.ssh/id_ed25519_git_pull`
   - Add the **public** key to GitHub as a **Deploy Key** (with read access).
   - Configure `~/.ssh/config`:
     ```
     Host github.com
         HostName github.com
         User git
         IdentityFile ~/.ssh/id_ed25519_git_pull
         IdentitiesOnly yes
     ```
   - `chmod 600 ~/.ssh/config`
5. Start services:
   - `docker compose --env-file .env -f docker-compose.prod.yml up -d --build`
6. Caddy will issue TLS automatically once DNS resolves.

## Deploy script

- Make sure `deploy.sh` is executable:
  - `chmod +x /opt/ai-startup/deploy.sh`
- Run:
  - `/opt/ai-startup/deploy.sh`
- What it does now:
  - builds and restarts production compose stack
  - runs post-deploy smoke check on `HEALTHCHECK_URL` (default `http://127.0.0.1/health`)
  - sends `Host` header from `HEALTHCHECK_HOST_HEADER` (default `pitchy.pro`)
  - rolls back to previous git commit automatically if smoke check fails (`ROLLBACK_ON_FAIL=true`)

### Quick autodeploy smoke test

Use a tiny non-functional change (for example, one line in `DEPLOY.md`) to validate full CI/CD path:

```bash
git add DEPLOY.md
git commit -m "chore: smoke test autodeploy pipeline"
git push origin main
```

Then verify:
- GitHub Actions: `CI` and `Deploy` are green.
- VPS commit is updated:
  - `git -C /opt/ai-startup rev-parse HEAD`
  - `git -C /opt/ai-startup rev-parse origin/main`
- Production health:
  - `curl -s https://pitchy.pro/health`

## Firewall and exposed ports

Keep public ports minimal: only `22`, `80`, `443`.

```bash
cd /opt/ai-startup
sudo bash ops/hardening/configure_ufw.sh
```

If Netdata is needed, allow only trusted CIDR (VPN/office/monitor host):

```bash
sudo NETDATA_ALLOW_CIDR=203.0.113.10/32 bash ops/hardening/configure_ufw.sh
```

This closes external access to `19999` by default and opens it only for the provided CIDR.

## Metrics access policy

- `/metrics` is restricted in `Caddyfile` to localhost + private ranges by default.
- To allow only one monitoring host/VPN range, set in `.env`:
  - `METRICS_ALLOWED_CIDR=203.0.113.10/32`
- Reload Caddy with normal deploy:
  - `/opt/ai-startup/deploy.sh`

## Yandex Lockbox (optional, recommended)

If you store secrets in Lockbox, `deploy.sh` can resolve them before `docker compose`:

1. Install and initialize `yc` under the `deploy` user.
2. In `/opt/ai-startup/.env` set:
   - `LOCKBOX_ENABLED=true`
   - `LOCKBOX_APP_SECRET_KEY_SECRET_ID=<secret-id>`
   - `LOCKBOX_YC_API_KEY_SECRET_ID=<secret-id>`
   - `LOCKBOX_POSTGRES_PASSWORD_SECRET_ID=<secret-id>`
3. Optional: set entry keys if your secret entry names differ:
   - `LOCKBOX_APP_SECRET_KEY_ENTRY_KEY`
   - `LOCKBOX_YC_API_KEY_ENTRY_KEY`
   - `LOCKBOX_POSTGRES_PASSWORD_ENTRY_KEY`
4. Run `/opt/ai-startup/deploy.sh`. It generates `.env.runtime` and uses it for compose.

Notes:
- `.env.runtime` is generated automatically and ignored by git.
- `DATABASE_URL` is rebuilt from `POSTGRES_USER`, resolved `POSTGRES_PASSWORD`, and `POSTGRES_DB`.
- Backend `env_file` is selected via `APP_ENV_FILE` and points to `.env.runtime` during deploy.

## GitHub Actions secrets

- `VPS_HOST`: server IP or hostname
- `VPS_USER`: SSH user (e.g., `deploy`)
- `VPS_SSH_PRIVATE_KEY`: private key with access to the server (used for SSH connection)

## GitHub Actions Deploy Key (for `git pull`)

1. Add the **public** key generated under the `deploy` user (step 4 in First-time setup) to GitHub as a **Deploy Key**.
2. This key allows the `deploy.sh` script to `git pull` from the repository.

## Docker Compose Optimizations

- Added `restart: unless-stopped` to all services.
- Added basic logging limits (`max-size`, `max-file`).

## Caddy Optimizations

- Enabled response compression and dedicated `/metrics` access control.

## Backups and weekly restore verification

Backup creation is not enough; verify restore weekly in isolated environment:

```bash
cd /opt/ai-startup
bash ops/backup/verify_restore.sh
```

Suggested weekly cron:

```cron
0 3 * * 1 cd /opt/ai-startup && /usr/bin/bash ops/backup/verify_restore.sh >> /home/deploy/pitchy-restore-check.log 2>&1
```

The script validates dump import and boots backend against restored DB snapshot.

## Alembic-only schema changes

- Production app startup no longer performs `create_all`.
- DB schema changes must go only through Alembic migrations:
  - `alembic revision --autogenerate -m "..."` (or manual migration)
  - `alembic upgrade head`

## Alerts (Telegram)

Implemented monitor checks:
- `health != ok`
- DB unavailable (`health.db == false`)
- 5xx spike from `/metrics`
- high disk usage
- SSL expiration window

### 1) Prepare monitor env on VPS

```bash
cd /opt/ai-startup
mkdir -p ops/alerts
cp ops/alerts/.env.example ops/alerts/.env
nano ops/alerts/.env
```

Fill at least:
- `ALERT_TELEGRAM_BOT_TOKEN`
- `ALERT_TELEGRAM_CHAT_ID` (single chat id or comma-separated list)
- tune thresholds if needed
- keep defaults for local checks through Caddy:
  - `ALERT_HEALTH_URL=http://127.0.0.1/health`
  - `ALERT_METRICS_URL=http://127.0.0.1/metrics`
  - `ALERT_HTTP_HOST_HEADER=pitchy.pro`

If you don't want to keep Telegram token in plaintext, use Lockbox:
- leave `ALERT_TELEGRAM_BOT_TOKEN=` empty
- set `ALERT_TELEGRAM_BOT_TOKEN_LOCKBOX_SECRET_ID=<secret-id>`
- optional entry key override: `ALERT_TELEGRAM_BOT_TOKEN_LOCKBOX_ENTRY_KEY=ALERT_TELEGRAM_BOT_TOKEN`

### 2) Test a single run manually

```bash
cd /opt/ai-startup
python3 ops/alerts/monitor.py --env-file ops/alerts/.env
```

Expected:
- `No new alerts.` if everything is healthy
- message in Telegram if any alert is active/event is triggered

### 3) Configure cron (every 5 minutes)

```bash
crontab -e
```

Add line:

```cron
*/5 * * * * cd /opt/ai-startup && /usr/bin/python3 ops/alerts/monitor.py --env-file ops/alerts/.env >> /var/log/pitchy-alerts.log 2>&1
```

### 4) Verify cron is active

```bash
crontab -l
tail -f /var/log/pitchy-alerts.log
```