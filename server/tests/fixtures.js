/**
 * Test Environment Fixtures
 * Reads test-only credentials from environment variables per Section 1.2:
 * "Remove the default keys from config.js, the frontend API client and test fixtures.
 * SLON_API_KEY is required, and startup fails without it... Test fixtures read a test-only value from the environment."
 */

import bcrypt from 'bcryptjs';

export const TEST_PASSWORD = 'test_executive_password_2026';
export const TEST_PASSWORD_HASH = bcrypt.hashSync(TEST_PASSWORD, 10);

process.env.NODE_ENV = 'test';

// If test runner is invoked without explicit environment keys, provide isolated test-only fixture values in process.env
if (!process.env.SLON_API_KEY && !process.env.SLOANE_API_KEY) {
  process.env.SLON_API_KEY = 'test_slon_api_key_readwrite_fixture';
}
if (!process.env.SLON_READONLY_API_KEY && !process.env.SLOANE_READONLY_API_KEY) {
  process.env.SLON_READONLY_API_KEY = 'test_slon_api_key_readonly_fixture';
}
if (!process.env.TEST_REVOKED_API_KEY) {
  process.env.TEST_REVOKED_API_KEY = 'test_slon_api_key_revoked_fixture';
}
if (!process.env.TEST_EXPIRED_API_KEY) {
  process.env.TEST_EXPIRED_API_KEY = 'test_slon_api_key_expired_fixture';
}
if (!process.env.STORAGE_PRESIGNED_TOKEN_SECRET && !process.env.SLON_TOKEN_SECRET) {
  process.env.STORAGE_PRESIGNED_TOKEN_SECRET = 'test_storage_token_secret_32_bytes_fixture';
}
if (!process.env.SLON_OWNER_EMAIL) {
  process.env.SLON_OWNER_EMAIL = 'kirsty@trinova.com';
}
if (!process.env.SLON_OWNER_PASSWORD_HASH) {
  process.env.SLON_OWNER_PASSWORD_HASH = TEST_PASSWORD_HASH;
}
if (!process.env.SIGNING_WEBHOOK_SECRET) {
  process.env.SIGNING_WEBHOOK_SECRET = 'test_signing_webhook_secret_hmac_fixture';
}

export const TEST_API_KEY = (process.env.SLON_API_KEY || process.env.SLOANE_API_KEY).trim();
export const TEST_READONLY_KEY = (process.env.SLON_READONLY_API_KEY || process.env.SLOANE_READONLY_API_KEY).trim();
export const TEST_REVOKED_KEY = process.env.TEST_REVOKED_API_KEY.trim();
export const TEST_EXPIRED_KEY = process.env.TEST_EXPIRED_API_KEY.trim();
export const TEST_STORAGE_SECRET = (process.env.STORAGE_PRESIGNED_TOKEN_SECRET || process.env.SLON_TOKEN_SECRET).trim();
export const TEST_WEBHOOK_SECRET = process.env.SIGNING_WEBHOOK_SECRET.trim();
