# FulfillOps

FulfillOps is an order fulfillment API built with Node.js, TypeScript, Express,
Prisma and PostgreSQL 16. The API reserves stock and inserts the order, its
items and a durable job in one transaction. A separate worker claims the job
and records fulfillment. Reusing an idempotency key with the same payload
returns the original order without another reservation.

## Run locally

Use Git, Node.js 22 (22.12 or newer), npm, Docker with Compose, and curl.
Use Bash for the examples below. On Windows, run them in WSL with access
to the Docker engine.

```bash
git clone https://github.com/devopsapproach/fulfillops.git
cd fulfillops
npm ci
test -f .env || cp .env.example .env
```

Set local credentials in .env. Match the PostgreSQL role, password, port and
database in each connection URL. URL-encode special characters in passwords.
Keep .env and Kubernetes secrets out of Git. Compose initializes credentials
only on an empty PostgreSQL volume.

| Setting                                                              | Purpose                                                                                                        |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT` | Compose database and host port. Defaults include user `fulfillops`, database `fulfillops_dev` and port `5432`. |
| `DATABASE_URL`                                                       | Application and migration connection. Use `localhost` from the host and `db` inside Compose or Kubernetes.     |
| `TEST_DATABASE_URL`                                                  | Isolated PostgreSQL database named `fulfillops_test`.                                                          |
| `PORT`, `NODE_ENV`, `LOG_LEVEL`                                      | API port (default `8080`), runtime mode and log level.                                                         |
| `WORKER_POLL_INTERVAL_MS`, `WORKER_LEASE_MS`, `WORKER_RETRY_BASE_MS` | Worker defaults are 500 ms, 10000 ms and 1000 ms. Each job stores its own attempt limit.                       |

Start **only PostgreSQL** for host development. In Docker Desktop the container
is named `fulfillops-db`.

```bash
docker compose up -d --wait db
npm run db:generate
npm run db:migrate:deploy
npm run db:seed
```

Run the seed command only for an empty, disposable local catalog with
`NODE_ENV=development` and a loopback database URL. The current seed overwrites
prices and available stock for the three demo SKUs. Keep it out of routine
deployments and away from databases with orders you want to preserve.

| SKU      | Price in cents | Initial stock |
| -------- | -------------: | ------------: |
| KIT-100  |           1299 |             7 |
| PART-200 |            599 |            12 |
| PACK-300 |            249 |             5 |

Start `npm run dev:api` and `npm run dev:worker` in separate terminals. Both
use the same database. For compiled execution, run `npm run build`, then
`npm run start:api` and `npm run start:worker` in separate terminals.

For an all-container run, stop the host processes and run
`docker compose up -d --build`. Compose starts PostgreSQL, waits for the
migration service to exit successfully, then starts the API and worker.
Initialize a fresh catalog from the host using the setup above. Inspect
startup with `docker compose ps -a` and `docker compose logs migrate api worker`.
Use `docker compose down` to stop while preserving the volume.

## Use the API

Set `API` to `http://localhost:8080` locally or to your Kubernetes API address.
Keep your worker running when you want submitted orders to complete.

| Method and path             | Result                                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------- |
| GET /health/live            | Process liveness.                                                                                        |
| GET /health/ready           | Readiness including database checks.                                                                     |
| GET /metrics                | Prometheus text for the responding API process.                                                          |
| GET /api/v1/catalog         | SKUs with unit prices in integer cents.                                                                  |
| GET /api/v1/inventory/:sku  | Available stock, or 404 for an unknown SKU.                                                              |
| POST /api/v1/orders         | Requires JSON and an Idempotency-Key header. Returns 202 with the order ID and queued acceptance status. |
| GET /api/v1/orders/:orderId | Current status and total in cents, or 404.                                                               |

```bash
API=http://localhost:8080
curl -fsS "$API/health/ready"
curl -fsS "$API/api/v1/catalog"
curl -fsS "$API/api/v1/inventory/KIT-100"

ORDER_KEY="demo-$(date +%s)"
ORDER_BODY='{"customer_id":"CUST-DEMO","items":[{"sku":"KIT-100","quantity":1}]}'

curl -i "$API/api/v1/orders" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $ORDER_KEY" \
  --data "$ORDER_BODY"
```

Copy the returned order ID into `ORDER_ID`, then run
`curl -fsS "$API/api/v1/orders/$ORDER_ID"`. Repeat GET until the worker
completes the order. Replay the original POST with the same key and body to
see the same order ID. The replay response still says `queued` because it
is the acceptance response. GET reports the current state. A changed payload
with the same key returns 409. Insufficient stock also returns 409, with a
different error code. Missing keys return 400 and invalid quantities return 422.

## Database and worker

PostgreSQL stores products, orders, order items, jobs and fulfillment
receipts. Stock cannot become negative, idempotency keys are unique, and
each fulfilled order has one receipt. The worker uses short transactions
to claim work and verify ownership before completion. Failed attempts can
be rescheduled with backoff. Expired leases are recovered. Exhausted jobs
become dead letters and their orders fail with reserved stock retained.

```bash
docker compose exec -T db psql -U fulfillops -d fulfillops_dev \
  -c 'SELECT sku, unit_price_cents, available FROM products ORDER BY sku;'
```

Use `npm run db:migrate:deploy` to apply committed migrations. For schema
changes use `npm run db:migrate:dev -- --name describe_change` on a development
database and review the SQL. Commit the schema and migration together and
generate the client with `npm run db:generate`. Keep applied migrations intact.

