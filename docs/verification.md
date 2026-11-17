# Local verification - November 17, 2026

Verified on native Windows with Node 20 and PostgreSQL 18:

- Four infrastructure tests passed: protected database targets are rejected,
  inherited integrations are cleared, paths/ports are separated, and the gateway
  forwards API bodies and auth cookies while serving SPA routes.
- A fresh personal database accepted all 42 migrations from the pinned upstream
  commit. No repository seed command was run.
- Prisma validation and the production frontend build passed. The upstream build
  reported its existing large-bundle warning.
- Worker ownership and health checks passed for both processes.
- `/`, `/profile`, `/health`, `/auth/me` and `/api/applications` returned HTTP 200
  through the gateway. The application list was empty and SSO was disabled.
- The backup command produced a custom-format PostgreSQL dump.
- Stop terminated the owned workers; a subsequent start was checked again.

Credentials, source installs, generated assets, logs and backups are ignored.
The original development databases were not selected by these commands.

The GitHub Actions matrix runs the infrastructure tests on Windows and Linux.
Linux worker lifecycle, containers, TLS and real sign-in were not exercised by this
local verification. A database restore drill is still future work.
