export class MetricsRegistry {
  private requestsTotal = new Map<string, number>();
  private durationBuckets = new Map<string, number[]>();
  private durationSum = new Map<string, number>();
  private durationCount = new Map<string, number>();
  private ordersCreatedTotal = 0;

  public recordOrderCreated(): void {
    this.ordersCreatedTotal += 1;
  }

  // Standard latency bounds for web APIs in seconds
  private readonly buckets = [0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0];

  private buildLabelString(labels: Record<string, string>): string {
    return Object.entries(labels)
      .map(([k, v]) => `${k}="${v}"`)
      .join(",");
  }

  public observeRequest(
    method: string,
    route: string,
    status: number,
    durationSeconds: number,
  ) {
    const labels = { method, route, status: String(status) };
    const labelStr = this.buildLabelString(labels);

    // 1. Record Counter
    this.requestsTotal.set(
      labelStr,
      (this.requestsTotal.get(labelStr) || 0) + 1,
    );

    // 2. Record Histogram
    if (!this.durationBuckets.has(labelStr)) {
      this.durationBuckets.set(
        labelStr,
        new Array(this.buckets.length).fill(0),
      );
      this.durationSum.set(labelStr, 0);
      this.durationCount.set(labelStr, 0);
    }

    const currentBuckets = this.durationBuckets.get(labelStr)!;
    // Cumulative bucket increment
    for (let i = 0; i < this.buckets.length; i++) {
      if (durationSeconds <= this.buckets[i]!) {
        currentBuckets[i]++;
      }
    }

    this.durationSum.set(
      labelStr,
      this.durationSum.get(labelStr)! + durationSeconds,
    );
    this.durationCount.set(labelStr, this.durationCount.get(labelStr)! + 1);
  }

  public getMetricsAsText(): string {
    let output = "";

    // Counter
    output += `# HELP fulfillops_http_requests_total Total number of HTTP requests\n`;
    output += `# TYPE fulfillops_http_requests_total counter\n`;
    for (const [labels, count] of this.requestsTotal.entries()) {
      output += `fulfillops_http_requests_total{${labels}} ${count}\n`;
      output +=
        "# HELP fulfillops_orders_created_total New orders committed by this API process\n";
      output += "# TYPE fulfillops_orders_created_total counter\n";
      output += `fulfillops_orders_created_total ${this.ordersCreatedTotal}\n\n`;
    }

    // Histogram
    output += `\n# HELP fulfillops_http_request_duration_seconds HTTP request duration in seconds\n`;
    output += `# TYPE fulfillops_http_request_duration_seconds histogram\n`;
    for (const [labels, counts] of this.durationBuckets.entries()) {
      for (let i = 0; i < this.buckets.length; i++) {
        output += `fulfillops_http_request_duration_seconds_bucket{${labels},le="${this.buckets[i]}"} ${counts[i]}\n`;
      }
      // Mandatory +Inf bucket equals the total count
      const totalCount = this.durationCount.get(labels);
      output += `fulfillops_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${totalCount}\n`;
      output += `fulfillops_http_request_duration_seconds_sum{${labels}} ${this.durationSum.get(labels)}\n`;
      output += `fulfillops_http_request_duration_seconds_count{${labels}} ${totalCount}\n`;
    }

    return output;
  }
}

export const metricsRegistry = new MetricsRegistry();

// Express Middleware
import type { Request, Response, NextFunction } from "express";

export function observeMetrics(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const start = process.hrtime();

  res.on("finish", () => {
    const diff = process.hrtime(start);
    const durationSeconds = diff[0] + diff[1] / 1e9;

    // Normalization: req.route.path provides the static string template (e.g. '/orders/:id')
    // Fallback to 'unknown' to prevent unmapped routes from blowing up cardinality
    const route = req.route ? req.route.path : "unknown";

    metricsRegistry.observeRequest(
      req.method,
      route,
      res.statusCode,
      durationSeconds,
    );
  });

  next();
}
