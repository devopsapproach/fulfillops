import { performance } from "node:perf_hooks";

const TARGET_URL = process.env.TARGET_URL || "http://localhost:8080/health/ready";
const TOTAL_REQUESTS = 200;
const CONCURRENCY = 20;
const SLO_P95_MS = 50; // Proposed local target: 50 milliseconds

async function sendRequest(): Promise<number> {
  const start = performance.now();
  try {
    const response = await fetch(TARGET_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    // Consume the body to ensure the connection closes properly
    await response.text();
  } catch {
    // If a request fails, record an artificially high latency to penalize the p95
    return 30000;
  }
  return performance.now() - start;
}

async function runBenchmark() {
  console.log(`Starting benchmark: ${TOTAL_REQUESTS} requests to ${TARGET_URL} (Concurrency: ${CONCURRENCY})`);
  
  const latencies: number[] = [];
  let completed = 0;

  // Concurrency pool execution
  const executePool = async () => {
    while (completed < TOTAL_REQUESTS) {
      completed++;
      const duration = await sendRequest();
      latencies.push(duration);
    }
  };

  const workers = Array.from({ length: CONCURRENCY }, () => executePool());
  await Promise.all(workers);

  // Compute p95
  latencies.sort((a, b) => a - b);
  const p95Index = Math.floor(latencies.length * 0.95) - 1;
  const p95Latency = latencies[p95Index];
  
  const isCompliant = p95Latency <= SLO_P95_MS;

  console.log("\n--- Benchmark Results ---");
  console.log(`Total Requests: ${latencies.length}`);
  console.log(`Min Latency:    ${latencies[0]?.toFixed(2)} ms`);
  console.log(`Max Latency:    ${latencies[latencies.length - 1]?.toFixed(2)} ms`);
  console.log(`Median (p50):   ${latencies[Math.floor(latencies.length * 0.5)]?.toFixed(2)} ms`);
  console.log(`p95 Latency:    ${p95Latency?.toFixed(2)} ms`);
  console.log(`\n--- SLO Evaluation ---`);
  console.log(`Target p95:     <= ${SLO_P95_MS} ms`);
  console.log(`Status:         ${isCompliant ? "PASS" : "FAIL"}`);

  if (!isCompliant) {
    process.exitCode = 1;
  }
}

runBenchmark().catch((error) => {
  console.error("Benchmark crashed:", error);
  process.exitCode = 1;
});