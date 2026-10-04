# Self-hosted GitHub Actions runner (local Mac mini)

This machine runs the GitHub Actions runner that builds EcoMate images. Runner
usage on self-hosted runners is free, so builds no longer draw down the monthly
GitHub-hosted minute quota (2,000 on the Free plan).

## Layout

| Path | Purpose |
|---|---|
| `~/actions-runner/` | Runner install + its `_work`, `_diag`, `_tool` state |
| `~/Library/LaunchAgents/com.ecomate.actions-runner.plist` | Keeps the runner online across reboots |
| `~/Library/LaunchAgents/com.ecomate.actions-runner-cleanup.plist` | Twice-daily `_work` housekeeping |
| `~/actions-runner/cleanup.sh` | The housekeeping script itself |

## How it works

- **Runner name:** `macmini-arm64-local`
- **Labels:** `self-hosted`, `macos`, `arm64`, `local`, `buildx`, `amd64-emulation`
- **Scope:** this repository only, not the account or organization
- Registered non-interactively; `.runner` and `.credentials` in `~/actions-runner`
  are the secrets to protect — never commit or share that directory.

`.github/workflows/ci.yml` and `deploy-client.yml` target
`[self-hosted, macos, arm64]`. `build-mobile.yml` deliberately stays on
GitHub-hosted runners: it is `workflow_dispatch`-only and needs Xcode and the
Android SDK, which are not installed here.

## Architecture

Production runs on an **amd64** VPS; this Mac mini is **arm64**. Builds therefore
pin `platforms: linux/amd64` and let buildx emulate the target, so the pushed
images stay runnable on the VPS. A native arm64 build would produce an image the
VPS cannot start. This emulation was verified on this machine.

Emulated builds are slower than native ones. As a rough guide, a full 4-service
CI run takes considerably longer than it does on GitHub-hosted runners, largely
because `npm ci` has no warm cache between runs on a laptop.

## Day-to-day

Check status:

```bash
gh api repos/MahmudulHasanRiaz/EcoMate-Web/actions/runners \
  --jq '.runners[] | "\(.name) \(.status) busy=\(.busy)"'
```

Runner logs: `tail -f ~/actions-runner/_launchd-runner.err.log`

Restart after a runner update or if it stops picking up jobs:

```bash
launchctl kickstart -k gui/$(id -u)/com.ecomate.actions-runner
```

Note: adding a label to a runner does not reach its current session. Restart the
service for a new label to take effect.

## Requirements for CI to run

The runner can only accept work while the machine is awake, unlocked, and on a
network. If the Mac is asleep or the lid is closed, jobs sit queued until it
wakes. Keep "Prevent automatic sleeping on power adapter" enabled in System
Settings → Battery if unattended builds matter.

A queued job that will not start is almost always a label mismatch. Check that
`self-hosted`, `macos`, and `arm64` are all present on the runner.

## Housekeeping

`~/actions-runner/_work` can exceed 1 GB during a build and accumulates stale
per-job checkouts if a job is cancelled or crashes. `cleanup.sh` removes job
directories older than 12 hours, but skips entirely while a job is running. It is
scheduled for 04:17 and 16:17 daily. Override the threshold with
`RUNNER_CLEANUP_MAX_AGE_HOURS`.

## Upgrading the runner

The runner self-updates by default. To pin a version, re-download the matching
release from https://github.com/actions/runner/releases, verify the asset's
`sha256` against the release digest, extract over the install, and re-run
`config.sh` with a fresh registration token from:

```bash
gh api -X POST repos/MahmudulHasanRiaz/EcoMate-Web/actions/runners/registration-token
```

## Removing the runner

```bash
cd ~/actions-runner
REG=$(curl -sS -X POST -H "Authorization: token $(gh auth token)" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/MahmudulHasanRiaz/EcoMate-Web/actions/runners/registration-token \
  | jq -r .token)
./config.sh remove --unattended --token "$REG"
launchctl unload ~/Library/LaunchAgents/com.ecomate.actions-runner.plist
```