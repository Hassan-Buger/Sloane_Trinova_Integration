/**
 * Trinova Production Telemetry & Health Monitoring Service
 * Tracks API error rates, response latencies, Companies House quotas,
 * signing webhook delivery success, and resource consumption.
 * 
 * Adheres strictly to context/production-rollback-runbook.md §5
 * and context/06_testing_deployment_context.md §11.
 */

export class TelemetryService {
  constructor() {
    this.startTime = Date.now();
    this.totalRequests = 0;
    this.statusCodes = {
      '2xx': 0,
      '3xx': 0,
      '4xx': 0,
      '5xx': 0
    };
    this.durations = [];
    this.maxDurationMs = 0;
    this.signingWebhooksTotal = 0;
    this.signingWebhooksFailed = 0;
    this.chRequestsCount = 0;
  }

  /**
   * Records completed HTTP request telemetry.
   */
  recordRequest({ statusCode, durationMs, path }) {
    this.totalRequests++;

    const category = `${Math.floor(statusCode / 100)}xx`;
    if (this.statusCodes[category] !== undefined) {
      this.statusCodes[category]++;
    }

    if (durationMs > this.maxDurationMs) {
      this.maxDurationMs = durationMs;
    }

    // Keep sliding window of latest 1000 request latencies
    if (this.durations.length >= 1000) {
      this.durations.shift();
    }
    this.durations.push(durationMs);

    // Track specific endpoint categories
    if (path && path.includes('/signing/webhooks')) {
      this.signingWebhooksTotal++;
      if (statusCode >= 400) {
        this.signingWebhooksFailed++;
      }
    } else if (path && path.includes('/statutory/sync')) {
      this.chRequestsCount++;
    }
  }

  /**
   * Calculates percentile latency from recorded durations.
   */
  getPercentileLatency(p) {
    if (this.durations.length === 0) return 0;
    const sorted = [...this.durations].sort((a, b) => a - b);
    const index = Math.min(
      Math.floor((p / 100) * sorted.length),
      sorted.length - 1
    );
    return sorted[index];
  }

  /**
   * Generates a snapshot of all system telemetry metrics.
   */
  getMetrics() {
    const uptimeSec = Math.floor((Date.now() - this.startTime) / 1000);
    const avgDuration =
      this.durations.length > 0
        ? Math.round(
            (this.durations.reduce((a, b) => a + b, 0) / this.durations.length) * 10
          ) / 10
        : 0;

    const errorRatePct =
      this.totalRequests > 0
        ? Math.round((this.statusCodes['5xx'] / this.totalRequests) * 10000) / 100
        : 0.0;

    const mem = process.memoryUsage();

    return {
      service: 'trinova-api-server',
      version: '1.0.0',
      uptimeSeconds: uptimeSec,
      timestamp: new Date().toISOString(),
      traffic: {
        totalRequests: this.totalRequests,
        statusCodes: this.statusCodes,
        errorRatePercent: errorRatePct,
        health: errorRatePct < 0.1 ? 'OPTIMAL' : errorRatePct < 1.0 ? 'DEGRADED' : 'UNHEALTHY'
      },
      latencyMs: {
        average: avgDuration,
        p50: this.getPercentileLatency(50),
        p95: this.getPercentileLatency(95),
        p99: this.getPercentileLatency(99),
        max: this.maxDurationMs
      },
      resources: {
        rssMb: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
        heapTotalMb: Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100,
        heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100
      },
      integrations: {
        companiesHouse: {
          rateLimitQuota: 600,
          rateLimitWindowMinutes: 5,
          syncRequestsHandled: this.chRequestsCount
        },
        documensoSigning: {
          provider: 'documenso',
          webhooksTotal: this.signingWebhooksTotal,
          webhooksFailed: this.signingWebhooksFailed,
          webhookDeliverySuccessRate:
            this.signingWebhooksTotal > 0
              ? Math.round(
                  ((this.signingWebhooksTotal - this.signingWebhooksFailed) /
                    this.signingWebhooksTotal) *
                    10000
                ) / 100
              : 100.0
        }
      }
    };
  }

  /**
   * Resets metrics counters (for testing).
   */
  reset() {
    this.totalRequests = 0;
    this.statusCodes = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
    this.durations = [];
    this.maxDurationMs = 0;
    this.signingWebhooksTotal = 0;
    this.signingWebhooksFailed = 0;
    this.chRequestsCount = 0;
  }
}

export const telemetry = new TelemetryService();
