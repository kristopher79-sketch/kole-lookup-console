'use strict';

const MOBILE_PAPERWORK_EMPTY_CONTEXT_CODES = new Set([
  'LOAD_PAPERWORK_BOL_NOT_AVAILABLE',
  'LOAD_PAPERWORK_TMS_NAME_NOT_AVAILABLE',
  'LOAD_PAPERWORK_TMS_FOLDER_NOT_FOUND',
  'LOAD_PAPERWORK_FOLDER_NOT_FOUND'
]);

function createMobilePaperworkError(message, statusCode = 500, code = '') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function validateMobilePaperworkLoadId(value) {
  const loadId = String(value || '').trim();

  if (!/^\d{1,12}$/.test(loadId)) {
    throw createMobilePaperworkError(
      'The requested load is invalid.',
      400,
      'MOBILE_PAPERWORK_INVALID_LOAD_ID'
    );
  }

  return loadId;
}

function validateMobilePaperworkDocumentId(value) {
  const documentId = String(value || '').trim();

  if (
    !documentId ||
    documentId.length > 256 ||
    /[\u0000-\u001f\u007f/\\]/.test(documentId)
  ) {
    throw createMobilePaperworkError(
      'The requested paperwork is invalid.',
      400,
      'MOBILE_PAPERWORK_INVALID_DOCUMENT_ID'
    );
  }

  return documentId;
}

function isAllowedMobilePaperworkPdf(item = {}) {
  const id = String(item.id || '').trim();
  const name = String(item.name || '').trim();
  const mimeType = String(item.file?.mimeType || '').trim().toLowerCase();

  return Boolean(
    item.file &&
    id &&
    name &&
    /\.pdf$/i.test(name) &&
    mimeType === 'application/pdf'
  );
}

function compareMobilePaperworkDocuments(left, right) {
  const leftIsDispatchSheet = /dispatch\s*sheet/i.test(String(left.name || ''));
  const rightIsDispatchSheet = /dispatch\s*sheet/i.test(String(right.name || ''));

  if (leftIsDispatchSheet !== rightIsDispatchSheet) {
    return leftIsDispatchSheet ? -1 : 1;
  }

  const modifiedDifference =
    (Date.parse(right.lastModifiedDateTime || '') || 0) -
    (Date.parse(left.lastModifiedDateTime || '') || 0);

  if (modifiedDifference !== 0) return modifiedDifference;

  return String(left.name || '').localeCompare(
    String(right.name || ''),
    undefined,
    { numeric: true, sensitivity: 'base' }
  );
}

function cleanMobilePaperworkDocuments(items = []) {
  return (items || [])
    .filter(isAllowedMobilePaperworkPdf)
    .sort(compareMobilePaperworkDocuments)
    .map((item) => ({
      id: String(item.id),
      name: String(item.name),
      type: 'application/pdf'
    }));
}

function findMobilePaperworkDocument(items, documentId) {
  const normalizedDocumentId = validateMobilePaperworkDocumentId(documentId);

  return (items || []).find((item) => (
    isAllowedMobilePaperworkPdf(item) &&
    String(item.id) === normalizedDocumentId
  )) || null;
}

function isEmptyMobilePaperworkContextError(error) {
  return MOBILE_PAPERWORK_EMPTY_CONTEXT_CODES.has(String(error?.code || ''));
}

function getMobilePaperworkErrorResponse(error, action = 'list') {
  const statusCode = Number(error?.statusCode);

  if (statusCode >= 400 && statusCode < 500) {
    return {
      status: statusCode,
      code: String(error?.code || 'MOBILE_PAPERWORK_REQUEST_FAILED'),
      message: String(error?.message || 'That paperwork is not available.')
    };
  }

  return {
    status: statusCode === 503 ? 503 : 502,
    code: action === 'open'
      ? 'MOBILE_PAPERWORK_OPEN_FAILED'
      : 'MOBILE_PAPERWORK_LIST_FAILED',
    message: action === 'open'
      ? 'This paperwork could not be opened right now.'
      : 'Paperwork could not be loaded right now.'
  };
}

function createMobilePaperworkService({
  getAccessibleLoad,
  resolvePaperworkContext,
  getDocumentContent
} = {}) {
  if (typeof getAccessibleLoad !== 'function') {
    throw new TypeError('A Mobile load-access resolver is required.');
  }
  if (typeof resolvePaperworkContext !== 'function') {
    throw new TypeError('A Mobile paperwork resolver is required.');
  }
  if (typeof getDocumentContent !== 'function') {
    throw new TypeError('A Mobile paperwork content reader is required.');
  }

  async function assertAccessibleLoad({ driver, loadId, context }) {
    const normalizedLoadId = validateMobilePaperworkLoadId(loadId);
    const access = await getAccessibleLoad({
      driver,
      loadId: normalizedLoadId,
      context,
      forceRefresh: true
    });

    if (!access) {
      throw createMobilePaperworkError(
        'That load is not available for this Mobile session.',
        404,
        'MOBILE_PAPERWORK_LOAD_NOT_AVAILABLE'
      );
    }

    return { access, loadId: normalizedLoadId };
  }

  async function list({ driver, loadId, context } = {}) {
    const authorized = await assertAccessibleLoad({ driver, loadId, context });
    let paperworkContext;

    try {
      paperworkContext = await resolvePaperworkContext({
        ...authorized,
        driver,
        context
      });
    } catch (error) {
      if (isEmptyMobilePaperworkContextError(error)) {
        return { loadId: authorized.loadId, documents: [] };
      }
      throw error;
    }

    return {
      loadId: authorized.loadId,
      documents: cleanMobilePaperworkDocuments(paperworkContext.items)
    };
  }

  async function open({ driver, loadId, documentId, context } = {}) {
    const normalizedDocumentId = validateMobilePaperworkDocumentId(documentId);
    const authorized = await assertAccessibleLoad({ driver, loadId, context });
    let paperworkContext;

    try {
      paperworkContext = await resolvePaperworkContext({
        ...authorized,
        driver,
        context
      });
    } catch (error) {
      if (isEmptyMobilePaperworkContextError(error)) {
        throw createMobilePaperworkError(
          'That paperwork is not available for this load.',
          404,
          'MOBILE_PAPERWORK_DOCUMENT_NOT_AVAILABLE'
        );
      }
      throw error;
    }

    const document = findMobilePaperworkDocument(
      paperworkContext.items,
      normalizedDocumentId
    );

    if (!document) {
      throw createMobilePaperworkError(
        'That paperwork is not available for this load.',
        404,
        'MOBILE_PAPERWORK_DOCUMENT_NOT_AVAILABLE'
      );
    }

    const content = await getDocumentContent({
      ...authorized,
      driver,
      document,
      paperworkContext,
      context
    });

    return {
      document: {
        id: String(document.id),
        name: String(document.name),
        type: 'application/pdf'
      },
      content
    };
  }

  return { list, open };
}

module.exports = {
  cleanMobilePaperworkDocuments,
  createMobilePaperworkError,
  createMobilePaperworkService,
  findMobilePaperworkDocument,
  getMobilePaperworkErrorResponse,
  isAllowedMobilePaperworkPdf,
  validateMobilePaperworkDocumentId,
  validateMobilePaperworkLoadId
};
