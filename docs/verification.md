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
Containers were not part of that initial native check. The additional Minikube
checks below cover Linux runtime behavior. TLS, real sign-in, EKS deployment and a
database restore drill remain separate work.

## Minikube and Observatory integration

- Docker Desktop and the existing Minikube Kubernetes 1.34 cluster were started.
  Existing unrelated workloads were preserved; the app uses `gta-demo`.
- All four personal app/controller/relay images built; Prisma generated a Linux
  client and the React production build passed.
- The reverse SSH database tunnel connected to the dedicated `gta_personal_k8s`
  database. Its migration Job reported no pending migrations among 42 found.
- Frontend, backend, controller and relay deployments became healthy; app routes,
  health and application API returned HTTP 200 through localhost port 18088.
- Availability scaling demonstrated 1 → 3 → 1 replicas. A temporary HTTP load test
  pushed CPU above the HPA target and caused the desired count to increase.
- Nine infrastructure/controller/instrumentation tests passed, including HTTP to
  Prisma parent-span correlation and omission of query arguments and sensitive paths.
- The separate Observatory project collected pod/node usage and recent spans,
  preserved chart history across restart, and verified bounded load start/stop.
- Duplicate load runs, invalid rates and missing control tokens were rejected.
  Kubernetes permission checks denied Secrets, app Job creation, pod exec and
  Deployment modification by the observability service account.
- Repeated health calls verified a gateway trace-header fix without frontend
  restarts. Browser visual review was unavailable because no browser was connected.

No repository seeds, university reference database changes or AWS provisioning
were performed. The full Linux CI rehearsal's result must be checked independently;
local Minikube success is not evidence of an AWS deployment or a passing CI run.
