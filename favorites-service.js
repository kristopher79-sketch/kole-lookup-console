const FAVORITES_CACHE_MS = 30 * 1000;
const SCHEMA_CACHE_MS = 5 * 60 * 1000;

function cleanText(value) {
  return String(value ?? '').trim();
}

function normalize(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function parseBoolean(value) {
  const normalized = normalize(value);
  return value === true || normalized === 'true' || normalized === 'yes' || normalized === '1';
}

function createFavoriteError(message, statusCode = 500, code = 'PHOTO_FAVORITE_ERROR') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.safeForClient = true;
  return error;
}

function findFavoriteColumn(columns, expectedName, type) {
  const expected = normalize(expectedName);
  const candidates = (columns || []).filter((column) =>
    !column?.readOnly && !column?.hidden &&
    (normalize(column?.name) === expected || normalize(column?.displayName) === expected)
  );
  const exact = candidates.find((column) => normalize(column?.name) === expected);
  const column = exact || (candidates.length === 1 ? candidates[0] : null);
  const typeMatches = type === 'boolean' ? Boolean(column?.boolean) : Boolean(column?.text);
  if (!column || !typeMatches) {
    return {
      verified: false,
      message: `The Photo Reference Favorites ${expectedName} column is missing, ambiguous, read-only, or has the wrong type.`
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

function createFavoritesService(dependencies) {
  const {
    graphGet,
    getGraphToken,
    getSiteId,
    getListId,
    normalizeEngineName,
    photoLibraryService
  } = dependencies;

  let cachedSchema = null;
  let cachedSchemaAt = 0;
  let cachedFavorites = null;
  let cachedFavoritesAt = 0;

  function getConfiguration() {
    const siteId = cleanText(getSiteId());
    const listId = cleanText(getListId());
    if (!siteId || !listId) {
      throw createFavoriteError('Photo favorites server configuration is incomplete.', 503, 'PHOTO_FAVORITES_NOT_CONFIGURED');
    }
    return { siteId, listId };
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

  async function getSchema(options = {}) {
    const now = Date.now();
    if (!options.forceRefresh && cachedSchema && now - cachedSchemaAt < SCHEMA_CACHE_MS) return cachedSchema;
    const { siteId, listId } = getConfiguration();
    const token = await getGraphToken();
    const columns = await getAllPages(token,
      `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(siteId)}` +
      `/lists/${encodeURIComponent(listId)}/columns` +
      '?$select=id,name,displayName,required,hidden,readOnly,enforceUniqueValues,indexed,boolean,text&$top=999'
    );
    const fields = {
      photoKey: findFavoriteColumn(columns, 'Title', 'text'),
      bidId: findFavoriteColumn(columns, 'BidID', 'text'),
      engineType: findFavoriteColumn(columns, 'EngineType', 'text'),
      favorite: findFavoriteColumn(columns, 'Favorite', 'boolean')
    };
    cachedSchema = {
      checkedAt: new Date().toISOString(),
      verified: Object.values(fields).every((field) => field.verified),
      fields,
      uniquenessEnforced: fields.photoKey.enforceUniqueValues === true
    };
    cachedSchemaAt = now;
    return cachedSchema;
  }

  function requireVerifiedSchema(schema) {
    if (schema?.verified) return;
    const failed = Object.values(schema?.fields || {}).find((field) => !field.verified);
    throw createFavoriteError(
      failed?.message || 'The Photo Reference Favorites schema could not be verified.',
      503,
      'PHOTO_FAVORITES_SCHEMA_UNVERIFIED'
    );
  }

  function clearCache() {
    cachedFavorites = null;
    cachedFavoritesAt = 0;
  }

  async function getFavorites(options = {}) {
    const now = Date.now();
    if (!options.forceRefresh && cachedFavorites && now - cachedFavoritesAt < FAVORITES_CACHE_MS) return cachedFavorites;
    const configuration = getConfiguration();
    const schema = await getSchema(options);
    requireVerifiedSchema(schema);
    const token = await getGraphToken();
    const titleField = schema.fields.photoKey.internalName;
    const bidIdField = schema.fields.bidId.internalName;
    const engineTypeField = schema.fields.engineType.internalName;
    const favoriteField = schema.fields.favorite.internalName;
    const fieldSelect = [titleField, bidIdField, engineTypeField, favoriteField].map(encodeURIComponent).join(',');
    const items = await getAllPages(token,
      `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(configuration.siteId)}` +
      `/lists/${encodeURIComponent(configuration.listId)}/items` +
      `?$expand=fields($select=${fieldSelect})&$select=id,fields&$top=200`
    );
    const byPhotoKey = new Map();
    const invalidFavorites = [];
    for (const item of items) {
      const photoKey = cleanText(item?.fields?.[titleField]);
      const record = {
        id: cleanText(item.id),
        photoKey,
        bidId: cleanText(item?.fields?.[bidIdField]),
        engineType: cleanText(item?.fields?.[engineTypeField]),
        favorite: parseBoolean(item?.fields?.[favoriteField])
      };
      if (!photoKey) {
        if (record.favorite) invalidFavorites.push(record);
        continue;
      }
      byPhotoKey.set(photoKey, [...(byPhotoKey.get(photoKey) || []), record]);
    }
    cachedFavorites = { byPhotoKey, invalidFavorites, recordCount: items.length, schema };
    cachedFavoritesAt = now;
    return cachedFavorites;
  }

  async function listEngineOptions() {
    const favorites = await getFavorites({ forceRefresh: true });
    const options = new Map();
    for (const [photoKey, records] of favorites.byPhotoKey.entries()) {
      const active = records.filter((record) => record.favorite);
      for (const record of active) {
        const engine = normalizeEngineName(record.engineType);
        if (!engine) continue;
        const current = options.get(engine.key) || {
          id: engine.key,
          name: engine.display,
          photoKeys: new Set()
        };
        current.photoKeys.add(photoKey);
        options.set(engine.key, current);
      }
    }
    return [...options.values()]
      .map((engine) => ({ id: engine.id, name: engine.name, favoriteCount: engine.photoKeys.size }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async function listPhotoPage(options = {}) {
    const requestedEngine = normalizeEngineName(options.model);
    if (!requestedEngine) {
      throw createFavoriteError('Choose a valid engine type.', 400, 'PHOTO_FAVORITE_ENGINE_INVALID');
    }
    const [favorites, catalog, overrides] = await Promise.all([
      getFavorites({ forceRefresh: true }),
      photoLibraryService.getCatalog({ forceRefresh: true }),
      photoLibraryService.getOverrides({ forceRefresh: true })
    ]);
    const shipments = new Map(catalog.shipments.map((shipment) => [shipment.bidId, shipment]));
    const records = [];
    const diagnostics = [];
    for (const group of favorites.byPhotoKey.values()) {
      const active = group.filter((record) => record.favorite);
      const matching = active.filter((record) => {
        const shipment = shipments.get(record.bidId);
        return shipment?.engineKey === requestedEngine.key ||
          normalizeEngineName(record.engineType)?.key === requestedEngine.key;
      });
      if (!matching.length) continue;
      if (new Set(active.map((record) => record.bidId)).size !== 1) {
        diagnostics.push({ code: 'FAVORITE_RECORD_CONFLICT' });
        continue;
      }
      if (shipments.get(matching[0].bidId)?.engineKey !== requestedEngine.key) {
        diagnostics.push({ code: 'FAVORITE_SHIPMENT_UNAVAILABLE' });
        continue;
      }
      records.push(matching[0]);
    }
    const resolved = await photoLibraryService.resolvePhotoRecords(records, { catalog, overrides });
    diagnostics.push(...resolved.diagnostics);
    if (favorites.invalidFavorites.length) {
      diagnostics.push({ code: 'FAVORITE_PHOTO_KEY_INVALID', count: favorites.invalidFavorites.length });
    }
    const items = resolved.items
      .map((photo) => ({ ...photo, favorite: true }))
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt) || a.id.localeCompare(b.id));
    return { engine: { id: requestedEngine.key, name: requestedEngine.display }, items, diagnostics };
  }

  return {
    getSchema,
    getFavorites,
    listEngineOptions,
    listPhotoPage,
    clearCache
  };
}

module.exports = {
  createFavoritesService,
  findFavoriteColumn
};
