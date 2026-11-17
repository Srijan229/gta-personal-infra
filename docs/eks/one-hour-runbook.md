# One-hour EKS portfolio session

Cloud creation is waiting for the user's explicit go-ahead. Preparation and the
Kubernetes rehearsal do not create AWS resources. The one-hour window is a target:
AWS provisioning and deletion duration varies. Start cleanup at minute 40, even if
the demonstration is incomplete. A timer or budget alert cannot guarantee a hard
spending cap.

## Before starting the cloud clock

- A successful **Kubernetes rehearsal (no AWS)** run must exist with its tested
  image artifact still available. Artifacts expire after one day; rerun the
  rehearsal before a later cloud session.
- Keep the native PostgreSQL service and this laptop online. The dedicated
  `gta_personal_k8s` database and its limited login are prepared locally; credentials
  are under ignored `.local/k8s/`. Existing reference databases are not used.
- The laptop needs Node 20, Terraform, AWS CLI, kubectl 1.36, and OpenSSH. Local
  Terraform is under `.local/tools/terraform.exe`. No local Docker daemon is needed.
- Sign into the approved personal AWS account in the user's own terminal after
  approval. Keep credentials out of chat and Git. Confirm that account, region,
  quotas and permissions before planning. Required rights cover VPC, IAM, EKS,
  managed nodes and temporary ECR repositories.
- Copy `infra/eks/terraform.tfvars.example` to ignored `terraform.tfvars`, fill the
  approved account ID and current public IPv4 `/32`. Defaults target `us-east-1`,
  cluster `gta-portfolio-demo`, and standard-supported Kubernetes 1.36.
- Check whether the account already has the GitHub OIDC provider and supply its
  ARN if so. The role trusts only the configured private repository and branch.
- The image publisher workflow must be on the repository's default branch before
  dispatch. Promote the tested preparation branch before the session, retaining
  `github_branch` as the branch used for publishing.

## Minute 0-15: plan, review, create

```powershell
./scripts/aws-session.ps1 -Action Check
./scripts/aws-session.ps1 -Action Plan -CloudApproved
# Review the resource list, account, region, CIDR and cost before Apply.
./scripts/aws-session.ps1 -Action Apply -CloudApproved
```

The apply step records the cleanup deadline in `.local/aws/session.json`. The
configuration creates a VPC, two public subnets, a restricted EKS API endpoint,
one managed t3.medium worker, IAM roles, four temporary ECR repositories, and an
image-publishing role. It creates no NAT Gateway, load balancer or cloud database.
The worker has a public address for outbound downloads; app Services are private.
If creation is delayed, shorten or skip the demo rather than moving cleanup later.

## Minute 15-25: publish already-tested images and connect the laptop database

Read the Terraform `image_prefix` and `image_publisher_role_arn` outputs. Manually
dispatch **Publish tested images (approved AWS session only)** with those outputs,
the successful rehearsal run ID, and `approval=CLOUD_APPROVED`. Dispatch from the
branch named in Terraform's `github_branch`. The workflow uses temporary GitHub
OIDC credentials scoped only to image publishing; it cannot deploy the cluster.

Set `GTA_IMAGE_PREFIX` from Terraform and `GTA_IMAGE_TAG=rehearsal-<run ID>` from the
publisher summary, then:

```powershell
./scripts/deploy-demo.ps1 -CloudApproved
```

It applies private services and the CRD, creates an SSH relay, starts a reverse
forward to laptop PostgreSQL through `kubectl port-forward`, runs the migration
Job, deploys the app/controller and metrics-server, and forwards the frontend to
**http://127.0.0.1:18088**. PostgreSQL port 5432 is never exposed to the internet.
The SSH relay permits only remote forwarding on port 5432 and allows no shell.

The app uses its local identity controls through this private port forward. This
lab configuration is not a public production sign-in configuration. Power Automate
and per-replica background schedules are disabled in the packaging overlay.

## Minute 25-35: record the demonstration

```powershell
$env:GTA_CLOUD_APPROVED='true'
node scripts/k8s-demo.mjs
kubectl -n gta-demo get asp,hpa,pods
kubectl -n gta-demo top pods
```

The script changes two owned fictional records in the dedicated demo database:
an application phase and one open section. This makes the controller set the HPA
floor to three. Closing the phase returns it to one after cooldown. A short load
Job calls the actual application-list API, and the HPA scales based on measured
CPU. The maximum is five backend pods; worker-node autoscaling is outside this demo.

Save a screen recording, the CRD/controller source, deployment output and the
sanitized `.local/evidence/scaling.json`. Record the source and infrastructure
commits. Report measured results only; this lab does not demonstrate 5,000-user
capacity. Do not upload secrets, kubeconfigs, SSH keys or database dumps.

## Minute 40-60: cleanup and verify

```powershell
./scripts/deploy-demo.ps1 -Stop
./scripts/aws-session.ps1 -Action Destroy -CloudApproved
```

Terraform deletes the managed nodes, EKS cluster, temporary ECR images/repositories,
owned IAM resources, routes/subnets and VPC. An existing OIDC provider supplied as
an input is retained. The command checks that Terraform's tracked resource list
is empty and records completion. Confirm in AWS that the cluster and EC2 instances
are gone and no project load balancer, NAT Gateway or EBS disk remains. Saved local
files, the private source asset and GitHub artifacts are not AWS runtime resources.

The local demo database remains for future rehearsals. Keep its credentials and any
backup private. AWS billing can appear later; review Cost Explorer after the run.
