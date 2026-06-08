require('dotenv').config();

const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 5000;

const ARCHIVE_YEAR_MIN = 2024;
const ARCHIVE_YEAR_MAX = 2030;
const DEFAULT_UPLOAD_DIGEST_LIST_ID = 'c9e907f9-cdac-4657-9da6-cc6ecfaa19a8';
const DEFAULT_SALES_LEADS_LIST_ID = '86cc3352-fb75-421d-a5e4-4b16d011fd1e';

function getLoadPicturesFolderId() {
  return (
    process.env.LOAD_PICTURES_FOLDER_ID ||
    process.env.LOAD_PHOTOS_FOLDER_ID ||
    process.env.LOAD_PICTURES_AND_BOLS_FOLDER_ID ||
    ''
  );
}


let cachedBidLists = null;
let cachedBidListsAt = 0;
const BID_LIST_CACHE_MS = 5 * 60 * 1000;

function getAllowedLookupTokens() {
  return [
    process.env.LOOKUP_ACCESS_TOKEN,
    ...(String(process.env.ADDITIONAL_LOOKUP_ACCESS_TOKENS || '')
      .split(',')
      .map((token) => token.trim()))
  ].filter(Boolean);
}

function getLookupTokenFromRequest(req) {
  const directToken = req.headers['x-lookup-token'];
  if (directToken) return String(directToken).trim();

  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function requireLookupAccess(req, res, next) {
  const allowedTokens = getAllowedLookupTokens();
  const token = getLookupTokenFromRequest(req);

  if (allowedTokens.length === 0) {
    return res.status(500).json({
      success: false,
      error: 'Lookup access token is not configured on the server.'
    });
  }

  if (!token || !allowedTokens.includes(token)) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or missing lookup access token.'
    });
  }

  next();
}

