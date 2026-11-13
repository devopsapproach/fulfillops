# Developer B — Checkpoint 2 verification report

## Commit tested

- f42235e, reported tested revision

## Integration tests

- Test files: 4 passed
- Tests: 30 passed
- Started at: _19:01:31_
- Duration: _16.41s_
- Results recorded from the developer's test summary

## Environment and preparation

- Application database: fulfillops_dev
- Migrations: two found; no pending migrations
- Seed: succeeded; created zero products, preserving existing catalog data
- TypeScript build: succeeded
- API readiness: HTTP 200

## Stock before acceptance

- SKU: KIT-100
- Unit price: 1299 cents
- Available: 6

## HTTP-created order

- Order ID: d40acd92-b789-438e-874a-5826358ca71d
- Customer: CUST-DEMO
- Requested item: KIT-100, quantity 1
- Accepted total: 1299 cents

## Acceptance response

- HTTP 202
- Response:
  {"order_id":"d40acd92-b789-438e-874a-5826358ca71d","status":"queued"}

## Initial database state

- Order: queued
- Job: pending
- Job count: 1
- Attempts: 0
- Maximum attempts: 3
- Claim token and lease expiry: NULL
- Completion and failure timestamps: NULL
- Receipt count: 0

## Stock after acceptance

- KIT-100 available: 5
- Exactly one unit was reserved

## Worker completion

- Worker logged job_claimed followed by job_completed
- Job ID: 06dc5f41-429c-4b5f-ad0c-42900c5f74b8
- Order: completed
- Job: completed
- Job count: 1
- Receipt count: 1
- Attempts: 1
- Claim token and lease expiry: NULL
- Last error: NULL
- Failure/dead-letter timestamps: NULL
- Order and job completed_at: 2026-11-13 18:12:13.147 UTC
- Accepted total remained 1299 cents

## Completion timing

- The 15-second HTTP observation window timed out while the order was queued
- Subsequent database inspection and GET confirmed completion
- The job's initial next_attempt_at was 18:09:34.519723 UTC
- Completion occurred approximately 158.63 seconds after that timestamp
- This interval includes queue waiting and is not a measurement of
  fulfillment execution time
- Completion within 15 seconds with both services already running
  remains to be verified

## Stock after completion

- KIT-100 available: 5
- Comparing reserved and completed inventory snapshots produced no differences
- The worker did not reserve inventory a second time

## Replay preserved original ID

- Confirmed
- POST replay returned HTTP 202 and the original order ID
- POST status was queued, representing the acceptance receipt
- GET returned completed with total_cents = 1299

## Stock and counts after replay

- Not independently inspected in the supplied output
- Repeat the database inspection to confirm stock = 5, job count = 1, and receipt count = 1

## Restart preserved completed state

- Not yet demonstrated explicitly
- Repeated GET and replay succeeded, but the supplied output does not
  show a stop/start sequence between these requests

## Conclusion

- Acceptance-to-worker completion: demonstrated
- Single reservation through completion: demonstrated
- One persisted completion receipt: demonstrated
- Replay preserves order identity: demonstrated
- Healthy-service completion within 15 seconds: pending
- Post-replay database invariants: pending inspection
- Restart persistence: pending explicit verification
