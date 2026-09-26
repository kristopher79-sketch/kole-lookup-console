import test from 'node:test';
import assert from 'node:assert/strict';
import { createLookupTokenStorage, isMobileLoginDevice } from './lookup-token-storage.js';

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

function browser(userAgent) {
  return { navigator: { userAgent }, localStorage: storage(), sessionStorage: storage() };
}

test('desktop requires login again and removes legacy saved tokens', () => {
  const desktop = browser('Windows NT 10.0');
  desktop.sessionStorage.setItem('koleLookupToken', 'test-only');
  desktop.localStorage.setItem('koleLookupToken', 'test-only');
  const policy = createLookupTokenStorage(desktop);
  assert.equal(policy.restore(), '');
  policy.save('test-only');
  assert.equal(createLookupTokenStorage(desktop).restore(), '');
  assert.equal(desktop.sessionStorage.getItem('koleLookupToken'), null);
  assert.equal(desktop.localStorage.getItem('koleLookupToken'), null);
});

test('mobile restores a successful login across app sessions and clears on logout or denial', () => {
  const mobile = browser('iPhone');
  createLookupTokenStorage(mobile).save('test-only');
  const reopened = createLookupTokenStorage(mobile);
  assert.equal(reopened.restore(), 'test-only');
  reopened.clear();
  assert.equal(createLookupTokenStorage(mobile).restore(), '');
  assert.equal(mobile.sessionStorage.getItem('koleLookupToken'), null);
});

test('device detection includes tablets without treating touch desktops as mobile', () => {
  for (const userAgent of ['iPhone', 'iPad', 'Android']) {
    assert.equal(isMobileLoginDevice({ userAgent }), true);
  }
  assert.equal(isMobileLoginDevice({ userAgent: 'Macintosh', maxTouchPoints: 5 }), true);
  assert.equal(isMobileLoginDevice({ userAgent: 'Macintosh', maxTouchPoints: 0 }), false);
  assert.equal(isMobileLoginDevice({ userAgent: 'Windows', maxTouchPoints: 10 }), false);
  assert.equal(isMobileLoginDevice({ userAgentData: { mobile: true } }), true);
  assert.equal(isMobileLoginDevice({}), false);
});

test('unavailable browser storage leaves login usable in memory', () => {
  const restricted = { navigator: { userAgent: 'Android' } };
  for (const name of ['localStorage', 'sessionStorage']) {
    Object.defineProperty(restricted, name, { get() { throw new Error('Storage blocked'); } });
  }
  const policy = createLookupTokenStorage(restricted);
  assert.equal(policy.restore(), '');
  assert.doesNotThrow(() => policy.save('test-only'));
  assert.doesNotThrow(() => policy.clear());
});
