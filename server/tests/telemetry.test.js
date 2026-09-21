/**
 * Automated Test Suite for Trinova Telemetry & System Monitoring
 * Tests request tracking, latency calculation, memory metrics, and /api/v1/metrics endpoint.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { telemetry } from '../src/services/telemetry.js';

describe('Production Telemetry & Metrics Suite', () => {
  let server;
  let baseUrl;
  const TEST_PORT = 5008;

  before(async () => {
    const app = createApp();
    await new Promise(resolve => {
      server = app.listen(TEST_PORT, () => {
        baseUrl = `http://localhost:${TEST_PORT}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  beforeEach(() => {
    telemetry.reset();
  });

  function request(path, options = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const req = http.request(url, options, res => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        });
      });
      req.on('error', reject);
      if (options.body) {
        req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
      }
      req.end();
    });
  }

  test('GET /api/v1/metrics without credentials returns 401 Unauthorized', async () => {
    const res = await request('/api/v1/metrics');
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'UNAUTHORIZED');
  });

  test('GET /api/v1/metrics with invalid credentials returns 401 Unauthorized', async () => {
    const res = await request('/api/v1/metrics', {
      headers: {
        Authorization: 'Bearer invalid_secret_token'
      }
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'INVALID_CREDENTIALS');
  });

  test('GET /api/v1/metrics with valid sloane:read credentials returns structured metrics payload', async () => {
    // Generate a health check request first to populate request metrics
    await request('/api/v1/health');

    const res = await request('/api/v1/metrics', {
      headers: {
        Authorization: 'Bearer tn_sec_live_sloane_readwrite_2026'
      }
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'success');

    const metrics = res.body.data;
    assert.equal(metrics.service, 'trinova-api-server');
    assert.equal(metrics.version, '1.0.0');
    assert.ok(typeof metrics.uptimeSeconds === 'number');

    // Traffic assertions
    assert.ok(metrics.traffic.totalRequests >= 1);
    assert.ok(metrics.traffic.statusCodes['2xx'] >= 1);
    assert.equal(typeof metrics.traffic.errorRatePercent, 'number');
    assert.ok(['OPTIMAL', 'DEGRADED', 'UNHEALTHY'].includes(metrics.traffic.health));

    // Latency assertions
    assert.ok(typeof metrics.latencyMs.average === 'number');
    assert.ok(typeof metrics.latencyMs.p50 === 'number');
    assert.ok(typeof metrics.latencyMs.p95 === 'number');
    assert.ok(typeof metrics.latencyMs.p99 === 'number');
    assert.ok(typeof metrics.latencyMs.max === 'number');

    // Memory assertions
    assert.ok(metrics.resources.rssMb > 0);
    assert.ok(metrics.resources.heapTotalMb > 0);
    assert.ok(metrics.resources.heapUsedMb > 0);

    // Integrations telemetry
    assert.equal(metrics.integrations.companiesHouse.rateLimitQuota, 600);
    assert.equal(metrics.integrations.companiesHouse.rateLimitWindowMinutes, 5);
    assert.equal(metrics.integrations.documensoSigning.provider, 'documenso');
    assert.equal(typeof metrics.integrations.documensoSigning.webhookDeliverySuccessRate, 'number');
  });

  test('TelemetryService accurately records status categories, latencies, and integration calls', () => {
    telemetry.recordRequest({ statusCode: 200, durationMs: 15, path: '/api/v1/clients' });
    telemetry.recordRequest({ statusCode: 201, durationMs: 25, path: '/api/v1/tasks' });
    telemetry.recordRequest({ statusCode: 404, durationMs: 5, path: '/api/v1/missing' });
    telemetry.recordRequest({ statusCode: 500, durationMs: 80, path: '/api/v1/error' });
    telemetry.recordRequest({ statusCode: 200, durationMs: 10, path: '/api/v1/statutory/sync' });
    telemetry.recordRequest({ statusCode: 200, durationMs: 30, path: '/api/v1/signing/webhooks' });
    telemetry.recordRequest({ statusCode: 400, durationMs: 12, path: '/api/v1/signing/webhooks' });

    const snap = telemetry.getMetrics();
    assert.equal(snap.traffic.totalRequests, 7);
    assert.equal(snap.traffic.statusCodes['2xx'], 4);
    assert.equal(snap.traffic.statusCodes['4xx'], 2);
    assert.equal(snap.traffic.statusCodes['5xx'], 1);

    // 1 error out of 7 requests = ~14.29%
    assert.equal(snap.traffic.errorRatePercent, 14.29);
    assert.equal(snap.traffic.health, 'UNHEALTHY'); // > 1.0% is UNHEALTHY

    // Integration calls
    assert.equal(snap.integrations.companiesHouse.syncRequestsHandled, 1);
    assert.equal(snap.integrations.documensoSigning.webhooksTotal, 2);
    assert.equal(snap.integrations.documensoSigning.webhooksFailed, 1);
    assert.equal(snap.integrations.documensoSigning.webhookDeliverySuccessRate, 50.0);

    // Percentiles
    assert.ok(snap.latencyMs.p50 > 0);
    assert.equal(snap.latencyMs.max, 80);
  });
});
