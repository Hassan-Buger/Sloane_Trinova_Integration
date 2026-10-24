/**
 * The TriNova connection panel showed "Signed in as [object Object]" because the server sends the
 * actor as an object. The browser must show the person's name instead.
 */

import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';

let ApiService;

before(async () => {
  ({ ApiService } = await import('../../scripts/services/api.js'));
});

describe('Signed-in name on the TriNova connection panel', () => {
  test('an actor object from the server becomes the person\'s name and scopes', async () => {
    const original = ApiService.request;
    ApiService.request = async () => ({
      data: {
        status: 'authenticated',
        actor: { actorId: 'actor_kirsty_allen', actorName: 'Kirsty Allen', scopes: ['sloane:read', 'sloane:write'] }
      },
      durationMs: 5
    });
    try {
      const auth = await ApiService.verifyAuth();
      assert.equal(auth.ok, true);
      assert.equal(auth.actor, 'Kirsty Allen');
      assert.deepEqual(auth.scopes, ['sloane:read', 'sloane:write']);
      assert.notEqual(String(auth.actor), '[object Object]');
    } finally {
      ApiService.request = original;
    }
  });

  test('a plain text actor is still shown as it is', async () => {
    const original = ApiService.request;
    ApiService.request = async () => ({ data: { actor: 'Kirsty Allen', scopes: ['sloane:read'] } });
    try {
      const auth = await ApiService.verifyAuth();
      assert.equal(auth.actor, 'Kirsty Allen');
      assert.deepEqual(auth.scopes, ['sloane:read']);
    } finally {
      ApiService.request = original;
    }
  });
});
