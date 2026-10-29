require('dotenv').config({ quiet: true });

const { createPhotoLibraryService } = require('./photo-library-service');

async function getGraphToken() {
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(process.env.TENANT_ID)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials'
    })
  });
  if (!response.ok) throw new Error(`Graph token request failed (${response.status}).`);
  return (await response.json()).access_token;
}

async function graphRequest(token, url, method = 'GET', body, extraHeaders = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...extraHeaders
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Graph ${method} request failed (${response.status}).`);
  return data;
}

const graphGet = (token, url) => graphRequest(token, url);
const graphPatch = (token, url, body, headers) => graphRequest(token, url, 'PATCH', body, headers);
const graphPost = (token, url, body) => graphRequest(token, url, 'POST', body);

function createService() {
  return createPhotoLibraryService({
    graphGet,
    graphPatch,
    graphPost,
    getGraphToken,
    getSiteId: () => process.env.KOLE_SHAREPOINT_SITE_ID || process.env.SITE_ID || '',
    getListId: () => process.env.PHOTO_LIBRARY_LIST_ID || '4f05fa77-918f-4529-93ed-b633ddd7341d',
    getOverridesListId: () => process.env.PHOTO_LIBRARY_OVERRIDES_LIST_ID || 'efbff622-9bd6-4221-b66b-75711f562f27',
    getDriveId: () => process.env.DISPATCH_ONEDRIVE_ID || '',
    getRootFolderId: () => process.env.LOAD_PICTURES_FOLDER_ID || process.env.LOAD_PHOTOS_FOLDER_ID || process.env.LOAD_PICTURES_AND_BOLS_FOLDER_ID || ''
  });
}

async function main() {
  const firstService = createService();
  let selected = [];
  try {
    const page = await firstService.listPhotoPage({ model: 'cfm56', shipmentLimit: 2 });
    const firstShipment = page.items[0]?.shipmentId;
    const sameShipment = page.items.filter((photo) => photo.shipmentId === firstShipment).slice(0, 2);
    const differentShipment = page.items.find((photo) => photo.shipmentId !== firstShipment);
    selected = [...sameShipment, ...(differentShipment ? [differentShipment] : [])];
    if (selected.length !== 3) throw new Error('The live test could not select three photographs across two shipments.');

    const firstRepeated = await Promise.all([
      firstService.setPhotoHidden(selected[0].id, true),
      firstService.setPhotoHidden(selected[0].id, true)
    ]);
    await Promise.all(selected.slice(1).map((photo) => firstService.setPhotoHidden(photo.id, true)));
    const ordinaryAfterHide = await firstService.listPhotoPage({ model: 'cfm56', shipmentLimit: 2 });

    const restartedService = createService();
    const hiddenAfterRestart = await restartedService.listPhotoPage({ model: 'cfm56', visibility: 'hidden', shipmentLimit: 2 });
    const selectedIds = new Set(selected.map((photo) => photo.id));
    const hiddenIds = new Set(hiddenAfterRestart.items.map((photo) => photo.id));
    const allPersisted = [...selectedIds].every((id) => hiddenIds.has(id));
    const allExcludedNormally = ordinaryAfterHide.items.every((photo) => !selectedIds.has(photo.id));

    await Promise.all(hiddenAfterRestart.items
      .filter((photo) => selectedIds.has(photo.id))
      .map((photo) => restartedService.setPhotoHidden(photo.id, false)));
    const ordinaryAfterRestore = await restartedService.listPhotoPage({ model: 'cfm56', shipmentLimit: 2 });
    const restoredIds = new Set(ordinaryAfterRestore.items.map((photo) => photo.id));
    const allRestored = [...selectedIds].every((id) => restoredIds.has(id));
    const overrides = await restartedService.getOverrides({ forceRefresh: true });
    const selectedRecords = [...overrides.byPhotoKey.values()].flat().filter((record) => selected.some((photo) => photo.shipment.bidId === record.bidId));

    process.stdout.write(JSON.stringify({
      testedPhotoCount: selected.length,
      testedShipmentCount: new Set(selected.map((photo) => photo.shipmentId)).size,
      repeatedHideRecordCounts: firstRepeated.map((result) => result.overrideRecordCount),
      allExcludedNormally,
      allPersistedAfterServiceRestart: allPersisted,
      allRestored,
      selectedOverrideRecordsHidden: selectedRecords.map((record) => record.hidden),
      oneDriveWritesPerformed: 0
    }, null, 2));
  } finally {
    await Promise.all(selected.map((photo) => firstService.setPhotoHidden(photo.id, false).catch(() => null)));
  }
}

main().catch((error) => {
  process.stderr.write(error.message);
  process.exitCode = 1;
});
