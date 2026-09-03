'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { isMobileLoadEligibleForRoster } = require('../mobile-home');
const {
  cleanMobilePaperworkDocuments,
  createMobilePaperworkService,
  findMobilePaperworkDocument
} = require('../mobile-paperwork');

function makeLoad(id, truck = '42') {
  return {
    id,
    fields: {
      Status: 'Won',
      Truck_x0020_Number: truck,
      Processed: false,
      FinalSettleSent: false
    }
  };
}

function makePdf(id, name) {
  return {
    id,
    name,
    file: { mimeType: 'application/pdf' },
    lastModifiedDateTime: '2026-09-03T12:00:00Z'
  };
}

function createTestService() {
  const loads = new Map([
    ['101', makeLoad('101', '42')],
    ['202', makeLoad('202', '77')]
  ]);
  const folders = new Map([
    ['101', {
      items: [
        makePdf('doc-a', 'Customer BOL.pdf'),
        {
          id: 'image-a',
          name: 'Delivery Photo.jpg',
          file: { mimeType: 'image/jpeg' }
        }
      ]
    }],
    ['202', { items: [makePdf('doc-b', 'Other Driver BOL.pdf')] }]
  ]);
  const content = Symbol('pdf-stream');
  let contentReads = 0;
  const accessChecks = [];

  const service = createMobilePaperworkService({
    getAccessibleLoad: async ({ driver, loadId, forceRefresh }) => {
      accessChecks.push({ driver, loadId, forceRefresh });
      const load = loads.get(loadId);
      return load && isMobileLoadEligibleForRoster(driver, load) ? { selectedItem: load } : null;
    },
    resolvePaperworkContext: async ({ loadId }) => folders.get(loadId),
    getDocumentContent: async () => {
      contentReads += 1;
      return content;
    }
  });

  return {
    accessChecks,
    content,
    folders,
    getContentReads: () => contentReads,
    loads,
    service
  };
}

test('mobile metadata contains only allowed PDFs and public fields', () => {
  const documents = cleanMobilePaperworkDocuments([
    makePdf('pdf-1', 'Packing List.pdf'),
    {
      id: 'wrong-mime',
      name: 'Instructions.pdf',
      file: { mimeType: 'application/octet-stream' }
    },
    {
      id: 'wrong-extension',
      name: 'Instructions.docx',
      file: { mimeType: 'application/pdf' }
    },
    {
      id: 'image',
      name: 'Photo.jpg',
      file: { mimeType: 'image/jpeg' }
    }
  ]);

  assert.deepEqual(documents, [
    { id: 'pdf-1', name: 'Packing List.pdf', type: 'application/pdf' }
  ]);
  assert.equal(Object.hasOwn(documents[0], 'webUrl'), false);
  assert.equal(Object.hasOwn(documents[0], 'size'), false);
});

test('assigned driver can list and open paperwork for an accessible load', async () => {
  const harness = createTestService();
  const driver = { id: 'driver-42', truck: '42' };

  const listing = await harness.service.list({ driver, loadId: '101' });
  assert.deepEqual(listing.documents, [
    { id: 'doc-a', name: 'Customer BOL.pdf', type: 'application/pdf' }
  ]);

  const opened = await harness.service.open({
    driver,
    loadId: '101',
    documentId: 'doc-a'
  });
  assert.equal(opened.content, harness.content);
  assert.equal(opened.document.name, 'Customer BOL.pdf');
  assert.equal(harness.getContentReads(), 1);
  assert.equal(harness.accessChecks.every((check) => check.forceRefresh === true), true);
});

test('another driver cannot list paperwork for an assigned load', async () => {
  const harness = createTestService();

  await assert.rejects(
    harness.service.list({ driver: { truck: '77' }, loadId: '101' }),
    { code: 'MOBILE_PAPERWORK_LOAD_NOT_AVAILABLE', statusCode: 404 }
  );
});

test('a document ID from another load cannot cross the authorized folder boundary', async () => {
  const harness = createTestService();

  await assert.rejects(
    harness.service.open({
      driver: { truck: '42' },
      loadId: '101',
      documentId: 'doc-b'
    }),
    { code: 'MOBILE_PAPERWORK_DOCUMENT_NOT_AVAILABLE', statusCode: 404 }
  );
  assert.equal(harness.getContentReads(), 0);
});

test('stale load access is checked again before document content is read', async () => {
  const harness = createTestService();
  const driver = { truck: '42' };

  await harness.service.list({ driver, loadId: '101' });
  harness.loads.get('101').fields.Processed = true;

  await assert.rejects(
    harness.service.open({ driver, loadId: '101', documentId: 'doc-a' }),
    { code: 'MOBILE_PAPERWORK_LOAD_NOT_AVAILABLE', statusCode: 404 }
  );
  assert.equal(harness.getContentReads(), 0);
});

test('document lookup rejects non-PDF files even when the ID matches', () => {
  assert.equal(
    findMobilePaperworkDocument([
      { id: 'image', name: 'Photo.jpg', file: { mimeType: 'image/jpeg' } }
    ], 'image'),
    null
  );
});

test('a missing paperwork folder is an empty list but not an openable document', async () => {
  const missingContextError = Object.assign(new Error('missing'), {
    code: 'LOAD_PAPERWORK_FOLDER_NOT_FOUND',
    statusCode: 404
  });
  const service = createMobilePaperworkService({
    getAccessibleLoad: async () => ({ selectedItem: makeLoad('101') }),
    resolvePaperworkContext: async () => { throw missingContextError; },
    getDocumentContent: async () => {
      throw new Error('Content should not be read.');
    }
  });

  assert.deepEqual(
    await service.list({ driver: { truck: '42' }, loadId: '101' }),
    { loadId: '101', documents: [] }
  );
  await assert.rejects(
    service.open({ driver: { truck: '42' }, loadId: '101', documentId: 'doc-a' }),
    { code: 'MOBILE_PAPERWORK_DOCUMENT_NOT_AVAILABLE', statusCode: 404 }
  );
});
