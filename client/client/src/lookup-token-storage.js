const LOOKUP_TOKEN_KEY = 'koleLookupToken';

export function isMobileLoginDevice(device = {}) {
  const userAgent = device.userAgent || '';
  if (/Windows/i.test(userAgent)) return false;
  return device.userAgentData?.mobile === true ||
    /Android|iPhone|iPad|iPod/i.test(userAgent) ||
    (/Macintosh/i.test(userAgent) && device.maxTouchPoints > 1);
}

export function createLookupTokenStorage(browser) {
  // Keep the policy fixed for this app session, independent of layout changes.
  const rememberLogin = isMobileLoginDevice(browser.navigator);
  const remove = (storageName) => {
    try {
      browser[storageName].removeItem(LOOKUP_TOKEN_KEY);
    } catch {
      // Login still works in memory when browser storage is unavailable.
    }
  };
  return {
    rememberLogin,
    restore() {
      remove('sessionStorage');
      if (!rememberLogin) {
        remove('localStorage');
        return '';
      }
      try {
        return browser.localStorage.getItem(LOOKUP_TOKEN_KEY) || '';
      } catch {
        return '';
      }
    },
    save(token) {
      remove('sessionStorage');
      remove('localStorage');
      if (rememberLogin) {
        try {
          browser.localStorage.setItem(LOOKUP_TOKEN_KEY, token);
        } catch {
          // Storage restrictions must not prevent a successful login.
        }
      }
    },
    clear() {
      remove('sessionStorage');
      remove('localStorage');
    },
  };
}
