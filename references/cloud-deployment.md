# Cloud deployment

Read this reference when installing or upgrading Context Guard Cloud on a
server. Cloud remains part of this repository; do not copy individual files or
create a second repository.

The current server speaks HTTP. Keep it on a trusted private network until a
later deployment adds HTTPS at the reverse proxy.

## 1. Prepare the server

The server needs Linux, Git, Node.js 18 or newer, npm, curl, and systemd user
services. Clone the complete repository and install production dependencies:

```bash
git clone https://github.com/Michel-Johnson/Context-Guard-Skill.git "$HOME/context-guard-cloud"
cd "$HOME/context-guard-cloud"
git switch main
npm ci --omit=dev
mkdir -p "$HOME/context-guard-cloud-data" "$HOME/.config/systemd/user"
```

Keep the data directory outside the Git checkout. Pulling or replacing the
checkout must never remove cloud Maps or event history.

## 2. Configure secrets

Create `$HOME/.config/context-guard-cloud.env` with mode `0600`:

```dotenv
CONTEXT_GUARD_CLOUD_TOKEN=<long-random-admin-token>
CONTEXT_GUARD_CLOUD_WORKBENCH_TOKEN=<different-long-random-browser-token>
```

Tokens are server secrets. Do not commit them, paste them into Map records, or
put them in a service command line. Generate independent random values with a
system password manager or `openssl rand -hex 32`.

The included `deploy/context-guard-cloud.service` listens on `0.0.0.0:8788` and
stores data in `$HOME/context-guard-cloud-data`. Change its port or paths before
installation if the host uses different locations.

## 3. Start the service

```bash
cp "$HOME/context-guard-cloud/deploy/context-guard-cloud.service" \
  "$HOME/.config/systemd/user/context-guard-cloud.service"
systemctl --user daemon-reload
systemctl --user enable --now context-guard-cloud.service
curl --fail http://127.0.0.1:8788/api/health
```

Use `systemctl --user status context-guard-cloud.service` and
`journalctl --user -u context-guard-cloud.service` to diagnose startup. Enable
user lingering when the service must survive logout.

## 4. Create a project

An administrator calls the project API once. Use a stable lowercase project ID:

```bash
curl --fail --request POST http://127.0.0.1:8788/api/projects \
  --header "Authorization: Bearer <admin-token>" \
  --header "Content-Type: application/json" \
  --data '{"id":"my-project","name":"My Project","description":"Project context map"}'
```

The response contains `syncToken`. It is displayed only when created. Save it
in a secret manager and give it only to Agents that may synchronize this
project. To rotate a lost token, call
`POST /api/projects/<project-id>/enrollments` with the admin token.

Open the editable cloud workbench once with:

```text
http://<server>:8788/auth?token=<workbench-token>&next=/
```

The token is exchanged for an HttpOnly cookie. Remove the token from copied or
shared URLs after authentication.

## 5. Connect each working copy

Run this inside every local or remote checkout that works on the project:

```bash
context-guard sync connect --root <project-path> \
  --url http://<server>:8788 --project my-project --token-stdin
context-guard sync status --root <project-path>
```

Paste the project `syncToken` on standard input. If both sides already contain
different Maps, choose the authoritative side and reconnect with exactly one of
`--pull` or `--push`. After connection, normal development uses `sync prepare`
before work and `sync finish` after tests as described in
`references/cloud-sync-interface.md`.

## 6. Upgrade and recover

Back up `$HOME/context-guard-cloud-data` before an upgrade. Then update only the
checkout and restart the service:

```bash
cd "$HOME/context-guard-cloud"
git pull --ff-only origin main
npm ci --omit=dev
systemctl --user restart context-guard-cloud.service
curl --fail http://127.0.0.1:8788/api/health
```

To move hosts, stop writes, copy the complete data directory and the protected
environment file to the new server, start the same version there, verify health,
then change each client's `sync connect --url`. Never reconstruct state from
only the latest Map: the event and work records are part of synchronization.
