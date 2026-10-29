const crypto = require('crypto');

const PHOTO_LIBRARY_FIELD_NAMES = Object.freeze([
  'BidID',
  'BOL',
  'Driver',
  'TMSName',
  'Truck',
  'Freight',
  'EngineName',
  'Origin',
  'Destination',
  'Route',
  'PIckupDate',
  'CompanyName',
  'CustomerCode',
  'Length',
  'Width',
  'Height',
  'InactiveOperator'
]);

const UNKNOWN_ENGINE_VALUES = new Set([
  '',
  '-',
  'na',
  'n a',
  'none',
  'null',
  'other',
  'tbd',
  'unknown',
  'not applicable',
  'not available'
]);

const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'bmp'
]);

const SCHEMA_CACHE_MS = 5 * 60 * 1000;
const CATALOG_CACHE_MS = 2 * 60 * 1000;
const FOLDER_CACHE_MS = 5 * 60 * 1000;
const OVERRIDE_CACHE_MS = 30 * 1000;
const PHOTO_REFERENCE_CACHE_MS = 60 * 60 * 1000;
const PHOTO_REFERENCE_CACHE_MAX = 15000;
const DIAGNOSTIC_LIMIT = 250;

function cleanText(value) {
  return String(value ?? '').trim();
}

function normalizeSearchValue(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactKey(value) {
  return normalizeSearchValue(value).replace(/\s+/g, '');
}

function parseBoolean(value) {
  const normalized = normalizeSearchValue(value);
  return value === true || normalized === 'true' || normalized === 'yes' || normalized === '1';
}

function normalizeDateOnly(value) {
  const clean = cleanText(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(clean);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

function normalizeEngineName(value) {
  const raw = cleanText(value).replace(/\s+/g, ' ');
  const normalized = normalizeSearchValue(raw);
  if (UNKNOWN_ENGINE_VALUES.has(normalized)) return null;

  const compact = normalized.replace(/\s+/g, '');
  let display = raw;
  if (/^cfm\s*56$/i.test(raw)) display = 'CFM56';
  else if (/^pw\s*1100/i.test(raw)) display = 'PW1100';
  else if (/^pw\s*1500/i.test(raw)) display = 'PW1500';
  else if (/^v\s*2500/i.test(raw)) display = 'V2500';
  else if (/^leap[\s-]*1[ab]$/i.test(raw)) display = `LEAP ${raw.match(/1[ab]/i)[0].toUpperCase()}`;
  else if (/^f\s*117$/i.test(raw)) display = 'F117';
  else if (/^trent\b/i.test(raw)) display = raw.replace(/^trent/i, 'Trent');

  return { key: compact, display, source: raw };
}

function classifyFreight(fields, engine) {
  const freight = cleanText(fields.Freight);
  const normalized = normalizeSearchValue(freight);

  if (normalized.includes('engine stand') || normalized.includes('shipping stand') || normalized === 'stand') return 'engine-stands';
  if (engine || /(^| )aircraft engine( |$)|(^| )engine( |$)/.test(normalized)) return 'aircraft-engines';
  if (normalized.includes('aircraft') || normalized.includes('aviation') || normalized.includes('component') || normalized.includes('part')) return 'aircraft-parts';
  return 'general-freight';
}

function parseNumber(value) {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function findSuppressionColumn(columns) {
  const matches = (columns || []).filter((column) => {
    const internalName = compactKey(column?.name);
    const displayName = compactKey(column?.displayName);
    return internalName === 'suppresssample' || displayName === 'suppresssample';
  });

  if (matches.length !== 1) {
    return {
      verified: false,
      code: matches.length > 1 ? 'SUPPRESSION_COLUMN_AMBIGUOUS' : 'SUPPRESSION_COLUMN_MISSING',
      message: matches.length > 1
        ? 'More than one suppresssample column definition was found.'
        : 'The suppresssample column was not found in Engine Photo Library metadata.'
    };
  }

  const column = matches[0];
  if (!column.boolean) {
    return {
      verified: false,
      code: 'SUPPRESSION_COLUMN_NOT_BOOLEAN',
      message: 'The suppresssample column exists but is not configured as a Yes/No column.'
    };
  }

  return {
    verified: true,
    code: 'SUPPRESSION_COLUMN_VERIFIED',
    internalName: column.name,
    displayName: column.displayName || column.name,
    required: column.required === true,
    defaultValue: column.defaultValue ?? null,
    message: 'The suppresssample Yes/No column is verified.'
  };
}

function createPhotoLibraryError(message, statusCode = 500, code = 'PHOTO_LIBRARY_ERROR') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.safeForClient = true;
  return error;
}

function encodePhotoKey(driveId, itemId) {
  const drive = cleanText(driveId);
  const item = cleanText(itemId);
  if (!drive || !item) {
    throw createPhotoLibraryError('The photograph identity is incomplete.', 500, 'PHOTO_IDENTITY_INCOMPLETE');
  }
  return `od1:${Buffer.from(drive, 'utf8').toString('base64url')}:${Buffer.from(item, 'utf8').toString('base64url')}`;
}

function findOverrideColumn(columns, expectedName, type) {
  const normalizedName = normalizeSearchValue(expectedName);
  const candidates = (columns || []).filter((column) =>
    !column?.readOnly && !column?.hidden &&
    (normalizeSearchValue(column?.name) === normalizedName || normalizeSearchValue(column?.displayName) === normalizedName)
  );
  const exact = candidates.find((column) => normalizeSearchValue(column?.name) === normalizedName);
  const column = exact || (candidates.length === 1 ? candidates[0] : null);
  const typeMatches = type === 'boolean' ? Boolean(column?.boolean) : Boolean(column?.text);
  if (!column || !typeMatches) {
    return {
      verified: false,
      message: `The Photo Reference Overrides ${expectedName} column is missing, ambiguous, read-only, or has the wrong type.`
    };
  }
  return {
    verified: true,
    internalName: column.name,
    displayName: column.displayName || column.name,
    type,
    required: column.required === true,
    indexed: column.indexed === true,
    enforceUniqueValues: column.enforceUniqueValues === true
  };
}

function encodeCursor(offset) {
  return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url');
}

function decodeCursor(value) {
  if (!value) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    const offset = Number(parsed?.offset);
    if (!Number.isInteger(offset) || offset < 0) throw new Error('Invalid offset');
    return offset;
  } catch {
    throw createPhotoLibraryError('The gallery cursor is invalid.', 400, 'PHOTO_LIBRARY_INVALID_CURSOR');
  }
}

function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }

  return Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run)).then(() => results);
}

