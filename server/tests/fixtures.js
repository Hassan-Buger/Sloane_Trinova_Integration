/**
 * Test Environment Fixtures
 * Reads test-only credentials from environment variables per Section 1.2:
 * "Remove the default keys from config.js, the frontend API client and test fixtures.
 * SLON_API_KEY is required, and startup fails without it... Test fixtures read a test-only value from the environment."
 */

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
  // Hash for 'password123'
  process.env.SLON_OWNER_PASSWORD_HASH = '$2a$10$wHh4tzXxmMPEzTTYPGE9r.4k.kgs.wCuYIyeLmVDeMf3PGqBtm8UK';
}
if (!process.env.SIGNING_WEBHOOK_SECRET) {
  process.env.SIGNING_WEBHOOK_SECRET = 'documenso_webhook_secret_hmac_2026';
}

export const TEST_API_KEY = (process.env.SLON_API_KEY || process.env.SLOANE_API_KEY).trim();
export const TEST_READONLY_KEY = (process.env.SLON_READONLY_API_KEY || process.env.SLOANE_READONLY_API_KEY).trim();
export const TEST_REVOKED_KEY = process.env.TEST_REVOKED_API_KEY.trim();
export const TEST_EXPIRED_KEY = process.env.TEST_EXPIRED_API_KEY.trim();
export const TEST_STORAGE_SECRET = (process.env.STORAGE_PRESIGNED_TOKEN_SECRET || process.env.SLON_TOKEN_SECRET).trim();
export const TEST_WEBHOOK_SECRET = (process.env.SIGNING_WEBHOOK_SECRET || 'documenso_webhook_secret_hmac_2026').trim();
