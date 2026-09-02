function normalizeLoadPaperworkName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findLoadPaperworkTmsFolder(items, tmsName) {
  const target = normalizeLoadPaperworkName(tmsName);

  if (!target) return null;

  return (
    (items || []).find((item) => (
      item?.folder && normalizeLoadPaperworkName(item.name) === target
    )) || null
  );
}

function getExpectedLoadPaperworkFolderName(order = {}) {
  const bol = String(order.BOL || '').trim();
  const driver = String(order.Driver || '').trim();
  const route = String(order.Route || '').trim();

  if (!bol || !driver || !route) return '';
  return `${bol} - ${driver} - ${route}`;
}

function findLoadPaperworkLoadFolder(items, order = {}) {
  const folders = (items || []).filter((item) => item?.folder);
  const bol = String(order.BOL || '').trim();
  const normalizedBol = bol.toLowerCase();

  if (!normalizedBol) {
    return { folder: null, matchStrategy: 'missing-bol', ambiguous: false };
  }

  const expectedName = getExpectedLoadPaperworkFolderName(order);
  const normalizedExpected = normalizeLoadPaperworkName(expectedName);
  const exactMatches = normalizedExpected
    ? folders.filter((item) => normalizeLoadPaperworkName(item.name) === normalizedExpected)
    : [];

  if (exactMatches.length === 1) {
    return { folder: exactMatches[0], matchStrategy: 'exact-order-folder', ambiguous: false };
  }

  const bolMatches = folders.filter((item) => {
    const name = String(item.name || '').trim().toLowerCase();
    return name === normalizedBol || name.startsWith(`${normalizedBol} -`);
  });

  if (bolMatches.length === 1) {
    return { folder: bolMatches[0], matchStrategy: 'bol-folder-prefix', ambiguous: false };
  }

  if (bolMatches.length > 1) {
    const driver = normalizeLoadPaperworkName(order.Driver);
    const route = normalizeLoadPaperworkName(order.Route);
    const hintedMatches = bolMatches.filter((item) => {
      const normalizedName = normalizeLoadPaperworkName(item.name);
      return (!driver || normalizedName.includes(driver)) && (!route || normalizedName.includes(route));
    });

    if (hintedMatches.length === 1) {
      return { folder: hintedMatches[0], matchStrategy: 'bol-driver-route-match', ambiguous: false };
    }

    return { folder: null, matchStrategy: 'ambiguous-bol-folder', ambiguous: true };
  }

  return { folder: null, matchStrategy: 'not-found', ambiguous: false };
}

function sanitizeLoadPaperworkFileName(originalName, extension = '') {
  const leafName = String(originalName || 'upload').split(/[\\/]/).pop() || 'upload';
  const originalExtensionMatch = leafName.match(/\.[A-Za-z0-9]{1,10}$/);
  const originalExtension = originalExtensionMatch ? originalExtensionMatch[0] : '';
  const safeExtension = String(extension || originalExtension).toLowerCase();
  const baseName = originalExtension ? leafName.slice(0, -originalExtension.length) : leafName;
  let safeBaseName = baseName
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/["*:<>?\\/|#%]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, Math.max(1, 120 - safeExtension.length))
    .replace(/[.\s]+$/g, '');

  if (!safeBaseName) safeBaseName = 'upload';
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(safeBaseName)) {
    safeBaseName = `file-${safeBaseName}`;
  }

  return `${safeBaseName}${safeExtension}`;
}

function getUniqueLoadPaperworkFileName(preferredName, existingNames = []) {
  const names = new Set(
    Array.from(existingNames || [], (name) => String(name || '').toLowerCase())
  );
  const hasName = (name) => names.has(String(name || '').toLowerCase());

  if (!hasName(preferredName)) return preferredName;

  const extensionMatch = String(preferredName || '').match(/\.[A-Za-z0-9]{1,10}$/);
  const extension = extensionMatch ? extensionMatch[0] : '';
  const baseName = extension ? preferredName.slice(0, -extension.length) : preferredName;

  for (let counter = 2; counter <= 9999; counter += 1) {
    const suffix = ` (${counter})`;
    const trimmedBase = baseName.slice(0, Math.max(1, 120 - extension.length - suffix.length));
    const candidate = `${trimmedBase}${suffix}${extension}`;
    if (!hasName(candidate)) return candidate;
  }

  return sanitizeLoadPaperworkFileName(
    `${baseName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extension}`,
    extension
  );
}

function cleanLoadPaperworkFiles(items) {
  return (items || [])
    .filter((item) => item?.file)
    .map((item) => ({
      id: String(item.id || ''),
      name: String(item.name || ''),
      webUrl: String(item.webUrl || ''),
      size: Number(item.size || 0),
      mimeType: String(item.file?.mimeType || ''),
      lastModifiedDateTime: String(item.lastModifiedDateTime || ''),
      isDispatchSheet: /dispatch\s*sheet/i.test(String(item.name || ''))
    }))
    .sort((left, right) => {
      if (left.isDispatchSheet !== right.isDispatchSheet) return left.isDispatchSheet ? -1 : 1;

      const modifiedDifference = (Date.parse(right.lastModifiedDateTime) || 0) - (Date.parse(left.lastModifiedDateTime) || 0);
      if (modifiedDifference !== 0) return modifiedDifference;

      return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' });
    });
}

module.exports = {
  cleanLoadPaperworkFiles,
  findLoadPaperworkLoadFolder,
  findLoadPaperworkTmsFolder,
  getExpectedLoadPaperworkFolderName,
  getUniqueLoadPaperworkFileName,
  normalizeLoadPaperworkName,
  sanitizeLoadPaperworkFileName
};
