# Deployment stages

## Stage 1: native personal environment

The initial repository pins the upstream application and separates its working
copy, database and ports from the existing university development setup. A local
Node gateway serves the production frontend build and forwards API/auth requests.
Setup, health checks, backups and process ownership are automated. GitHub Actions
checks the database guard, environment isolation and gateway on Windows and Linux.

Local checks use Node 20 and PostgreSQL 18 because that is the application's current
supported setup. Review this runtime choice before internet deployment. The
application's existing container/deployment files remain in its downloaded source.

## Stage 2: choose personal hosting

Decide on the provider, budget, domain and identity provider. Then add a
provider-specific infrastructure directory and authenticated deployment profile.
Include private database networking, TLS ingress, secret storage, health checks,
log retention and a tested backup/restore procedure.

The local development identity controls must not be exposed publicly. A public
profile needs upstream SSO configuration and enforced server authorization.
Power Automate connections should use personal test resources and explicit secrets.

## Stage 3: delivery and recovery

Build versioned app images, deploy an explicitly selected version and record the
release. Add a manual deployment workflow, infrastructure plan review and smoke
checks. Migrations need a backup and documented recovery steps; switching images
alone cannot reverse a database schema change.

Test a restore into a separate database before relying on backups. The current
command creates local custom-format dumps. Off-machine retention, scheduled
backup and automated recovery are future work.