async function getGraphToken() {
  if (!process.env.TENANT_ID || !process.env.CLIENT_ID || !process.env.CLIENT_SECRET) {
    throw new Error('Graph client credentials are not configured on the server.');
  }

  const body = new URLSearchParams({
    client_id: process.env.CLIENT_ID,
    client_secret: process.env.CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials'
  });

  const response = await fetch(
    `https://login.microsoftonline.com/${process.env.TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error_description || data.error || 'Unable to acquire Graph token.');
  }

  return data.access_token;
}

async function graphGet(token, url) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(JSON.stringify(data));
  }

  return data;
}

async function getAllChildrenFromFolder(token, driveId, folderId) {
  let url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folderId}/children?$select=id,name,webUrl,file,folder,lastModifiedDateTime&$top=999`;
  const allItems = [];

  while (url) {
    const data = await graphGet(token, url);
    allItems.push(...(data.value || []));
    url = data['@odata.nextLink'] || null;
  }

  return allItems;
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeSearchValue(value) {
  return normalizeText(value)
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactSearchValue(value) {
  return normalizeSearchValue(value).replace(/\s+/g, '');
}

function parseBoolean(value) {
  const normalized = normalizeText(value);

  return (
    value === true ||
    normalized === 'true' ||
    normalized === 'yes' ||
    normalized === '1'
  );
}

function getNameParts(value) {
  const normalized = normalizeSearchValue(value);
  if (!normalized) return [];

  return normalized
    .split(' ')
    .map((part) => part.trim())
    .filter(Boolean);
}

function getLikelyLastName(value) {
  const parts = getNameParts(value);
  if (parts.length === 0) return '';
  return parts[parts.length - 1];
}

function isExactBolSearch(value) {
  return /^[a-z]\d{6}$/i.test(String(value || '').trim());
}

function isLikelyTruckSearch(value) {
  return /^[a-z0-9-]{1,10}$/i.test(String(value || '').trim());
}

function getSourceSortValue(item) {
  if (!item.SourceYear || item.SourceYear === 'Current') return 9999;

  const year = Number(item.SourceYear);
  return Number.isNaN(year) ? 0 : year;
}

function getBolSortValue(item) {
  const bol = String(item.BOL || '').trim().toUpperCase();
  const match = bol.match(/[A-Z](\d{6})/);
  if (!match) return 0;
  return Number(match[1]) || 0;
}

function getPickupSortValue(item) {
  if (!item.PickupDate) return 0;

  const date = new Date(item.PickupDate);
  const time = date.getTime();

  return Number.isNaN(time) ? 0 : time;
}

function compareRecordsDefault(a, b) {
  const sourceDiff = getSourceSortValue(b) - getSourceSortValue(a);
  if (sourceDiff !== 0) return sourceDiff;

  const bolDiff = getBolSortValue(b) - getBolSortValue(a);
  if (bolDiff !== 0) return bolDiff;

  const pickupDiff = getPickupSortValue(b) - getPickupSortValue(a);
  if (pickupDiff !== 0) return pickupDiff;

  return String(a.Customer || '').localeCompare(String(b.Customer || ''));
}

function getSearchScore(item, rawQuery) {
  const query = normalizeSearchValue(rawQuery);
  const queryCompact = compactSearchValue(rawQuery);

  if (!query) return 0;

  const bol = normalizeSearchValue(item.BOL);
  const bidId = normalizeSearchValue(item.BidID);
  const customer = normalizeSearchValue(item.Customer);
  const truck = normalizeSearchValue(item.Truck);
  const operator = normalizeSearchValue(item.Driver);
  const tmsName = normalizeSearchValue(item.TMSName);

  const operatorCompact = compactSearchValue(item.Driver);
  const tmsCompact = compactSearchValue(item.TMSName);

  const operatorLast = getLikelyLastName(item.Driver);
  const tmsLast = getLikelyLastName(item.TMSName);

  let score = 0;

  if (bol && bol === query) score += 1000;
  else if (bol && bol.startsWith(query)) score += 850;
  else if (bol && bol.includes(query)) score += 700;

  if (bidId && bidId === query) score += 750;
  else if (bidId && bidId.startsWith(query)) score += 600;
  else if (bidId && bidId.includes(query)) score += 450;

  if (truck && truck === query) score += 700;
  else if (truck && truck.startsWith(query)) score += 550;
  else if (truck && truck.includes(query) && isLikelyTruckSearch(rawQuery)) score += 350;

  if (customer && customer === query) score += 650;
  else if (customer && customer.startsWith(query)) score += 500;
  else if (customer && customer.includes(query)) score += 325;

  if (operator && operator === query) score += 625;
  else if (operatorLast && operatorLast === query) score += 575;
  else if (operator && operator.startsWith(query)) score += 450;
  else if (operator && operator.includes(query)) score += 300;
  else if (operatorCompact && queryCompact && operatorCompact.includes(queryCompact)) score += 275;

  if (tmsName && tmsName === query) score += 625;
  else if (tmsLast && tmsLast === query) score += 575;
  else if (tmsName && tmsName.startsWith(query)) score += 450;
  else if (tmsName && tmsName.includes(query)) score += 300;
  else if (tmsCompact && queryCompact && tmsCompact.includes(queryCompact)) score += 275;

  if (isExactBolSearch(rawQuery) && bol !== query) {
    score = Math.min(score, 250);
  }

  return score;
}

function searchAndRankRecords(records, rawQuery) {
  return records
    .map((item) => ({
      ...item,
      SearchScore: getSearchScore(item, rawQuery)
    }))
    .filter((item) => item.SearchScore > 0)
    .sort((a, b) => {
      const scoreDiff = b.SearchScore - a.SearchScore;
      if (scoreDiff !== 0) return scoreDiff;

      return compareRecordsDefault(a, b);
    })
    .map(({ SearchScore, ...item }) => item);
}

function findBestBolMatch(items, bol, bidId) {
  const cleanBol = normalizeText(bol);
  const cleanBidId = normalizeText(bidId);

  if (!cleanBol) return null;

  const files = items.filter((item) => item.file);

  if (cleanBidId) {
    const exactMatch = files.find((item) => {
      const name = normalizeText(item.name);
      return name.includes(cleanBol) && name.includes(cleanBidId);
    });

    if (exactMatch) return exactMatch;
  }

  return files.find((item) => normalizeText(item.name).includes(cleanBol)) || null;
}

function findBestFinalSettleMatch(items, bol) {
  const cleanBol = normalizeText(bol);

  if (!cleanBol) return null;

  const files = items.filter((item) => item.file);

  const exactMatch = files.find((item) => {
    const name = normalizeText(item.name);
    return name.includes('finalsettle') && name.includes(cleanBol);
  });

  if (exactMatch) return exactMatch;

  return files.find((item) => normalizeText(item.name).includes(cleanBol)) || null;
}

function findBestDispatchSheetMatch(items, bol) {
  const cleanBol = normalizeText(bol);

  if (!cleanBol) return null;

  const files = items.filter((item) => item.file);

  const exactMatch = files.find((item) => {
    const name = normalizeText(item.name);
    return name.includes('dispatchsheet') && name.includes(cleanBol);
  });

  if (exactMatch) return exactMatch;

  return files.find((item) => normalizeText(item.name).includes(cleanBol)) || null;
}

function findFolderByExactName(items, folderName) {
  const target = normalizeSearchValue(folderName);

  if (!target) return null;

  return (
    items.find((item) => item.folder && normalizeSearchValue(item.name) === target) ||
    null
  );
}

function findFolderByBolPrefix(items, bol) {
  const cleanBol = normalizeText(bol);

  if (!cleanBol) return null;

  return (
    items.find((item) => {
      const name = normalizeText(item.name);
      return item.folder && name.startsWith(cleanBol);
    }) || null
  );
}

function findUploadTypeFolder(items, uploadType) {
  const target = normalizeText(uploadType);

  if (!target) return null;

  const folderItems = items.filter((item) => item.folder);

  return (
    folderItems.find((item) => normalizeText(item.name) === target) ||
    folderItems.find((item) => normalizeText(item.name).startsWith(target)) ||
    folderItems.find((item) => normalizeText(item.name).includes(target)) ||
    null
  );
}

function getDriverHintFromCompositeKey(compositeKey, bol) {
  const rawKey = String(compositeKey || '').trim();
  const rawBol = String(bol || '').trim();

  if (!rawKey || !rawBol) return '';

  const keyLower = rawKey.toLowerCase();
  const bolLower = rawBol.toLowerCase();
  const bolIndex = keyLower.indexOf(bolLower);

  if (bolIndex <= 0) return '';

  return rawKey.slice(0, bolIndex).trim();
}

function uniqueNonEmpty(values) {
  const seen = new Set();
  const output = [];

  values.forEach((value) => {
    const clean = String(value || '').trim();
    const key = normalizeSearchValue(clean);

    if (!key || seen.has(key)) return;

    seen.add(key);
    output.push(clean);
  });

  return output;
}

async function findLoadPhotoFolderForBol(token, bol, options = {}) {
  const loadPicturesFolderId = getLoadPicturesFolderId();

  const rootItems = await getAllChildrenFromFolder(
    token,
    process.env.DISPATCH_ONEDRIVE_ID,
    loadPicturesFolderId
  );

  const inactiveFolder = findFolderByExactName(rootItems, 'Inactive');
  const candidateDrivers = uniqueNonEmpty(options.candidateDrivers || []);
  const preferInactive = parseBoolean(options.operatorInactive);
  const activeDriverFolders = rootItems.filter((item) => item.folder && normalizeSearchValue(item.name) !== 'inactive');

  const scopeDefs = [];

  if (preferInactive && inactiveFolder) {
    scopeDefs.push({ name: 'Inactive', parentFolder: inactiveFolder, folders: null, operatorInactive: true });
  }

  scopeDefs.push({ name: 'Active', parentFolder: null, folders: activeDriverFolders, operatorInactive: false });

  if (!preferInactive && inactiveFolder) {
    scopeDefs.push({ name: 'Inactive', parentFolder: inactiveFolder, folders: null, operatorInactive: true });
  }

  for (const scope of scopeDefs) {
    const folders = scope.folders || await getAllChildrenFromFolder(
      token,
      process.env.DISPATCH_ONEDRIVE_ID,
      scope.parentFolder.id
    );

    for (const driver of candidateDrivers) {
      const driverFolder = findFolderByExactName(folders, driver);
      if (!driverFolder) continue;

      const loadFolders = await getAllChildrenFromFolder(
        token,
        process.env.DISPATCH_ONEDRIVE_ID,
        driverFolder.id
      );

      const loadFolder = findFolderByBolPrefix(loadFolders, bol);

      if (loadFolder) {
        return {
          loadFolder,
          driverFolder,
          driver: driverFolder.name,
          operatorInactive: scope.operatorInactive,
          matchStrategy: 'driver-folder-match'
        };
      }
    }
  }

  // Last resort: the Upload Digest row only absolutely needs the BOL. If the driver
  // name from the order/digest does not match the OneDrive folder name exactly,
  // scan active and inactive driver folders for the BOL-prefixed load folder.
  for (const scope of scopeDefs) {
    const folders = scope.folders || await getAllChildrenFromFolder(
      token,
      process.env.DISPATCH_ONEDRIVE_ID,
      scope.parentFolder.id
    );

    for (const driverFolder of folders.filter((item) => item.folder)) {
      const loadFolders = await getAllChildrenFromFolder(
        token,
        process.env.DISPATCH_ONEDRIVE_ID,
        driverFolder.id
      );

      const loadFolder = findFolderByBolPrefix(loadFolders, bol);

      if (loadFolder) {
        return {
          loadFolder,
          driverFolder,
          driver: driverFolder.name,
          operatorInactive: scope.operatorInactive,
          matchStrategy: 'bol-scan-match'
        };
      }
    }
  }

  return null;
}

function getArchiveYear(displayName) {
  const match = String(displayName || '').match(/^Bid Listing Archive (\d{4})$/);
  if (!match) return null;

  const year = Number(match[1]);

  if (year < ARCHIVE_YEAR_MIN || year > ARCHIVE_YEAR_MAX) return null;

  return year;
}

async function getSearchableBidLists(token, forceRefresh = false) {
  const now = Date.now();

  if (!forceRefresh && cachedBidLists && now - cachedBidListsAt < BID_LIST_CACHE_MS) {
    return cachedBidLists;
  }

  const data = await graphGet(
    token,
    `https://graph.microsoft.com/v1.0/sites/${process.env.SITE_ID}/lists?$select=id,displayName,list`
  );

  const lists = (data.value || [])
    .filter((list) => list?.list?.hidden !== true)
    .map((list) => {
      const displayName = list.displayName || '';
      const archiveYear = getArchiveYear(displayName);

      if (displayName === 'Bid Listing') {
        return {
          listId: list.id,
          label: 'Bid Listing',
          year: 'Current',
          sortOrder: 0
        };
      }

      if (archiveYear) {
        return {
          listId: list.id,
          label: displayName,
          year: String(archiveYear),
          sortOrder: 9999 - archiveYear
        };
      }

      return null;
    })
    .filter(Boolean)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  cachedBidLists = lists;
  cachedBidListsAt = now;

  return lists;
}

function cleanBidItem(item, sourceList) {
  const fields = item.fields || {};

  return {
    id: item.id || '',
    SourceListId: sourceList.listId,
    SourceList: sourceList.label,
    SourceYear: sourceList.year,

    BOL: fields.BOLNumber_x0028_Won_x0029_ || '',
    BidID: fields.BidID || '',
    Customer: fields.Company || '',
    CustomerCode: fields.CustomerCode || '',
    Origin: fields.Shipment_x0020_Origin || '',
    Destination: fields.Shipment_x0020_Destination || '',
    Status: fields.Status || '',
    Truck: fields.Truck_x0020_Number || '',
    Driver: fields.Operator_x002f_Team || '',
    TMSName: fields.TMSName || '',
    OperatorInactive: fields.OperatorInactive ?? false,
    PickupDate: fields.Pickup_x0020_Offer_x0020_Date || '',
    PermitsEscortFees: fields.Permits_x002f_Escort_x0020_Fees_ || ''
  };
}

async function getAllBidItemsFromList(token, sourceList) {
  let url = `https://graph.microsoft.com/v1.0/sites/${process.env.SITE_ID}/lists/${sourceList.listId}/items?$expand=fields&$top=999`;
  const allItems = [];

  while (url) {
    const data = await graphGet(token, url);
    allItems.push(...(data.value || []));
    url = data['@odata.nextLink'] || null;
  }

  return allItems.map((item) => cleanBidItem(item, sourceList));
}

function buildRecordResponse(data, sourceList) {
  const f = data.fields || {};

  return {
    success: true,
    id: data.id || '',
    SourceListId: sourceList?.listId || '',
    SourceList: sourceList?.label || '',
    SourceYear: sourceList?.year || '',

    BOL: f.BOLNumber_x0028_Won_x0029_ || '',
    BidID: f.BidID || '',
    Customer: f.Company || '',
    Requestor: f.Requestor || '',
    Origin: f.Shipment_x0020_Origin || '',
    Destination: f.Shipment_x0020_Destination || '',
    Driver: f.Operator_x002f_Team || '',
    Truck: f.Truck_x0020_Number || '',
    Status: f.Status || '',
    Freight: f.Freight_x0020_Description || '',
    Length: f.Length || '',
    Width: f.Width || '',
    Height: f.Height || '',
    LoadedMiles: f.Loaded_x0020_Miles || '',
    EmptyMiles: f.Empty_x0020__x0028_Deadhead_x002 || '',
    QuotedTotal: f.Quoted_x0020_Total || '',
    RatePerMile: f._x0024__x0020_Per_x0020_Mile || '',
    PickupDate: f.Pickup_x0020_Offer_x0020_Date || '',
    DeliveryDate: f.Expected_x0020_Delivery_x0020_Da || '',
    PickupTime: f.Pickup1PickupTime || '',
    PickupAMPM: f.Pickup1AMorPM || '',
    DeliveryTime: f.Delivery1Time || '',
    DeliveryAMPM: f.Delivery1AMorPM || '',
    AircraftRelated: f.Aircraft_x0020_Related_x003f_ || '',
    TeamRequired: f.Team_x0020_Required || '',
    Route: f.Route || '',
    OperatorInactive: f.OperatorInactive ?? false,

    Pickup1Name: f.Pickup1Name || '',
    Pickup1Address1: f.Pickup1Address1 || '',
    Pickup1City: f.Pickup1City || '',
    Pickup1State: f.Pickup1State || '',
    Pickup1Zip: f.Pickup1Zip || '',
    Pickup1ContactName: f.Pickup1ContactName || '',
    Pickup1ContactNumber: f.Pickup1ContactNumber || '',
    Pickup1TimeSnapshot: f.Pickup1TimeSnapshot || '',

    Delivery1Name: f.Delivery1Name || '',
    Delivery1Address1: f.Deliver1Address1 || '',
    Delivery1City: f.Delivery1City || '',
    Delivery1State: f.Delivery1State || '',
    Delivery1Zip: f.Delivery1Zip || '',
    Delivery1ContactName: f.Delivery1ContactName || '',
    Delivery1ContactNumber: f.Delivery1ContactNumber || '',
    Delivery1TimeSnapshot: f.Delivery1TimeSnapshot || '',

    Item1QTY: f.Item1QTY || '',
    Item1Description: f.Item1Description || '',
    Item1Serial: f.Item1Serial || '',
    Item1Dimensions: f.Item1Dimensions || '',
    EstimatedWeight: f.EstimatedWeight || '',
    TotalPieces: f.TotalPieces || '',
    ShipperNumber: f.ShipperNumber || '',
    Contract: f.Contract || '',

    PermitsEscortFees: f.Permits_x002f_Escort_x0020_Fees_ || '',
    EstimatedDriverPay: f.EstimatedDriverPay || '',
    NetPayabletoDriver: f.NetPayabletoDriver || '',
    NoOfTarpsNeeded: f.No_x002e_ofTarpsNeeded || '',
    TarpingBilled: f.TarpingBilled || '',
    FuelSurchargeBilled: f.FuelSurchargeBilled || '',
    LinehaulBilled: f.LinehaulBilled || '',
    TarpingDriverPay: f.TarpingDriverPay || '',
    FuelSurchargeDriverPay: f.FuelSurchargeDriverPay || '',
    LinehaulDriverPay: f.LinehaulDriverPay || '',
    AdditionalCharges: f.AdditionalCharges || '',
    AdditionalDriverPay: f.AdditionalDriverPay || '',
    Processed: f.Processed ?? '',
    FinalSettleSent: f.FinalSettleSent ?? '',
    PpwrkSubmitted: f.PpwrkSubmitted || '',
    PpwrkSubmittedTime: f.PpwrkSubmittedTime || '',
    CustomerCode: f.CustomerCode || '',
    TMSName: f.TMSName || '',
    WrittentoExcel: f.WrittentoExcel ?? '',
    ExcelWriteStatus: f.ExcelWriteStatus || ''
  };
}
function formatEasternDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function formatEasternTimestamp(date = new Date()) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

function buildOperationsRecord(item, sourceList) {
  const fields = item.fields || {};

  return {
    id: item.id || '',
    SourceListId: sourceList.listId,
    SourceYear: sourceList.year,

    BOL: fields.BOLNumber_x0028_Won_x0029_ || '',
    BidID: fields.BidID || '',
    Customer: fields.Company || '',
    CustomerCode: fields.CustomerCode || '',
    Origin: fields.Shipment_x0020_Origin || '',
    Destination: fields.Shipment_x0020_Destination || '',
    Driver: fields.Operator_x002f_Team || '',
    Truck: fields.Truck_x0020_Number || '',

    PickupDate: fields.Pickup_x0020_Offer_x0020_Date || '',
    DeliveryDate: fields.Expected_x0020_Delivery_x0020_Da || '',

    Status: fields.Status || '',
    Processed: fields.Processed ?? false
  };
}

function normalizeBolKey(value) {
  return String(value || '').trim().toUpperCase();
}


function normalizeEasternDateOnly(value) {
  if (!value) return '';

  const raw = String(value).trim();
  const dateOnlyMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);

  if (dateOnlyMatch && !raw.includes('T')) {
    return dateOnlyMatch[1];
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';

  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(parsed);
}

function formatUploadDigestTimestamp(value) {
  if (!value) return '';

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value || '');

  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(parsed);
}

function getUploadDigestDriverName(fields, compositeKey, bol) {
  const directValue =
    fields.DriverName ||
    fields.driverName ||
    fields.Driver_x0020_Name ||
    fields.OperatorName ||
    fields.Operator_x0020_Name ||
    fields.Title ||
    '';

  if (directValue) return directValue;

  const normalizedDriverKey = (key) =>
    String(key || '')
      .replace(/_x0020_/gi, '')
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase();

  const matchedKey = Object.keys(fields || {}).find((key) => {
    const normalized = normalizedDriverKey(key);
    return normalized === 'drivername' || normalized === 'driver' || normalized.includes('drivername');
  });

  if (matchedKey && fields[matchedKey]) return fields[matchedKey];

  return getDriverHintFromCompositeKey(compositeKey, bol);
}

function buildUploadDigestRecord(item) {
  const f = item.fields || {};
  const bol = f.BOLNumber || '';
  const compositeKey = f.CompositeKey || '';

  return {
    id: item.id || '',
    BOLNumber: bol,
    UploadType: f.UploadType || '',
    UploadDate: f.UploadDate || '',
    UploadDateDisplay: formatUploadDigestTimestamp(f.UploadDate),
    CompositeKey: compositeKey,
    DriverName: getUploadDigestDriverName(f, compositeKey, bol)
  };
}


function getSalesLeadsListId() {
  return process.env.SALES_LEADS_LIST_ID || DEFAULT_SALES_LEADS_LIST_ID;
}

function getSalesLeadFieldSelect() {
  return [
    'CompanyName',
    'CustomerCode',
    'Status',
    'FirstSeen',
    'ConversionDate',
    'QuoteCount',
    'FirstQuoteDate',
    'LastQuoteDate',
    'TouchCount',
    'NextTouchDate',
    'AutoCreated',
    'CreatedDate',
    'AviationRelated',
    'ConvertedCold',
    'NormalizedName',
    'QuotesWon',
    'FollowUpPending',
    'FollowUpHandling',
    'SuppressionReason',
    'SuppressionDate',
    'FollowUpInitialized',
    'Quotes2024', 'Quotes2025', 'Quotes2026', 'Quotes2027', 'Quotes2028', 'Quotes2029', 'Quotes2030',
    'Wins2024', 'Wins2025', 'Wins2026', 'Wins2027', 'Wins2028', 'Wins2029', 'Wins2030',
    'FirstQuote2024', 'FirstQuote2025', 'FirstQuote2026', 'FirstQuote2027', 'FirstQuote2028', 'FirstQuote2029', 'FirstQuote2030',
    'LastQuote2024', 'LastQuote2025', 'LastQuote2026', 'LastQuote2027', 'LastQuote2028', 'LastQuote2029', 'LastQuote2030'
  ].join(',');
}

function normalizeCustomerName(value) {
  return normalizeSearchValue(value);
}

function isPlaceholderFutureDate(value) {
  const normalized = normalizeEasternDateOnly(value);
  return normalized >= '2099-01-01';
}

function isSalesFollowUpDue(record, targetDate = formatEasternDate()) {
  if (record.FollowUpPending !== true) return false;
  if (normalizeText(record.FollowUpHandling) === 'suppressed') return false;

  const nextTouch = normalizeEasternDateOnly(record.NextTouchDate);
  if (!nextTouch || isPlaceholderFutureDate(nextTouch)) return false;

  return nextTouch <= targetDate;
}

function getCustomerRevenueFieldSelect() {
  return [
    'CustomerCode',
    'Status',
    'Pickup_x0020_Offer_x0020_Date',
    'Quoted_x0020_Total'
  ].join(',');
}

function getRevenueYearFromBidRecord(fields, sourceList) {
  const pickup = getUtcYearMonth(fields.Pickup_x0020_Offer_x0020_Date);
  if (pickup?.year) return pickup.year;

  const sourceYear = Number(sourceList?.year);
  if (!Number.isNaN(sourceYear) && sourceYear > 0) return sourceYear;

  return Number(formatEasternDate().slice(0, 4));
}

function emptyCustomerRevenueSummary() {
  return {
    totalRevenueWon: 0,
    revenueByYear: {},
    wonLoadsByYear: {},
    revenueRecordCount: 0
  };
}

async function buildCustomerRevenueIndex(token) {
  const lists = await getSearchableBidLists(token);
  const index = new Map();

  for (const sourceList of lists) {
    const items = await getAllListItemsWithFields(token, sourceList.listId, getCustomerRevenueFieldSelect());

    items.forEach((item) => {
      const fields = item.fields || {};
      const customerCode = normalizeText(fields.CustomerCode);
      const status = normalizeText(fields.Status);

      if (!customerCode || status !== 'won') return;

      const revenue = getNumberValue(fields.Quoted_x0020_Total);
      const year = getRevenueYearFromBidRecord(fields, sourceList);

      if (!index.has(customerCode)) {
        index.set(customerCode, emptyCustomerRevenueSummary());
      }

      const summary = index.get(customerCode);
      summary.totalRevenueWon += revenue;
      summary.revenueByYear[year] = (summary.revenueByYear[year] || 0) + revenue;
      summary.wonLoadsByYear[year] = (summary.wonLoadsByYear[year] || 0) + 1;
      summary.revenueRecordCount += 1;
    });
  }

  return index;
}

function enrichSalesLeadWithRevenue(record, customerRevenueIndex) {
  const customerCode = normalizeText(record.CustomerCode);
  const revenue = customerCode
    ? customerRevenueIndex.get(customerCode) || emptyCustomerRevenueSummary()
    : emptyCustomerRevenueSummary();

  return {
    ...record,
    RevenueWon: revenue.totalRevenueWon,
    RevenueWonRecordCount: revenue.revenueRecordCount,
    YearDetails: (record.YearDetails || []).map((year) => ({
      ...year,
      revenueWon: revenue.revenueByYear[year.year] || 0,
      revenueWonLoads: revenue.wonLoadsByYear[year.year] || 0
    }))
  };
}

async function getCustomerOrdersByCodeAndYear(token, customerCode, year) {
  const cleanCode = normalizeText(customerCode);
  const targetYear = Number(year);

  if (!cleanCode || Number.isNaN(targetYear)) return [];

  const lists = await getSearchableBidLists(token);
  const matches = [];

  for (const sourceList of lists) {
    const items = await getAllBidItemsFromList(token, sourceList);

    items.forEach((record) => {
      const pickup = getUtcYearMonth(record.PickupDate);

      if (!pickup || pickup.year !== targetYear) return;
      if (normalizeText(record.CustomerCode) !== cleanCode) return;

      matches.push(record);
    });
  }

  return matches.sort(compareRecordsDefault);
}

function cleanSalesLeadItem(item) {
  const f = item.fields || {};
  const quoteCount = Number(f.QuoteCount || 0) || 0;
  const quotesWon = Number(f.QuotesWon || 0) || 0;
  const winRate = quoteCount > 0 ? quotesWon / quoteCount : 0;

  const currentYear = Number(formatEasternDate().slice(0, 4));
  const archiveYears = [2024, 2025].filter((year) => year < currentYear);
  const archiveQuoteTotal = archiveYears.reduce((sum, year) => sum + (Number(f[`Quotes${year}`] || 0) || 0), 0);
  const archiveWinTotal = archiveYears.reduce((sum, year) => sum + (Number(f[`Wins${year}`] || 0) || 0), 0);

  const yearDetails = [2024, 2025, 2026, 2027, 2028, 2029, 2030].map((year) => {
    const isCurrentYear = year === currentYear;
    const quotes = isCurrentYear
      ? Math.max(0, quoteCount - archiveQuoteTotal)
      : (Number(f[`Quotes${year}`] || 0) || 0);
    const wins = isCurrentYear
      ? Math.max(0, quotesWon - archiveWinTotal)
      : (Number(f[`Wins${year}`] || 0) || 0);

    return {
      year,
      isCurrentYear,
      quotes,
      wins,
      firstQuote: f[`FirstQuote${year}`] || '',
      lastQuote: f[`LastQuote${year}`] || ''
    };
  });

  const record = {
    id: item.id || f.id || '',
    webUrl: item.webUrl || '',
    CompanyName: f.CompanyName || f.Title || '',
    CustomerCode: f.CustomerCode || '',
    Status: f.Status || '',
    FirstSeen: f.FirstSeen || '',
    ConversionDate: f.ConversionDate || '',
    QuoteCount: quoteCount,
    FirstQuoteDate: f.FirstQuoteDate || '',
    LastQuoteDate: f.LastQuoteDate || '',
    TouchCount: Number(f.TouchCount || 0) || 0,
    NextTouchDate: f.NextTouchDate || '',
    AutoCreated: f.AutoCreated === true,
    CreatedDate: f.CreatedDate || '',
    AviationRelated: f.AviationRelated === true,
    ConvertedCold: f.ConvertedCold === true,
    NormalizedName: f.NormalizedName || normalizeCustomerName(f.CompanyName || f.Title || ''),
    QuotesWon: quotesWon,
    WinRate: winRate,
    FollowUpPending: f.FollowUpPending === true,
    FollowUpHandling: f.FollowUpHandling || '',
    FollowUpInitialized: f.FollowUpInitialized === true,
    SuppressionReason: f.SuppressionReason || '',
    SuppressionDate: f.SuppressionDate || '',
    YearDetails: yearDetails
  };

  record.FollowUpDue = isSalesFollowUpDue(record);
  record.NextTouchDisplay = isPlaceholderFutureDate(record.NextTouchDate) ? '' : record.NextTouchDate;

  return record;
}

function sortSalesLeads(records, sortMode = 'name') {
  const sorted = [...records];

  sorted.sort((a, b) => {
    if (sortMode === 'quotes') {
      const diff = Number(b.QuoteCount || 0) - Number(a.QuoteCount || 0);
      if (diff !== 0) return diff;
    }

    if (sortMode === 'wins') {
      const diff = Number(b.QuotesWon || 0) - Number(a.QuotesWon || 0);
      if (diff !== 0) return diff;
    }

    if (sortMode === 'revenue') {
      const diff = Number(b.RevenueWon || 0) - Number(a.RevenueWon || 0);
      if (diff !== 0) return diff;
    }

    if (sortMode === 'lastQuote') {
      const aTime = new Date(a.LastQuoteDate || 0).getTime() || 0;
      const bTime = new Date(b.LastQuoteDate || 0).getTime() || 0;
      const diff = bTime - aTime;
      if (diff !== 0) return diff;
    }

    if (sortMode === 'followUp') {
      const aDate = normalizeEasternDateOnly(a.NextTouchDate) || '9999-12-31';
      const bDate = normalizeEasternDateOnly(b.NextTouchDate) || '9999-12-31';
      const diff = aDate.localeCompare(bDate);
      if (diff !== 0) return diff;
    }

    return String(a.CompanyName || '').localeCompare(String(b.CompanyName || ''));
  });

  return sorted;
}

function filterSalesLeads(records, view = 'all') {
  const normalized = normalizeText(view);

  if (normalized === 'converted') {
    return records.filter((record) => normalizeText(record.Status) === 'converted');
  }

  if (normalized === 'unconverted') {
    return records.filter((record) => normalizeText(record.Status) === 'unconverted');
  }

  if (normalized === 'followupdue' || normalized === 'follow-up due') {
    return records.filter((record) => record.FollowUpDue === true);
  }

  if (normalized === 'aviation') {
    return records.filter((record) => record.AviationRelated === true);
  }

  if (normalized === 'suppressed') {
    return records.filter((record) => normalizeText(record.FollowUpHandling) === 'suppressed' || normalizeText(record.Status) === 'ignore' || normalizeText(record.Status) === 'inactive');
  }

  return records;
}

function getSalesLeadSummary(records) {
  return {
    total: records.length,
    converted: records.filter((record) => normalizeText(record.Status) === 'converted').length,
    unconverted: records.filter((record) => normalizeText(record.Status) === 'unconverted').length,
    followUpDue: records.filter((record) => record.FollowUpDue === true).length,
    aviation: records.filter((record) => record.AviationRelated === true).length,
    suppressed: records.filter((record) => normalizeText(record.FollowUpHandling) === 'suppressed' || normalizeText(record.Status) === 'ignore' || normalizeText(record.Status) === 'inactive').length
  };
}

async function getAllListItemsWithFields(token, listId, fieldSelect = '') {
  const expandFields = fieldSelect
    ? `fields($select=${fieldSelect})`
    : 'fields';

  let url = `https://graph.microsoft.com/v1.0/sites/${process.env.SITE_ID}/lists/${listId}/items?$expand=${expandFields}&$top=999`;
  const allItems = [];

  while (url) {
    const data = await graphGet(token, url);
    allItems.push(...(data.value || []));
    url = data['@odata.nextLink'] || null;
  }

  return allItems;
}

async function getUploadEvidenceSets(token) {
  const uploadDigestListId =
    process.env.UPLOAD_DIGEST_LIST_ID || DEFAULT_UPLOAD_DIGEST_LIST_ID;

  if (!uploadDigestListId) {
    return {
      pickupEvidenceBols: new Set(),
      deliveryEvidenceBols: new Set(),
      uploadDigestCount: 0
    };
  }

  const uploadItems = await getAllListItemsWithFields(
    token,
    uploadDigestListId,
    'BOLNumber,DriverName,UploadType,UploadDate,CompositeKey'
  );

  const pickupEvidenceBols = new Set();
  const deliveryEvidenceBols = new Set();

  uploadItems.forEach((item) => {
    const fields = item.fields || {};
    const bol = normalizeBolKey(fields.BOLNumber);
    const uploadType = normalizeText(fields.UploadType);

    if (!bol) return;

    if (uploadType === 'pickup') {
      pickupEvidenceBols.add(bol);
    }

    if (uploadType === 'delivery') {
      deliveryEvidenceBols.add(bol);
    }
  });

  return {
    pickupEvidenceBols,
    deliveryEvidenceBols,
    uploadDigestCount: uploadItems.length
  };
}

function addUploadEvidence(record, evidenceSets) {
  const bol = normalizeBolKey(record.BOL);

  return {
    ...record,
    hasPickupEvidence: bol ? evidenceSets.pickupEvidenceBols.has(bol) : false,
    hasDeliveryEvidence: bol ? evidenceSets.deliveryEvidenceBols.has(bol) : false
  };
}

function getEasternParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date);

  const get = (type) => Number(parts.find((part) => part.type === type)?.value || 0);

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second')
  };
}