## Kubernetes and Argo CD

The base in [infra/k8s/base](infra/k8s/base) defines two API replicas, two
workers, PostgreSQL with a PVC, Services and a migration Job. Argo applies
the platform first, runs the migration hook, then updates the deployments.
Catalog initialization is a separate step on a fresh test database.

For a new local kind cluster, install kind and kubectl and run
`kind create cluster --name fulfillops-t19 --config infra/kind.yaml`.
For an existing cluster, start `fulfillops-t19-control-plane` in the Docker
engine that owns it. Kubernetes starts the pods. Select and verify the context.

```bash
kubectl config use-context kind-fulfillops-t19
kubectl get nodes
```

The development overlay uses locally loaded images with pull policy
`Never`. Build and load both images before committing their tags to
[the development overlay](infra/k8s/overlays/dev/kustomization.yaml).

```bash
TAG="dev-$(git rev-parse --short HEAD)"
docker build --target runtime -t "fulfillops:$TAG" .
docker build --target migrate -t "fulfillops-migrate:$TAG" .
kind load docker-image "fulfillops:$TAG" "fulfillops-migrate:$TAG" \
  --name fulfillops-t19
kubectl kustomize infra/k8s/overlays/dev
```

Create the namespace with `kubectl create namespace fulfillops-lab` if it
does not exist. Create a Secret named `fulfillops-db` in that namespace
with keys `POSTGRES_PASSWORD` and `DATABASE_URL`. The base expects role
`fulfillops` and database `fulfillops_test` at `db:5432`. Use the same
password in both entries, URL-encoded in the URL. For example, supply the
two entries in a private environment file and run
`kubectl -n fulfillops-lab create secret generic fulfillops-db --from-env-file=/path/to/private-db.env`.
Reuse an existing Secret when the PVC already contains data.

Install Argo CD into the `argocd` namespace using the team's reviewed
release. Give Argo read access to the repository if it is private. Review
[the Application](infra/argocd/application.yaml), set its target revision
to the pushed branch containing your overlay, then apply it with
`kubectl apply -f infra/argocd/application.yaml`.

```bash
# Terminal A. Keep open for the Argo UI and CLI.
kubectl -n argocd port-forward service/argocd-server 8090:443

# Terminal B. Keep open for API requests.
kubectl -n fulfillops-lab port-forward service/api 18082:8080
```

In a third terminal, authenticate with
`argocd login localhost:8090 --username admin --insecure` for the local
instance, then inspect the deployment:

```bash
argocd app get fulfillops --hard-refresh
argocd app wait fulfillops --sync --health --timeout 300
kubectl -n fulfillops-lab get deployment,pods,jobs,pvc
kubectl -n fulfillops-lab logs job/fulfillops-migrate --tail=100
kubectl -n fulfillops-lab logs -l app=fulfillops-worker --prefix --tail=20
curl -fsS http://localhost:18082/health/ready
```

Expect two ready API pods, two running workers, a completed migration Job
and a bound PVC. If auto-sync is disabled, run `argocd app sync fulfillops`
before waiting. If a pod reports `ErrImageNeverPull`, check the exact tag
and load it into kind. If the migration Job failed, read its pod logs.
For a published deployment, use CI-published runtime and migration digests
in the registry overlay and configure registry credentials as needed.

## Tests and instructor demo

- Run `npm run check` for types, lint, formatting, unit tests and build.
- Run `npm run test:integration` against a migrated, separate
  `fulfillops_test` database. Start just the Compose database and keep
  background consumers of that database stopped. Supertest starts its
  own API. `npm run test:worker` runs the focused worker suite.
- Use the public checker against a fresh isolated test deployment with
  both API and worker running. It creates orders and consumes stock.
- Show a new order completing, replay it, then verify one receipt and one
  reservation. Show recovery and retry evidence, persistence across a
  database pod replacement, GitOps drift correction and a Git revert.
- Use the instructor rollout probe against a stable local Service endpoint
  such as the kind NodePort on `localhost:18080` if configured. Start it
  before triggering the rollout. Keep the CSV and rollout timestamps.
- Show the benchmark sample count, p95 and errors, along with CI results,
  SBOMs, scan reports and published image digests where available.

For local integration tests, set `TEST_DATABASE_URL` in .env. The Compose
init SQL creates the local test role and database on a fresh volume.
Apply migrations to that URL explicitly:

```bash
node --input-type=module -e '
import "dotenv/config";
import { spawnSync } from "node:child_process";

const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== "/fulfillops_test") {
  throw new Error("TEST_DATABASE_URL must target the isolated fulfillops_test database");
}
const run = spawnSync("npm", ["run", "db:migrate:deploy"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url },
});
process.exit(run.status ?? 1);
'
npm run test:integration
```

The guarded `scripts/reset-test-data.ts` removes transaction data and
restores catalog stock. Run it only on a disposable test database, with
all API and worker processes using that database stopped.

```bash
set -o pipefail
mkdir -p artifacts/final-demo
python3 assessment/fulfillops_public_checker.py \
  --base-url http://localhost:18082 --concurrency --stress \
  2>&1 | tee artifacts/final-demo/public-checker.txt
grep -F 'RESULT: 15 passed / 0 failed / 0 skipped' \
  artifacts/final-demo/public-checker.txt
```

For more detail see the [architecture](docs/architecture.md),
[database schema](docs/database-schema.md), [local stack](docs/local-stack.md),
[CI workflow](.github/workflows/ci.yml) and
[commit conventions](docs/commit/COMMIT_CONVENTION.md).
