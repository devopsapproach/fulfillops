import concurrent.futures
import json
import os
import subprocess
import time
import urllib.error
import urllib.request
import uuid

if os.environ.get("ISOLATED_TEST") != "true":
    raise RuntimeError("Set ISOLATED_TEST=true only for your isolated lab")

urls = os.environ["API_URLS"].split(",")
assert len(urls) == 2 and urls[0] != urls[1], "Two distinct API URLs required"
psql = json.loads(os.environ["PSQL_COMMAND_JSON"])

def sql(statement):
    result = subprocess.run(psql, input=statement, text=True,
                            capture_output=True, check=True)
    return result.stdout.strip()

assert sql("SELECT current_database();") == "fulfillops_test"

def quote(value):
    return "'" + str(value).replace("'", "''") + "'"

def request(base, method, path, body=None, key=None):
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Idempotency-Key"] = key
    req = urllib.request.Request(
        base + path, method=method, headers=headers,
        data=None if body is None else json.dumps(body).encode())
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())

def completed(order_id, deadline):
    while time.monotonic() < deadline:
        status, body = request(urls[0], "GET", "/api/v1/orders/" + order_id)
        assert status == 200, body
        if body["status"] == "completed":
            assert body["total_cents"] == 100, body
            return
        assert body["status"] in ("queued", "processing"), body
        time.sleep(0.1)
    raise AssertionError("Order did not complete within deadline: " + order_id)

suffix = uuid.uuid4().hex
sku = "T19-" + suffix
rollback_sku = "T19A-" + suffix
empty_sku = "T19Z-" + suffix
sku_list = ",".join(map(quote, [sku, rollback_sku, empty_sku]))
sql(f"INSERT INTO products(sku,unit_price_cents,available) VALUES "
    f"({quote(sku)},100,5),({quote(rollback_sku)},100,3),"
    f"({quote(empty_sku)},100,0);")

# Do not clean up inside this harness while workers might still own jobs.
# Its caller destroys the entire disposable stack, or the dedicated lab
# operator retains records for evidence. All fixtures have unique SKUs.
key = "t19-same-" + suffix
payload = {"customer_id": "T19-TEST", "items": [{"sku": sku, "quantity": 1}]}
started = time.monotonic()
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    futures = [pool.submit(request, urls[i % 2], "POST", "/api/v1/orders",
                           payload, key) for i in range(8)]
    results = [future.result() for future in futures]
assert all(status == 202 for status, _ in results), results
ids = {body["order_id"] for _, body in results}
assert len(ids) == 1, results
order_id = ids.pop()
completed(order_id, started + 15)
elapsed_ms = round((time.monotonic() - started) * 1000)
assert sql(f"SELECT available FROM products WHERE sku={quote(sku)};") == "4"

for base in urls:
    status, replay = request(base, "POST", "/api/v1/orders", payload, key)
    assert status == 202 and replay == {"order_id": order_id, "status": "queued"}
    status, conflict = request(base, "POST", "/api/v1/orders",
        {**payload, "customer_id": "T19-DIFFERENT"}, key)
    assert status == 409 and conflict["error"]["code"] == "IDEMPOTENCY_CONFLICT"

race_started = time.monotonic()
with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
    futures = [pool.submit(request, urls[i % 2], "POST", "/api/v1/orders",
        payload, f"t19-distinct-{suffix}-{i}") for i in range(12)]
    race = [future.result() for future in futures]
accepted = [body["order_id"] for status, body in race if status == 202]
rejected = [(status, body) for status, body in race if status != 202]
assert len(accepted) == 4 and len(rejected) == 8, race
assert len(set(accepted)) == 4
assert all(status == 409 and body["error"]["code"] == "OUT_OF_STOCK"
           for status, body in rejected), rejected
for accepted_id in accepted:
    completed(accepted_id, race_started + 15)
assert sql(f"SELECT available FROM products WHERE sku={quote(sku)};") == "0"

rollback_key = "t19-rollback-" + suffix
status, body = request(urls[0], "POST", "/api/v1/orders", {
    "customer_id": "T19-TEST",
    "items": [{"sku": rollback_sku, "quantity": 1},
              {"sku": empty_sku, "quantity": 1}]}, rollback_key)
assert status == 409 and body["error"]["code"] == "OUT_OF_STOCK", body
assert sql(f"SELECT available FROM products WHERE sku={quote(rollback_sku)};") == "3"
assert sql(f"SELECT count(*) FROM orders WHERE idempotency_key={quote(rollback_key)};") == "0"

state = json.loads(sql(f"""
SELECT json_build_object(
 'orders', (SELECT count(*) FROM orders o WHERE EXISTS
   (SELECT 1 FROM order_items i WHERE i.order_id=o.id AND i.sku={quote(sku)})),
 'jobs', (SELECT count(*) FROM jobs j JOIN order_items i ON i.order_id=j.order_id
   WHERE i.sku={quote(sku)} AND j.state='completed'
     AND j.claim_token IS NULL AND j.lease_expires_at IS NULL),
 'receipts', (SELECT count(*) FROM fulfillment_receipts r JOIN order_items i
   ON i.order_id=r.order_id WHERE i.sku={quote(sku)})
);
"""))
assert state == {"orders": 5, "jobs": 5, "receipts": 5}, state
print(json.dumps({"result": "PASS", "api_urls": urls, "order_id": order_id,
    "same_key_count": 8, "completion_ms": elapsed_ms, "database": state,
    "fixture_skus": [sku, rollback_sku, empty_sku]}))
