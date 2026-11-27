// One bootstrap at a time, including preference changes and mutation refreshes.
// Matching callers share work; an explicit post-mutation refresh runs afterward.
export function createDashboardRefreshQueue() {
  let active = null;
  const waiting = [];
  function pump() {
    if (active || !waiting.length) return;
    active = waiting.shift();
    const job = active;
    Promise.resolve().then(job.work).then(job.resolve, job.reject).finally(() => {
      active = null;
      pump();
    });
  }
  return {
    run(key, work, { afterCurrent = false } = {}) {
      if (!afterCurrent && active?.key === key) return active.promise;
      const queued = waiting.find(job => job.key === key);
      if (queued) return queued.promise;
      let resolve;
      let reject;
      const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
      waiting.push({ key, work, promise, resolve, reject });
      pump();
      return promise;
    }
  };
}

export function isDashboardRefreshVisible(document, desktopMinimized = false) {
  return document.visibilityState === 'visible' && !desktopMinimized;
}