function getEasternComparable(parts) {
  return Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour || 0),
    Number(parts.minute || 0),
    Number(parts.second || 0)
  );
}

function getDriverSummaryUnlockParts(year, month) {
  let unlockYear = Number(year);
  let unlockMonth = Number(month) + 1;

  if (unlockMonth === 13) {
    unlockMonth = 1;
    unlockYear += 1;
  }

  return {
    year: unlockYear,
    month: unlockMonth,
    day: 5,
    hour: 8,
    minute: 0,
    second: 0
  };
}

function getMonthName(month) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    timeZone: 'UTC'
  }).format(new Date(Date.UTC(2026, Number(month) - 1, 1)));
}

function getShortMonthName(month) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    timeZone: 'UTC'
  }).format(new Date(Date.UTC(2026, Number(month) - 1, 1)));
}

function getReportMonthLabel(year, month) {
  return `${getMonthName(month)} ${year}`;
}

function formatUnlockLabel(unlockParts) {
  return `${getMonthName(unlockParts.month)} ${unlockParts.day}, ${unlockParts.year} at 8:00 AM Eastern`;
}

function getDriverSummaryLockStatus(year, month, now = new Date()) {
  const unlockParts = getDriverSummaryUnlockParts(year, month);
  const currentEasternParts = getEasternParts(now);

  const isUnlocked =
    getEasternComparable(currentEasternParts) >= getEasternComparable(unlockParts);

  return {
    isUnlocked,
    unlockParts,
    unlockLabel: formatUnlockLabel(unlockParts),
    reportLabel: getReportMonthLabel(year, month)
  };
}