function createPhotoLibraryService(dependencies) {
  const {
    graphGet,
    graphPatch,
    graphPost,
    getGraphToken,
    getSiteId,
    getListId,
    getOverridesListId,
    getDriveId,
    getRootFolderId
  } = dependencies;

  let cachedSchema = null;
  let cachedSchemaAt = 0;
  let cachedCatalog = null;
  let cachedCatalogAt = 0;
  let cachedOverrideSchema = null;
  let cachedOverrideSchemaAt = 0;
  let cachedOverrides = null;
  let cachedOverridesAt = 0;
  const folderCache = new Map();
  const photoReferences = new Map();
  const inFlightOverrideWrites = new Map();
  const discoveredModelCounts = new Map();
  const modelDiscoveryProgress = new Map();
  let latestDiagnostics = [];

  function getConfiguration() {
    const siteId = cleanText(getSiteId());
    const listId = cleanText(getListId());
    const overridesListId = cleanText(getOverridesListId());
    const driveId = cleanText(getDriveId());
    const rootFolderId = cleanText(getRootFolderId());
    const missing = [];
    if (!siteId) missing.push('site ID');
    if (!listId) missing.push('Engine Photo Library list ID');
    if (!overridesListId) missing.push('Photo Reference Overrides list ID');
    if (!driveId) missing.push('Dispatch OneDrive ID');
    if (!rootFolderId) missing.push('Load Pictures folder ID');
    if (missing.length) {
      throw createPhotoLibraryError(
        `Photo Library server configuration is incomplete: ${missing.join(', ')}.`,
        503,
        'PHOTO_LIBRARY_NOT_CONFIGURED'
      );
    }
    return { siteId, listId, overridesListId, driveId, rootFolderId };
  }

  async function getAllPages(token, initialUrl) {
    const values = [];
    let url = initialUrl;
    while (url) {
      const data = await graphGet(token, url);
      values.push(...(data.value || []));
      url = data['@odata.nextLink'] || null;
    }
    return values;
  }

  async function getOverrideSchema(options = {}) {
    const now = Date.now();
    if (!options.forceRefresh && cachedOverrideSchema && now - cachedOverrideSchemaAt < SCHEMA_CACHE_MS) {
      return cachedOverrideSchema;
    }
    const { siteId, overridesListId } = getConfiguration();
    const token = await getGraphToken();
    const url = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(siteId)}` +
      `/lists/${encodeURIComponent(overridesListId)}/columns` +
      '?$select=id,name,displayName,required,hidden,readOnly,enforceUniqueValues,indexed,boolean,text&$top=999';
    const columns = await getAllPages(token, url);
    const fields = {
      photoKey: findOverrideColumn(columns, 'Title', 'text'),
      bidId: findOverrideColumn(columns, 'BidID', 'text'),
      hidden: findOverrideColumn(columns, 'Hidden', 'boolean')
    };
    const verified = Object.values(fields).every((field) => field.verified);
    cachedOverrideSchema = {
      checkedAt: new Date().toISOString(),
      verified,
      fields,
      uniquenessEnforced: fields.photoKey.enforceUniqueValues === true
    };
    cachedOverrideSchemaAt = now;
    return cachedOverrideSchema;
  }

  function requireVerifiedOverrideSchema(schema) {
    if (schema?.verified) return;
    const failedField = Object.values(schema?.fields || {}).find((field) => !field.verified);
    throw createPhotoLibraryError(
      failedField?.message || 'The Photo Reference Overrides schema could not be verified.',
      503,
      'PHOTO_OVERRIDE_SCHEMA_UNVERIFIED'
    );
  }

  function clearOverrideCache() {
    cachedOverrides = null;
    cachedOverridesAt = 0;
  }

  async function getOverrides(options = {}) {
    const now = Date.now();
    if (!options.forceRefresh && cachedOverrides && now - cachedOverridesAt < OVERRIDE_CACHE_MS) {
      return cachedOverrides;
    }
    const configuration = getConfiguration();
    const schema = await getOverrideSchema(options);
    requireVerifiedOverrideSchema(schema);
    const token = await getGraphToken();
    const titleField = schema.fields.photoKey.internalName;
    const bidIdField = schema.fields.bidId.internalName;
    const hiddenField = schema.fields.hidden.internalName;
    const fieldSelect = [titleField, bidIdField, hiddenField].map((field) => encodeURIComponent(field)).join(',');
    const url = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(configuration.siteId)}` +
      `/lists/${encodeURIComponent(configuration.overridesListId)}/items` +
      `?$expand=fields($select=${fieldSelect})&$select=id,fields&$top=200`;
    const items = await getAllPages(token, url);
    const byPhotoKey = new Map();
    for (const item of items) {
      const photoKey = cleanText(item?.fields?.[titleField]);
      if (!photoKey) continue;
      const record = {
        id: cleanText(item.id),
        photoKey,
        bidId: cleanText(item?.fields?.[bidIdField]),
        hidden: parseBoolean(item?.fields?.[hiddenField])
      };
      byPhotoKey.set(photoKey, [...(byPhotoKey.get(photoKey) || []), record]);
    }
    cachedOverrides = { byPhotoKey, recordCount: items.length, schema };
    cachedOverridesAt = now;
    return cachedOverrides;
  }

  function isPhotoKeyHidden(overrides, photoKey) {
    return (overrides?.byPhotoKey?.get(photoKey) || []).some((record) => record.hidden);
  }

  async function getSchema(options = {}) {
    const now = Date.now();
    if (!options.forceRefresh && cachedSchema && now - cachedSchemaAt < SCHEMA_CACHE_MS) return cachedSchema;
    const { siteId, listId } = getConfiguration();
    const token = await getGraphToken();
    const url = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(siteId)}` +
      `/lists/${encodeURIComponent(listId)}/columns` +
      '?$select=id,name,displayName,required,hidden,readOnly,defaultValue,boolean,text,number,dateTime,choice&$top=999';
    const columns = await getAllPages(token, url);
    const suppression = findSuppressionColumn(columns);
    cachedSchema = {
      checkedAt: new Date().toISOString(),
      columnCount: columns.length,
      suppression,
      observedFields: PHOTO_LIBRARY_FIELD_NAMES.filter((fieldName) =>
        columns.some((column) => column?.name === fieldName)
      ),
      missingFields: PHOTO_LIBRARY_FIELD_NAMES.filter((fieldName) =>
        !columns.some((column) => column?.name === fieldName)
      )
    };
    cachedSchemaAt = now;
    return cachedSchema;
  }

  function requireVerifiedSuppression(schema) {
    if (!schema?.suppression?.verified) {
      throw createPhotoLibraryError(
        schema?.suppression?.message || 'The suppresssample column could not be verified.',
        503,
        schema?.suppression?.code || 'PHOTO_LIBRARY_SUPPRESSION_UNVERIFIED'
      );
    }
  }

  function mapShipment(item, suppressionFieldName) {
    const fields = item?.fields || {};
    const bidId = cleanText(fields.BidID);
    if (!bidId) return null;
    const engine = normalizeEngineName(fields.EngineName);
    const suppressionValue = fields[suppressionFieldName];
    return {
      id: bidId,
      bidId,
      sourceItemId: cleanText(item.id),
      bol: cleanText(fields.BOL),
      truck: cleanText(fields.Truck),
      driver: cleanText(fields.Driver),
      tmsName: cleanText(fields.TMSName),
      freight: cleanText(fields.Freight),
      category: classifyFreight(fields, engine),
      engineName: engine?.display,
      engineKey: engine?.key,
      sourceEngineName: engine?.source || cleanText(fields.EngineName),
      origin: cleanText(fields.Origin),
      destination: cleanText(fields.Destination),
      route: cleanText(fields.Route),
      pickupDate: normalizeDateOnly(fields.PIckupDate),
      companyName: cleanText(fields.CompanyName),
      customerCode: cleanText(fields.CustomerCode),
      dimensions: {
        length: parseNumber(fields.Length),
        width: parseNumber(fields.Width),
        height: parseNumber(fields.Height)
      },
      inactiveOperator: parseBoolean(fields.InactiveOperator),
      suppressSample: parseBoolean(suppressionValue),
      suppressionValue: suppressionValue ?? null
    };
  }

  async function getCatalog(options = {}) {
    const now = Date.now();
    if (!options.forceRefresh && cachedCatalog && now - cachedCatalogAt < CATALOG_CACHE_MS) return cachedCatalog;
    const schema = await getSchema(options);
    requireVerifiedSuppression(schema);
    const { siteId, listId } = getConfiguration();
    const token = await getGraphToken();
    const fields = [...PHOTO_LIBRARY_FIELD_NAMES, schema.suppression.internalName];
    const fieldSelect = fields.map((field) => encodeURIComponent(field)).join(',');
    const url = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(siteId)}` +
      `/lists/${encodeURIComponent(listId)}/items` +
      `?$expand=fields($select=${fieldSelect})&$select=id,fields&$top=200`;
    const items = await getAllPages(token, url);
    const mapped = items.map((item) => mapShipment(item, schema.suppression.internalName)).filter(Boolean);
    const suppressedCount = mapped.filter((shipment) => shipment.suppressSample).length;
    const missingBidIdCount = items.length - mapped.length;
    const shipments = mapped
      .filter((shipment) => !shipment.suppressSample)
      .sort((a, b) => b.pickupDate.localeCompare(a.pickupDate) || b.bidId.localeCompare(a.bidId));
    cachedCatalog = {
      shipments,
      summary: {
        sourceRecordCount: items.length,
        eligibleShipmentCount: shipments.length,
        suppressedShipmentCount: suppressedCount,
        missingBidIdCount
      },
      suppression: schema.suppression
    };
    cachedCatalogAt = now;
    return cachedCatalog;
  }

  function chooseEngineDisplay(shipments) {
    const counts = new Map();
    shipments.forEach((shipment) => {
      const name = shipment.engineName;
      if (!name) return;
      counts.set(name, (counts.get(name) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || '';
  }

  async function listModels() {
    const catalog = await getCatalog();
    const groups = new Map();
    catalog.shipments
      .filter((shipment) => shipment.category === 'aircraft-engines' && shipment.engineKey)
      .forEach((shipment) => {
        groups.set(shipment.engineKey, [...(groups.get(shipment.engineKey) || []), shipment]);
      });
    const models = [...groups.entries()].map(([id, shipments]) => ({
      id,
      name: chooseEngineDisplay(shipments),
      shipmentCount: shipments.length,
      photoCount: discoveredModelCounts.has(id) ? discoveredModelCounts.get(id) : null,
      newestPhotoUrl: null
    })).sort((a, b) => b.shipmentCount - a.shipmentCount || a.name.localeCompare(b.name));
    return { models, ...catalog.summary, suppression: catalog.suppression };
  }

  async function listFolderChildren(token, driveId, folderId) {
    const cacheKey = `${driveId}:${folderId}`;
    const cached = folderCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < FOLDER_CACHE_MS) return cached.items;
    const url = `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}` +
      `/items/${encodeURIComponent(folderId)}/children` +
      '?$select=id,name,size,file,folder,createdDateTime,lastModifiedDateTime,photo&$top=999';
    const items = await getAllPages(token, url);
    folderCache.set(cacheKey, { cachedAt: Date.now(), items });
    while (folderCache.size > 600) folderCache.delete(folderCache.keys().next().value);
    return items;
  }

  function findExactFolder(items, name) {
    const target = normalizeSearchValue(name);
    if (!target) return null;
    return items.find((item) => item.folder && normalizeSearchValue(item.name) === target) || null;
  }

  function findBolFolders(items, bol) {
    const target = normalizeSearchValue(bol);
    if (!target) return [];
    return items.filter((item) => item.folder && normalizeSearchValue(item.name).startsWith(target));
  }

  function addDiagnostic(diagnostics, shipment, code, detail = {}) {
    diagnostics.push({
      code,
      bidId: shipment.bidId,
      ...detail
    });
  }

  async function getDriverScopes(token, configuration, preferInactive) {
    const rootItems = await listFolderChildren(token, configuration.driveId, configuration.rootFolderId);
    const inactiveRoot = findExactFolder(rootItems, 'Inactive');
    const activeFolders = rootItems.filter((item) => item.folder && normalizeSearchValue(item.name) !== 'inactive');
    const scopes = [];
    if (preferInactive && inactiveRoot) {
      scopes.push({ inactive: true, folders: await listFolderChildren(token, configuration.driveId, inactiveRoot.id) });
    }
    scopes.push({ inactive: false, folders: activeFolders });
    if (!preferInactive && inactiveRoot) {
      scopes.push({ inactive: true, folders: await listFolderChildren(token, configuration.driveId, inactiveRoot.id) });
    }
    return scopes;
  }

  async function resolveShipmentFolder(token, configuration, shipment, diagnostics) {
    if (!shipment.bol) {
      addDiagnostic(diagnostics, shipment, 'BOL_MISSING');
      return null;
    }
    const scopes = await getDriverScopes(token, configuration, shipment.inactiveOperator);
    const candidateNames = [shipment.tmsName, shipment.driver].filter(Boolean);
    const candidateMatches = [];

    for (const scope of scopes) {
      for (const candidateName of candidateNames) {
        const driverFolder = findExactFolder(scope.folders, candidateName);
        if (!driverFolder) continue;
        const loadFolders = await listFolderChildren(token, configuration.driveId, driverFolder.id);
        const bolMatches = findBolFolders(loadFolders, shipment.bol);
        if (bolMatches.length === 1) {
          candidateMatches.push({ loadFolder: bolMatches[0], driverFolder, inactive: scope.inactive, strategy: 'driver-bol' });
        } else if (bolMatches.length > 1) {
          addDiagnostic(diagnostics, shipment, 'SHIPMENT_FOLDER_AMBIGUOUS', { matchCount: bolMatches.length });
          return null;
        }
      }
    }

    const uniqueCandidates = candidateMatches.filter((match, index, items) =>
      items.findIndex((candidate) => candidate.loadFolder.id === match.loadFolder.id) === index
    );
    if (uniqueCandidates.length === 1) return uniqueCandidates[0];
    if (uniqueCandidates.length > 1) {
      addDiagnostic(diagnostics, shipment, 'SHIPMENT_FOLDER_AMBIGUOUS', { matchCount: uniqueCandidates.length });
      return null;
    }

    const scanMatches = [];
    for (const scope of scopes) {
      for (const driverFolder of scope.folders.filter((item) => item.folder)) {
        const loadFolders = await listFolderChildren(token, configuration.driveId, driverFolder.id);
        const bolMatches = findBolFolders(loadFolders, shipment.bol);
        bolMatches.forEach((loadFolder) => scanMatches.push({ loadFolder, driverFolder, inactive: scope.inactive, strategy: 'unique-bol-scan' }));
        if (scanMatches.length > 1) break;
      }
      if (scanMatches.length > 1) break;
    }
    if (scanMatches.length === 1) return scanMatches[0];
    if (scanMatches.length > 1) addDiagnostic(diagnostics, shipment, 'SHIPMENT_FOLDER_AMBIGUOUS', { matchCount: scanMatches.length });
    else addDiagnostic(diagnostics, shipment, 'SHIPMENT_FOLDER_MISSING');
    return null;
  }

  function isSupportedImage(item) {
    if (!item?.file) return false;
    const extension = cleanText(item.name).split('.').pop().toLowerCase();
    return SUPPORTED_IMAGE_EXTENSIONS.has(extension);
  }

  function registerPhotoReference(configuration, shipment, item, stage, photoKey, hidden) {
    const id = crypto.createHash('sha256')
      .update(`${configuration.driveId}:${item.id}:${stage}`)
      .digest('base64url')
      .slice(0, 32);
    photoReferences.set(id, {
      driveId: configuration.driveId,
      itemId: item.id,
      photoKey,
      bidId: shipment.bidId,
      hidden: hidden === true,
      name: cleanText(item.name),
      mimeType: cleanText(item.file?.mimeType) || 'application/octet-stream',
      expiresAt: Date.now() + PHOTO_REFERENCE_CACHE_MS
    });
    while (photoReferences.size > PHOTO_REFERENCE_CACHE_MAX) {
      photoReferences.delete(photoReferences.keys().next().value);
    }
    return id;
  }

  function mapPhoto(configuration, shipment, item, stage, photoKey, hidden) {
    const id = registerPhotoReference(configuration, shipment, item, stage, photoKey, hidden);
    const capturedAt = cleanText(item.photo?.takenDateTime) || cleanText(item.lastModifiedDateTime) || `${shipment.pickupDate}T12:00:00Z`;
    const timestampSource = item.photo?.takenDateTime ? 'photo' : item.lastModifiedDateTime ? 'modified' : 'pickup-date';
    return {
      id,
      shipmentId: shipment.id,
      stage,
      capturedAt,
      timestampSource,
      thumbnailUrl: `/api/photo-library/photos/${encodeURIComponent(id)}/thumbnail`,
      fullUrl: `/api/photo-library/photos/${encodeURIComponent(id)}/content`,
      alt: `${shipment.engineName || shipment.freight || 'Freight'} ${stage} photograph`,
      isDemo: false,
      hidden,
      shipment
    };
  }

  async function getShipmentPhotos(token, configuration, shipment, requestedStage, overrides, visibility) {
    const diagnostics = [];
    const resolved = await resolveShipmentFolder(token, configuration, shipment, diagnostics);
    if (!resolved) return { photos: [], diagnostics };
    const children = await listFolderChildren(token, configuration.driveId, resolved.loadFolder.id);
    const stageDefinitions = [
      { stage: 'pickup', folder: children.find((item) => item.folder && normalizeSearchValue(item.name).includes('pickup')) },
      { stage: 'delivery', folder: children.find((item) => item.folder && normalizeSearchValue(item.name).includes('delivery')) }
    ].filter((definition) => !requestedStage || requestedStage === 'all' || definition.stage === requestedStage);
    const photos = [];
    for (const definition of stageDefinitions) {
      if (!definition.folder) {
        addDiagnostic(diagnostics, shipment, `${definition.stage.toUpperCase()}_FOLDER_MISSING`);
        continue;
      }
      const stageItems = await listFolderChildren(token, configuration.driveId, definition.folder.id);
      const imageItems = stageItems.filter(isSupportedImage);
      const unsupportedCount = stageItems.filter((item) => item.file && !isSupportedImage(item)).length;
      if (imageItems.length === 0) addDiagnostic(diagnostics, shipment, `${definition.stage.toUpperCase()}_FOLDER_EMPTY`);
      if (unsupportedCount > 0) addDiagnostic(diagnostics, shipment, 'UNSUPPORTED_IMAGE_FORMAT', { count: unsupportedCount, stage: definition.stage });
      imageItems.forEach((item) => {
        const photoKey = encodePhotoKey(configuration.driveId, item.id);
        const hidden = isPhotoKeyHidden(overrides, photoKey);
        if (visibility === 'hidden' ? !hidden : hidden) return;
        photos.push(mapPhoto(configuration, shipment, item, definition.stage, photoKey, hidden));
      });
    }
    return { photos, diagnostics };
  }

  async function listPhotoPage(options) {
    const catalog = await getCatalog();
    const configuration = getConfiguration();
    const overrides = await getOverrides();
    const modelKey = compactKey(options.model || '');
    const category = cleanText(options.category);
    const visibility = options.visibility === 'hidden' ? 'hidden' : 'visible';
    const requestedStage = cleanText(options.stage).toLowerCase();
    if (requestedStage && !['all', 'pickup', 'delivery'].includes(requestedStage)) {
      throw createPhotoLibraryError('The photograph stage filter is invalid.', 400, 'PHOTO_LIBRARY_STAGE_INVALID');
    }
    if (cleanText(options.search).length > 200) {
      throw createPhotoLibraryError('The photograph search is too long.', 400, 'PHOTO_LIBRARY_SEARCH_TOO_LONG');
    }
    let shipments = catalog.shipments.filter((shipment) =>
      modelKey ? shipment.engineKey === modelKey : shipment.category === category
    );
    const search = normalizeSearchValue(options.search);
    if (search) {
      shipments = shipments.filter((shipment) => normalizeSearchValue([
        shipment.bidId,
        shipment.bol,
        shipment.driver,
        shipment.tmsName,
        shipment.freight,
        shipment.engineName,
        shipment.origin,
        shipment.destination,
        shipment.route,
        shipment.companyName,
        shipment.customerCode
      ].join(' ')).includes(search));
    }
    if (options.sort === 'oldest') {
      shipments = [...shipments].sort((a, b) => a.pickupDate.localeCompare(b.pickupDate) || a.bidId.localeCompare(b.bidId));
    }
    const offset = decodeCursor(options.cursor);
    const shipmentLimit = Math.min(5, Math.max(1, Number(options.shipmentLimit) || 2));
    const selected = shipments.slice(offset, offset + shipmentLimit);
    const token = await getGraphToken();
    const results = await mapWithConcurrency(selected, 2, (shipment) =>
      getShipmentPhotos(token, configuration, shipment, requestedStage, overrides, visibility).catch(() => ({
        photos: [],
        diagnostics: [{ code: 'SHIPMENT_RESOLUTION_FAILED', bidId: shipment.bidId }]
      }))
    );
    const photos = results.flatMap((result) => result.photos)
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
    const diagnostics = results.flatMap((result) => result.diagnostics);
    const nextOffset = offset + selected.length;
    const completed = nextOffset >= shipments.length;
    latestDiagnostics = [...diagnostics, ...latestDiagnostics].slice(0, DIAGNOSTIC_LIMIT);
    if (visibility === 'visible' && modelKey && (!requestedStage || requestedStage === 'all') && !search) {
      let progress = modelDiscoveryProgress.get(modelKey);
      if (offset === 0 || !progress || progress.nextOffset !== offset) {
        progress = { nextOffset: offset, photoCount: 0 };
      }
      progress.photoCount += photos.length;
      progress.nextOffset = nextOffset;
      modelDiscoveryProgress.set(modelKey, progress);
      if (completed) {
        discoveredModelCounts.set(modelKey, progress.photoCount);
        modelDiscoveryProgress.delete(modelKey);
      }
    }
    return {
      items: photos,
      nextCursor: completed ? null : encodeCursor(nextOffset),
      completed,
      processedShipmentCount: selected.length,
      totalShipmentCount: shipments.length,
      discoveredPhotoCount: photos.length,
      diagnostics
    };
  }

  function getPhotoReference(photoId) {
    const reference = photoReferences.get(cleanText(photoId));
    if (!reference || reference.expiresAt < Date.now()) {
      if (reference) photoReferences.delete(cleanText(photoId));
      throw createPhotoLibraryError('That photograph reference has expired. Reload the gallery.', 404, 'PHOTO_REFERENCE_NOT_FOUND');
    }
    return reference;
  }

  async function setPhotoHidden(photoId, hidden) {
    const reference = getPhotoReference(photoId);
    const photoKey = reference.photoKey;
    const existingWrite = inFlightOverrideWrites.get(photoKey);
    if (existingWrite) return existingWrite;

    const write = (async () => {
      const configuration = getConfiguration();
      const schema = await getOverrideSchema();
      requireVerifiedOverrideSchema(schema);
      const overrides = await getOverrides({ forceRefresh: true });
      const records = overrides.byPhotoKey.get(photoKey) || [];
      if (!hidden && records.length === 0) {
        throw createPhotoLibraryError(
          'This photograph does not have a visibility override to restore.',
          404,
          'PHOTO_OVERRIDE_NOT_FOUND'
        );
      }

      const token = await getGraphToken();
      const fields = {
        [schema.fields.photoKey.internalName]: photoKey,
        [schema.fields.bidId.internalName]: reference.bidId,
        [schema.fields.hidden.internalName]: hidden
      };
      if (records.length > 0) {
        await Promise.all(records.map((record) => graphPatch(
          token,
          `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(configuration.siteId)}` +
            `/lists/${encodeURIComponent(configuration.overridesListId)}` +
            `/items/${encodeURIComponent(record.id)}/fields`,
          fields,
          { 'If-Match': '*' }
        )));
      } else {
        await graphPost(
          token,
          `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(configuration.siteId)}` +
            `/lists/${encodeURIComponent(configuration.overridesListId)}/items`,
          { fields }
        );
      }

      clearOverrideCache();
      const confirmed = await getOverrides({ forceRefresh: true });
      if (isPhotoKeyHidden(confirmed, photoKey) !== hidden) {
        throw createPhotoLibraryError(
          'SharePoint did not confirm the photograph visibility change.',
          502,
          'PHOTO_OVERRIDE_CONFIRMATION_FAILED'
        );
      }
      reference.hidden = hidden;
      return {
        photoId: cleanText(photoId),
        bidId: reference.bidId,
        hidden,
        overrideRecordCount: (confirmed.byPhotoKey.get(photoKey) || []).length
      };
    })();

    inFlightOverrideWrites.set(photoKey, write);
    try {
      return await write;
    } finally {
      if (inFlightOverrideWrites.get(photoKey) === write) inFlightOverrideWrites.delete(photoKey);
    }
  }

  function getDiagnostics() {
    const categoryCounts = {};
    for (const shipment of cachedCatalog?.shipments || []) {
      categoryCounts[shipment.category] = (categoryCounts[shipment.category] || 0) + 1;
    }
    return {
      recent: latestDiagnostics,
      cachedFolderCount: folderCache.size,
      activePhotoReferenceCount: photoReferences.size,
      discoveredModelCounts: Object.fromEntries(discoveredModelCounts),
      catalogSummary: cachedCatalog?.summary || null,
      categoryCounts
    };
  }

  return {
    getSchema,
    getOverrideSchema,
    getCatalog,
    getOverrides,
    listModels,
    listPhotoPage,
    getPhotoReference,
    setPhotoHidden,
    getDiagnostics,
    clearCaches() {
      cachedSchema = null;
      cachedSchemaAt = 0;
      cachedCatalog = null;
      cachedCatalogAt = 0;
      cachedOverrideSchema = null;
      cachedOverrideSchemaAt = 0;
      clearOverrideCache();
      folderCache.clear();
      photoReferences.clear();
      discoveredModelCounts.clear();
      modelDiscoveryProgress.clear();
      latestDiagnostics = [];
    }
  };
}

module.exports = {
  createPhotoLibraryService,
  findSuppressionColumn,
  findOverrideColumn,
  normalizeEngineName,
  classifyFreight,
  encodePhotoKey,
  decodeCursor,
  encodeCursor
};
