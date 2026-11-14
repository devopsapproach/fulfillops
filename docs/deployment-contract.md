# Deployment contract

- Runtime: Node.js version recorded in .nvmrc; PostgreSQL 16.
- Build: npm ci; npm run db:generate; npm run build.
- Runtime Docker target: runtime.
- API command: node dist/api/server.js; port 8080.
- Worker command: node dist/worker/main.js; no HTTP endpoint yet.
- Migration Docker target: migrate; image default runs migrate deploy then seed.
- API probes: /health/live and /health/ready.
- Database hostname inside the deployment: db.
- DATABASE_URL is supplied through a secret.
- Two API replicas and two worker replicas share the database.
- Worker configuration: polling 500 ms, lease 10000 ms, retry base 1000 ms.
- Each job's stored max_attempts is authoritative. API currently inserts 3.
- WORKER_MAX_ATTEMPTS is currently parsed but does not configure API jobs.
- Application termination grace: 30 seconds; worker internal deadline: 10 seconds.
- One migration Job runs before application rollout; no per-replica migrations.
- Runtime image: ghcr.io/devopsapproach/fulfillops.
- Migration image: ghcr.io/devopsapproach/fulfillops-migrate.
- CI uses commit SHA tags. Git deployment manifests record published digests.
- Real secrets are created outside Git; no credentials in evidence.
- Metrics and worker-health interface: pending Developer C's verified handoff.

## Ownership

A owns Dockerfile and development Compose configuration.
B owns CI, acceptance harness, Kubernetes, Argo CD and deployment evidence.
C owns application behavior, schema/migrations, metrics and component tests.
Coordinate package.json, lockfile and environment-documentation edits.

## Acceptance

1. Existing quality and integration tests pass.
2. A real HTTP order completes within 15 seconds with services running.
3. Identical-key requests sent to both APIs produce one order/reservation.
4. Competing distinct keys do not oversell.
5. Replay preserves identity, inventory and receipt count.
6. Worker failure/recovery respects leases, ownership and attempt budgets.
7. Restarts preserve orders, receipts and idempotency mappings.
8. Fresh isolated public checker: 15 passed, 0 failed, 0 skipped.
9. CI produces image SBOMs, vulnerability results and immutable identities.
10. Two API/two worker Kubernetes pods run with persistent database storage.
11. GitOps detects drift, restores it and recovers a deliberately broken rollout.
12. Timestamped rollout evidence and at least 200 HTTP latency samples exist.