function parseReportInteger(value, name, min, max) {
  const number = Number(value);

  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${name} must be a whole number between ${min} and ${max}.`);
  }

  return number;
}

function getNumberValue(value) {
  if (value === null || value === undefined || value === '') return 0;

  const number = Number(String(value).replace(/[$,]/g, ''));
  return Number.isNaN(number) ? 0 : number;
}

function getChoiceValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return value.Value || value.value || value.Label || '';
  return value;
}

function getUtcYearMonth(value) {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1
  };
}

function formatShortDate(value) {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || '');

  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: '2-digit',
    day: '2-digit',
    year: 'numeric'
  }).format(date);
}

function formatCurrencyValue(value) {
  return getNumberValue(value).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD'
  });
}

function getDriverSummaryItem(item, sourceList) {
  const f = item.fields || {};

  const truck = getChoiceValue(
    f.Truck_x0020_Number || f['Truck_x0020_Number/Value'] || ''
  );

  const driver = getChoiceValue(
    f.Operator_x002f_Team || f['Operator_x002f_Team/Value'] || ''
  );

  const customer = getChoiceValue(f.Company || f['Company/Value'] || '');

  const quotedTotal = getNumberValue(f.Quoted_x0020_Total);
  const loadedMiles = getNumberValue(f.Loaded_x0020_Miles);
  const emptyMiles = getNumberValue(f.Empty_x0020__x0028_Deadhead_x002);
  const driverPay = getNumberValue(f.NetPayabletoDriver);
  const totalMiles = loadedMiles + emptyMiles;

  return {
    id: item.id || '',
    SourceListId: sourceList.listId,
    SourceYear: sourceList.year,
    BOL: f.BOLNumber_x0028_Won_x0029_ || '',
    BidID: f.BidID || '',
    Customer: customer,
    PickupDate: f.Pickup_x0020_Offer_x0020_Date || '',
    PickupDateDisplay: formatShortDate(f.Pickup_x0020_Offer_x0020_Date),
    DeliveryDate: f.Expected_x0020_Delivery_x0020_Da || '',
    DeliveryDateDisplay: formatShortDate(f.Expected_x0020_Delivery_x0020_Da),
    Route: f.Route || [f.Shipment_x0020_Origin, f.Shipment_x0020_Destination].filter(Boolean).join(' to '),
    Status: f.Status || '',
    Truck: truck || 'Unassigned Truck',
    Driver: driver || 'Unknown Operator',
    EmptyMiles: emptyMiles,
    LoadedMiles: loadedMiles,
    TotalMiles: totalMiles,
    QuotedTotal: quotedTotal,
    RatePerLoadedMile: loadedMiles > 0 ? quotedTotal / loadedMiles : 0,
    RatePerAllMiles: totalMiles > 0 ? quotedTotal / totalMiles : 0,
    RatePerMile: loadedMiles > 0 ? quotedTotal / loadedMiles : 0,
    DriverPay: driverPay
  };
}

function getDriverSummaryFieldSelect() {
  return [
    'BOLNumber_x0028_Won_x0029_',
    'BidID',
    'Company',
    'Pickup_x0020_Offer_x0020_Date',
    'Expected_x0020_Delivery_x0020_Da',
    'Route',
    'Shipment_x0020_Origin',
    'Shipment_x0020_Destination',
    'Empty_x0020__x0028_Deadhead_x002',
    'Loaded_x0020_Miles',
    'Quoted_x0020_Total',
    '_x0024__x0020_Per_x0020_Mile',
    'OData__x0024__x0020_Per_x0020_Mile',
    'NetPayabletoDriver',
    'Truck_x0020_Number',
    'Operator_x002f_Team',
    'Status'
  ].join(',');
}

async function getDriverSummarySourceList(token, requestedYear) {
  const lists = await getSearchableBidLists(token);
  const currentList = lists.find((list) => list.label === 'Bid Listing');
  const currentEasternYear = getEasternParts().year;

  if (Number(requestedYear) === currentEasternYear) {
    return currentList || null;
  }

  return lists.find((list) => String(list.year) === String(requestedYear)) || null;
}

function buildDriverSummaryResponse(items, sourceList, year, month) {
  const targetItems = items
    .map((item) => getDriverSummaryItem(item, sourceList))
    .filter((record) => {
      const pickup = getUtcYearMonth(record.PickupDate);
      if (!pickup) return false;

      const status = String(record.Status || '').trim().toLowerCase();

      return (
        pickup.year === year &&
        pickup.month === month &&
        (status === 'won' || status === 'tonu')
      );
    });

  const truckMap = new Map();

  targetItems.forEach((load) => {
    const key = load.Truck || 'Unassigned Truck';

    if (!truckMap.has(key)) {
      truckMap.set(key, {
        truck: key,
        operator: load.Driver || 'Unknown Operator',
        loadCount: 0,
        emptyMiles: 0,
        loadedMiles: 0,
        totalMiles: 0,
        quotedTotal: 0,
        driverPay: 0,
        loads: []
      });
    }

    const group = truckMap.get(key);

    if ((!group.operator || group.operator === 'Unknown Operator') && load.Driver) {
      group.operator = load.Driver;
    }

    group.loadCount += 1;
    group.emptyMiles += load.EmptyMiles;
    group.loadedMiles += load.LoadedMiles;
    group.totalMiles += load.TotalMiles;
    group.quotedTotal += load.QuotedTotal;
    group.driverPay += load.DriverPay;
    group.loads.push(load);
  });

  const drivers = Array.from(truckMap.values())
    .map((group) => ({
      ...group,
      revenuePerLoadedMile: group.loadedMiles > 0 ? group.quotedTotal / group.loadedMiles : 0,
      revenuePerTotalMile: group.totalMiles > 0 ? group.quotedTotal / group.totalMiles : 0,
      loads: group.loads.sort((a, b) => {
        const aTime = new Date(a.PickupDate).getTime() || 0;
        const bTime = new Date(b.PickupDate).getTime() || 0;
        return aTime - bTime;
      })
    }))
    .sort((a, b) => String(a.truck).localeCompare(String(b.truck), undefined, { numeric: true }));

  const totals = drivers.reduce(
    (acc, group) => {
      acc.loadCount += group.loadCount;
      acc.emptyMiles += group.emptyMiles;
      acc.loadedMiles += group.loadedMiles;
      acc.totalMiles += group.totalMiles;
      acc.quotedTotal += group.quotedTotal;
      acc.driverPay += group.driverPay;
      return acc;
    },
    {
      loadCount: 0,
      emptyMiles: 0,
      loadedMiles: 0,
      totalMiles: 0,
      quotedTotal: 0,
      driverPay: 0
    }
  );

  totals.revenuePerLoadedMile = totals.loadedMiles > 0 ? totals.quotedTotal / totals.loadedMiles : 0;
  totals.revenuePerTotalMile = totals.totalMiles > 0 ? totals.quotedTotal / totals.totalMiles : 0;

  return {
    success: true,
    reportType: 'driverSummary',
    reportLabel: getReportMonthLabel(year, month),
    generatedAt: `${formatEasternTimestamp()} Eastern`,
    dataSource: sourceList?.label || 'Bid Listing',
    month,
    year,
    status: 'available',
    anchorDate: 'Pickup Offer Date',
    includedStatuses: ['Won', 'TONU'],
    totals,
    drivers
  };
}

function getGrossRevenueFieldSelect() {
  return [
    'BOLNumber_x0028_Won_x0029_',
    'BidID',
    'Company',
    'Pickup_x0020_Offer_x0020_Date',
    'Truck_x0020_Number',
    'Operator_x002f_Team',
    'TMSName',
    'Status',
    'Quoted_x0020_Total',
    'FinalBillableTotal',
    'Permits_x002f_Escort_x0020_Fees_'
  ].join(',');
}

function getGrossRevenueReportItem(item, sourceList) {
  const f = item.fields || {};
  const truck = getChoiceValue(f.Truck_x0020_Number || f['Truck_x0020_Number/Value'] || '');
  const operatorTeam = getChoiceValue(f.Operator_x002f_Team || f['Operator_x002f_Team/Value'] || '');
  const customer = getChoiceValue(f.Company || f['Company/Value'] || '');
  const quotedTotal = getNumberValue(f.Quoted_x0020_Total);
  const permitsEscortFees = getNumberValue(f.Permits_x002f_Escort_x0020_Fees_);
  const grossRevenue = Math.max(0, quotedTotal - permitsEscortFees);

  return {
    id: item.id || '',
    SourceListId: sourceList.listId,
    SourceYear: sourceList.year,
    BOL: f.BOLNumber_x0028_Won_x0029_ || '',
    BidID: f.BidID || '',
    Customer: customer || '',
    Truck: truck || 'Unassigned Truck',
    Operator: f.TMSName || operatorTeam || 'Unknown Operator',
    Status: f.Status || '',
    PickupDate: f.Pickup_x0020_Offer_x0020_Date || '',
    PickupDateDisplay: formatShortDate(f.Pickup_x0020_Offer_x0020_Date),
    QuotedTotal: quotedTotal,
    PermitsEscortFees: permitsEscortFees,
    GrossRevenue: grossRevenue
  };
}

function buildGrossRevenueTotalsResponse(items, sourceList, year) {
  const monthNames = Array.from({ length: 12 }, (_, index) => getMonthName(index + 1));
  const monthKeys = monthNames.map((name, index) => ({
    month: index + 1,
    name,
    shortName: getShortMonthName(index + 1)
  }));

  const targetItems = items
    .map((item) => getGrossRevenueReportItem(item, sourceList))
    .filter((record) => {
      const pickup = getUtcYearMonth(record.PickupDate);
      if (!pickup) return false;

      const status = normalizeText(record.Status);

      return (
        pickup.year === Number(year) &&
        (status === 'won' || status === 'tonu')
      );
    });

  const truckMap = new Map();

  targetItems.forEach((load) => {
    const key = load.Truck || 'Unassigned Truck';

    if (!truckMap.has(key)) {
      truckMap.set(key, {
        truck: key,
        operator: load.Operator || 'Unknown Operator',
        monthTotals: Object.fromEntries(monthKeys.map((month) => [month.month, 0])),
        totalGrossRevenue: 0,
        loadCount: 0,
        permitEscortTotal: 0,
        loads: []
      });
    }

    const group = truckMap.get(key);
    const pickup = getUtcYearMonth(load.PickupDate);

    if ((!group.operator || group.operator === 'Unknown Operator') && load.Operator) {
      group.operator = load.Operator;
    }

    group.monthTotals[pickup.month] += load.GrossRevenue;
    group.totalGrossRevenue += load.GrossRevenue;
    group.permitEscortTotal += load.PermitsEscortFees;
    group.loadCount += 1;
    group.loads.push(load);
  });

  const trucks = Array.from(truckMap.values())
    .map((group) => ({
      ...group,
      averageMonthlyRevenue: group.totalGrossRevenue / 12,
      monthsWithRevenue: monthKeys.filter((month) => group.monthTotals[month.month] > 0).length
    }))
    .sort((a, b) => String(a.truck).localeCompare(String(b.truck), undefined, { numeric: true }));

  const monthlyTotals = Object.fromEntries(monthKeys.map((month) => [month.month, 0]));
  let totalGrossRevenue = 0;
  let totalPermitEscortExcluded = 0;
  let totalLoadCount = 0;

  trucks.forEach((truck) => {
    monthKeys.forEach((month) => {
      monthlyTotals[month.month] += truck.monthTotals[month.month] || 0;
    });

    totalGrossRevenue += truck.totalGrossRevenue;
    totalPermitEscortExcluded += truck.permitEscortTotal;
    totalLoadCount += truck.loadCount;
  });

  return {
    success: true,
    reportType: 'grossRevenueTotals',
    reportLabel: `${year} Gross Revenue Totals`,
    generatedAt: `${formatEasternTimestamp()} Eastern`,
    dataSource: sourceList?.label || 'Bid Listing',
    year: Number(year),
    anchorDate: 'Pickup Offer Date',
    includedStatuses: ['Won', 'TONU'],
    revenueBasis: 'Quoted/final billable total less permits and escort fees',
    months: monthKeys,
    totals: {
      loadCount: totalLoadCount,
      totalGrossRevenue,
      totalPermitEscortExcluded,
      averageMonthlyRevenue: totalGrossRevenue / 12,
      monthlyTotals
    },
    trucks
  };
}

function getOrdersDueForSettlementFieldSelect() {
  return [
    'BOLNumber_x0028_Won_x0029_',
    'BidID',
    'Company',
    'Expected_x0020_Delivery_x0020_Da',
    'Pickup_x0020_Offer_x0020_Date',
    'Shipment_x0020_Origin',
    'Shipment_x0020_Destination',
    'Pickup2State',
    'Delivery1State',
    'Truck_x0020_Number',
    'Operator_x002f_Team',
    'TMSName',
    'Status',
    'FinalSettleSent',
    'FinalBillableTotal',
    'NetPayabletoDriver'
  ].join(',');
}

function getOrdersDueForSettlementItem(item, sourceList) {
  const f = item.fields || {};
  const truck = getChoiceValue(f.Truck_x0020_Number || f['Truck_x0020_Number/Value'] || '');
  const operatorTeam = getChoiceValue(f.Operator_x002f_Team || f['Operator_x002f_Team/Value'] || '');
  const customer = getChoiceValue(f.Company || f['Company/Value'] || '');

  return {
    id: item.id || '',
    webUrl: item.webUrl || '',
    SourceListId: sourceList.listId,
    SourceYear: sourceList.year,
    BOL: f.BOLNumber_x0028_Won_x0029_ || '',
    BidID: f.BidID || '',
    Customer: customer || '',
    Operator: f.TMSName || operatorTeam || 'Unknown Operator',
    OperatorTeam: operatorTeam || '',
    Truck: truck || '',
    Status: f.Status || '',
    FinalSettleSent: f.FinalSettleSent ?? false,
    PickupDate: f.Pickup_x0020_Offer_x0020_Date || '',
    PickupDateDisplay: formatShortDate(f.Pickup_x0020_Offer_x0020_Date),
    DeliveryDate: f.Expected_x0020_Delivery_x0020_Da || '',
    DeliveryDateDisplay: formatShortDate(f.Expected_x0020_Delivery_x0020_Da),
    Origin: f.Shipment_x0020_Origin || '',
    Destination: f.Shipment_x0020_Destination || '',
    OriginST: f.Pickup2State || '',
    DestST: f.Delivery1State || '',
    Route: [f.Shipment_x0020_Origin, f.Shipment_x0020_Destination].filter(Boolean).join(' to '),
    BidAmount: getNumberValue(f.FinalBillableTotal),
    DriverPay: getNumberValue(f.NetPayabletoDriver)
  };
}

function getDateOnlyComparable(value) {
  if (!value) return '';

  const raw = String(value).trim();
  const dateOnlyMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (dateOnlyMatch) return dateOnlyMatch[1];

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function sortOrdersDueForSettlementRows(a, b) {
  const deliveryDiff = String(a.DeliveryDate || '').localeCompare(String(b.DeliveryDate || ''));
  if (deliveryDiff !== 0) return deliveryDiff;

  const operatorDiff = String(a.Operator || '').localeCompare(String(b.Operator || ''), undefined, { numeric: true });
  if (operatorDiff !== 0) return operatorDiff;

  return String(a.BOL || '').localeCompare(String(b.BOL || ''), undefined, { numeric: true });
}

function buildOrdersDueForSettlementResponse(items, sourceList) {
  const today = formatEasternDate();

  const rows = items
    .map((item) => getOrdersDueForSettlementItem(item, sourceList))
    .filter((record) => {
      const status = normalizeText(record.Status);
      const delivery = getDateOnlyComparable(record.DeliveryDate);

      return (
        (status === 'won' || status === 'tonu') &&
        !parseBoolean(record.FinalSettleSent) &&
        delivery &&
        delivery < today
      );
    })
    .sort(sortOrdersDueForSettlementRows);

  const totals = getSettlementTotals(rows);

  return {
    success: true,
    reportType: 'ordersDueForSettlement',
    reportLabel: 'Orders Due for Settlement',
    generatedAt: `${formatEasternTimestamp()} Eastern`,
    dataSource: sourceList.label,
    targetDate: today,
    count: rows.length,
    totals,
    rows
  };
}






function getDriverPositionFieldSelect() {
  return [
    'EquipmentID',
    'DriverID',
    'DriverID2',
    'Latitude',
    'Longitude',
    'PositionTimeUTC',
    'EventTimeUTC',
    'Speed',
    'Heading',
    'Odometer',
    'IgnitionStatus',
    'TripStatus',
    'PositionType',
    'MessageType',
    'LastTransactionID',
    'LastUpdatedUTC',
    'RosterMatched',
    'RosterMatchName',
    'ActiveInRoster',
    'CurrentCityState',
    'LastTransform'
  ].join(',');
}

function getIgnitionStatusLabel(value) {
  const normalized = String(value ?? '').trim();

  if (normalized === '1') return 'On';
  if (normalized === '2') return 'Off';

  return normalized || '-';
}

function getTripStatusLabel(value) {
  const normalized = String(value ?? '').trim().toUpperCase();

  if (normalized === 'I') return 'In Trip';
  if (normalized === 'O') return 'Out of Trip';

  return normalized || '-';
}

function getPositionAgeMinutes(value) {
  if (!value) return null;

  const date = new Date(value);
  const time = date.getTime();

  if (Number.isNaN(time)) return null;

  return Math.max(0, Math.round((Date.now() - time) / 60000));
}


function getDriverRosterFieldSelect() {
  return [
    'Operator_x002f_TeamName',
    'PIN',
    'Trucks',
    'TMSName',
    'CellPhone1',
    'CellPhone2',
    'DriverType',
    'Status',
    'TrailerType',
    'BOLLetterPrefix',
    'SoloorTeam',
    'EmailAddress1',
    'EmailAddress2',
    'RegisteredWeight',
    'TractorPlate',
    'TractorYear',
    'TractorVIN',
    'TrailerUnitNumber',
    'TrailerLength',
    'TrailerPlate',
    'TrailerRegisteredState',
    'TrailerYear',
    'TrailerMake',
    'TrailerVIN',
    'SteerAxleWeight',
    'Spacing1to2',
    'Spacing2to3',
    'Spacing3to4',
    'Spacing4to5',
    'OverallLength',
    'LowestDeckHeight',
    'TractorOwner',
    'TrailerOwner',
    'TractorAxles',
    'TractorMake',
    'TractorRegisteredState',
    'TrailerAxles',
    'EmptyWeight',
    'StartDate',
    'TermDate',
    'OrdersTaggedforInactive'
  ].join(',');
}

function cleanPhoneText(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

function cleanRosterText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeTruckKey(value) {
  return String(value || '').trim().toUpperCase();
}

function cleanDriverRosterItem(item) {
  const f = item.fields || {};

  return {
    id: item.id || '',
    webUrl: item.webUrl || '',

    operatorTeamName: cleanRosterText(f.Operator_x002f_TeamName),
    pin: cleanRosterText(f.PIN),
    truck: cleanRosterText(f.Trucks),
    tmsName: cleanRosterText(f.TMSName),
    cellPhone1: cleanPhoneText(f.CellPhone1),
    cellPhone2: cleanPhoneText(f.CellPhone2),
    emailAddress1: cleanRosterText(f.EmailAddress1),
    emailAddress2: cleanRosterText(f.EmailAddress2),

    driverType: cleanRosterText(f.DriverType),
    status: cleanRosterText(f.Status),
    trailerType: cleanRosterText(f.TrailerType),
    bolLetterPrefix: cleanRosterText(f.BOLLetterPrefix),
    soloOrTeam: cleanRosterText(f.SoloorTeam),
    registeredWeight: f.RegisteredWeight ?? '',
    startDate: f.StartDate || '',
    termDate: f.TermDate || '',
    ordersTaggedForInactive: f.OrdersTaggedforInactive ?? false,

    tractorPlate: cleanRosterText(f.TractorPlate),
    tractorYear: cleanRosterText(f.TractorYear),
    tractorMake: cleanRosterText(f.TractorMake),
    tractorVin: cleanRosterText(f.TractorVIN),
    tractorOwner: cleanRosterText(f.TractorOwner),
    tractorAxles: f.TractorAxles ?? '',
    tractorRegisteredState: cleanRosterText(f.TractorRegisteredState),

    trailerUnitNumber: cleanRosterText(f.TrailerUnitNumber),
    trailerLength: cleanRosterText(f.TrailerLength),
    trailerPlate: cleanRosterText(f.TrailerPlate),
    trailerRegisteredState: cleanRosterText(f.TrailerRegisteredState),
    trailerYear: f.TrailerYear ?? '',
    trailerMake: cleanRosterText(f.TrailerMake),
    trailerVin: cleanRosterText(f.TrailerVIN),
    trailerOwner: cleanRosterText(f.TrailerOwner),
    trailerAxles: f.TrailerAxles ?? '',

    emptyWeight: f.EmptyWeight ?? '',
    steerAxleWeight: f.SteerAxleWeight ?? '',
    spacing1to2: f.Spacing1to2 ?? '',
    spacing2to3: f.Spacing2to3 ?? '',
    spacing3to4: f.Spacing3to4 ?? '',
    spacing4to5: f.Spacing4to5 ?? '',
    overallLength: f.OverallLength ?? '',
    lowestDeckHeight: f.LowestDeckHeight ?? ''
  };
}

async function getDriverRosterItems(token) {
  const driverRosterListId = process.env.DRIVER_ROSTER_LIST_ID;

  if (!driverRosterListId) {
    throw new Error('DRIVER_ROSTER_LIST_ID is not configured on the server.');
  }

  const items = await getAllListItemsWithFields(
    token,
    driverRosterListId,
    getDriverRosterFieldSelect()
  );

  return items.map(cleanDriverRosterItem);
}

async function getDriverRosterByTruck(token) {
  const rosterByTruck = new Map();

  if (!process.env.DRIVER_ROSTER_LIST_ID) {
    return rosterByTruck;
  }

  const rosterItems = await getDriverRosterItems(token);

  rosterItems.forEach((roster) => {
    const truckKey = normalizeTruckKey(roster.truck);
    if (!truckKey) return;

    const existing = rosterByTruck.get(truckKey);
    const isActive = normalizeText(roster.status) === 'active';
    const existingIsActive = normalizeText(existing?.status) === 'active';

    if (!existing || (isActive && !existingIsActive)) {
      rosterByTruck.set(truckKey, roster);
    }
  });

  return rosterByTruck;
}

function sortDriverRosterRecords(a, b) {
  const aName = normalizeText(a.operatorTeamName || a.tmsName);
  const bName = normalizeText(b.operatorTeamName || b.tmsName);

  const nameCompare = aName.localeCompare(bName);
  if (nameCompare !== 0) return nameCompare;

  return normalizeTruckKey(a.truck).localeCompare(normalizeTruckKey(b.truck));
}

function cleanDriverPositionItem(item) {
  const f = item.fields || {};
  const positionAgeMinutes = getPositionAgeMinutes(f.PositionTimeUTC);
  const speed = getNumberValue(f.Speed);

  return {
    id: item.id || '',
    webUrl: item.webUrl || '',

    equipmentId: f.EquipmentID || '',
    driverId: f.DriverID || '',
    driverId2: f.DriverID2 || '',
    driverName: f.RosterMatchName || '',

    latitude: f.Latitude ?? null,
    longitude: f.Longitude ?? null,
    currentCityState: f.CurrentCityState || '',

    positionTimeUtc: f.PositionTimeUTC || '',
    eventTimeUtc: f.EventTimeUTC || '',
    lastUpdatedUtc: f.LastUpdatedUTC || item.lastModifiedDateTime || '',
    positionAgeMinutes,
    isStale: positionAgeMinutes === null ? true : positionAgeMinutes > 24 * 60,

    speed,
    isMoving: speed > 0,
    heading: f.Heading ?? null,
    odometer: f.Odometer ?? null,

    ignitionStatus: f.IgnitionStatus || '',
    ignitionStatusLabel: getIgnitionStatusLabel(f.IgnitionStatus),
    tripStatus: f.TripStatus || '',
    tripStatusLabel: getTripStatusLabel(f.TripStatus),
    positionType: f.PositionType || '',
    messageType: f.MessageType || '',

    lastTransactionId: f.LastTransactionID || '',
    rosterMatched: f.RosterMatched ?? false,
    activeInRoster: f.ActiveInRoster ?? false
  };
}

function sortDriverPositions(a, b) {
  const bTime = new Date(b.positionTimeUtc || b.lastUpdatedUtc || 0).getTime() || 0;
  const aTime = new Date(a.positionTimeUtc || a.lastUpdatedUtc || 0).getTime() || 0;

  if (bTime !== aTime) return bTime - aTime;

  return String(a.equipmentId || '').localeCompare(String(b.equipmentId || ''), undefined, { numeric: true });
}

function parseCutoffDateValue(value) {
  const raw = String(value || '').trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error('cutoffDate must be provided as YYYY-MM-DD.');
  }

  const [year, month, day] = raw.split('-').map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));

  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() + 1 !== month ||
    check.getUTCDate() !== day
  ) {
    throw new Error('cutoffDate is not a valid calendar date.');
  }

  return { raw, year, month, day };
}

function addDaysToDateParts(parts, days) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + Number(days || 0)));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}
function getPayrollDatePartsFromCutoff(cutoffParts) {
  // Payroll is the Wednesday following the cutoff.
  // Normal Thursday cutoff = following Wednesday = +6 days.
  const cutoffDate = new Date(Date.UTC(
    cutoffParts.year,
    cutoffParts.month - 1,
    cutoffParts.day
  ));

  const cutoffDay = cutoffDate.getUTCDay(); // Sunday = 0, Wednesday = 3
  let daysUntilWednesday = (3 - cutoffDay + 7) % 7;

  // "Following Wednesday" means not the same day if someone ever picks a Wednesday cutoff.
  if (daysUntilWednesday === 0) {
    daysUntilWednesday = 7;
  }

  return addDaysToDateParts(cutoffParts, daysUntilWednesday);
}
function formatIsoDateParts(parts) {
  return [
    String(parts.year).padStart(4, '0'),
    String(parts.month).padStart(2, '0'),
    String(parts.day).padStart(2, '0')
  ].join('-');
}

function formatDisplayDateParts(parts) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: '2-digit',
    day: '2-digit',
    year: 'numeric'
  }).format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day)));
}

function getEasternComparableFromDateParts(parts, hour = 0, minute = 0, second = 0) {
  return Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(hour || 0),
    Number(minute || 0),
    Number(second || 0)
  );
}

function parsePaperworkSubmittedTimestamp(dateValue, timeValue) {
  const dateRaw = String(dateValue || '').trim();
  const timeRaw = String(timeValue || '').trim();

  if (!dateRaw || !timeRaw) return null;

  let year;
  let month;
  let day;

  const isoDateMatch = dateRaw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const usDateMatch = dateRaw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);

  if (isoDateMatch) {
    year = Number(isoDateMatch[1]);
    month = Number(isoDateMatch[2]);
    day = Number(isoDateMatch[3]);
  } else if (usDateMatch) {
    month = Number(usDateMatch[1]);
    day = Number(usDateMatch[2]);
    year = Number(usDateMatch[3]);
    if (year < 100) year += 2000;
  } else {
    const parsedDate = new Date(dateRaw);
    if (Number.isNaN(parsedDate.getTime())) return null;
    year = parsedDate.getUTCFullYear();
    month = parsedDate.getUTCMonth() + 1;
    day = parsedDate.getUTCDate();
  }

  const compactTime = timeRaw.toUpperCase().replace(/\s+/g, '');
  const timeMatch = compactTime.match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?(AM|PM)?$/);

  if (!timeMatch) return null;

  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2] || 0);
  const second = Number(timeMatch[3] || 0);
  const ampm = timeMatch[4] || '';

  if (ampm === 'PM' && hour < 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;

  if (hour > 23 || minute > 59 || second > 59) return null;

  return {
    comparable: getEasternComparableFromDateParts({ year, month, day }, hour, minute, second),
    isoDate: formatIsoDateParts({ year, month, day }),
    displayDate: formatDisplayDateParts({ year, month, day }),
    displayTime: timeRaw,
    hour,
    minute,
    second
  };
}


function getWonNotRegisteredFieldSelect() {
  return [
    'BOLNumber_x0028_Won_x0029_',
    'BidID',
    'Company',
    'Pickup_x0020_Offer_x0020_Date',
    'Shipment_x0020_Origin',
    'Shipment_x0020_Destination',
    'Operator_x002f_Team',
    'Truck_x0020_Number',
    'Status'
  ].join(',');
}

function getWonNotRegisteredItem(item, sourceList) {
  const f = item.fields || {};

  const customer = getChoiceValue(f.Company || f['Company/Value'] || '');
  const driver = getChoiceValue(f.Operator_x002f_Team || f['Operator_x002f_Team/Value'] || '');
  const truck = getChoiceValue(f.Truck_x0020_Number || f['Truck_x0020_Number/Value'] || '');

  return {
    id: item.id || '',
    SourceListId: sourceList.listId,
    SourceList: sourceList.label,
    SourceYear: sourceList.year,
    BOL: f.BOLNumber_x0028_Won_x0029_ || '',
    BidID: f.BidID || '',
    Customer: customer || '',
    Driver: driver || '',
    Truck: truck || '',
    Status: f.Status || '',
    PickupDate: f.Pickup_x0020_Offer_x0020_Date || '',
    PickupDateDisplay: formatShortDate(f.Pickup_x0020_Offer_x0020_Date),
    Origin: f.Shipment_x0020_Origin || '',
    Destination: f.Shipment_x0020_Destination || ''
  };
}

function sortWonNotRegisteredRows(a, b) {
  const pickupDiff = getPickupSortValue(a) - getPickupSortValue(b);
  if (pickupDiff !== 0) return pickupDiff;

  return String(a.BidID || '').localeCompare(String(b.BidID || ''));
}

function buildWonNotRegisteredResponse(items, sourceList) {
  const rows = items
    .map((item) => getWonNotRegisteredItem(item, sourceList))
    .filter((record) => normalizeText(record.Status) === 'won')
    .filter((record) => !String(record.BOL || '').trim())
    .sort(sortWonNotRegisteredRows);

  return {
    success: true,
    reportType: 'wonNotRegistered',
    reportLabel: 'Orders Won and Not Registered',
    generatedAt: `${formatEasternTimestamp()} Eastern`,
    dataSource: sourceList.label,
    count: rows.length,
    rows
  };
}

function getSettlementFieldSelect() {
  return [
    'BOLNumber_x0028_Won_x0029_',
    'BidID',
    'Company',
    'Pickup_x0020_Offer_x0020_Date',
    'Pickup2State',
    'Delivery1State',
    'Shipment_x0020_Origin',
    'Shipment_x0020_Destination',
    'Truck_x0020_Number',
    'Operator_x002f_Team',
    'TMSName',
    'Status',
    'Processed',
    'PpwrkSubmitted',
    'PpwrkSubmittedTime',
    'FinalBillableTotal',
    'NetPayabletoDriver'
  ].join(',');
}

function getSettlementReportItem(item, sourceList) {
  const f = item.fields || {};
  const truck = getChoiceValue(f.Truck_x0020_Number || f['Truck_x0020_Number/Value'] || '');
  const operatorTeam = getChoiceValue(f.Operator_x002f_Team || f['Operator_x002f_Team/Value'] || '');
  const customer = getChoiceValue(f.Company || f['Company/Value'] || '');
  const submitted = parsePaperworkSubmittedTimestamp(f.PpwrkSubmitted, f.PpwrkSubmittedTime);

  return {
    id: item.id || '',
    SourceListId: sourceList.listId,
    SourceYear: sourceList.year,
    BOL: f.BOLNumber_x0028_Won_x0029_ || '',
    BidID: f.BidID || '',
    Operator: f.TMSName || operatorTeam || 'Unknown Operator',
    OperatorTeam: operatorTeam || '',
    Truck: truck || '',
    Customer: customer || '',
    Status: f.Status || '',
    Processed: f.Processed ?? false,
    PUDate: f.Pickup_x0020_Offer_x0020_Date || '',
    PUDateDisplay: formatShortDate(f.Pickup_x0020_Offer_x0020_Date),
    OriginST: f.Pickup2State || '',
    DestST: f.Delivery1State || '',
    Route: [f.Shipment_x0020_Origin, f.Shipment_x0020_Destination].filter(Boolean).join(' to '),
    BidAmount: getNumberValue(f.FinalBillableTotal),
    DriverPay: getNumberValue(f.NetPayabletoDriver),
    SubmitDate: f.PpwrkSubmitted || '',
    SubmitTime: f.PpwrkSubmittedTime || '',
    SubmitDateDisplay: submitted?.displayDate || '',
    SubmitTimeDisplay: submitted?.displayTime || '',
    SubmittedComparable: submitted?.comparable || null
  };
}

function getSettlementTotals(records) {
  const drivers = new Set();
  const customers = new Set();

  const totals = records.reduce(
    (acc, record) => {
      acc.orderCount += 1;
      acc.bidTotal += getNumberValue(record.BidAmount);
      acc.driverPayTotal += getNumberValue(record.DriverPay);

      if (record.Operator) drivers.add(record.Operator);
      if (record.Customer) customers.add(record.Customer);

      return acc;
    },
    {
      orderCount: 0,
      driverCount: 0,
      customerCount: 0,
      bidTotal: 0,
      driverPayTotal: 0
    }
  );

  totals.driverCount = drivers.size;
  totals.customerCount = customers.size;
  totals.margin = totals.bidTotal - totals.driverPayTotal;

  return totals;
}

function sortSettlementRows(a, b) {
  const operatorDiff = String(a.Operator || '').localeCompare(String(b.Operator || ''), undefined, { numeric: true });
  if (operatorDiff !== 0) return operatorDiff;

  const submitDiff = (a.SubmittedComparable || 0) - (b.SubmittedComparable || 0);
  if (submitDiff !== 0) return submitDiff;

  return String(a.BOL || '').localeCompare(String(b.BOL || ''), undefined, { numeric: true });
}

function buildWeeklySettlementResponse(items, sourceLists, cutoffDateValue) {
  const cutoff = parseCutoffDateValue(cutoffDateValue);
  const previousCutoff = addDaysToDateParts(cutoff, -7);
const payrollDate = getPayrollDatePartsFromCutoff(cutoff);

  const previousCutoffNoon = getEasternComparableFromDateParts(previousCutoff, 12, 0, 0);
  const previousCutoffEndOfDay = getEasternComparableFromDateParts(previousCutoff, 23, 59, 59);
  const currentCutoffNoon = getEasternComparableFromDateParts(cutoff, 12, 0, 0);
  const currentCutoffEndOfDay = getEasternComparableFromDateParts(cutoff, 23, 59, 59);

  const sourceById = new Map(sourceLists.map((list) => [list.listId, list]));

  const usableRecords = items
    .map((entry) => getSettlementReportItem(entry.item, sourceById.get(entry.sourceListId) || entry.sourceList))
    .filter((record) => parseBoolean(record.Processed))
    .filter((record) => record.SubmittedComparable !== null);

  const main = [];
  const suggest = [];

  usableRecords.forEach((record) => {
    if (
      record.SubmittedComparable > previousCutoffNoon &&
      record.SubmittedComparable <= currentCutoffNoon
    ) {
      main.push({
        ...record,
        Starred:
          record.SubmittedComparable > previousCutoffNoon &&
          record.SubmittedComparable <= previousCutoffEndOfDay
      });
      return;
    }

    if (
      record.SubmittedComparable > currentCutoffNoon &&
      record.SubmittedComparable <= currentCutoffEndOfDay
    ) {
      suggest.push({
        ...record,
        Starred: false
      });
    }
  });

  main.sort(sortSettlementRows);
  suggest.sort(sortSettlementRows);

  const excludedCount = items
    .map((entry) => getSettlementReportItem(entry.item, sourceById.get(entry.sourceListId) || entry.sourceList))
    .filter((record) => parseBoolean(record.Processed))
    .filter((record) => record.SubmittedComparable === null).length;

  return {
    success: true,
    reportType: 'weeklySettlement',
    reportLabel: `Weekly Settlement Report - Payroll Date ${formatDisplayDateParts(payrollDate)}`,
payrollDate: formatIsoDateParts(payrollDate),
payrollDateLabel: formatDisplayDateParts(payrollDate),

    generatedAt: `${formatEasternTimestamp()} Eastern`,
    dataSource: sourceLists.map((list) => list.label).join(', '),
    cutoffDate: cutoff.raw,
    cutoffLabel: `${formatDisplayDateParts(cutoff)} at 12:00 PM Eastern`,
    previousCutoffDate: formatIsoDateParts(previousCutoff),
    previousCutoffLabel: `${formatDisplayDateParts(previousCutoff)} at 12:00 PM Eastern`,
    mainWindowLabel: `After ${formatDisplayDateParts(previousCutoff)} 12:00 PM through ${formatDisplayDateParts(cutoff)} 12:00 PM Eastern`,
    suggestWindowLabel: `After ${formatDisplayDateParts(cutoff)} 12:00 PM through ${formatDisplayDateParts(cutoff)} 11:59 PM Eastern`,
    totals: {
      main: getSettlementTotals(main),
      suggest: getSettlementTotals(suggest),
      combined: getSettlementTotals([...main, ...suggest])
    },
    counts: {
      scannedRecords: items.length,
      usableProcessedRecords: usableRecords.length,
      excludedProcessedRecordsMissingSubmissionTimestamp: excludedCount
    },
    main,
    suggest
  };
}

app.get('/', (req, res) => {
  res.send('Kole Lookup API is running');
});

app.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'API working',
    time: new Date()
  });
});

app.get('/auth-check', requireLookupAccess, (req, res) => {
  res.json({
    success: true,
    message: 'Lookup access authorized'
  });
});

app.get('/graph-test', requireLookupAccess, async (req, res) => {
  try {
    const token = await getGraphToken();

    res.json({
      success: true,
      message: 'Graph token acquired successfully',
      tokenPreview: token.substring(0, 25) + '...'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Graph token failed',
      error: error.message
    });
  }
});

app.get('/lookup-lists', requireLookupAccess, async (req, res) => {
  try {
    const token = await getGraphToken();
    const forceRefresh = String(req.query.refresh || '').toLowerCase() === 'true';
    const lists = await getSearchableBidLists(token, forceRefresh);

    res.json({
      success: true,
      count: lists.length,
      lists
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/bids-test', requireLookupAccess, async (req, res) => {
  try {
    const token = await getGraphToken();
    const lists = await getSearchableBidLists(token);
    const currentList = lists.find((list) => list.label === 'Bid Listing');

    if (!currentList) {
      return res.status(404).json({
        success: false,
        error: 'Bid Listing was not found.'
      });
    }

    const data = await graphGet(
      token,
      `https://graph.microsoft.com/v1.0/sites/${process.env.SITE_ID}/lists/${currentList.listId}/items?$expand=fields&$top=5`
    );

    res.json((data.value || []).map((item) => cleanBidItem(item, currentList)));
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/search', requireLookupAccess, async (req, res) => {
  try {
    const token = await getGraphToken();
    const q = (req.query.q || '').toString().trim();
    const includeArchives =
      String(req.query.includeArchives || '').toLowerCase() === 'true';

    if (!q) {
      return res.status(400).json({
        success: false,
        message: 'Missing search query. Use /search?q=yourSearchText'
      });
    }

    const allLists = await getSearchableBidLists(token);

    const lists = includeArchives
      ? allLists
      : allLists.filter((list) => list.label === 'Bid Listing');

    const settled = await Promise.allSettled(
      lists.map((list) => getAllBidItemsFromList(token, list))
    );

    const successfulGroups = settled
      .filter((result) => result.status === 'fulfilled')
      .flatMap((result) => result.value);

    const failedLists = settled
      .map((result, index) => ({
        result,
        list: lists[index]
      }))
      .filter((entry) => entry.result.status === 'rejected')
      .map((entry) => ({
        SourceList: entry.list.label,
        error: entry.result.reason?.message || 'Unknown list search failure'
      }));

    const results = searchAndRankRecords(successfulGroups, q);

    res.json({
      success: true,
      query: q,
      includeArchives,
      searchedLists: lists.length,
      searchedRecords: successfulGroups.length,
      count: results.length,
      failedLists,
      results
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/documents/bol', requireLookupAccess, async (req, res) => {
  try {
    const bol = (req.query.bol || '').toString().trim();
    const bidId = (req.query.bidId || '').toString().trim();

    if (!bol) {
      return res.status(400).json({
        success: false,
        error: 'Missing BOL number.'
      });
    }

    if (!process.env.SHAREPOINT_DOCUMENTS_DRIVE_ID || !process.env.BOLPRINTS_FOLDER_ID) {
      return res.status(500).json({
        success: false,
        error: 'BOL document folder environment variables are not configured.'
      });
    }

    const token = await getGraphToken();

    const items = await getAllChildrenFromFolder(
      token,
      process.env.SHAREPOINT_DOCUMENTS_DRIVE_ID,
      process.env.BOLPRINTS_FOLDER_ID
    );

    const match = findBestBolMatch(items, bol, bidId);

    if (!match) {
      return res.status(404).json({
        success: false,
        error: 'No BOL PDF was found for this record.',
        searchedFor: { bol, bidId }
      });
    }

    res.json({
      success: true,
      documentType: 'BOL',
      name: match.name,
      webUrl: match.webUrl,
      id: match.id,
      lastModifiedDateTime: match.lastModifiedDateTime || ''
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/documents/finalsettle', requireLookupAccess, async (req, res) => {
  try {
    const bol = (req.query.bol || '').toString().trim();

    if (!bol) {
      return res.status(400).json({
        success: false,
        error: 'Missing BOL number.'
      });
    }

    if (!process.env.SHAREPOINT_DOCUMENTS_DRIVE_ID || !process.env.FINALSETTLE_FOLDER_ID) {
      return res.status(500).json({
        success: false,
        error: 'Final Settle document folder environment variables are not configured.'
      });
    }

    const token = await getGraphToken();

    const items = await getAllChildrenFromFolder(
      token,
      process.env.SHAREPOINT_DOCUMENTS_DRIVE_ID,
      process.env.FINALSETTLE_FOLDER_ID
    );

    const match = findBestFinalSettleMatch(items, bol);

    if (!match) {
      return res.status(404).json({
        success: false,
        error: 'No Final Settle PDF was found for this record.',
        searchedFor: { bol }
      });
    }

    res.json({
      success: true,
      documentType: 'Final Settle',
      name: match.name,
      webUrl: match.webUrl,
      id: match.id,
      lastModifiedDateTime: match.lastModifiedDateTime || ''
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/documents/dispatchsheet', requireLookupAccess, async (req, res) => {
  try {
    const bol = (req.query.bol || '').toString().trim();

    if (!bol) {
      return res.status(400).json({
        success: false,
        error: 'Missing BOL number.'
      });
    }

    if (!process.env.SHAREPOINT_DOCUMENTS_DRIVE_ID || !process.env.DISPATCHSHEETS_SP_FOLDER_ID) {
      return res.status(500).json({
        success: false,
        error: 'Dispatch Sheet document folder environment variables are not configured.'
      });
    }

    const token = await getGraphToken();

    const items = await getAllChildrenFromFolder(
      token,
      process.env.SHAREPOINT_DOCUMENTS_DRIVE_ID,
      process.env.DISPATCHSHEETS_SP_FOLDER_ID
    );

    const match = findBestDispatchSheetMatch(items, bol);

    if (!match) {
      return res.status(404).json({
        success: false,
        error: 'No Dispatch Sheet PDF was found for this record.',
        searchedFor: { bol }
      });
    }

    res.json({
      success: true,
      documentType: 'Dispatch Sheet',
      name: match.name,
      webUrl: match.webUrl,
      id: match.id,
      lastModifiedDateTime: match.lastModifiedDateTime || ''
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message });
  }
});


app.get('/documents/loadphotos/by-bol', requireLookupAccess, async (req, res) => {
  try {
    const bol = (req.query.bol || '').toString().trim();
    const driverHint = (req.query.driver || '').toString().trim();
    const compositeKey = (req.query.compositeKey || '').toString().trim();
    const uploadType = (req.query.uploadType || '').toString().trim();

    if (!bol) {
      return res.status(400).json({
        success: false,
        error: 'Missing BOL number.'
      });
    }

    if (!process.env.DISPATCH_ONEDRIVE_ID || !getLoadPicturesFolderId()) {
      return res.status(500).json({
        success: false,
        error: 'Load Pictures folder environment variables are not configured.'
      });
    }

    const token = await getGraphToken();
    const normalizedBol = normalizeBolKey(bol);
    const lists = await getSearchableBidLists(token);
    let matchedOrder = null;

    for (const sourceList of lists) {
      const records = await getAllBidItemsFromList(token, sourceList);
      matchedOrder = records.find((record) => normalizeBolKey(record.BOL) === normalizedBol);

      if (matchedOrder) break;
    }

    const compositeDriverHint = getDriverHintFromCompositeKey(compositeKey, bol);
    const candidateDrivers = uniqueNonEmpty([
      matchedOrder?.TMSName,
      matchedOrder?.Driver,
      driverHint,
      compositeDriverHint
    ]);

    const photoMatch = await findLoadPhotoFolderForBol(token, bol, {
      candidateDrivers,
      operatorInactive: matchedOrder?.OperatorInactive
    });

    if (!photoMatch) {
      return res.status(404).json({
        success: false,
        error: 'No load photo folder was found for this BOL.',
        searchedFor: {
          bol,
          candidateDrivers,
          orderMatched: Boolean(matchedOrder)
        }
      });
    }

    let targetFolder = photoMatch.loadFolder;
    let targetFolderType = 'Load Photos';

    if (uploadType) {
      const loadFolderChildren = await getAllChildrenFromFolder(
        token,
        process.env.DISPATCH_ONEDRIVE_ID,
        photoMatch.loadFolder.id
      );

      const uploadTypeFolder = findUploadTypeFolder(loadFolderChildren, uploadType);

      if (!uploadTypeFolder) {
        return res.status(404).json({
          success: false,
          error: `The ${uploadType} folder was not found inside the load photo folder.`,
          searchedFor: {
            bol,
            uploadType,
            loadFolder: photoMatch.loadFolder.name,
            driverFolder: photoMatch.driverFolder.name
          }
        });
      }

      targetFolder = uploadTypeFolder;
      targetFolderType = `${uploadType} Load Photos`;
    }

    res.json({
      success: true,
      documentType: targetFolderType,
      name: targetFolder.name,
      webUrl: targetFolder.webUrl,
      id: targetFolder.id,
      loadFolder: photoMatch.loadFolder.name,
      driverFolder: photoMatch.driverFolder.name,
      driver: photoMatch.driver,
      uploadType,
      operatorInactive: photoMatch.operatorInactive,
      matchStrategy: photoMatch.matchStrategy,
      orderId: matchedOrder?.id || '',
      sourceListId: matchedOrder?.SourceListId || '',
      sourceYear: matchedOrder?.SourceYear || '',
      lastModifiedDateTime: targetFolder.lastModifiedDateTime || ''
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/documents/loadphotos', requireLookupAccess, async (req, res) => {
  try {
    const bol = (req.query.bol || '').toString().trim();
    const driver = (req.query.driver || '').toString().trim();
    const operatorInactive = parseBoolean(req.query.operatorInactive);

    if (!bol) {
      return res.status(400).json({
        success: false,
        error: 'Missing BOL number.'
      });
    }

    if (!driver) {
      return res.status(400).json({
        success: false,
        error: 'Missing driver/operator name.'
      });
    }

    if (!process.env.DISPATCH_ONEDRIVE_ID || !getLoadPicturesFolderId()) {
      return res.status(500).json({
        success: false,
        error: 'Load Pictures folder environment variables are not configured.'
      });
    }

    const token = await getGraphToken();

    const rootItems = await getAllChildrenFromFolder(
      token,
      process.env.DISPATCH_ONEDRIVE_ID,
      getLoadPicturesFolderId()
    );

    let driverSearchItems = rootItems;
    let inactiveFolder = null;

    if (operatorInactive) {
      inactiveFolder = findFolderByExactName(rootItems, 'Inactive');

      if (!inactiveFolder) {
        return res.status(404).json({
          success: false,
          error: 'Inactive folder was not found inside Load Pictures and BOLs.',
          searchedFor: { bol, driver, operatorInactive }
        });
      }

      driverSearchItems = await getAllChildrenFromFolder(
        token,
        process.env.DISPATCH_ONEDRIVE_ID,
        inactiveFolder.id
      );
    }

    const driverFolder = findFolderByExactName(driverSearchItems, driver);

    if (!driverFolder) {
      return res.status(404).json({
        success: false,
        error: operatorInactive
          ? 'No inactive driver photo folder was found for this operator.'
          : 'No active driver photo folder was found for this operator.',
        searchedFor: { bol, driver, operatorInactive }
      });
    }

    const loadFolders = await getAllChildrenFromFolder(
      token,
      process.env.DISPATCH_ONEDRIVE_ID,
      driverFolder.id
    );

    const loadFolder = findFolderByBolPrefix(loadFolders, bol);

    if (!loadFolder) {
      return res.status(404).json({
        success: false,
        error: 'No load photo folder was found for this BOL under the operator folder.',
        searchedFor: {
          bol,
          driver,
          operatorInactive,
          driverFolder: driverFolder.name
        }
      });
    }

    res.json({
      success: true,
      documentType: 'Load Photos',
      name: loadFolder.name,
      webUrl: loadFolder.webUrl,
      id: loadFolder.id,
      driverFolder: driverFolder.name,
      operatorInactive,
      lastModifiedDateTime: loadFolder.lastModifiedDateTime || ''
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message });
  }
});


app.get('/documents/permits', requireLookupAccess, async (req, res) => {
  const bol = (req.query.bol || '').toString().trim();
  const operatorTeam = (req.query.operatorTeam || '').toString().trim();
  const officialFolderName = bol && operatorTeam ? `${bol} (${operatorTeam})` : '';
  const bolWithoutPrefix = bol ? bol.replace(/^[A-Za-z]/, '') : '';
  const legacyFolderName = bolWithoutPrefix && operatorTeam ? `${bolWithoutPrefix} (${operatorTeam})` : '';

  try {
    if (!bol) {
      return res.status(400).json({
        success: false,
        error: 'Missing BOL number.'
      });
    }

    if (!operatorTeam) {
      return res.status(400).json({
        success: false,
        error: 'Missing Operator/Team value.'
      });
    }

    if (!process.env.DISPATCH_ONEDRIVE_ID || !process.env.PERMIT_REQUESTS_FOLDER_ID) {
      return res.status(500).json({
        success: false,
        error: 'Permit folder environment variables are not configured.'
      });
    }

    const token = await getGraphToken();

    // List the children under the configured Permits root and check both supported names:
    // 1) Current standard: B195567 (Dottore)
    // 2) Legacy/cloud-side variant: 195567 (Dottore)
    const items = await getAllChildrenFromFolder(
      token,
      process.env.DISPATCH_ONEDRIVE_ID,
      process.env.PERMIT_REQUESTS_FOLDER_ID
    );

    const candidates = [officialFolderName, legacyFolderName]
      .filter(Boolean)
      .filter((value, index, array) => array.indexOf(value) === index);

    const match = candidates
      .map((candidate) => ({
        candidate,
        item: items.find((item) => item.folder && item.name === candidate)
      }))
      .find((entry) => entry.item);

    if (!match?.item) {
      return res.status(404).json({
        success: false,
        error: 'No permit folder was found for this order.',
        searchedFor: {
          bol,
          operatorTeam,
          officialFolderName,
          legacyFolderName,
          candidates
        }
      });
    }

    res.json({
      success: true,
      documentType: 'Permits',
      name: match.item.name,
      webUrl: match.item.webUrl,
      id: match.item.id,
      matchedFolderName: match.candidate,
      lastModifiedDateTime: match.item.lastModifiedDateTime || ''
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/record/:listId/:id', requireLookupAccess, async (req, res) => {
  try {
    const token = await getGraphToken();
    const listId = req.params.listId;
    const id = req.params.id;

    const lists = await getSearchableBidLists(token);
    const sourceList = lists.find((list) => list.listId === listId);

    if (!sourceList) {
      return res.status(404).json({
        success: false,
        error: 'Requested list is not part of the lookup search set.'
      });
    }

    const data = await graphGet(
      token,
      `https://graph.microsoft.com/v1.0/sites/${process.env.SITE_ID}/lists/${listId}/items/${id}?$expand=fields`
    );

    res.json(buildRecordResponse(data, sourceList));
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/record/:id', requireLookupAccess, async (req, res) => {
  try {
    const token = await getGraphToken();
    const id = req.params.id;

    const lists = await getSearchableBidLists(token);
    const currentList = lists.find((list) => list.label === 'Bid Listing');

    if (!currentList) {
      return res.status(404).json({
        success: false,
        error: 'Bid Listing was not found.'
      });
    }

    const data = await graphGet(
      token,
      `https://graph.microsoft.com/v1.0/sites/${process.env.SITE_ID}/lists/${currentList.listId}/items/${id}?$expand=fields`
    );

    res.json(buildRecordResponse(data, currentList));
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/record-fields/:listId/:id', requireLookupAccess, async (req, res) => {
  try {
    const token = await getGraphToken();
    const listId = req.params.listId;
    const id = req.params.id;

    const lists = await getSearchableBidLists(token);
    const sourceList = lists.find((list) => list.listId === listId);

    if (!sourceList) {
      return res.status(404).json({
        success: false,
        error: 'Requested list is not part of the lookup search set.'
      });
    }

    const data = await graphGet(
      token,
      `https://graph.microsoft.com/v1.0/sites/${process.env.SITE_ID}/lists/${listId}/items/${id}?$expand=fields`
    );

    res.json({
      success: true,
      id: data.id || '',
      SourceListId: sourceList.listId,
      SourceList: sourceList.label,
      SourceYear: sourceList.year,
      fields: data.fields || {}
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/record-fields/:id', requireLookupAccess, async (req, res) => {
  try {
    const token = await getGraphToken();
    const id = req.params.id;

    const lists = await getSearchableBidLists(token);
    const currentList = lists.find((list) => list.label === 'Bid Listing');

    if (!currentList) {
      return res.status(404).json({
        success: false,
        error: 'Bid Listing was not found.'
      });
    }

    const data = await graphGet(
      token,
      `https://graph.microsoft.com/v1.0/sites/${process.env.SITE_ID}/lists/${currentList.listId}/items/${id}?$expand=fields`
    );

    res.json({
      success: true,
      id: data.id || '',
      SourceListId: currentList.listId,
      SourceList: currentList.label,
      SourceYear: currentList.year,
      fields: data.fields || {}
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/sharepoint-docs-debug', requireLookupAccess, async (req, res) => {
  try {
    const token = await getGraphToken();

    const items = await getAllChildrenFromFolder(
      token,
      process.env.SHAREPOINT_DOCUMENTS_DRIVE_ID,
      'root'
    );

    res.json({
      count: items.length,
      items: items.map((i) => ({
        name: i.name,
        id: i.id,
        isFolder: !!i.folder
      }))
    });
  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});




app.get('/reports/sales-leads', requireLookupAccess, async (req, res) => {
  try {
    const salesLeadsListId = getSalesLeadsListId();

    if (!salesLeadsListId) {
      return res.status(500).json({
        success: false,
        error: 'SALES_LEADS_LIST_ID is not configured on the server.'
      });
    }

    const view = String(req.query.view || 'all').trim() || 'all';
    const sort = String(req.query.sort || '').trim();
    const token = await getGraphToken();
    const [items, customerRevenueIndex] = await Promise.all([
      getAllListItemsWithFields(token, salesLeadsListId, getSalesLeadFieldSelect()),
      buildCustomerRevenueIndex(token)
    ]);
    const records = items
      .map(cleanSalesLeadItem)
      .map((record) => enrichSalesLeadWithRevenue(record, customerRevenueIndex));
    const filtered = filterSalesLeads(records, view);

    let sortMode = sort || 'name';
    if (normalizeText(view) === 'followupdue') sortMode = sort || 'followUp';
    if (normalizeText(view) === 'unconverted') sortMode = sort || 'quotes';
    if (normalizeText(view) === 'aviation') sortMode = sort || 'quotes';

    res.json({
      success: true,
      generatedAt: `${formatEasternTimestamp()} Eastern`,
      reportLabel: 'Sales Leads',
      sourceListId: salesLeadsListId,
      view,
      sort: sortMode,
      recordsScanned: records.length,
      count: filtered.length,
      summary: getSalesLeadSummary(records),
      records: sortSalesLeads(filtered, sortMode)
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message || 'Unable to load Sales Leads.'
    });
  }
});


app.get('/reports/sales-leads/orders', requireLookupAccess, async (req, res) => {
  try {
    const customerCode = String(req.query.customerCode || '').trim();
    const year = Number(req.query.year || 0);

    if (!customerCode) {
      return res.status(400).json({
        success: false,
        error: 'Provide a customerCode query value.'
      });
    }

    if (!year) {
      return res.status(400).json({
        success: false,
        error: 'Provide a valid year query value.'
      });
    }

    const token = await getGraphToken();
    const results = await getCustomerOrdersByCodeAndYear(token, customerCode, year);

    res.json({
      success: true,
      reportType: 'salesLeadYearOrders',
      customerCode,
      year,
      searchedRecords: results.length,
      results
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message || 'Unable to load customer orders for that year.'
    });
  }
});

app.get('/sales-leads/by-customer', requireLookupAccess, async (req, res) => {
  try {
    const salesLeadsListId = getSalesLeadsListId();
    const customer = String(req.query.customer || '').trim();
    const customerCode = String(req.query.customerCode || '').trim();

    if (!salesLeadsListId) {
      return res.status(500).json({
        success: false,
        error: 'SALES_LEADS_LIST_ID is not configured on the server.'
      });
    }

    if (!customer && !customerCode) {
      return res.status(400).json({
        success: false,
        error: 'Provide a customer or customerCode query value.'
      });
    }

    const token = await getGraphToken();
    const [items, customerRevenueIndex] = await Promise.all([
      getAllListItemsWithFields(token, salesLeadsListId, getSalesLeadFieldSelect()),
      buildCustomerRevenueIndex(token)
    ]);
    const records = items
      .map(cleanSalesLeadItem)
      .map((record) => enrichSalesLeadWithRevenue(record, customerRevenueIndex));
    const customerKey = normalizeCustomerName(customer);
    const codeKey = normalizeText(customerCode);

    const matches = records
      .map((record) => {
        const recordName = normalizeCustomerName(record.CompanyName);
        const recordNormalizedName = normalizeCustomerName(record.NormalizedName);
        const recordCode = normalizeText(record.CustomerCode);
        let score = 0;

        if (codeKey && recordCode === codeKey) score += 1000;
        if (customerKey && recordNormalizedName === customerKey) score += 850;
        if (customerKey && recordName === customerKey) score += 800;
        if (customerKey && recordNormalizedName.startsWith(customerKey)) score += 550;
        if (customerKey && recordName.includes(customerKey)) score += 350;
        if (customerKey && customerKey.includes(recordNormalizedName) && recordNormalizedName) score += 250;

        return { ...record, MatchScore: score };
      })
      .filter((record) => record.MatchScore > 0)
      .sort((a, b) => b.MatchScore - a.MatchScore || String(a.CompanyName || '').localeCompare(String(b.CompanyName || '')));

    res.json({
      success: true,
      generatedAt: `${formatEasternTimestamp()} Eastern`,
      sourceListId: salesLeadsListId,
      query: { customer, customerCode },
      count: matches.length,
      matches
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message || 'Unable to lookup customer sales lead.'
    });
  }
});

app.get('/reports/won-not-registered', requireLookupAccess, async (req, res) => {
  try {
    const token = await getGraphToken();
    const lists = await getSearchableBidLists(token);
    const currentList = lists.find((list) => list.label === 'Bid Listing');

    if (!currentList) {
      return res.status(404).json({
        success: false,
        error: 'Bid Listing was not found.'
      });
    }

    const items = await getAllListItemsWithFields(
      token,
      currentList.listId,
      getWonNotRegisteredFieldSelect()
    );

    const report = buildWonNotRegisteredResponse(items, currentList);
    res.json(report);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


app.get('/reports/gross-revenue-totals', requireLookupAccess, async (req, res) => {
  try {
    const year = parseReportInteger(req.query.year || getEasternParts().year, 'year', 2024, 2030);
    const token = await getGraphToken();
    const sourceList = await getDriverSummarySourceList(token, year);

    if (!sourceList) {
      return res.status(404).json({
        success: false,
        error: `No Bid Listing source list was found for ${year}.`
      });
    }

    const items = await getAllListItemsWithFields(
      token,
      sourceList.listId,
      getGrossRevenueFieldSelect()
    );

    res.json(buildGrossRevenueTotalsResponse(items, sourceList, year));
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message || 'Unable to load Gross Revenue Totals.'
    });
  }
});

app.get('/reports/orders-due-for-settlement', requireLookupAccess, async (req, res) => {
  try {
    const token = await getGraphToken();
    const lists = await getSearchableBidLists(token);
    const currentList = lists.find((list) => list.label === 'Bid Listing');

    if (!currentList) {
      return res.status(404).json({
        success: false,
        error: 'Bid Listing not found.'
      });
    }

    const items = await getAllListItemsWithFields(
      token,
      currentList.listId,
      getOrdersDueForSettlementFieldSelect()
    );

    res.json(buildOrdersDueForSettlementResponse(items, currentList));
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message || 'Unable to load Orders Due for Settlement.'
    });
  }
});


app.get('/reports/weekly-settlement', requireLookupAccess, async (req, res) => {
  try {
    const cutoffDate = String(req.query.cutoffDate || '').trim();
    const cutoff = parseCutoffDateValue(cutoffDate);

    const token = await getGraphToken();
    const allLists = await getSearchableBidLists(token);

    // Settlement is anchored to paperwork submission date/time, not pickup/delivery year.
    // Because older orders can be submitted/processed later, accounting reports must scan
    // every available archive from the first archive year through the selected cutoff year,
    // plus the live Bid Listing.
    // Example: a December 2025 cutoff scans Archive 2024, Archive 2025, and Bid Listing.
    const sourceLists = allLists
      .filter((list) => {
        if (list.label === 'Bid Listing') return true;

        const sourceYear = Number(list.year);
        if (!Number.isInteger(sourceYear)) return false;

        return sourceYear >= ARCHIVE_YEAR_MIN && sourceYear <= cutoff.year;
      })
      .sort((a, b) => {
        if (a.label === 'Bid Listing') return 1;
        if (b.label === 'Bid Listing') return -1;

        return Number(a.year || 0) - Number(b.year || 0);
      });

    if (sourceLists.length === 0) {
      return res.status(404).json({
        success: false,
        error: `No Bid Listing source list was found for settlement cutoff ${cutoffDate}.`
      });
    }

    const settled = await Promise.allSettled(
      sourceLists.map(async (sourceList) => {
        const listItems = await getAllListItemsWithFields(
          token,
          sourceList.listId,
          getSettlementFieldSelect()
        );

        return listItems.map((item) => ({
          item,
          sourceList,
          sourceListId: sourceList.listId
        }));
      })
    );

    const successfulItems = settled
      .filter((result) => result.status === 'fulfilled')
      .flatMap((result) => result.value);

    const failedLists = settled
      .map((result, index) => ({ result, list: sourceLists[index] }))
      .filter((entry) => entry.result.status === 'rejected')
      .map((entry) => ({
        SourceList: entry.list.label,
        error: entry.result.reason?.message || 'Unknown settlement report list failure'
      }));

    const report = buildWeeklySettlementResponse(successfulItems, sourceLists, cutoffDate);

    res.json({
      ...report,
      failedLists
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


app.get('/reports/driver-summary', requireLookupAccess, async (req, res) => {
  try {
    const month = parseReportInteger(req.query.month, 'month', 1, 12);
    const year = parseReportInteger(req.query.year, 'year', 2024, 2030);
    const lockStatus = getDriverSummaryLockStatus(year, month);

    if (!lockStatus.isUnlocked) {
      return res.status(423).json({
        success: false,
        error: 'REPORT_LOCKED',
        message: `${lockStatus.reportLabel} Driver Summary Report is not available yet.`,
        reportLabel: lockStatus.reportLabel,
        unlockLabel: lockStatus.unlockLabel,
        lockReason:
          'Monthly Driver Summary Reports unlock at 8:00 AM Eastern on the 5th day of the following month. This allows time for completed settlements, paperwork review, and final corrections before driver performance data is published.'
      });
    }

    const token = await getGraphToken();
    const sourceList = await getDriverSummarySourceList(token, year);

    if (!sourceList) {
      return res.status(404).json({
        success: false,
        error: `No Bid Listing source list was found for ${year}.`
      });
    }

    const items = await getAllListItemsWithFields(
      token,
      sourceList.listId
    );

    const report = buildDriverSummaryResponse(items, sourceList, year, month);

    res.json(report);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


app.get('/tracking/driver-positions', requireLookupAccess, async (req, res) => {
  try {
    const driverPositionsListId = process.env.DRIVER_POSITIONS_LIST_ID;

    if (!driverPositionsListId) {
      return res.status(500).json({
        success: false,
        error: 'DRIVER_POSITIONS_LIST_ID is not configured on the server.'
      });
    }

    const token = await getGraphToken();
    const [items, rosterByTruck] = await Promise.all([
      getAllListItemsWithFields(
        token,
        driverPositionsListId,
        getDriverPositionFieldSelect()
      ),
      getDriverRosterByTruck(token)
    ]);

    const positions = items
      .map(cleanDriverPositionItem)
      .map((position) => {
        const roster = rosterByTruck.get(normalizeTruckKey(position.equipmentId)) || null;

        return {
          ...position,
          roster,
          hasRosterDetails: Boolean(roster)
        };
      })
      .sort(sortDriverPositions);

    res.json({
      success: true,
      generatedAt: `${formatEasternTimestamp()} Eastern`,
      sourceListId: driverPositionsListId,
      rosterSourceListId: process.env.DRIVER_ROSTER_LIST_ID || '',
      counts: {
        total: positions.length,
        moving: positions.filter((p) => p.isMoving).length,
        stopped: positions.filter((p) => !p.isMoving).length,
        stale: positions.filter((p) => p.isStale).length,
        unmatchedRoster: positions.filter((p) => p.rosterMatched !== true).length,
        missingRosterDetails: positions.filter((p) => !p.hasRosterDetails).length
      },
      positions
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message || 'Unable to load driver position tracking.'
    });
  }
});


app.get('/upload-digest', requireLookupAccess, async (req, res) => {
  try {
    const token = await getGraphToken();
    const targetDate = normalizeEasternDateOnly(req.query.date) || formatEasternDate();
    const uploadDigestListId =
      process.env.UPLOAD_DIGEST_LIST_ID || DEFAULT_UPLOAD_DIGEST_LIST_ID;

    if (!uploadDigestListId) {
      return res.status(500).json({
        success: false,
        error: 'UPLOAD_DIGEST_LIST_ID is not configured on the server.'
      });
    }

    const uploadItems = await getAllListItemsWithFields(
      token,
      uploadDigestListId
    );

    const rawRecords = uploadItems
      .map(buildUploadDigestRecord)
      .filter((record) => normalizeEasternDateOnly(record.UploadDate) === targetDate)
      .sort((a, b) => {
        const aTime = new Date(a.UploadDate).getTime();
        const bTime = new Date(b.UploadDate).getTime();

        if (Number.isNaN(aTime) && Number.isNaN(bTime)) return 0;
        if (Number.isNaN(aTime)) return 1;
        if (Number.isNaN(bTime)) return -1;

        return bTime - aTime;
      });

    const seenUploadKeys = new Set();
    const records = [];

    rawRecords.forEach((record) => {
      const bolKey = normalizeBolKey(record.BOLNumber);
      const typeKey = normalizeText(record.UploadType) || 'unknown';
      const uploadKey = `${bolKey}|${typeKey}`;

      if (!bolKey || seenUploadKeys.has(uploadKey)) return;

      seenUploadKeys.add(uploadKey);
      records.push(record);
    });

    res.json({
      success: true,
      generatedAt: `${formatEasternTimestamp()} Eastern`,
      targetDate,
      count: records.length,
      rawCount: rawRecords.length,
      recordsScanned: uploadItems.length,
      records
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message || 'Unable to load Upload Digest.'
    });
  }
});

app.get('/operations/today', requireLookupAccess, async (req, res) => {
  try {
    const token = await getGraphToken();

    const lists = await getSearchableBidLists(token);

    const currentList = lists.find(
      (list) => list.label === 'Bid Listing'
    );

    if (!currentList) {
      return res.status(404).json({
        success: false,
        error: 'Bid Listing not found.'
      });
    }

    const items = await getAllListItemsWithFields(
      token,
      currentList.listId,
      [
        'BOLNumber_x0028_Won_x0029_',
        'BidID',
        'Company',
        'Shipment_x0020_Origin',
        'Shipment_x0020_Destination',
        'Operator_x002f_Team',
        'Truck_x0020_Number',
        'Pickup_x0020_Offer_x0020_Date',
        'Expected_x0020_Delivery_x0020_Da',
        'Status',
        'Processed'
      ].join(',')
    );

    const today = formatEasternDate();
    const plus7 = formatEasternDate(
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    );

    const all = items
      .map((item) => buildOperationsRecord(item, currentList))
      .filter(
        (r) =>
          normalizeText(r.Status) === 'won' &&
          (r.Processed === false ||
            r.Processed === null ||
            r.Processed === '')
      );

    function normalizeDate(value) {
      if (!value) return '';

      const raw = String(value).trim();
      const dateOnlyMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);

      if (dateOnlyMatch) {
        return dateOnlyMatch[1];
      }

      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) return '';

      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(parsed);
    }

    const evidenceSets = await getUploadEvidenceSets(token);

    const activeToday = all
      .filter((r) => {
        const pickup = normalizeDate(r.PickupDate);
        const delivery = normalizeDate(r.DeliveryDate);

        return pickup && delivery && pickup <= today && delivery >= today;
      })
      .map((r) => addUploadEvidence(r, evidenceSets));

    const loadingToday = all
      .filter((r) => normalizeDate(r.PickupDate) === today)
      .map((r) => addUploadEvidence(r, evidenceSets));

    const deliveringToday = all
      .filter((r) => normalizeDate(r.DeliveryDate) === today)
      .map((r) => addUploadEvidence(r, evidenceSets));

    const loadingNext7 = all
      .filter((r) => {
        const pickup = normalizeDate(r.PickupDate);
        return pickup > today && pickup <= plus7;
      })
      .map((r) => addUploadEvidence(r, evidenceSets));

    res.json({
      success: true,
      generatedAt: `${formatEasternTimestamp()} Eastern`,
      targetDate: today,
      counts: {
        rawItemsScanned: items.length,
        eligibleWonUnprocessed: all.length,
        activeToday: activeToday.length,
        loadingToday: loadingToday.length,
        deliveringToday: deliveringToday.length,
        loadingNext7: loadingNext7.length
      },
      uploadDigest: {
        checked: true,
        recordsScanned: evidenceSets.uploadDigestCount
      },
      activeToday,
      loadingToday,
      deliveringToday,
      loadingNext7
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
app.get('/reports/inactive-driver-roster', requireLookupAccess, async (req, res) => {
  try {
    if (!process.env.DRIVER_ROSTER_LIST_ID) {
      return res.status(500).json({
        success: false,
        error: 'DRIVER_ROSTER_LIST_ID is not configured on the server.'
      });
    }

    const token = await getGraphToken();
    const rosterItems = await getDriverRosterItems(token);

    const inactiveDrivers = rosterItems
      .filter((roster) => normalizeText(roster.status) === 'inactive')
      .sort(sortDriverRosterRecords);

    res.json({
      success: true,
      generatedAt: `${formatEasternTimestamp()} Eastern`,
      reportLabel: 'Inactive Driver Roster',
      sourceListId: process.env.DRIVER_ROSTER_LIST_ID,
      count: inactiveDrivers.length,
      rows: inactiveDrivers
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message || 'Unable to load inactive driver roster.'
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});