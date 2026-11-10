import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateUsername, validatePassword, normalizeUsername, hashPassword, checkPassword } from '../src/services/auth.js';

test('username rules', () => {
  assert.equal(validateUsername('meghna_g'), null);
  assert.equal(validateUsername(normalizeUsername('  Meghna.G ')), null); // trimmed + lower-cased first
  assert.ok(validateUsername('ab'));            // too short
  assert.ok(validateUsername('has space'));     // invalid character
  assert.ok(validateUsername('x'.repeat(31)));  // too long
});

test('password rules', () => {
  assert.equal(validatePassword('blood2026'), null);
  assert.ok(validatePassword('short1'));        // < 8
  assert.ok(validatePassword('onlyletters'));   // needs a number
  assert.ok(validatePassword('12345678'));      // needs a letter
  assert.ok(validatePassword('a1'.repeat(40))); // > 72
});

test('passwords are hashed, salted and verifiable', async () => {
  const h1 = await hashPassword('blood2026');
  const h2 = await hashPassword('blood2026');
  assert.notEqual(h1, 'blood2026');             // never stored as plain text
  assert.notEqual(h1, h2);                      // random salt: same password, different hash
  assert.equal(await checkPassword('blood2026', h1), true);
  assert.equal(await checkPassword('wrong-pass1', h1), false);
});
