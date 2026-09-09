# Nuvio on Oracle Cloud Always Free

This deployment removes Nuvio's production runtime from request-metered serverless functions and runs it on one OCI Ampere A1 VM.

## Guarded free profile

The Terraform plan is hard-blocked unless it contains only the approved resources and the VM stays at:

- Shape: `VM.Standard.A1.Flex`
- 2 OCPU
- 12 GB RAM
- 100 GB boot volume
- one VCN, subnet, route table, internet gateway and security list
- no NAT gateway
- no load balancer
- no database
- no Kubernetes/OKE
- no autoscaling

Oracle's Always Free documentation currently lists 2 OCPU + 12 GB RAM for A1, 200 GB total block storage and 10 TB/month outbound data in the tenancy home region.

## Required GitHub secrets

Add these repository Actions secrets before running the provisioning workflow:

- `OCI_TENANCY_OCID`
- `OCI_USER_OCID`
- `OCI_FINGERPRINT`
- `OCI_PRIVATE_KEY` — PEM API signing private key
- `OCI_REGION` — the tenancy home region, for example `eu-frankfurt-1`
- `OCI_COMPARTMENT_OCID`
- `ORACLE_SSH_PUBLIC_KEY`
- `ORACLE_SSH_PRIVATE_KEY`
- one of:
  - `TMDB_READ_TOKEN`
  - `TMDB_API_KEY`

The OCI API public key corresponding to `OCI_PRIVATE_KEY` must already be registered on the OCI user.

## Provision

GitHub → Actions → **Provision Oracle Nuvio Free** → Run workflow.

The workflow:

1. validates all required secrets;
2. initializes Terraform;
3. produces a plan;
4. runs `oracle/verify-free-plan.mjs` before every apply;
5. tries the configured Availability Domains in order;
6. provisions the A1 VM;
7. installs Node.js 22, Caddy and the Nuvio systemd service;
8. writes TMDb credentials only to `/etc/nuvio/nuvio.env`;
9. deploys the current validated `main` release;
10. checks the live Oracle runtime;
11. runs a safe catalog audit against Oracle;
12. stores the Terraform state both as a GitHub artifact and on the VM.

The public endpoint is automatically generated from the VM IP using `sslip.io`, so no paid domain is required.

## Runtime

- Caddy: ports 80/443
- Node.js: bound only to `127.0.0.1:3000`
- persistent response cache: `/var/cache/nuvio`
- cache entry cap: 2048
- Node service memory cap: 9 GB
- service auto-restarts on failure
- only ports 22/80/443 are opened

## Updates

`nuvio-update.timer` checks GitHub every ~10 minutes.

A release is not activated until:

- dependencies install;
- the full regional test suite passes;
- Cloudflare-compatible renderer tests pass;
- the portable build completes.

The symlink switch is atomic. If the new local runtime fails its health check, the updater restores the previous release automatically.

## Public URLs

After provisioning, the workflow summary prints:

- `https://<oracle-host>/fr/manifest.json`
- `https://<oracle-host>/global/manifest.json`
- `https://<oracle-host>/tr/manifest.json`
- `https://<oracle-host>/us/manifest.json`
- `https://<oracle-host>/nuvio-collections-desktop.json`
- `https://<oracle-host>/nuvio-collections-fr-global-tr-usa.json`

All catalog IDs, collection IDs and folder IDs are preserved.
