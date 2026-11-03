const test = require('node:test');
const assert = require('node:assert/strict');
const { createFavoritesService, findFavoriteColumn } = require('../favorites-service');
const { normalizeEngineName } = require('../photo-library-service');

const FAVORITE_COLUMNS = [
  ['Title', 'text'],
  ['BidID', 'text'],
  ['EngineType', 'text'],
  ['Favorite', 'boolean']
].map(([name, type]) => ({ name, displayName: name, [type]: {}, readOnly: false, hidden: false }));

test('findFavoriteColumn requires the expected writable SharePoint type', () => {
  assert.equal(findFavoriteColumn(FAVORITE_COLUMNS, 'EngineType', 'text').internalName, 'EngineType');
  assert.equal(findFavoriteColumn(FAVORITE_COLUMNS, 'Favorite', 'boolean').internalName, 'Favorite');
  assert.equal(findFavoriteColumn(FAVORITE_COLUMNS, 'Favorite', 'text').verified, false);
});

test('favorites service lists engine choices and resolves only active favorites', async () => {
  const records = [
    { id: '1', fields: { Title: 'photo-a', BidID: 'BID-1', EngineType: 'NEO', Favorite: true } },
    { id: '2', fields: { Title: 'photo-b', BidID: 'BID-1', EngineType: 'PW1100', Favorite: true } },
    { id: '3', fields: { Title: 'photo-c', BidID: 'BID-1', EngineType: 'PW1100', Favorite: false } }
  ];
  const resolvedRecords = [];
  const service = createFavoritesService({
    graphGet: async (_token, url) => ({ value: url.includes('/columns') ? FAVORITE_COLUMNS : records }),
    getGraphToken: async () => 'test-token',
    getSiteId: () => 'test-site',
    getListId: () => 'test-list',
    normalizeEngineName,
    photoLibraryService: {
      getCatalog: async () => ({
        shipments: [{ bidId: 'BID-1', engineKey: 'pw1100' }]
      }),
      getOverrides: async () => ({ byPhotoKey: new Map() }),
      resolvePhotoRecords: async (selected) => {
        resolvedRecords.push(...selected);
        return {
          items: selected.map((record, index) => ({
            id: `opaque-${index}`,
            capturedAt: `2026-10-${20 + index}T12:00:00Z`
          })),
          diagnostics: []
        };
      }
    }
  });

  assert.deepEqual(await service.listEngineOptions(), [
    { id: 'pw1100', name: 'PW1100', favoriteCount: 2 }
  ]);

  const page = await service.listPhotoPage({ model: 'pw1100' });
  assert.equal(page.engine.id, 'pw1100');
  assert.equal(page.items.length, 2);
  assert.deepEqual(resolvedRecords.map((record) => record.photoKey).sort(), ['photo-a', 'photo-b']);
  assert.ok(page.items.every((photo) => photo.favorite));
});
