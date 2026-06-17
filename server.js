require('dotenv').config();

const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '256kb' }));

const PORT = process.env.PORT || 5000;

const ARCHIVE_YEAR_MIN = 2024;
const ARCHIVE_YEAR_MAX = 2030;
const DEFAULT_UPLOAD_DIGEST_LIST_ID = 'c9e907f9-cdac-4657-9da6-cc6ecfaa19a8';
const DEFAULT_KOLE_AUTO_UPDATER_LIST_ID = 'fd5b0d2f-b0e7-4445-a36d-af753825a3ea';
const DEFAULT_SALES_LEADS_LIST_ID = '86cc3352-fb75-421d-a5e4-4b16d011fd1e';
const DEFAULT_SALES_LEADS_NOTES_LIST_NAME = 'Sales Leads Notes Log';
const DEFAULT_CUSTOMER_BOOKING_TRENDS_LIST_ID = 'f899ef92-6489-43b1-9a9f-19c5f0ee83b9';
const DEFAULT_NO_AVAILABILITY_MAIN_LIST_ID = '38f3bf2a-30d2-48eb-8b6f-8f5c05e5f1d7';
const DEFAULT_NO_AVAILABILITY_2025_LIST_ID = '138431f5-a32d-452d-abf4-05adbd0ab50d';
const DEFAULT_NO_AVAILABILITY_2024_LIST_ID = '8336e21e-38bb-47c0-bc01-6fea891b7cf6';
const DEFAULT_AVAILABLE_TRUCKS_SINGLE_LINE_LIST_ID = '67edb153-a389-474a-a7dd-d3bc0d746952';
const DEFAULT_AVAILABLE_EQUIPMENT_SOURCE_LIST_ID = '96af7972-58ff-4bb8-b5a6-ca86f4d19ee6';
const DEFAULT_AVAILABLE_TRUCKS_EMAIL_LIST_ID = '2458883d-ea8b-4761-8047-a04e35e9f93f';
const DRIVER_TIME_OFF_DEFAULT_REPORT_YEARS_BACK = 3;
const AVAILABLE_TRUCKS_DEFAULT_LOOKBACK_DAYS = 30;
const SALES_LEAD_NOTE_MAX_LENGTH = 63000;

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
let cachedSalesLeadsNotesListId = null;
let cachedSalesLeadsNotesListIdAt = 0;
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

async function graphGet(token, url, extraHeaders = {}) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      ...extraHeaders
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(JSON.stringify(data));
  }

  return data;
}

async function graphPatch(token, url, body) {
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(JSON.stringify(data));
  }

  return data;
}


async function graphPost(token, url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = await response.json().catch(() => ({}));

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

function isValidDateInput(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

function addDaysToDateInput(dateValue, days) {
  const [year, month, day] = String(dateValue || formatEasternDate())
    .split('-')
    .map(Number);

  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + Number(days || 0));

  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0')
  ].join('-');
}

function getOperationsTargetDate(value) {
  const candidate = String(value || '').trim();
  return isValidDateInput(candidate) ? candidate : formatEasternDate();
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
    Processed: fields.Processed ?? false,
    IsProcessed: parseBoolean(fields.Processed),
    IsSettled: parseBoolean(fields.Processed)
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

function normalizeGraphName(value) {
  return String(value || '')
    .replace(/_x0020_/gi, ' ')
    .replace(/[^a-z0-9]+/gi, '')
    .toLowerCase();
}

async function getListIdByDisplayName(token, displayName) {
  const target = normalizeGraphName(displayName);
  if (!target) return '';

  const data = await graphGet(
    token,
    `https://graph.microsoft.com/v1.0/sites/${process.env.SITE_ID}/lists?$select=id,displayName,list`
  );

  const lists = (data.value || []).filter((list) => list?.list?.hidden !== true);

  const exactMatch = lists.find((list) => normalizeGraphName(list.displayName) === target);
  if (exactMatch?.id) return exactMatch.id;

  const fuzzyMatch = lists.find((list) => {
    const normalized = normalizeGraphName(list.displayName);
    return normalized.includes('salesleadsnoteslog') || (
      normalized.includes('sales') &&
      normalized.includes('lead') &&
      normalized.includes('note')
    );
  });

  return fuzzyMatch?.id || '';
}

async function getSalesLeadsNotesListId(token) {
  const configured = String(process.env.SALES_LEADS_NOTES_LIST_ID || '').trim();
  if (configured) return configured;

  const now = Date.now();
  if (cachedSalesLeadsNotesListId && now - cachedSalesLeadsNotesListIdAt < BID_LIST_CACHE_MS) {
    return cachedSalesLeadsNotesListId;
  }

  const discovered = await getListIdByDisplayName(token, DEFAULT_SALES_LEADS_NOTES_LIST_NAME);
  cachedSalesLeadsNotesListId = discovered || '';
  cachedSalesLeadsNotesListIdAt = now;

  return cachedSalesLeadsNotesListId;
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

function getFlexibleFieldValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    return value.Value || value.value || value.Label || value.label || value.DisplayName || value.displayName || value.Title || value.title || '';
  }
  return value;
}

function getFlexibleField(fields, candidateNames) {
  for (const name of candidateNames) {
    if (fields[name] !== undefined && fields[name] !== null && fields[name] !== '') {
      return getFlexibleFieldValue(fields[name]);
    }
  }

  const normalizedCandidates = candidateNames.map(normalizeGraphName);
  const matchedKey = Object.keys(fields || {}).find((key) => normalizedCandidates.includes(normalizeGraphName(key)));

  return matchedKey ? getFlexibleFieldValue(fields[matchedKey]) : '';
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
function cleanSalesLeadNoteItem(item) {
  const f = item.fields || {};
  const touchDate = getFlexibleField(f, [
    'TouchDate',
    'Touch_x0020_Date',
    'NoteDate',
    'Note_x0020_Date',
    'ActivityDate',
    'Activity_x0020_Date'
  ]) || '';
  const createdDate = getFlexibleField(f, [
    'Created',
    'CreatedDate',
    'Created_x0020_Date'
  ]) || item.createdDateTime || '';
  const noteDate = touchDate || createdDate;

  const noteText = stripHtml(getFlexibleField(f, [
    'Note',
    'Notes',
    'NoteText',
    'Note_x0020_Text',
    'Comments',
    'Comment',
    'Body',
    'Description'
  ]) || f.Title || '');

  const title = stripHtml(getFlexibleField(f, [
    'Subject',
    'Title',
    'Topic'
  ]));

  return {
    id: item.id || '',
    CustomerCode: getFlexibleField(f, ['CustomerCode', 'Customer_x0020_Code', 'Customer']) || '',
    CustomerName: getFlexibleField(f, ['CustomerName', 'Customer_x0020_Name', 'CompanyName', 'Company_x0020_Name']) || '',
    NoteDate: noteDate,
    NoteDateDisplay: formatShortDate(noteDate),
    CreatedDate: createdDate,
    CreatedDateDisplay: formatShortDate(createdDate),
    NoteType: getFlexibleField(f, ['NoteType', 'Note_x0020_Type', 'ActivityType', 'Type']) || '',
    Title: title,
    Note: noteText,
    Author: getFlexibleField(f, ['Author', 'CreatedBy', 'Created_x0020_By', 'EnteredBy', 'Entered_x0020_By']) || item.createdBy?.user?.displayName || '',
    NextTouchDate: getFlexibleField(f, ['NextTouchDate', 'Next_x0020_Touch', 'FollowUpDate', 'Follow_x0020_Up_x0020_Date']) || '',
    webUrl: item.webUrl || ''
  };
}

async function getSalesLeadNotesBundle(token) {
  try {
    const notesListId = await getSalesLeadsNotesListId(token);

    if (!notesListId) {
      return {
        notesIndex: new Map(),
        sourceListId: '',
        status: 'notFound',
        error: `${DEFAULT_SALES_LEADS_NOTES_LIST_NAME} was not found. Set SALES_LEADS_NOTES_LIST_ID or confirm the list display name.`,
        recordsScanned: 0
      };
    }

    const items = await getAllListItemsWithFields(token, notesListId);
    const notes = items
      .map(cleanSalesLeadNoteItem)
      .filter((note) => normalizeText(note.CustomerCode) && (note.Note || note.Title));

    const notesIndex = new Map();

    notes.forEach((note) => {
      const key = normalizeText(note.CustomerCode);
      if (!notesIndex.has(key)) notesIndex.set(key, []);
      notesIndex.get(key).push(note);
    });

    notesIndex.forEach((customerNotes) => {
      customerNotes.sort((a, b) => {
        const aTime = new Date(a.NoteDate || 0).getTime() || 0;
        const bTime = new Date(b.NoteDate || 0).getTime() || 0;
        return bTime - aTime;
      });
    });

    return {
      notesIndex,
      sourceListId: notesListId,
      status: 'available',
      error: '',
      recordsScanned: notes.length
    };
  } catch (error) {
    return {
      notesIndex: new Map(),
      sourceListId: '',
      status: 'error',
      error: error.message || 'Unable to load Sales Leads Notes Log.',
      recordsScanned: 0
    };
  }
}

function enrichSalesLeadWithNotes(record, notesIndex) {
  const customerCode = normalizeText(record.CustomerCode);
  const notes = customerCode ? notesIndex.get(customerCode) || [] : [];

  return {
    ...record,
    SalesNotes: notes,
    SalesNotesCount: notes.length,
    LastSalesNoteDate: notes[0]?.NoteDate || ''
  };
}


function cleanSalesLeadNoteInput(value) {
  return String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

function getSalesLeadNoteTitle(customerName, customerCode, touchDate) {
  const customer = String(customerName || customerCode || 'Sales Note').trim();
  return `${customer} - ${touchDate}`.slice(0, 255);
}

async function createSalesLeadNote(token, input) {
  const notesListId = await getSalesLeadsNotesListId(token);

  if (!notesListId) {
    throw new Error(`${DEFAULT_SALES_LEADS_NOTES_LIST_NAME} was not found. Set SALES_LEADS_NOTES_LIST_ID or confirm the list display name.`);
  }

  const customerCode = String(input.customerCode || '').trim();
  const customerName = String(input.customerName || '').trim();
  const noteText = cleanSalesLeadNoteInput(input.note || input.notes || '');
  const touchDate = formatEasternDate();

  if (!customerCode) {
    const error = new Error('Customer Code is required before adding a sales note.');
    error.statusCode = 400;
    throw error;
  }

  if (!noteText) {
    const error = new Error('Enter a note before saving.');
    error.statusCode = 400;
    throw error;
  }

  if (noteText.length > SALES_LEAD_NOTE_MAX_LENGTH) {
    const error = new Error(`Sales note is too long. Limit notes to ${SALES_LEAD_NOTE_MAX_LENGTH.toLocaleString('en-US')} characters.`);
    error.statusCode = 400;
    throw error;
  }

  const item = await graphPost(
    token,
    `https://graph.microsoft.com/v1.0/sites/${process.env.SITE_ID}/lists/${notesListId}/items`,
    {
      fields: {
        Title: getSalesLeadNoteTitle(customerName, customerCode, touchDate),
        CustomerCode: customerCode,
        CustomerName: customerName,
        TouchDate: touchDate,
        Notes: noteText
      }
    }
  );

  return cleanSalesLeadNoteItem(item);
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


function addDaysToDateKey(dateKey, days) {
  const [year, month, day] = String(dateKey || formatEasternDate())
    .slice(0, 10)
    .split('-')
    .map(Number);

  if (!year || !month || !day) return formatEasternDate();

  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + Number(days || 0));

  return date.toISOString().slice(0, 10);
}

function getDateKey(value) {
  if (!value) return '';

  const raw = String(value || '').trim();
  const directMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (directMatch) return directMatch[1];

  return normalizeEasternDateOnly(raw);
}

function clampSalesActivityDays(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) return 7;

  return Math.min(Math.max(Math.floor(number), 1), 90);
}

function getSalesActivityDateRange(query = {}) {
  const today = formatEasternDate();
  const lookbackDays = clampSalesActivityDays(query.days || query.lookbackDays || 7);
  let endDate = getDateKey(query.endDate) || today;
  let startDate = getDateKey(query.startDate) || addDaysToDateKey(endDate, -(lookbackDays - 1));

  if (startDate > endDate) {
    const swap = startDate;
    startDate = endDate;
    endDate = swap;
  }

  return {
    lookbackDays,
    startDate,
    endDate,
    dueStartDate: today,
    dueEndDate: addDaysToDateKey(today, lookbackDays - 1)
  };
}

function isDateKeyInRange(value, startDate, endDate) {
  const key = getDateKey(value);
  return Boolean(key && key >= startDate && key <= endDate);
}

function isSalesLeadActionable(record) {
  const status = normalizeText(record.Status);

  if (record.FollowUpPending !== true) return false;
  if (normalizeText(record.FollowUpHandling) === 'suppressed') return false;
  if (status === 'ignore' || status === 'inactive') return false;

  return true;
}

function buildSalesActivityLeadRow(record) {
  return {
    id: record.id || '',
    CompanyName: record.CompanyName || '',
    CustomerCode: record.CustomerCode || '',
    Status: record.Status || '',
    NextTouchDate: record.NextTouchDate || '',
    NextTouchDisplay: formatShortDate(record.NextTouchDate),
    QuoteCount: Number(record.QuoteCount || 0) || 0,
    FirstQuoteDate: record.FirstQuoteDate || '',
    FirstQuoteDisplay: formatShortDate(record.FirstQuoteDate),
    LastQuoteDate: record.LastQuoteDate || '',
    LastQuoteDisplay: formatShortDate(record.LastQuoteDate),
    FollowUpHandling: record.FollowUpHandling || '',
    AviationRelated: record.AviationRelated === true
  };
}

function buildSalesActivityNoteRow(note, lead = {}) {
  const activityDate = note.CreatedDate || note.NoteDate || '';
  const touchDate = note.NoteDate || note.CreatedDate || '';

  return {
    id: note.id || '',
    CustomerCode: note.CustomerCode || lead.CustomerCode || '',
    CompanyName: note.CustomerName || lead.CompanyName || '',
    Status: lead.Status || '',
    ActivityDate: activityDate,
    ActivityDateDisplay: formatShortDate(activityDate),
    TouchDate: touchDate,
    TouchDateDisplay: formatShortDate(touchDate),
    Note: note.Note || '',
    Title: note.Title || '',
    Author: note.Author || '',
    NoteType: note.NoteType || '',
    webUrl: note.webUrl || ''
  };
}

function sortByDateThenCompany(records, dateField = 'NextTouchDate', direction = 'asc') {
  return [...records].sort((a, b) => {
    const aDate = getDateKey(a[dateField]) || (direction === 'asc' ? '9999-12-31' : '0000-00-00');
    const bDate = getDateKey(b[dateField]) || (direction === 'asc' ? '9999-12-31' : '0000-00-00');
    const dateDiff = direction === 'asc' ? aDate.localeCompare(bDate) : bDate.localeCompare(aDate);

    if (dateDiff !== 0) return dateDiff;

    return String(a.CompanyName || '').localeCompare(String(b.CompanyName || ''));
  });
}

function getUniqueSalesActivityCustomerCount(...sections) {
  const keys = new Set();

  sections.flat().forEach((record) => {
    const key = normalizeText(record.CustomerCode) || normalizeCustomerName(record.CompanyName);
    if (key) keys.add(key);
  });

  return keys.size;
}

function buildSalesActivitySnapshot(records, notesBundle, range) {
  const today = formatEasternDate();
  const leadsByCode = new Map();

  records.forEach((record) => {
    const key = normalizeText(record.CustomerCode);
    if (key && !leadsByCode.has(key)) leadsByCode.set(key, record);
  });

  const actionableLeads = records.filter(isSalesLeadActionable);

  const dueFollowUps = sortByDateThenCompany(
    actionableLeads
      .filter((record) => isDateKeyInRange(record.NextTouchDate, range.dueStartDate, range.dueEndDate))
      .map(buildSalesActivityLeadRow),
    'NextTouchDate',
    'asc'
  );

  const overdueFollowUps = sortByDateThenCompany(
    actionableLeads
      .filter((record) => {
        const nextTouch = getDateKey(record.NextTouchDate);
        return nextTouch && nextTouch < today;
      })
      .map(buildSalesActivityLeadRow),
    'NextTouchDate',
    'asc'
  );

  const notes = Array.from(notesBundle.notesIndex.values()).flat();

  const notesAdded = sortByDateThenCompany(
    notes
      .filter((note) => isDateKeyInRange(note.CreatedDate || note.NoteDate, range.startDate, range.endDate))
      .map((note) => buildSalesActivityNoteRow(note, leadsByCode.get(normalizeText(note.CustomerCode)))),
    'ActivityDate',
    'desc'
  );

  const completedFollowUps = sortByDateThenCompany(
    notes
      .filter((note) => isDateKeyInRange(note.NoteDate, range.startDate, range.endDate))
      .map((note) => buildSalesActivityNoteRow(note, leadsByCode.get(normalizeText(note.CustomerCode)))),
    'TouchDate',
    'desc'
  );

  return {
    success: true,
    reportType: 'salesActivitySnapshot',
    reportLabel: 'Sales Activity Snapshot',
    generatedAt: `${formatEasternTimestamp()} Eastern`,
    lookbackDays: range.lookbackDays,
    activityStartDate: range.startDate,
    activityEndDate: range.endDate,
    dueStartDate: range.dueStartDate,
    dueEndDate: range.dueEndDate,
    activityPeriodLabel: `${formatShortDate(range.startDate)} to ${formatShortDate(range.endDate)}`,
    duePeriodLabel: `${formatShortDate(range.dueStartDate)} to ${formatShortDate(range.dueEndDate)}`,
    notesStatus: notesBundle.status,
    notesError: notesBundle.error,
    notesSourceListId: notesBundle.sourceListId,
    recordsScanned: records.length,
    notesScanned: notesBundle.recordsScanned,
    summary: {
      overdueFollowUps: overdueFollowUps.length,
      dueFollowUps: dueFollowUps.length,
      notesAdded: notesAdded.length,
      completedFollowUps: completedFollowUps.length,
      touchedCustomers: getUniqueSalesActivityCustomerCount(notesAdded, completedFollowUps)
    },
    sections: {
      overdueFollowUps,
      dueFollowUps,
      notesAdded,
      completedFollowUps
    }
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

async function getAllListItemsWithFieldsResilient(token, listId, fieldSelect = '') {
  try {
    return {
      items: await getAllListItemsWithFields(token, listId, fieldSelect),
      usedFallback: false,
      warning: ''
    };
  } catch (error) {
    if (!fieldSelect) throw error;

    const fallbackItems = await getAllListItemsWithFields(token, listId);

    return {
      items: fallbackItems,
      usedFallback: true,
      warning: error.message || 'Selected field fetch failed; retried with full fields.'
    };
  }
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

function getElapsedMonthCountForReportYear(year) {
  const selectedYear = Number(year);
  const current = getEasternParts();

  if (selectedYear < current.year) return 12;
  if (selectedYear > current.year) return 12;

  return Math.max(1, current.month);
}

function safeAverage(total, divisor) {
  const cleanDivisor = Number(divisor);
  return cleanDivisor > 0 ? Number(total || 0) / cleanDivisor : 0;
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
    'Pickup1PickupTime',
    'Pickup1AMorPM',
    'Expected_x0020_Delivery_x0020_Da',
    'Shipment_x0020_Origin',
    'Shipment_x0020_Destination',
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

function getCustomerBookingTrendsListId() {
  return process.env.CUSTOMER_BOOKING_TRENDS_LIST_ID || DEFAULT_CUSTOMER_BOOKING_TRENDS_LIST_ID;
}

function getCustomerBookingTrendsSourceFieldSelect() {
  return [
    'BOLNumber_x0028_Won_x0029_',
    'BidID',
    'Company',
    'CustomerCode',
    'Pickup_x0020_Offer_x0020_Date',
    'Status',
    'Quoted_x0020_Total',
    'FinalBillableTotal',
    'Loaded_x0020_Miles'
  ].join(',');
}

function getCustomerBookingTrendRecordFromBidItem(item, sourceList) {
  const f = item.fields || {};
  const pickup = getUtcYearMonth(f.Pickup_x0020_Offer_x0020_Date);
  const status = normalizeText(getChoiceValue(f.Status || f['Status/Value'] || ''));

  if (!pickup) return null;
  if (status !== 'won' && status !== 'tonu') return null;

  const customer = getChoiceValue(f.Company || f['Company/Value'] || '');
  const quotedTotal = getNumberValue(f.Quoted_x0020_Total);
  const finalBillableTotal = getNumberValue(f.FinalBillableTotal);
  const revenue = finalBillableTotal > 0 ? finalBillableTotal : quotedTotal;
  const loadedMiles = getNumberValue(f.Loaded_x0020_Miles);

  return {
    id: item.id || '',
    SourceListId: sourceList?.listId || '',
    SourceYear: sourceList?.year || '',
    BOL: f.BOLNumber_x0028_Won_x0029_ || '',
    BidID: f.BidID || '',
    Customer: customer,
    CustomerCode: f.CustomerCode || '',
    BookingYear: pickup.year,
    BookingMonth: pickup.month,
    Jobs: 1,
    Revenue: revenue,
    LoadedMiles: loadedMiles,
    RatePerLoadedMile: loadedMiles > 0 ? revenue / loadedMiles : 0,
    Status: getChoiceValue(f.Status || f['Status/Value'] || '')
  };
}

function getCustomerBookingTrendsFieldSelect() {
  return [
    'Customer',
    'BookingYear',
    'BookingMonth',
    'Jobs',
    'Revenue',
    'Average_x0024__x002f_LoadedMile',
    '_x0025_ofRevenue'
  ].join(',');
}

function getCustomerTrendReportLockStatus(year, month, now = new Date()) {
  return getDriverSummaryLockStatus(year, month, now);
}

function getTrendPercentChange(currentValue, previousValue) {
  const current = Number(currentValue || 0);
  const previous = Number(previousValue || 0);

  if (previous <= 0) return null;

  return (current - previous) / previous;
}

function getCustomerTrendBucket(currentRevenue, previousRevenue) {
  const current = Number(currentRevenue || 0);
  const previous = Number(previousRevenue || 0);

  if (current > 0 && previous <= 0) return 'newReturning';
  if (current <= 0 && previous > 0) return 'dormant';
  if (current > previous) return 'growing';
  if (current < previous) return 'declining';
  if (current > 0) return 'steady';
  return 'inactive';
}

function getCustomerTrendBucketLabel(bucket) {
  switch (bucket) {
    case 'growing':
      return 'Growing';
    case 'declining':
      return 'Declining';
    case 'dormant':
      return 'Dormant';
    case 'newReturning':
      return 'New / Returning';
    case 'steady':
      return 'Steady';
    default:
      return 'Inactive';
  }
}

function getCustomerBookingTrendItem(item) {
  const f = item.fields || {};
  const jobs = getNumberValue(f.Jobs);
  const revenue = getNumberValue(f.Revenue);
  const ratePerLoadedMile = getNumberValue(f.Average_x0024__x002f_LoadedMile);
  const percentOfRevenue = getNumberValue(f._x0025_ofRevenue);

  return {
    id: item.id || '',
    Customer: getChoiceValue(f.Customer || f['Customer/Value'] || ''),
    BookingYear: Number(f.BookingYear || 0),
    BookingMonth: Number(f.BookingMonth || 0),
    Jobs: jobs,
    Revenue: revenue,
    RatePerLoadedMile: ratePerLoadedMile,
    PercentOfRevenue: percentOfRevenue
  };
}

function makeEmptyCustomerTrendYear(year) {
  return {
    year,
    jobs: 0,
    revenue: 0,
    ratePerLoadedMile: 0,
    revenueShare: 0,
    rateWeightedTotal: 0,
    rateWeight: 0,
    activeMonths: 0
  };
}

function addRateToCustomerTrendAggregate(target, rate, jobs) {
  const cleanRate = Number(rate || 0);
  const cleanJobs = Number(jobs || 0);

  if (cleanRate <= 0) return;

  target.activeMonths += 1;

  if (cleanJobs > 0) {
    target.rateWeightedTotal += cleanRate * cleanJobs;
    target.rateWeight += cleanJobs;
    return;
  }

  target.rateWeightedTotal += cleanRate;
  target.rateWeight += 1;
}

function finalizeCustomerTrendAggregate(target) {
  return {
    ...target,
    ratePerLoadedMile: target.rateWeight > 0 ? target.rateWeightedTotal / target.rateWeight : 0
  };
}

function buildCustomerTrendInsights(row, currentYear, previousYear) {
  const current = row.yearDetailsByYear[String(currentYear)] || makeEmptyCustomerTrendYear(currentYear);
  const previous = row.yearDetailsByYear[String(previousYear)] || makeEmptyCustomerTrendYear(previousYear);
  const insights = [];

  if (current.revenue > 0 && previous.revenue > 0) {
    const change = getTrendPercentChange(current.revenue, previous.revenue);
    const absChange = current.revenue - previous.revenue;
    const direction = absChange >= 0 ? 'up' : 'down';
    insights.push(`Revenue is ${direction} ${Math.abs(change * 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}% versus ${previousYear} through the same month.`);
  }

  if (current.revenue > 0 && previous.revenue <= 0) {
    insights.push(`This customer has current-year revenue with no ${previousYear} revenue through the same month.`);
  }

  if (current.revenue <= 0 && previous.revenue > 0) {
    insights.push(`This customer had ${previousYear} revenue through this month, but no current-year revenue in the same window.`);
  }

  if (current.jobs > previous.jobs && current.revenue < previous.revenue && previous.revenue > 0) {
    insights.push('Job count is higher, but revenue is lower than the prior-year comparison window. Rate/mix may need a closer look.');
  }

  if (current.ratePerLoadedMile > 0 && previous.ratePerLoadedMile > 0 && current.ratePerLoadedMile < previous.ratePerLoadedMile) {
    insights.push('Average $ / loaded mile is below the prior-year comparison window.');
  }

  if (insights.length === 0) {
    insights.push('No major trend flag was detected for the selected comparison window.');
  }

  return insights;
}

function buildCustomerBookingTrendsResponse(items, throughYear, throughMonth) {
  const startYear = ARCHIVE_YEAR_MIN;
  const years = [];

  for (let year = startYear; year <= throughYear; year += 1) {
    years.push(year);
  }

  const monthKeys = Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    name: getMonthName(index + 1),
    shortName: getShortMonthName(index + 1),
    inComparisonWindow: index + 1 <= throughMonth
  }));

  const trendItems = items
    .map((item) => (item?.fields ? getCustomerBookingTrendItem(item) : item))
    .filter(Boolean)
    .filter((record) => (
      record.Customer &&
      years.includes(record.BookingYear) &&
      record.BookingMonth >= 1 &&
      record.BookingMonth <= 12 &&
      record.BookingMonth <= throughMonth
    ));

  const totalsByYear = new Map(years.map((year) => [year, makeEmptyCustomerTrendYear(year)]));
  const customerMap = new Map();

  function ensureCustomer(customer) {
    const key = normalizeSearchValue(customer);

    if (!customerMap.has(key)) {
      const yearDetailsByYear = {};
      const monthlyByMonth = {};

      years.forEach((year) => {
        yearDetailsByYear[String(year)] = makeEmptyCustomerTrendYear(year);
      });

      monthKeys.forEach((month) => {
        monthlyByMonth[String(month.month)] = {
          month: month.month,
          monthName: month.name,
          shortName: month.shortName,
          years: Object.fromEntries(years.map((year) => [String(year), makeEmptyCustomerTrendYear(year)]))
        };
      });

      customerMap.set(key, {
        customer,
        yearDetailsByYear,
        monthlyByMonth
      });
    }

    return customerMap.get(key);
  }

  trendItems.forEach((record) => {
    const customer = ensureCustomer(record.Customer);
    const yearKey = String(record.BookingYear);
    const monthKey = String(record.BookingMonth);
    const customerYear = customer.yearDetailsByYear[yearKey];
    const customerMonthYear = customer.monthlyByMonth[monthKey]?.years?.[yearKey];
    const totalYear = totalsByYear.get(record.BookingYear);

    if (!customerYear || !customerMonthYear || !totalYear) return;

    customerYear.jobs += record.Jobs;
    customerYear.revenue += record.Revenue;
    addRateToCustomerTrendAggregate(customerYear, record.RatePerLoadedMile, record.Jobs);

    customerMonthYear.jobs += record.Jobs;
    customerMonthYear.revenue += record.Revenue;
    addRateToCustomerTrendAggregate(customerMonthYear, record.RatePerLoadedMile, record.Jobs);

    totalYear.jobs += record.Jobs;
    totalYear.revenue += record.Revenue;
    addRateToCustomerTrendAggregate(totalYear, record.RatePerLoadedMile, record.Jobs);
  });

  const finalizedTotalsByYear = Object.fromEntries(
    years.map((year) => {
      const total = finalizeCustomerTrendAggregate(totalsByYear.get(year));
      return [String(year), total];
    })
  );

  const currentYearTotal = finalizedTotalsByYear[String(throughYear)] || makeEmptyCustomerTrendYear(throughYear);
  const previousYear = throughYear - 1;

  const rows = Array.from(customerMap.values())
    .map((entry) => {
      const yearDetailsByYear = Object.fromEntries(
        years.map((year) => {
          const detail = finalizeCustomerTrendAggregate(entry.yearDetailsByYear[String(year)]);
          const total = finalizedTotalsByYear[String(year)] || makeEmptyCustomerTrendYear(year);
          return [
            String(year),
            {
              ...detail,
              revenueShare: total.revenue > 0 ? detail.revenue / total.revenue : 0
            }
          ];
        })
      );

      const monthlyBreakdown = monthKeys.map((month) => ({
        month: month.month,
        monthName: month.name,
        shortName: month.shortName,
        inComparisonWindow: month.inComparisonWindow,
        years: Object.fromEntries(
          years.map((year) => {
            const monthlyDetail = finalizeCustomerTrendAggregate(entry.monthlyByMonth[String(month.month)].years[String(year)]);
            return [String(year), monthlyDetail];
          })
        )
      }));

      const current = yearDetailsByYear[String(throughYear)] || makeEmptyCustomerTrendYear(throughYear);
      const previous = yearDetailsByYear[String(previousYear)] || makeEmptyCustomerTrendYear(previousYear);
      const bucket = getCustomerTrendBucket(current.revenue, previous.revenue);
      const yoyRevenueChange = getTrendPercentChange(current.revenue, previous.revenue);

      const row = {
        customer: entry.customer,
        currentYear: throughYear,
        previousYear,
        bucket,
        bucketLabel: getCustomerTrendBucketLabel(bucket),
        currentRevenue: current.revenue,
        previousRevenue: previous.revenue,
        currentJobs: current.jobs,
        previousJobs: previous.jobs,
        currentRatePerLoadedMile: current.ratePerLoadedMile,
        previousRatePerLoadedMile: previous.ratePerLoadedMile,
        revenueShare: currentYearTotal.revenue > 0 ? current.revenue / currentYearTotal.revenue : 0,
        yoyRevenueChange,
        yearDetails: years.map((year) => yearDetailsByYear[String(year)]),
        yearDetailsByYear,
        monthlyBreakdown
      };

      return {
        ...row,
        insights: buildCustomerTrendInsights(row, throughYear, previousYear)
      };
    })
    .filter((row) => years.some((year) => Number(row.yearDetailsByYear[String(year)]?.revenue || 0) > 0))
    .sort((a, b) => {
      const currentDiff = Number(b.currentRevenue || 0) - Number(a.currentRevenue || 0);
      if (currentDiff !== 0) return currentDiff;

      return String(a.customer || '').localeCompare(String(b.customer || ''));
    });

  const currentActiveRows = rows.filter((row) => row.currentRevenue > 0);
  const top10Revenue = currentActiveRows
    .slice(0, 10)
    .reduce((sum, row) => sum + Number(row.currentRevenue || 0), 0);

  const bucketCounts = rows.reduce(
    (acc, row) => {
      acc.all += 1;
      acc[row.bucket] = (acc[row.bucket] || 0) + 1;
      return acc;
    },
    { all: 0, growing: 0, declining: 0, dormant: 0, newReturning: 0, steady: 0, inactive: 0 }
  );

  return {
    success: true,
    reportType: 'customerBookingTrends',
    reportLabel: `Customer Booking Trends through ${getReportMonthLabel(throughYear, throughMonth)}`,
    generatedAt: `${formatEasternTimestamp()} Eastern`,
    status: 'available',
    anchorDate: 'Booking Month',
    throughYear,
    throughMonth,
    throughMonthLabel: getReportMonthLabel(throughYear, throughMonth),
    comparedYears: years,
    recordsScanned: items.length,
    rowsScanned: trendItems.length,
    customerCount: rows.length,
    bucketCounts,
    totalsByYear: finalizedTotalsByYear,
    summary: {
      currentYear: throughYear,
      currentRevenue: currentYearTotal.revenue,
      currentJobs: currentYearTotal.jobs,
      currentRatePerLoadedMile: currentYearTotal.ratePerLoadedMile,
      activeCustomers: currentActiveRows.length,
      top10RevenueShare: currentYearTotal.revenue > 0 ? top10Revenue / currentYearTotal.revenue : 0
    },
    monthKeys,
    rows
  };
}


function getNoAvailabilitySources() {
  return [
    {
      key: 'main',
      label: 'No Availability',
      sourceYear: 'Main',
      listId:
        process.env.VITE_KOLE_NO_AVAILABILITY_MAIN_LIST_ID ||
        process.env.KOLE_NO_AVAILABILITY_MAIN_LIST_ID ||
        DEFAULT_NO_AVAILABILITY_MAIN_LIST_ID
    },
    {
      key: '2025',
      label: '2025 No Availability',
      sourceYear: 2025,
      listId:
        process.env.VITE_KOLE_NO_AVAILABILITY_2025_LIST_ID ||
        process.env.KOLE_NO_AVAILABILITY_2025_LIST_ID ||
        DEFAULT_NO_AVAILABILITY_2025_LIST_ID
    },
    {
      key: '2024',
      label: '2024 No Availability',
      sourceYear: 2024,
      listId:
        process.env.VITE_KOLE_NO_AVAILABILITY_2024_LIST_ID ||
        process.env.KOLE_NO_AVAILABILITY_2024_LIST_ID ||
        DEFAULT_NO_AVAILABILITY_2024_LIST_ID
    }
  ].filter((source) => source.listId);
}

function getNoAvailabilityFieldSelect() {
  return [
    'Company',
    'Requestor',
    'Solicit_x0020_Date',
    'Pickup_x0020_Location',
    'Delivery_x0020_Location',
    'Shipment_x0020_Type',
    'Total_x0020_Miles',
    'Created',
    'Modified'
  ].join(',');
}

function getNoAvailabilityReportYear(value) {
  const dateKey = normalizeEasternDateOnly(value);
  return dateKey ? Number(dateKey.slice(0, 4)) : null;
}

function cleanNoAvailabilityItem(item, source) {
  const f = item.fields || {};
  const solicitDate = f.Solicit_x0020_Date || '';
  const solicitDateKey = normalizeEasternDateOnly(solicitDate);
  const company = getChoiceValue(f.Company || f['Company/Value'] || '');
  const requestor = getChoiceValue(f.Requestor || f['Requestor/Value'] || '');
  const pickupLocation = getChoiceValue(f.Pickup_x0020_Location || f['Pickup_x0020_Location/Value'] || '');
  const deliveryLocation = getChoiceValue(f.Delivery_x0020_Location || f['Delivery_x0020_Location/Value'] || '');
  const shipmentType = getChoiceValue(f.Shipment_x0020_Type || f['Shipment_x0020_Type/Value'] || '');
  const totalMiles = getNumberValue(f.Total_x0020_Miles);

  return {
    id: item.id || f.id || '',
    SourceListId: source.listId,
    sourceKey: source.key,
    sourceLabel: source.label,
    sourceYear: source.sourceYear,
    reportYear: getNoAvailabilityReportYear(solicitDate),
    solicitDate,
    solicitDateKey,
    company,
    requestor,
    pickupLocation,
    deliveryLocation,
    shipmentType,
    totalMiles,
    created: f.Created || item.createdDateTime || '',
    modified: f.Modified || item.lastModifiedDateTime || '',
    webUrl: item.webUrl || ''
  };
}

function buildNoAvailabilityDedupKey(row) {
  return [
    row.solicitDateKey,
    normalizeSearchValue(row.company),
    normalizeSearchValue(row.requestor),
    normalizeSearchValue(row.pickupLocation),
    normalizeSearchValue(row.deliveryLocation),
    normalizeSearchValue(row.shipmentType),
    Number(row.totalMiles || 0)
  ].join('|');
}

function dedupeNoAvailabilityRows(rows) {
  const seen = new Map();
  let duplicateCount = 0;

  rows.forEach((row) => {
    const key = buildNoAvailabilityDedupKey(row);
    const existing = seen.get(key);

    if (!existing) {
      seen.set(key, row);
      return;
    }

    duplicateCount += 1;

    const existingIsMain = existing.sourceKey === 'main';
    const rowIsArchive = row.sourceKey !== 'main';
    const rowModified = new Date(row.modified || row.created || 0).getTime() || 0;
    const existingModified = new Date(existing.modified || existing.created || 0).getTime() || 0;

    if ((existingIsMain && rowIsArchive) || rowModified > existingModified) {
      seen.set(key, row);
    }
  });

  return {
    rows: Array.from(seen.values()),
    duplicateCount
  };
}

const US_STATE_ABBREVIATIONS = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY', district: 'DC', 'district of columbia': 'DC'
};

const US_STATE_ABBREVIATION_SET = new Set(Object.values(US_STATE_ABBREVIATIONS));

function formatNoAvailabilityName(value) {
  const clean = String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

  if (!clean) return '';

  return clean.replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

function getNoAvailabilityStateAbbreviation(value) {
  const clean = String(value || '')
    .trim()
    .replace(/\./g, '')
    .replace(/\b\d{5}(?:-\d{4})?\b/g, '')
    .replace(/[^a-zA-Z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!clean) return '';

  const upper = clean.toUpperCase();
  if (US_STATE_ABBREVIATION_SET.has(upper)) return upper;

  return US_STATE_ABBREVIATIONS[clean.toLowerCase()] || '';
}

function normalizeNoAvailabilityCityState(value) {
  const raw = String(value || '')
    .trim()
    .replace(/\b\d{5}(?:-\d{4})?\b/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/,\s*/g, ', ')
    .replace(/,+$/g, '')
    .trim();

  if (!raw) return '';

  const commaParts = raw.split(',').map((part) => part.trim()).filter(Boolean);

  if (commaParts.length >= 2) {
    const state = getNoAvailabilityStateAbbreviation(commaParts[commaParts.length - 1]);
    const city = commaParts.length > 2 ? commaParts[commaParts.length - 2] : commaParts[0];

    if (state && city) {
      return `${formatNoAvailabilityName(city)}, ${state}`;
    }
  }

  const parts = raw.split(' ').map((part) => part.trim()).filter(Boolean);

  for (let size = Math.min(3, parts.length); size >= 1; size -= 1) {
    const stateCandidate = parts.slice(parts.length - size).join(' ');
    const state = getNoAvailabilityStateAbbreviation(stateCandidate);
    const city = parts.slice(0, parts.length - size).join(' ');

    if (state && city) {
      return `${formatNoAvailabilityName(city)}, ${state}`;
    }
  }

  return formatNoAvailabilityName(raw);
}

function getNoAvailabilityMonthKey(row) {
  const dateKey = row.solicitDateKey || normalizeEasternDateOnly(row.solicitDate || row.created || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey.slice(0, 7) : '';
}

function getNoAvailabilityMonthLabel(monthKey) {
  if (!/^\d{4}-\d{2}$/.test(String(monthKey || ''))) return 'Unknown';

  const [year, month] = String(monthKey).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));

  return date.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric'
  });
}

function getNoAvailabilityLocationPoints(row) {
  return [
    { role: 'pickup', cityState: normalizeNoAvailabilityCityState(row.pickupLocation) },
    { role: 'delivery', cityState: normalizeNoAvailabilityCityState(row.deliveryLocation) }
  ].filter((point) => point.cityState);
}

function getNoAvailabilityTopCustomers(rows, limit = 5) {
  const counts = new Map();

  rows.forEach((row) => {
    const key = normalizeSearchValue(row.company);
    if (!key) return;

    const current = counts.get(key) || { customer: row.company, count: 0, miles: 0 };
    current.count += 1;
    current.miles += Number(row.totalMiles || 0);
    counts.set(key, current);
  });

  return Array.from(counts.values())
    .sort((a, b) => b.count - a.count || b.miles - a.miles || String(a.customer).localeCompare(String(b.customer)))
    .slice(0, limit)
    .map((entry) => ({
      ...entry,
      percentage: rows.length > 0 ? entry.count / rows.length : 0
    }));
}

function getNoAvailabilityTopCustomer(rows) {
  return getNoAvailabilityTopCustomers(rows, 1)[0] || { customer: '', count: 0, miles: 0, percentage: 0 };
}

function getNoAvailabilityTopCityStates(rows, limit = 5) {
  const counts = new Map();
  let totalLocationHits = 0;

  rows.forEach((row) => {
    const points = getNoAvailabilityLocationPoints(row);
    totalLocationHits += points.length;

    points.forEach((point) => {
      const key = normalizeSearchValue(point.cityState);
      if (!key) return;

      const current = counts.get(key) || {
        cityState: point.cityState,
        count: 0,
        pickupCount: 0,
        deliveryCount: 0,
        miles: 0,
        uniqueCustomers: new Set()
      };

      current.count += 1;
      current.miles += Number(row.totalMiles || 0);
      if (point.role === 'pickup') current.pickupCount += 1;
      if (point.role === 'delivery') current.deliveryCount += 1;
      if (normalizeSearchValue(row.company)) current.uniqueCustomers.add(normalizeSearchValue(row.company));
      counts.set(key, current);
    });
  });

  return Array.from(counts.values())
    .map((entry) => ({
      cityState: entry.cityState,
      count: entry.count,
      pickupCount: entry.pickupCount,
      deliveryCount: entry.deliveryCount,
      miles: entry.miles,
      uniqueCustomers: entry.uniqueCustomers.size,
      percentage: totalLocationHits > 0 ? entry.count / totalLocationHits : 0
    }))
    .sort((a, b) => b.count - a.count || b.miles - a.miles || String(a.cityState).localeCompare(String(b.cityState)))
    .slice(0, limit);
}

function getNoAvailabilityTopMonths(rows, limit = 5) {
  const counts = new Map();

  rows.forEach((row) => {
    const monthKey = getNoAvailabilityMonthKey(row) || 'Unknown';
    const current = counts.get(monthKey) || {
      monthKey,
      monthLabel: getNoAvailabilityMonthLabel(monthKey),
      count: 0,
      miles: 0,
      uniqueCustomers: new Set(),
      uniqueCityStates: new Set()
    };

    current.count += 1;
    current.miles += Number(row.totalMiles || 0);
    if (normalizeSearchValue(row.company)) current.uniqueCustomers.add(normalizeSearchValue(row.company));

    getNoAvailabilityLocationPoints(row).forEach((point) => {
      current.uniqueCityStates.add(normalizeSearchValue(point.cityState));
    });

    counts.set(monthKey, current);
  });

  return Array.from(counts.values())
    .map((entry) => ({
      monthKey: entry.monthKey,
      monthLabel: entry.monthLabel,
      count: entry.count,
      miles: entry.miles,
      uniqueCustomers: entry.uniqueCustomers.size,
      uniqueCityStates: entry.uniqueCityStates.size,
      percentage: rows.length > 0 ? entry.count / rows.length : 0
    }))
    .sort((a, b) => b.count - a.count || b.miles - a.miles || String(b.monthKey).localeCompare(String(a.monthKey)))
    .slice(0, limit);
}

function getNoAvailabilityMonthlyTrend(rows) {
  return getNoAvailabilityTopMonths(rows, 999)
    .sort((a, b) => String(a.monthKey).localeCompare(String(b.monthKey)));
}

function getNoAvailabilityTopLanes(rows, limit = 5) {
  const counts = new Map();

  rows.forEach((row) => {
    const pickup = normalizeNoAvailabilityCityState(row.pickupLocation);
    const delivery = normalizeNoAvailabilityCityState(row.deliveryLocation);

    if (!pickup || !delivery) return;

    const lane = `${pickup} → ${delivery}`;
    const key = normalizeSearchValue(lane);
    const current = counts.get(key) || {
      lane,
      pickup,
      delivery,
      count: 0,
      miles: 0,
      uniqueCustomers: new Set()
    };

    current.count += 1;
    current.miles += Number(row.totalMiles || 0);
    if (normalizeSearchValue(row.company)) current.uniqueCustomers.add(normalizeSearchValue(row.company));
    counts.set(key, current);
  });

  return Array.from(counts.values())
    .map((entry) => ({
      lane: entry.lane,
      pickup: entry.pickup,
      delivery: entry.delivery,
      count: entry.count,
      miles: entry.miles,
      uniqueCustomers: entry.uniqueCustomers.size,
      percentage: rows.length > 0 ? entry.count / rows.length : 0
    }))
    .sort((a, b) => b.count - a.count || b.miles - a.miles || String(a.lane).localeCompare(String(b.lane)))
    .slice(0, limit);
}

function getNoAvailabilityFieldBreakdown(rows, fieldName, outputName, limit = 5) {
  const counts = new Map();

  rows.forEach((row) => {
    const value = String(row[fieldName] || '').trim();
    const key = normalizeSearchValue(value);
    if (!key) return;

    const current = counts.get(key) || { [outputName]: value, count: 0, miles: 0, uniqueCustomers: new Set() };
    current.count += 1;
    current.miles += Number(row.totalMiles || 0);
    if (normalizeSearchValue(row.company)) current.uniqueCustomers.add(normalizeSearchValue(row.company));
    counts.set(key, current);
  });

  return Array.from(counts.values())
    .map((entry) => ({
      [outputName]: entry[outputName],
      count: entry.count,
      miles: entry.miles,
      uniqueCustomers: entry.uniqueCustomers.size,
      percentage: rows.length > 0 ? entry.count / rows.length : 0
    }))
    .sort((a, b) => b.count - a.count || b.miles - a.miles || String(a[outputName]).localeCompare(String(b[outputName])))
    .slice(0, limit);
}

function getNoAvailabilityYearBreakdown(rows) {
  const byYear = new Map();

  rows.forEach((row) => {
    const year = row.reportYear || 'Unknown';
    const current = byYear.get(year) || { year, count: 0, miles: 0, uniqueCustomers: new Set(), uniqueCityStates: new Set() };
    current.count += 1;
    current.miles += Number(row.totalMiles || 0);
    if (normalizeSearchValue(row.company)) current.uniqueCustomers.add(normalizeSearchValue(row.company));
    getNoAvailabilityLocationPoints(row).forEach((point) => current.uniqueCityStates.add(normalizeSearchValue(point.cityState)));
    byYear.set(year, current);
  });

  return Array.from(byYear.values())
    .map((entry) => ({
      year: entry.year,
      count: entry.count,
      miles: entry.miles,
      uniqueCustomers: entry.uniqueCustomers.size,
      uniqueCityStates: entry.uniqueCityStates.size
    }))
    .sort((a, b) => Number(b.year || 0) - Number(a.year || 0));
}

function buildNoAvailabilityInsights(rows, analytics, summary) {
  const insights = [];

  if (rows.length === 0) return insights;

  const peakMonth = analytics.topMonths[0];
  if (peakMonth) {
    insights.push({
      title: 'Highest month',
      value: peakMonth.monthLabel,
      detail: `${peakMonth.monthLabel} produced ${peakMonth.count} no availability record(s), covering ${peakMonth.uniqueCustomers} customer(s) and ${Math.round(peakMonth.miles).toLocaleString('en-US')} missed mile(s).`,
      tone: 'warning'
    });
  }

  const topCity = analytics.topCityStates[0];
  if (topCity) {
    insights.push({
      title: 'Hot city/state',
      value: topCity.cityState,
      detail: `${topCity.cityState} appeared ${topCity.count} time(s) across pickup and delivery points (${topCity.pickupCount} pickup / ${topCity.deliveryCount} delivery).`,
      tone: 'info'
    });
  }

  const topCustomersShare = summary.topFiveCustomersShare || 0;
  if (analytics.topCustomers[0]) {
    insights.push({
      title: 'Customer concentration',
      value: `${Math.round(topCustomersShare * 1000) / 10}%`,
      detail: `The top five customers account for ${Math.round(topCustomersShare * 1000) / 10}% of the no availability records in this window.`,
      tone: topCustomersShare >= 0.35 ? 'warning' : 'neutral'
    });
  }

  const topLane = analytics.topLanes[0];
  if (topLane && topLane.count > 1) {
    insights.push({
      title: 'Repeated lane',
      value: topLane.lane,
      detail: `${topLane.lane} repeated ${topLane.count} time(s). That may point to a lane worth targeted capacity planning.`,
      tone: 'info'
    });
  }

  const topShipmentType = analytics.shipmentTypes[0];
  if (topShipmentType) {
    insights.push({
      title: 'Common shipment type',
      value: topShipmentType.shipmentType,
      detail: `${topShipmentType.shipmentType} is the most common type in this report at ${topShipmentType.count} no availability record(s).`,
      tone: 'neutral'
    });
  }

  return insights;
}

function buildNoAvailabilityResponse(rawRows, options = {}) {
  const { duplicateCount, rows: dedupedRows } = dedupeNoAvailabilityRows(rawRows);
  const targetYear = options.year && options.year !== 'all' ? Number(options.year) : null;
  const filteredRows = targetYear
    ? dedupedRows.filter((row) => Number(row.reportYear) === targetYear)
    : dedupedRows;

  const rows = filteredRows
    .map((row) => ({
      ...row,
      pickupCityState: normalizeNoAvailabilityCityState(row.pickupLocation),
      deliveryCityState: normalizeNoAvailabilityCityState(row.deliveryLocation)
    }))
    .sort((a, b) => {
      const dateDiff = new Date(b.solicitDate || b.created || 0) - new Date(a.solicitDate || a.created || 0);
      if (dateDiff !== 0) return dateDiff;
      return String(a.company || '').localeCompare(String(b.company || ''));
    });

  const uniqueCustomerKeys = new Set(rows.map((row) => normalizeSearchValue(row.company)).filter(Boolean));
  const uniqueCityStateKeys = new Set(
    rows.flatMap((row) => getNoAvailabilityLocationPoints(row).map((point) => normalizeSearchValue(point.cityState))).filter(Boolean)
  );
  const topCustomers = getNoAvailabilityTopCustomers(rows, 5);
  const topCustomer = topCustomers[0] || { customer: '', count: 0, miles: 0, percentage: 0 };
  const topCityStates = getNoAvailabilityTopCityStates(rows, 5);
  const topCityState = topCityStates[0] || { cityState: '', count: 0, pickupCount: 0, deliveryCount: 0, miles: 0, percentage: 0 };
  const topMonths = getNoAvailabilityTopMonths(rows, 5);
  const highestMonth = topMonths[0] || { monthLabel: '', count: 0, miles: 0, percentage: 0 };
  const totalMiles = rows.reduce((sum, row) => sum + Number(row.totalMiles || 0), 0);
  const mostRecentSolicitDate = rows[0]?.solicitDate || '';
  const mostRecentModifiedDate = rows
    .map((row) => row.modified || row.created || '')
    .filter(Boolean)
    .sort((a, b) => new Date(b) - new Date(a))[0] || '';
  const reportLabel = targetYear ? `No Availability - ${targetYear}` : 'No Availability - All Years';

  const analytics = {
    topCustomers,
    topCityStates,
    topMonths,
    monthlyTrend: getNoAvailabilityMonthlyTrend(rows),
    topLanes: getNoAvailabilityTopLanes(rows, 5),
    topRequestors: getNoAvailabilityFieldBreakdown(rows, 'requestor', 'requestor', 5),
    shipmentTypes: getNoAvailabilityFieldBreakdown(rows, 'shipmentType', 'shipmentType', 5)
  };

  const summary = {
    totalNoAvailability: rows.length,
    uniqueCustomers: uniqueCustomerKeys.size,
    uniqueCityStates: uniqueCityStateKeys.size,
    topCustomer: topCustomer.customer,
    topCustomerCount: topCustomer.count,
    topCustomerMiles: topCustomer.miles,
    topCustomerShare: topCustomer.percentage,
    topCityState: topCityState.cityState,
    topCityStateCount: topCityState.count,
    topCityStatePickupCount: topCityState.pickupCount,
    topCityStateDeliveryCount: topCityState.deliveryCount,
    topCityStateShare: topCityState.percentage,
    highestMonth: highestMonth.monthLabel,
    highestMonthCount: highestMonth.count,
    highestMonthMiles: highestMonth.miles,
    highestMonthShare: highestMonth.percentage,
    topFiveCustomersShare: rows.length > 0 ? topCustomers.reduce((sum, entry) => sum + entry.count, 0) / rows.length : 0,
    totalMissedMiles: totalMiles,
    averageMissedMiles: rows.length > 0 ? totalMiles / rows.length : 0,
    mostRecentSolicitDate,
    mostRecentModifiedDate,
    duplicateRowsRemoved: duplicateCount
  };

  return {
    success: true,
    reportType: 'noAvailability',
    reportLabel,
    generatedAt: `${formatEasternTimestamp()} Eastern`,
    selectedYear: targetYear || 'all',
    anchorDate: 'Solicit Date',
    count: rows.length,
    rows,
    summary,
    analytics,
    insights: buildNoAvailabilityInsights(rows, analytics, summary),
    yearBreakdown: getNoAvailabilityYearBreakdown(dedupedRows)
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

function buildGrossRevenueTotalsResponse(items, sourceList, year, rosterByTruck = new Map()) {
  const monthNames = Array.from({ length: 12 }, (_, index) => getMonthName(index + 1));
  const monthKeys = monthNames.map((name, index) => ({
    month: index + 1,
    name,
    shortName: getShortMonthName(index + 1)
  }));
  const elapsedMonthCount = getElapsedMonthCountForReportYear(year);

  const makeEmptyMonthlyMap = () => Object.fromEntries(monthKeys.map((month) => [month.month, 0]));

  function ensureTruckGroup(truck, seed = {}) {
    const key = truck || 'Unassigned Truck';

    if (!truckMap.has(key)) {
      const roster = rosterByTruck?.get?.(normalizeTruckKey(key)) || null;

      truckMap.set(key, {
        truck: key,
        operator: seed.operator || roster?.tmsName || roster?.operatorTeamName || 'Unknown Operator',
        rosterStatus: seed.rosterStatus || roster?.status || '',
        rosterTermDate: seed.rosterTermDate || roster?.termDate || '',
        rosterStartDate: seed.rosterStartDate || roster?.startDate || '',
        isRosterOnly: seed.isRosterOnly ?? false,
        monthTotals: makeEmptyMonthlyMap(),
        monthLoadCounts: makeEmptyMonthlyMap(),
        totalGrossRevenue: 0,
        loadCount: 0,
        permitEscortTotal: 0,
        loads: []
      });
    }

    return truckMap.get(key);
  }

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
    const group = ensureTruckGroup(load.Truck || 'Unassigned Truck');
    const pickup = getUtcYearMonth(load.PickupDate);

    group.isRosterOnly = false;

    if ((!group.operator || group.operator === 'Unknown Operator') && load.Operator) {
      group.operator = load.Operator;
    }

    group.monthTotals[pickup.month] += load.GrossRevenue;
    group.monthLoadCounts[pickup.month] += 1;
    group.totalGrossRevenue += load.GrossRevenue;
    group.permitEscortTotal += load.PermitsEscortFees;
    group.loadCount += 1;
    group.loads.push(load);
  });

  const trucks = Array.from(truckMap.values())
    .map((group) => {
      const monthsWithRevenue = monthKeys.filter((month) => group.monthTotals[month.month] > 0).length;

      return {
        ...group,
        averageMonthlyRevenue: safeAverage(group.totalGrossRevenue, elapsedMonthCount),
        averageActiveMonthRevenue: safeAverage(group.totalGrossRevenue, elapsedMonthCount),
        averageRevenueMonthRevenue: safeAverage(group.totalGrossRevenue, monthsWithRevenue),
        monthsElapsed: elapsedMonthCount,
        monthsWithRevenue
      };
    })
    .sort((a, b) => String(a.truck).localeCompare(String(b.truck), undefined, { numeric: true }));

  const monthlyTotals = Object.fromEntries(monthKeys.map((month) => [month.month, 0]));
  const monthlyLoadCounts = Object.fromEntries(monthKeys.map((month) => [month.month, 0]));
  let totalGrossRevenue = 0;
  let totalPermitEscortExcluded = 0;
  let totalLoadCount = 0;

  trucks.forEach((truck) => {
    monthKeys.forEach((month) => {
      monthlyTotals[month.month] += truck.monthTotals[month.month] || 0;
      monthlyLoadCounts[month.month] += truck.monthLoadCounts?.[month.month] || 0;
    });

    totalGrossRevenue += truck.totalGrossRevenue;
    totalPermitEscortExcluded += truck.permitEscortTotal;
    totalLoadCount += truck.loadCount;
  });

  const reportMonthsWithRevenue = monthKeys.filter((month) => monthlyTotals[month.month] > 0).length;

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
      averageMonthlyRevenue: safeAverage(totalGrossRevenue, elapsedMonthCount),
      averageActiveMonthRevenue: safeAverage(totalGrossRevenue, elapsedMonthCount),
      averageRevenueMonthRevenue: safeAverage(totalGrossRevenue, reportMonthsWithRevenue),
      monthsElapsed: elapsedMonthCount,
      monthsWithRevenue: reportMonthsWithRevenue,
      monthlyTotals,
      monthlyLoadCounts
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
    'Quoted_x0020_Total',
    'FinalBillableTotal',
    'EstimatedDriverPay',
    'LinehaulDriverPay',
    'FuelSurchargeDriverPay',
    'TarpingDriverPay',
    'AdditionalDriverPay',
    'NetPayabletoDriver'
  ].join(',');
}

function getOrdersDueForSettlementItem(item, sourceList) {
  const f = item.fields || {};
  const truck = getChoiceValue(f.Truck_x0020_Number || f['Truck_x0020_Number/Value'] || '');
  const operatorTeam = getChoiceValue(f.Operator_x002f_Team || f['Operator_x002f_Team/Value'] || '');
  const customer = getChoiceValue(f.Company || f['Company/Value'] || '');
  const finalBillableTotal = getNumberValue(f.FinalBillableTotal);
  const quotedTotal = getNumberValue(f.Quoted_x0020_Total);
  const netDriverPay = getNumberValue(f.NetPayabletoDriver);
  const estimatedDriverPay = getNumberValue(f.EstimatedDriverPay);
  const componentDriverPay = [
    f.LinehaulDriverPay,
    f.FuelSurchargeDriverPay,
    f.TarpingDriverPay,
    f.AdditionalDriverPay
  ].reduce((sum, value) => sum + getNumberValue(value), 0);

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
    BidAmount: finalBillableTotal > 0 ? finalBillableTotal : quotedTotal,
    DriverPay: netDriverPay > 0 ? netDriverPay : (estimatedDriverPay > 0 ? estimatedDriverPay : componentDriverPay)
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

function getReportActionAlertFieldSelect() {
  return Array.from(new Set([
    ...getOrdersDueForSettlementFieldSelect().split(','),
    ...getWonNotRegisteredFieldSelect().split(',')
  ])).join(',');
}

function buildReportActionAlertsResponse(items, sourceList) {
  const ordersDueSettlement = buildOrdersDueForSettlementResponse(items, sourceList);
  const wonNotRegistered = buildWonNotRegisteredResponse(items, sourceList);

  const alerts = {
    ordersDueSettlement: {
      reportKey: 'ordersDueSettlement',
      reportLabel: ordersDueSettlement.reportLabel,
      count: ordersDueSettlement.count,
      hasAlert: ordersDueSettlement.count > 0
    },
    wonNotRegistered: {
      reportKey: 'wonNotRegistered',
      reportLabel: wonNotRegistered.reportLabel,
      count: wonNotRegistered.count,
      hasAlert: wonNotRegistered.count > 0
    }
  };

  return {
    success: true,
    reportType: 'reportActionAlerts',
    generatedAt: `${formatEasternTimestamp()} Eastern`,
    dataSource: sourceList.label,
    totalAlerts: alerts.ordersDueSettlement.count + alerts.wonNotRegistered.count,
    alerts
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


function getDriverTimeOffListId() {
  return process.env.DRIVER_TIME_OFF_LOG_LIST_ID || process.env.TIME_OFF_LOG_LIST_ID || '';
}

function getDriverTimeOffFieldSelect() {
  return [
    'Title',
    'RecordNumber',
    'TruckNumber',
    'OperatorName',
    'StartDate',
    'EndDate',
    'Reason',
    'Status'
  ].join(',');
}

function cleanDriverTimeOffItem(item) {
  const f = item.fields || {};
  const startDate = normalizeEasternDateOnly(f.StartDate);
  const endDate = normalizeEasternDateOnly(f.EndDate);
  return {
    id: item.id || '',
    webUrl: item.webUrl || '',
    recordNumber: cleanRosterText(f.RecordNumber),
    truckNumber: cleanRosterText(f.TruckNumber),
    operatorName: cleanRosterText(f.OperatorName),
    startDate,
    endDate,
    reason: cleanRosterText(f.Reason),
    status: cleanRosterText(f.Status || 'Active'),
    isCancelled: normalizeText(f.Status) === 'cancelled',
    title: cleanRosterText(f.Title)
  };
}

function isExcludedDriverTimeOffRow(row = {}) {
  const operatorKey = normalizeSearchValue(row.operatorName || row.OperatorName || '');
  const titleKey = normalizeSearchValue(row.title || row.Title || '');
  const truckKey = normalizeSearchValue(row.truckNumber || row.TruckNumber || '');

  // Business rule: New Vision is a separate entity, not an internal KOLE driver/unit.
  // Hide it from current driver time-off visibility and time-off reporting.
  return (
    operatorKey.includes('new vision') ||
    titleKey.includes('new vision') ||
    truckKey === '5550'
  );
}

function getDateOnlyTime(dateValue) {
  const normalized = normalizeEasternDateOnly(dateValue);
  if (!normalized) return null;
  const time = new Date(`${normalized}T00:00:00Z`).getTime();
  return Number.isNaN(time) ? null : time;
}

function getInclusiveDateSpanDays(startDate, endDate) {
  const start = getDateOnlyTime(startDate);
  const end = getDateOnlyTime(endDate || startDate);
  if (start === null || end === null || end < start) return 0;
  return Math.round((end - start) / 86400000) + 1;
}

function sortDriverTimeOffRows(a, b) {
  const startDiff = (getDateOnlyTime(a.startDate) || 0) - (getDateOnlyTime(b.startDate) || 0);
  if (startDiff !== 0) return startDiff;
  const nameDiff = String(a.operatorName || '').localeCompare(String(b.operatorName || ''), undefined, { numeric: true });
  if (nameDiff !== 0) return nameDiff;
  return String(a.truckNumber || '').localeCompare(String(b.truckNumber || ''), undefined, { numeric: true });
}

function isDriverTimeOffCurrent(row, targetDate = formatEasternDate()) {
  if (!row || row.isCancelled) return false;
  if (!row.startDate) return false;
  const start = row.startDate;
  const end = row.endDate || row.startDate;
  return start <= targetDate && end >= targetDate;
}

function enrichDriverTimeOffRow(row, targetDate = formatEasternDate()) {
  const days = getInclusiveDateSpanDays(row.startDate, row.endDate || row.startDate);
  const isCurrent = isDriverTimeOffCurrent(row, targetDate);
  const startsFuture = row.startDate > targetDate;
  const endedPast = (row.endDate || row.startDate) < targetDate;
  return {
    ...row,
    days,
    isCurrent,
    timingStatus: row.isCancelled ? 'Cancelled' : (isCurrent ? 'Current' : (startsFuture ? 'Upcoming' : (endedPast ? 'Past' : 'Scheduled')))
  };
}

async function getDriverTimeOffRows(token) {
  const listId = getDriverTimeOffListId();
  if (!listId) {
    throw new Error('DRIVER_TIME_OFF_LOG_LIST_ID is not configured on the server.');
  }
  const result = await getAllListItemsWithFieldsResilient(token, listId, getDriverTimeOffFieldSelect());
  return {
    rows: result.items
      .map(cleanDriverTimeOffItem)
      .filter((row) => !isExcludedDriverTimeOffRow(row)),
    warning: result.warning || ''
  };
}

function buildDriverTimeOffCurrentResponse(rows, options = {}) {
  const targetDate = options.targetDate || formatEasternDate();
  const currentRows = rows
    .map((row) => enrichDriverTimeOffRow(row, targetDate))
    .filter((row) => row.isCurrent)
    .sort(sortDriverTimeOffRows);

  return {
    success: true,
    targetDate,
    generatedAt: `${formatEasternTimestamp()} Eastern`,
    count: currentRows.length,
    records: currentRows
  };
}

function getDriverTimeOffMonthKey(row) {
  const date = normalizeEasternDateOnly(row.reportStartDate || row.startDate);
  return date ? date.slice(0, 7) : 'Unknown';
}

function getDriverTimeOffMonthLabel(monthKey) {
  if (!/^\d{4}-\d{2}$/.test(String(monthKey || ''))) return 'Unknown';
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    year: 'numeric'
  });
}

function summarizeDriverTimeOffBy(rows, keyFn, labelFn = (key) => key || 'Unknown') {
  const map = new Map();
  rows.forEach((row) => {
    const key = keyFn(row) || 'Unknown';
    const current = map.get(key) || { key, label: labelFn(key), events: 0, days: 0 };
    current.events += 1;
    current.days += Number(row.days || 0);
    map.set(key, current);
  });
  return Array.from(map.values()).sort((a, b) => (b.days - a.days) || (b.events - a.events) || String(a.label).localeCompare(String(b.label)));
}

function buildDriverTimeOffReportResponse(rawRows, options = {}) {
  const year = Number(options.year) || Number(formatEasternDate().slice(0, 4));
  const targetDate = options.targetDate || formatEasternDate();
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const rows = rawRows
    .map((row) => enrichDriverTimeOffRow(row, targetDate))
    .filter((row) => !row.isCancelled)
    .map((row) => {
      const reportStartDate = row.startDate < yearStart ? yearStart : row.startDate;
      const rowEndDate = row.endDate || row.startDate;
      const reportEndDate = rowEndDate > yearEnd ? yearEnd : rowEndDate;

      return {
        ...row,
        reportStartDate,
        reportEndDate,
        reportDays: reportStartDate <= reportEndDate
          ? getInclusiveDateSpanDays(reportStartDate, reportEndDate)
          : 0
      };
    })
    .filter((row) => row.startDate && row.reportStartDate <= row.reportEndDate && Number(row.reportDays || 0) > 0)
    .sort(sortDriverTimeOffRows);

  const totalDays = rows.reduce((sum, row) => sum + Number(row.reportDays || row.days || 0), 0);
  const uniqueDriverKeys = new Set(rows.map((row) => normalizeSearchValue(row.operatorName || row.truckNumber)).filter(Boolean));
  const currentRows = rows.filter((row) => row.isCurrent);
  const longestEvent = [...rows].sort((a, b) => Number(b.reportDays || b.days || 0) - Number(a.reportDays || a.days || 0))[0] || null;

  const byDriver = summarizeDriverTimeOffBy(
    rows.map((row) => ({ ...row, days: row.reportDays || row.days || 0 })),
    (row) => `${row.operatorName || 'Unknown'}|${row.truckNumber || ''}`,
    (key) => {
      const [name, truck] = String(key).split('|');
      return truck ? `${name} · Truck ${truck}` : name;
    }
  );

  const byReason = summarizeDriverTimeOffBy(
    rows.map((row) => ({ ...row, days: row.reportDays || row.days || 0 })),
    (row) => row.reason || 'Unspecified'
  );

  const byMonth = summarizeDriverTimeOffBy(
    rows.map((row) => ({ ...row, days: row.reportDays || row.days || 0 })),
    getDriverTimeOffMonthKey,
    getDriverTimeOffMonthLabel
  ).sort((a, b) => String(a.key).localeCompare(String(b.key)));

  return {
    success: true,
    year,
    reportLabel: `${year} Driver Time Off`,
    generatedAt: `${formatEasternTimestamp()} Eastern`,
    count: rows.length,
    summary: {
      totalEvents: rows.length,
      totalDays,
      uniqueDrivers: uniqueDriverKeys.size,
      currentDriversOff: currentRows.length,
      averageDaysPerEvent: rows.length ? Math.round((totalDays / rows.length) * 10) / 10 : 0,
      longestEventDays: longestEvent ? Number(longestEvent.reportDays || longestEvent.days || 0) : 0,
      longestEventDriver: longestEvent ? longestEvent.operatorName : ''
    },
    analytics: { byDriver, byMonth, byReason },
    currentRecords: currentRows,
    rows
  };
}


function getDriverTimeOffReportFilterKey(row = {}, filterType = '') {
  if (filterType === 'driver') {
    return `${row.operatorName || 'Unknown'}|${row.truckNumber || ''}`;
  }

  if (filterType === 'month') {
    return getDriverTimeOffMonthKey(row);
  }

  if (filterType === 'reason') {
    return row.reason || 'Unspecified';
  }

  return '';
}

function getDriverTimeOffFilterLabel(filterType = '', filterKey = '', providedLabel = '') {
  if (providedLabel) return String(providedLabel).trim();

  if (filterType === 'driver') {
    const [name, truck] = String(filterKey || '').split('|');
    return truck ? `${name} · Truck ${truck}` : name || 'Filtered Driver';
  }

  if (filterType === 'month') {
    return getDriverTimeOffMonthLabel(filterKey);
  }

  if (filterType === 'reason') {
    return filterKey || 'Unspecified';
  }

  return '';
}

function applyDriverTimeOffReportFilter(report, options = {}) {
  const filterType = normalizeText(options.filterType);
  const filterKey = String(options.filterKey || '').trim();

  if (!filterType || !filterKey || !['driver', 'month', 'reason'].includes(filterType)) {
    return report;
  }

  const filteredRows = (report.rows || []).filter((row) =>
    getDriverTimeOffReportFilterKey(row, filterType) === filterKey
  );

  const filteredReport = buildDriverTimeOffReportResponse(filteredRows, { year: report.year });
  const filterLabel = getDriverTimeOffFilterLabel(filterType, filterKey, options.filterLabel);

  return {
    ...filteredReport,
    reportLabel: filterLabel ? `${report.reportLabel || `${report.year} Driver Time Off`} - ${filterLabel}` : report.reportLabel,
    generatedAt: report.generatedAt,
    sourceReportLabel: report.reportLabel,
    filter: {
      type: filterType,
      key: filterKey,
      label: filterLabel
    },
    warning: report.warning || ''
  };
}

function buildDriverTimeOffFieldsFromBody(body = {}, rosterOption = null) {
  const startDate = normalizeEasternDateOnly(body.startDate);
  const endDate = normalizeEasternDateOnly(body.endDate);
  const operatorName = cleanRosterText(rosterOption?.driverName || body.operatorName);
  const truckNumber = cleanRosterText(rosterOption?.unitNo || body.truckNumber);
  const reason = cleanRosterText(body.reason);
  const status = cleanRosterText(body.status || 'Active') || 'Active';

  if (!operatorName) throw new Error('Driver is required.');
  if (!truckNumber) throw new Error('Truck number is required.');
  if (!startDate) throw new Error('Start date is required.');
  if (!endDate) throw new Error('End date is required.');
  if (endDate < startDate) throw new Error('End date cannot be before start date.');

  const recordNumber = cleanRosterText(body.recordNumber) || `TO-${Date.now()}`;

  return {
    Title: `${operatorName} ${truckNumber} ${startDate}`.trim(),
    RecordNumber: recordNumber,
    TruckNumber: truckNumber,
    OperatorName: operatorName,
    StartDate: startDate,
    EndDate: endDate,
    Reason: reason,
    Status: status
  };
}

async function resolveDriverTimeOffRosterOption(token, rosterDriverKey) {
  const key = cleanRosterText(rosterDriverKey);
  if (!key) return null;
  const options = await getAvailableTruckRosterOptions(token);
  const option = options.find((entry) => entry.key === key);
  if (!option) throw new Error('Selected driver is not currently available in Driver Roster. Refresh and choose the driver again.');
  return option;
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


function getSettlementDriverKey(record) {
  const operatorKey = normalizeSearchValue(record.Operator || record.OperatorTeam || '');
  const truckKey = normalizeTruckKey(record.Truck);

  return operatorKey || (truckKey ? `truck:${truckKey}` : 'unknown-driver');
}

function getSettlementRevenueMatchKeys(record) {
  const keys = new Set();
  const operatorKey = normalizeSearchValue(record.Operator || '');
  const operatorTeamKey = normalizeSearchValue(record.OperatorTeam || '');
  const truckKey = normalizeTruckKey(record.Truck);

  if (operatorKey) keys.add(`name:${operatorKey}`);
  if (operatorTeamKey) keys.add(`name:${operatorTeamKey}`);
  if (truckKey) keys.add(`truck:${truckKey}`);

  return keys;
}

function getRosterRevenueMatchKeys(roster) {
  const keys = new Set();
  const tmsNameKey = normalizeSearchValue(roster.tmsName || '');
  const operatorTeamKey = normalizeSearchValue(roster.operatorTeamName || '');
  const truckKey = normalizeTruckKey(roster.truck);

  if (tmsNameKey) keys.add(`name:${tmsNameKey}`);
  if (operatorTeamKey) keys.add(`name:${operatorTeamKey}`);
  if (truckKey) keys.add(`truck:${truckKey}`);

  return keys;
}

function buildSettlementDriverPaySummary(records) {
  const summaryByDriver = new Map();

  records.forEach((record) => {
    const key = getSettlementDriverKey(record);
    const existing = summaryByDriver.get(key) || {
      driver: record.Operator || record.OperatorTeam || 'Unknown Operator',
      trucks: new Set(),
      orderCount: 0,
      bidTotal: 0,
      driverPayTotal: 0,
      margin: 0,
      bols: new Set()
    };

    existing.orderCount += 1;
    existing.bidTotal += getNumberValue(record.BidAmount);
    existing.driverPayTotal += getNumberValue(record.DriverPay);
    existing.margin = existing.bidTotal - existing.driverPayTotal;

    if (record.Truck) existing.trucks.add(record.Truck);
    if (record.BOL) existing.bols.add(record.BOL);

    summaryByDriver.set(key, existing);
  });

  return Array.from(summaryByDriver.values())
    .map((row) => ({
      ...row,
      trucks: Array.from(row.trucks).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true })).join(', '),
      bolCount: row.bols.size,
      bols: Array.from(row.bols).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }))
    }))
    .sort((a, b) => {
      const nameDiff = String(a.driver || '').localeCompare(String(b.driver || ''), undefined, { numeric: true });
      if (nameDiff !== 0) return nameDiff;

      return String(a.trucks || '').localeCompare(String(b.trucks || ''), undefined, { numeric: true });
    });
}

function buildSettlementRevenueKeySet(records) {
  const keys = new Set();

  records
    .filter((record) => getNumberValue(record.BidAmount) > 0)
    .forEach((record) => {
      getSettlementRevenueMatchKeys(record).forEach((key) => keys.add(key));
    });

  return keys;
}

function hasAnyRevenueKeyMatch(keys, revenueKeys) {
  for (const key of keys) {
    if (revenueKeys.has(key)) return true;
  }

  return false;
}

function isExcludedActiveNoRevenueSettlementRosterRow(roster) {
  const truckKey = normalizeTruckKey(roster?.truck);
  const tmsNameKey = normalizeSearchValue(roster?.tmsName || '');
  const operatorTeamKey = normalizeSearchValue(roster?.operatorTeamName || '');

  // One-off business exception: New Vision / truck 5550 is a placeholder used
  // when work is brokered to a sister company, so it should not trigger the
  // active-driver-with-no-revenue sanity check.
  return (
    truckKey === '5550' &&
    (tmsNameKey.includes('new vision') || operatorTeamKey.includes('new vision'))
  );
}

function buildActiveDriversWithNoSettlementRevenue(rosterItems = [], mainRecords = [], suggestRecords = []) {
  const mainRevenueKeys = buildSettlementRevenueKeySet(mainRecords);
  const suggestRevenueKeys = buildSettlementRevenueKeySet(suggestRecords);

  return rosterItems
    .filter((roster) => normalizeText(roster.status) === 'active')
    .filter((roster) => !isExcludedActiveNoRevenueSettlementRosterRow(roster))
    .map((roster) => {
      const matchKeys = getRosterRevenueMatchKeys(roster);

      return {
        ...roster,
        hasMainSettlementRevenue: hasAnyRevenueKeyMatch(matchKeys, mainRevenueKeys),
        hasLikelyNextWeekRevenue: hasAnyRevenueKeyMatch(matchKeys, suggestRevenueKeys)
      };
    })
    .filter((roster) => !roster.hasMainSettlementRevenue)
    .sort(sortDriverRosterRecords);
}

function sortSettlementRows(a, b) {
  const operatorDiff = String(a.Operator || '').localeCompare(String(b.Operator || ''), undefined, { numeric: true });
  if (operatorDiff !== 0) return operatorDiff;

  const submitDiff = (a.SubmittedComparable || 0) - (b.SubmittedComparable || 0);
  if (submitDiff !== 0) return submitDiff;

  return String(a.BOL || '').localeCompare(String(b.BOL || ''), undefined, { numeric: true });
}

function buildWeeklySettlementResponse(items, sourceLists, cutoffDateValue, activeRosterItems = [], activeRosterWarning = '') {
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

  const activeDriversWithoutMainRevenue = buildActiveDriversWithNoSettlementRevenue(activeRosterItems, main, suggest);

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
    driverPaySummary: {
      main: buildSettlementDriverPaySummary(main),
      suggest: buildSettlementDriverPaySummary(suggest)
    },
    activeDriversWithNoRevenue: {
      sourceAvailable: activeRosterItems.length > 0,
      warning: activeRosterWarning,
      count: activeDriversWithoutMainRevenue.length,
      main: activeDriversWithoutMainRevenue
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




async function getSalesActivityReportPayload(query = {}) {
  const salesLeadsListId = getSalesLeadsListId();

  if (!salesLeadsListId) {
    const configError = new Error('SALES_LEADS_LIST_ID is not configured on the server.');
    configError.statusCode = 500;
    throw configError;
  }

  const token = await getGraphToken();
  const range = getSalesActivityDateRange(query || {});
  const [items, notesBundle] = await Promise.all([
    getAllListItemsWithFields(token, salesLeadsListId, getSalesLeadFieldSelect()),
    getSalesLeadNotesBundle(token)
  ]);

  const records = items.map(cleanSalesLeadItem);
  const report = buildSalesActivitySnapshot(records, notesBundle, range);

  return {
    ...report,
    sourceListId: salesLeadsListId
  };
}

app.get('/reports/sales-activity', requireLookupAccess, async (req, res) => {
  try {
    const report = await getSalesActivityReportPayload(req.query || {});
    res.json(report);
  } catch (error) {
    console.error(error);

    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || 'Unable to load Sales Activity Snapshot.'
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
    const [items, customerRevenueIndex, notesBundle] = await Promise.all([
      getAllListItemsWithFields(token, salesLeadsListId, getSalesLeadFieldSelect()),
      buildCustomerRevenueIndex(token),
      getSalesLeadNotesBundle(token)
    ]);
    const records = items
      .map(cleanSalesLeadItem)
      .map((record) => enrichSalesLeadWithRevenue(record, customerRevenueIndex))
      .map((record) => enrichSalesLeadWithNotes(record, notesBundle.notesIndex));
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
      notesSourceListId: notesBundle.sourceListId,
      notesStatus: notesBundle.status,
      notesError: notesBundle.error,
      notesScanned: notesBundle.recordsScanned,
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


app.post('/sales-leads/notes', requireLookupAccess, async (req, res) => {
  try {
    const token = await getGraphToken();
    const note = await createSalesLeadNote(token, req.body || {});

    res.status(201).json({
      success: true,
      message: 'Sales note added. Refresh the Sales Leads customer cards to see the new note in the log.',
      maxLength: SALES_LEAD_NOTE_MAX_LENGTH,
      note
    });
  } catch (error) {
    console.error(error);

    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || 'Unable to add sales note.'
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
    const [items, customerRevenueIndex, notesBundle] = await Promise.all([
      getAllListItemsWithFields(token, salesLeadsListId, getSalesLeadFieldSelect()),
      buildCustomerRevenueIndex(token),
      getSalesLeadNotesBundle(token)
    ]);
    const records = items
      .map(cleanSalesLeadItem)
      .map((record) => enrichSalesLeadWithRevenue(record, customerRevenueIndex))
      .map((record) => enrichSalesLeadWithNotes(record, notesBundle.notesIndex));
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
      notesSourceListId: notesBundle.sourceListId,
      notesStatus: notesBundle.status,
      notesError: notesBundle.error,
      notesScanned: notesBundle.recordsScanned,
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

app.get('/reports/action-alerts', requireLookupAccess, async (req, res) => {
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
      getReportActionAlertFieldSelect()
    );

    res.json(buildReportActionAlertsResponse(items, currentList));
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message || 'Unable to load report action alerts.'
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

    const rosterByTruck = await getDriverRosterByTruck(token);

    res.json(buildGrossRevenueTotalsResponse(items, sourceList, year, rosterByTruck));
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



function escapePdfText(value) {
  return String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .trim();
}

function getPdfTextWidthApprox(value, fontSize = 8) {
  return String(value ?? '').length * fontSize * 0.52;
}

function truncatePdfText(value, maxWidth, fontSize = 8) {
  const text = String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
  if (!text) return '-';
  if (getPdfTextWidthApprox(text, fontSize) <= maxWidth) return text;

  const maxChars = Math.max(4, Math.floor(maxWidth / (fontSize * 0.52)) - 1);
  return `${text.slice(0, maxChars).trim()}...`;
}

function pdfText(x, y, text, options = {}) {
  const font = options.font || 'F1';
  const size = Number(options.size || 8);
  const color = options.color || '0.08 0.10 0.14';

  return `q ${color} rg BT /${font} ${size} Tf ${Number(x).toFixed(2)} ${Number(y).toFixed(2)} Td (${escapePdfText(text)}) Tj ET Q\n`;
}

function pdfRect(x, y, width, height, color = '0.95 0.97 1') {
  return `q ${color} rg ${Number(x).toFixed(2)} ${Number(y).toFixed(2)} ${Number(width).toFixed(2)} ${Number(height).toFixed(2)} re f Q\n`;
}

function pdfLine(x1, y1, x2, y2, color = '0.78 0.82 0.89', width = 0.5) {
  return `q ${color} RG ${Number(width).toFixed(2)} w ${Number(x1).toFixed(2)} ${Number(y1).toFixed(2)} m ${Number(x2).toFixed(2)} ${Number(y2).toFixed(2)} l S Q\n`;
}

function formatPdfMoney(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(getNumberValue(value));
}

function formatPdfNumber(value) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0
  }).format(Number(value) || 0);
}

function formatPdfRosterDate(value) {
  if (!value) return '-';
  return formatShortDate(value) || String(value || '-');
}

function buildPdfDocument(pageContents, options = {}) {
  const width = options.width || 792;
  const height = options.height || 612;
  const objects = [];

  function addObject(body) {
    objects.push(body);
    return objects.length;
  }

  addObject('<< /Type /Catalog /Pages 2 0 R >>');
  addObject('');
  addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>');

  const pageObjectIds = [];

  pageContents.forEach((content) => {
    const contentObjectId = addObject(`<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}endstream`);
    const pageObjectId = addObject(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${contentObjectId} 0 R >>`
    );

    pageObjectIds.push(pageObjectId);
  });

  objects[1] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageObjectIds.length} >>`;

  const chunks = ['%PDF-1.4\n'];
  const offsets = [0];

  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(chunks.join(''), 'utf8'));
    chunks.push(`${index + 1} 0 obj\n${body}\nendobj\n`);
  });

  const xrefOffset = Buffer.byteLength(chunks.join(''), 'utf8');
  chunks.push(`xref\n0 ${objects.length + 1}\n`);
  chunks.push('0000000000 65535 f \n');

  for (let i = 1; i <= objects.length; i += 1) {
    chunks.push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }

  chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  return Buffer.from(chunks.join(''), 'utf8');
}


function createPdfReportWriter(options = {}) {
  const pageWidth = options.pageWidth || 792;
  const pageHeight = options.pageHeight || 612;
  const margin = options.margin || 36;
  const contentWidth = pageWidth - (margin * 2);
  const pages = [];
  let page = '';
  let y = pageHeight - margin;
  let pageNumber = 0;

  function add(content) {
    page += content;
  }

  function startPage() {
    if (page) pages.push(page);

    pageNumber += 1;
    page = '';
    y = pageHeight - margin;

    add(pdfText(margin, y, 'KOLE TRUCKING', { font: 'F2', size: 11, color: '0.08 0.12 0.22' }));
    add(pdfText(pageWidth - margin - 58, y, `Page ${pageNumber}`, { font: 'F1', size: 8, color: '0.35 0.42 0.52' }));
    y -= 19;
    add(pdfText(margin, y, options.title || 'Kole Report', { font: 'F2', size: 18, color: '0.06 0.09 0.16' }));
    y -= 14;
    if (options.subtitle) {
      add(pdfText(margin, y, truncatePdfText(options.subtitle, contentWidth, 8.5), { font: 'F1', size: 8.5, color: '0.35 0.42 0.52' }));
      y -= 9;
    }
    add(pdfLine(margin, y, pageWidth - margin, y, '0.70 0.76 0.86', 0.75));
    y -= 18;
  }

  function finish() {
    if (page) pages.push(page);
    return buildPdfDocument(pages, { width: pageWidth, height: pageHeight });
  }

  function ensureSpace(heightNeeded = 24) {
    if (y - heightNeeded < margin) startPage();
  }

  function addParagraph(label, value) {
    ensureSpace(15);
    add(pdfText(margin, y, `${label}:`, { font: 'F2', size: 8.5, color: '0.13 0.18 0.28' }));
    add(pdfText(margin + 128, y, truncatePdfText(value || '-', contentWidth - 128, 8.5), { font: 'F1', size: 8.5, color: '0.18 0.23 0.32' }));
    y -= 13;
  }

  function addSectionTitle(title, subtitle = '') {
    ensureSpace(34);
    add(pdfRect(margin, y - 15, contentWidth, 20, '0.89 0.93 1'));
    add(pdfText(margin + 8, y - 9, title, { font: 'F2', size: 10.5, color: '0.08 0.13 0.24' }));
    if (subtitle) {
      add(pdfText(pageWidth - margin - 128, y - 9, truncatePdfText(subtitle, 120, 8), { font: 'F1', size: 8, color: '0.35 0.42 0.52' }));
    }
    y -= 29;
  }

  function addTextLine(text, options = {}) {
    ensureSpace(15);
    add(pdfText(margin, y, truncatePdfText(text || '-', contentWidth, options.size || 8.5), {
      font: options.font || 'F1',
      size: options.size || 8.5,
      color: options.color || '0.13 0.18 0.28'
    }));
    y -= options.lineHeight || 14;
  }

  function addTable(columns, rows, emptyMessage) {
    const headerHeight = 15;
    const rowHeight = 14;

    if (!rows || rows.length === 0) {
      ensureSpace(20);
      add(pdfText(margin, y, emptyMessage || 'No rows found.', { font: 'F1', size: 8.5, color: '0.35 0.42 0.52' }));
      y -= 17;
      return;
    }

    function drawHeader() {
      ensureSpace(headerHeight + rowHeight);
      let x = margin;
      add(pdfRect(margin, y - 11, contentWidth, headerHeight, '0.17 0.21 0.31'));

      columns.forEach((column) => {
        add(pdfText(x + 3, y - 7, truncatePdfText(column.label, column.width - 6, 7.25), { font: 'F2', size: 7.25, color: '1 1 1' }));
        x += column.width;
      });

      y -= headerHeight;
    }

    drawHeader();

    rows.forEach((row, rowIndex) => {
      if (y - rowHeight < margin) {
        startPage();
        drawHeader();
      }

      if (rowIndex % 2 === 0) {
        add(pdfRect(margin, y - 10.5, contentWidth, rowHeight, '0.97 0.98 1'));
      }

      let x = margin;
      columns.forEach((column) => {
        const rawValue = typeof column.value === 'function' ? column.value(row) : row[column.value];
        const displayValue = truncatePdfText(rawValue || '-', column.width - 6, 7.4);
        add(pdfText(x + 3, y - 7, displayValue, { font: column.mono ? 'F3' : 'F1', size: 7.4, color: '0.08 0.10 0.14' }));
        x += column.width;
      });

      add(pdfLine(margin, y - 12, pageWidth - margin, y - 12, '0.88 0.91 0.96', 0.35));
      y -= rowHeight;
    });

    y -= 8;
  }

  startPage();

  return {
    addParagraph,
    addSectionTitle,
    addTextLine,
    addTable,
    finish,
    ensureSpace,
    getContentWidth: () => contentWidth
  };
}


function createDriverTimeOffPdfBuffer(report) {
  const summary = report.summary || {};
  const analytics = report.analytics || {};
  const subtitleParts = [
    `Generated: ${report.generatedAt || '-'}`,
    report.filter?.label ? `Filtered: ${report.filter.label}` : 'Full year summary',
    'Raw log excluded'
  ];

  const writer = createPdfReportWriter({
    title: report.reportLabel || 'Driver Time Off Report',
    subtitle: subtitleParts.filter(Boolean).join('    ')
  });

  writer.addSectionTitle('Report Summary');
  writer.addParagraph('Report year', String(report.year || '-'));
  if (report.filter?.label) {
    writer.addParagraph('Filter', report.filter.label);
  }
  writer.addParagraph('Export note', 'This PDF includes summary cards and analysis sections only. The full Time Off Log is intentionally excluded.');
  writer.addTextLine([
    `Events ${formatPdfNumber(summary.totalEvents)}`,
    `Total Days ${formatPdfNumber(summary.totalDays)}`,
    `Drivers ${formatPdfNumber(summary.uniqueDrivers)}`,
    `Current Off ${formatPdfNumber(summary.currentDriversOff)}`,
    `Avg Days/Event ${Number(summary.averageDaysPerEvent || 0).toLocaleString('en-US', { maximumFractionDigits: 1 })}`,
    `Longest ${formatPdfNumber(summary.longestEventDays)} day(s)${summary.longestEventDriver ? ` - ${summary.longestEventDriver}` : ''}`
  ].join('   |   '), { font: 'F2' });

  writer.addSectionTitle('By Driver', `${formatPdfNumber((analytics.byDriver || []).length)} driver(s)`);
  writer.addTable([
    { label: 'Driver / Truck', width: 360, value: (row) => row.label || row.key || '-' },
    { label: 'Events', width: 80, value: (row) => formatPdfNumber(row.events) },
    { label: 'Days', width: 90, value: (row) => formatPdfNumber(row.days) }
  ], analytics.byDriver || [], 'No driver summary rows found.');

  writer.addSectionTitle('By Month', `${formatPdfNumber((analytics.byMonth || []).length)} month(s)`);
  writer.addTable([
    { label: 'Month', width: 360, value: (row) => row.label || row.key || '-' },
    { label: 'Events', width: 80, value: (row) => formatPdfNumber(row.events) },
    { label: 'Days', width: 90, value: (row) => formatPdfNumber(row.days) }
  ], analytics.byMonth || [], 'No monthly summary rows found.');

  writer.addSectionTitle('By Reason', `${formatPdfNumber((analytics.byReason || []).length)} reason(s)`);
  writer.addTable([
    { label: 'Reason', width: 360, value: (row) => row.label || row.key || '-' },
    { label: 'Events', width: 80, value: (row) => formatPdfNumber(row.events) },
    { label: 'Days', width: 90, value: (row) => formatPdfNumber(row.days) }
  ], analytics.byReason || [], 'No reason summary rows found.');

  return writer.finish();
}

function createDriverSummaryPdfBuffer(report) {
  const writer = createPdfReportWriter({
    title: `${report.reportLabel || ''} Driver Summary Report`.trim(),
    subtitle: `Generated: ${report.generatedAt || '-'}    Data source: ${report.dataSource || '-'}`
  });
  const totals = report.totals || {};

  writer.addSectionTitle('Report Summary');
  writer.addParagraph('Anchor date', report.anchorDate || 'Pickup Offer Date');
  writer.addParagraph('Included statuses', (report.includedStatuses || []).join(', ') || 'Won, TONU');
  writer.addTextLine([
    `Loads ${formatPdfNumber(totals.loadCount)}`,
    `Gross ${formatPdfMoney(totals.quotedTotal)}`,
    `Loaded Miles ${formatPdfNumber(totals.loadedMiles)}`,
    `Empty Miles ${formatPdfNumber(totals.emptyMiles)}`,
    `$/Load Mile ${formatPdfMoney(totals.revenuePerLoadedMile)}`,
    `$/All Miles ${formatPdfMoney(totals.revenuePerTotalMile)}`,
    `Driver Pay ${formatPdfMoney(totals.driverPay)}`
  ].join('   |   '), { font: 'F2' });

  writer.addSectionTitle('Driver Totals', `${formatPdfNumber((report.drivers || []).length)} driver(s)`);
  writer.addTable([
    { label: 'Truck', width: 48, mono: true, value: (row) => row.truck || '-' },
    { label: 'Operator', width: 135, value: (row) => row.operator || '-' },
    { label: 'Loads', width: 42, mono: true, value: (row) => formatPdfNumber(row.loadCount) },
    { label: 'Empty', width: 55, value: (row) => formatPdfNumber(row.emptyMiles) },
    { label: 'Loaded', width: 55, value: (row) => formatPdfNumber(row.loadedMiles) },
    { label: 'All Miles', width: 55, value: (row) => formatPdfNumber(row.totalMiles) },
    { label: 'Gross', width: 82, value: (row) => formatPdfMoney(row.quotedTotal) },
    { label: '$/Load', width: 70, value: (row) => formatPdfMoney(row.revenuePerLoadedMile) },
    { label: '$/All', width: 70, value: (row) => formatPdfMoney(row.revenuePerTotalMile) },
    { label: 'Driver Pay', width: 108, value: (row) => formatPdfMoney(row.driverPay) }
  ], report.drivers || [], 'No Won or TONU loads were found for this report month.');

  (report.drivers || []).forEach((driver) => {
    writer.addSectionTitle(`Truck ${driver.truck || '-'}`, `${driver.operator || 'Unknown Operator'} | ${formatPdfNumber(driver.loadCount)} load(s)`);
    writer.addTextLine([
      `Gross ${formatPdfMoney(driver.quotedTotal)}`,
      `Driver Pay ${formatPdfMoney(driver.driverPay)}`,
      `Loaded ${formatPdfNumber(driver.loadedMiles)}`,
      `Empty ${formatPdfNumber(driver.emptyMiles)}`,
      `$/All ${formatPdfMoney(driver.revenuePerTotalMile)}`
    ].join('   |   '), { font: 'F2' });

    writer.addTable([
      { label: 'BOL', width: 53, mono: true, value: (row) => row.BOL || '-' },
      { label: 'Company', width: 112, value: (row) => row.Customer || '-' },
      { label: 'Pickup', width: 55, value: (row) => row.PickupDateDisplay || '-' },
      { label: 'Route', width: 168, value: (row) => row.Route || '-' },
      { label: 'DH', width: 42, value: (row) => formatPdfNumber(row.EmptyMiles) },
      { label: 'Loaded', width: 46, value: (row) => formatPdfNumber(row.LoadedMiles) },
      { label: 'Quoted', width: 70, value: (row) => formatPdfMoney(row.QuotedTotal) },
      { label: '$/Ld', width: 54, value: (row) => formatPdfMoney(row.RatePerLoadedMile ?? row.RatePerMile) },
      { label: '$/All', width: 54, value: (row) => formatPdfMoney(row.RatePerAllMiles) },
      { label: 'Pay', width: 66, value: (row) => formatPdfMoney(row.DriverPay) }
    ], driver.loads || [], 'No loads found for this driver.');
  });

  return writer.finish();
}

function createSalesActivityPdfBuffer(report) {
  const writer = createPdfReportWriter({
    title: report.reportLabel || 'Sales Activity Snapshot',
    subtitle: `Activity: ${report.activityPeriodLabel || '-'}    Due window: ${report.duePeriodLabel || '-'}    Generated: ${report.generatedAt || '-'}`
  });
  const summary = report.summary || {};
  const sections = report.sections || {};

  writer.addSectionTitle('Snapshot Summary');
  writer.addTextLine([
    `Overdue ${formatPdfNumber(summary.overdueFollowUps)}`,
    `Due Window ${formatPdfNumber(summary.dueFollowUps)}`,
    `Notes Added ${formatPdfNumber(summary.notesAdded)}`,
    `Completed Touches ${formatPdfNumber(summary.completedFollowUps)}`,
    `Touched Customers ${formatPdfNumber(summary.touchedCustomers)}`
  ].join('   |   '), { font: 'F2' });

  if (report.notesStatus && report.notesStatus !== 'available') {
    writer.addParagraph('Notes warning', report.notesError || 'Sales notes are not connected yet.');
  }

  function addLeadSection(title, description, rows = []) {
    writer.addSectionTitle(title, `${formatPdfNumber(rows.length)} item(s)`);
    if (description) writer.addTextLine(description, { size: 8.25, color: '0.35 0.42 0.52' });
    writer.addTable([
      { label: 'Company', width: 180, value: (row) => row.CompanyName || '-' },
      { label: 'Code', width: 70, mono: true, value: (row) => row.CustomerCode || '-' },
      { label: 'Next Touch', width: 70, value: (row) => row.NextTouchDateDisplay || formatShortDate(row.NextTouchDate) || '-' },
      { label: 'Quotes', width: 50, value: (row) => formatPdfNumber(row.QuoteCount) },
      { label: 'First Quote', width: 70, value: (row) => row.FirstQuoteDateDisplay || formatShortDate(row.FirstQuoteDate) || '-' },
      { label: 'Last Quote', width: 70, value: (row) => row.LastQuoteDateDisplay || formatShortDate(row.LastQuoteDate) || '-' },
      { label: 'Status', width: 90, value: (row) => row.Status || '-' }
    ], rows, 'Nothing to show here.');
  }

  function addNoteSection(title, description, rows = [], dateField = 'ActivityDate') {
    writer.addSectionTitle(title, `${formatPdfNumber(rows.length)} item(s)`);
    if (description) writer.addTextLine(description, { size: 8.25, color: '0.35 0.42 0.52' });
    writer.addTable([
      { label: 'Company', width: 155, value: (row) => row.CompanyName || '-' },
      { label: 'Code', width: 70, mono: true, value: (row) => row.CustomerCode || '-' },
      { label: 'Date', width: 62, value: (row) => row[`${dateField}Display`] || formatShortDate(row[dateField]) || '-' },
      { label: 'Author', width: 80, value: (row) => row.Author || '-' },
      { label: 'Type', width: 70, value: (row) => row.NoteType || '-' },
      { label: 'Note', width: 283, value: (row) => row.Note || row.Title || '-' }
    ], rows, 'Nothing to show here.');
  }

  addLeadSection('Overdue Follow-Ups', 'Follow-up pending and Next Touch before today.', sections.overdueFollowUps || []);
  addLeadSection('Follow-Ups Due in Window', `Follow-up pending from ${report.duePeriodLabel || 'the selected due window'}.`, sections.dueFollowUps || []);
  addNoteSection('Notes Added', `Notes created from ${report.activityPeriodLabel || 'the selected activity window'}.`, sections.notesAdded || [], 'ActivityDate');
  addNoteSection('Follow-Ups Completed', `Touch dates recorded from ${report.activityPeriodLabel || 'the selected activity window'}.`, sections.completedFollowUps || [], 'TouchDate');

  return writer.finish();
}

function createWeeklySettlementPdfBuffer(report) {
  const pageWidth = 792;
  const pageHeight = 612;
  const margin = 36;
  const contentWidth = pageWidth - (margin * 2);
  const pages = [];
  let page = '';
  let y = pageHeight - margin;
  let pageNumber = 0;

  function add(content) {
    page += content;
  }

  function startPage() {
    if (page) pages.push(page);

    pageNumber += 1;
    page = '';
    y = pageHeight - margin;

    add(pdfText(margin, y, 'KOLE TRUCKING', { font: 'F2', size: 11, color: '0.08 0.12 0.22' }));
    add(pdfText(pageWidth - margin - 58, y, `Page ${pageNumber}`, { font: 'F1', size: 8, color: '0.35 0.42 0.52' }));
    y -= 19;
    add(pdfText(margin, y, report.reportLabel || 'Weekly Settlement Report', { font: 'F2', size: 18, color: '0.06 0.09 0.16' }));
    y -= 14;
    add(pdfText(margin, y, `Cutoff: ${report.cutoffLabel || '-'}    Generated: ${report.generatedAt || '-'}`, { font: 'F1', size: 8.5, color: '0.35 0.42 0.52' }));
    y -= 9;
    add(pdfLine(margin, y, pageWidth - margin, y, '0.70 0.76 0.86', 0.75));
    y -= 18;
  }

  function finish() {
    if (page) pages.push(page);
    return buildPdfDocument(pages, { width: pageWidth, height: pageHeight });
  }

  function ensureSpace(heightNeeded = 24) {
    if (y - heightNeeded < margin) startPage();
  }

  function addParagraph(label, value) {
    ensureSpace(15);
    add(pdfText(margin, y, `${label}:`, { font: 'F2', size: 8.5, color: '0.13 0.18 0.28' }));
    add(pdfText(margin + 128, y, truncatePdfText(value || '-', contentWidth - 128, 8.5), { font: 'F1', size: 8.5, color: '0.18 0.23 0.32' }));
    y -= 13;
  }

  function addSectionTitle(title, subtitle = '') {
    ensureSpace(34);
    add(pdfRect(margin, y - 15, contentWidth, 20, '0.89 0.93 1'));
    add(pdfText(margin + 8, y - 9, title, { font: 'F2', size: 10.5, color: '0.08 0.13 0.24' }));
    if (subtitle) {
      add(pdfText(pageWidth - margin - 128, y - 9, truncatePdfText(subtitle, 120, 8), { font: 'F1', size: 8, color: '0.35 0.42 0.52' }));
    }
    y -= 29;
  }

  function addTotalsLine(label, totals = {}) {
    ensureSpace(18);
    const text = [
      `${label}`,
      `Orders ${formatPdfNumber(totals.orderCount)}`,
      `Drivers ${formatPdfNumber(totals.driverCount)}`,
      `Customers ${formatPdfNumber(totals.customerCount)}`,
      `Gross ${formatPdfMoney(totals.bidTotal)}`,
      `Driver Pay ${formatPdfMoney(totals.driverPayTotal)}`,
      `Margin ${formatPdfMoney(totals.margin)}`
    ].join('   |   ');

    add(pdfText(margin, y, truncatePdfText(text, contentWidth, 8.5), { font: 'F2', size: 8.5, color: '0.13 0.18 0.28' }));
    y -= 15;
  }

  function addTable(columns, rows, emptyMessage) {
    const headerHeight = 15;
    const rowHeight = 14;

    if (!rows || rows.length === 0) {
      ensureSpace(20);
      add(pdfText(margin, y, emptyMessage || 'No rows found.', { font: 'F1', size: 8.5, color: '0.35 0.42 0.52' }));
      y -= 17;
      return;
    }

    function drawHeader() {
      ensureSpace(headerHeight + rowHeight);
      let x = margin;
      add(pdfRect(margin, y - 11, contentWidth, headerHeight, '0.17 0.21 0.31'));

      columns.forEach((column) => {
        add(pdfText(x + 3, y - 7, truncatePdfText(column.label, column.width - 6, 7.25), { font: 'F2', size: 7.25, color: '1 1 1' }));
        x += column.width;
      });

      y -= headerHeight;
    }

    drawHeader();

    rows.forEach((row, rowIndex) => {
      if (y - rowHeight < margin) {
        startPage();
        drawHeader();
      }

      if (rowIndex % 2 === 0) {
        add(pdfRect(margin, y - 10.5, contentWidth, rowHeight, '0.97 0.98 1'));
      }

      let x = margin;
      columns.forEach((column) => {
        const rawValue = column.value(row);
        const displayValue = truncatePdfText(rawValue || '-', column.width - 6, 7.4);
        add(pdfText(x + 3, y - 7, displayValue, { font: column.mono ? 'F3' : 'F1', size: 7.4, color: '0.08 0.10 0.14' }));
        x += column.width;
      });

      add(pdfLine(margin, y - 12, pageWidth - margin, y - 12, '0.88 0.91 0.96', 0.35));
      y -= rowHeight;
    });

    y -= 8;
  }

  function addSettlementTable(title, totals, rows, emptyMessage) {
    addSectionTitle(title, `${formatPdfNumber(rows?.length || 0)} order(s)`);
    addTotalsLine('Totals', totals || {});
    addTable([
      { label: 'BOL', width: 53, mono: true, value: (row) => `${row.Starred ? '* ' : ''}${row.BOL || '-'}` },
      { label: 'Operator', width: 84, value: (row) => row.Operator || '-' },
      { label: 'Truck', width: 38, mono: true, value: (row) => row.Truck || '-' },
      { label: 'Customer', width: 100, value: (row) => row.Customer || '-' },
      { label: 'Pickup', width: 54, value: (row) => row.PUDateDisplay || '-' },
      { label: 'Route', width: 158, value: (row) => row.Route || [row.OriginST, row.DestST].filter(Boolean).join(' to ') || '-' },
      { label: 'Submitted', width: 82, value: (row) => [row.SubmitDateDisplay, row.SubmitTimeDisplay].filter(Boolean).join(' ') || '-' },
      { label: 'Gross', width: 74, value: (row) => formatPdfMoney(row.BidAmount) },
      { label: 'Driver Pay', width: 77, value: (row) => formatPdfMoney(row.DriverPay) }
    ], rows, emptyMessage);
  }

  function addDriverPaySummary(rows = []) {
    addSectionTitle('Gross / Driver Pay by Driver', `${formatPdfNumber(rows.length)} driver(s)`);
    addTable([
      { label: 'Driver', width: 128, value: (row) => row.driver || 'Unknown Operator' },
      { label: 'Truck(s)', width: 62, mono: true, value: (row) => row.trucks || '-' },
      { label: 'Orders', width: 45, mono: true, value: (row) => formatPdfNumber(row.orderCount) },
      { label: 'BOLs', width: 210, mono: true, value: (row) => (row.bols || []).join(', ') || '-' },
      { label: 'Gross', width: 92, value: (row) => formatPdfMoney(row.bidTotal) },
      { label: 'Driver Pay', width: 92, value: (row) => formatPdfMoney(row.driverPayTotal) },
      { label: 'Margin', width: 91, value: (row) => formatPdfMoney(row.margin) }
    ], rows, 'No driver pay summary is available for this settlement window.');
  }

  function addNoRevenueCheck(data = {}) {
    const rows = data.main || [];
    addSectionTitle('Active Drivers With No Main-Window Revenue', `${formatPdfNumber(rows.length)} flagged`);

    if (!data.sourceAvailable && data.warning) {
      addParagraph('Warning', data.warning);
      return;
    }

    if (data.warning) addParagraph('Warning', data.warning);

    addTable([
      { label: 'Operator / Team', width: 132, value: (row) => row.operatorTeamName || '-' },
      { label: 'TMS Name', width: 112, value: (row) => row.tmsName || '-' },
      { label: 'Truck', width: 48, mono: true, value: (row) => row.truck || '-' },
      { label: 'Driver Type', width: 82, value: (row) => row.driverType || '-' },
      { label: 'Trailer', width: 90, value: (row) => row.trailerType || '-' },
      { label: 'Start Date', width: 74, value: (row) => formatPdfRosterDate(row.startDate) },
      { label: 'Check', width: 182, value: (row) => row.hasLikelyNextWeekRevenue ? 'No main-window revenue; appears in likely next week.' : 'No main-window revenue found.' }
    ], rows, 'Every active roster driver matched main-window settlement revenue.');
  }

  startPage();

  addSectionTitle('Report Summary');
  addParagraph('Main settlement window', report.mainWindowLabel);
  addParagraph('Likely next week', report.suggestWindowLabel);
  addParagraph('Data source', report.dataSource);
  if (report.failedLists?.length) {
    addParagraph('Source warnings', `${report.failedLists.length} list(s) could not be loaded; see app preview for details.`);
  }
  y -= 4;

  addSettlementTable('Main Settlement', report.totals?.main, report.main || [], 'No orders were found for the main settlement window.');
  addDriverPaySummary(report.driverPaySummary?.main || []);
  addNoRevenueCheck(report.activeDriversWithNoRevenue || {});
  addSectionTitle('Settlement Note');
  addParagraph('* Starred BOLs', 'Submitted after the prior cutoff but before the end of that prior cutoff date.');

  addSettlementTable('Likely for Next Week', report.totals?.suggest, report.suggest || [], 'No orders were found for the likely next-week bucket.');

  if (report.counts?.excludedProcessedRecordsMissingSubmissionTimestamp > 0) {
    addSectionTitle('Skipped Processed Orders');
    addParagraph('Skipped', `${report.counts.excludedProcessedRecordsMissingSubmissionTimestamp} processed order(s) did not have a usable paperwork submitted date/time.`);
  }

  return finish();
}

async function getWeeklySettlementReportPayload(cutoffDateValue) {
  const cutoffDate = String(cutoffDateValue || '').trim();
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
    const notFoundError = new Error(`No Bid Listing source list was found for settlement cutoff ${cutoffDate}.`);
    notFoundError.statusCode = 404;
    throw notFoundError;
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

  let activeRosterItems = [];
  let activeRosterWarning = '';

  if (process.env.DRIVER_ROSTER_LIST_ID) {
    try {
      activeRosterItems = await getDriverRosterItems(token);
    } catch (rosterError) {
      activeRosterWarning = rosterError.message || 'Driver Roster could not be loaded for the active-driver revenue check.';
    }
  } else {
    activeRosterWarning = 'DRIVER_ROSTER_LIST_ID is not configured, so active drivers with no settlement revenue could not be checked.';
  }

  const report = buildWeeklySettlementResponse(successfulItems, sourceLists, cutoffDate, activeRosterItems, activeRosterWarning);

  return {
    ...report,
    failedLists
  };
}

app.get('/reports/weekly-settlement', requireLookupAccess, async (req, res) => {
  try {
    const report = await getWeeklySettlementReportPayload(req.query.cutoffDate);
    res.json(report);
  } catch (error) {
    console.error(error);

    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/reports/weekly-settlement/pdf', requireLookupAccess, async (req, res) => {
  try {
    const report = await getWeeklySettlementReportPayload(req.query.cutoffDate);
    const pdfBuffer = createWeeklySettlementPdfBuffer(report);
    const safePayrollDate = String(report.payrollDate || report.cutoffDate || 'weekly-settlement').replace(/[^0-9A-Za-z_-]+/g, '-');
    const fileName = `Kole_Weekly_Settlement_${safePayrollDate}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', pdfBuffer.length);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.end(pdfBuffer);
  } catch (error) {
    console.error(error);

    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || 'Unable to export Weekly Settlement Report PDF.'
    });
  }
});

app.get('/reports/driver-summary/pdf', requireLookupAccess, async (req, res) => {
  try {
    const report = await getDriverSummaryReportPayload(req.query.month, req.query.year);
    const pdfBuffer = createDriverSummaryPdfBuffer(report);
    const safeLabel = `${report.year || 'year'}-${String(report.month || '').padStart(2, '0')}`.replace(/[^0-9A-Za-z_-]+/g, '-');
    const fileName = `Kole_Driver_Summary_${safeLabel}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', pdfBuffer.length);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.end(pdfBuffer);
  } catch (error) {
    console.error(error);

    res.status(error.statusCode || 500).json(error.payload || {
      success: false,
      error: error.message || 'Unable to export Monthly Driver Summary Report PDF.'
    });
  }
});

app.get('/reports/sales-activity/pdf', requireLookupAccess, async (req, res) => {
  try {
    const report = await getSalesActivityReportPayload(req.query || {});
    const pdfBuffer = createSalesActivityPdfBuffer(report);
    const safeWindow = `${report.lookbackDays || 'activity'}-days-${report.activityEndDate || ''}`.replace(/[^0-9A-Za-z_-]+/g, '-');
    const fileName = `Kole_Sales_Activity_${safeWindow}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', pdfBuffer.length);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.end(pdfBuffer);
  } catch (error) {
    console.error(error);

    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || 'Unable to export Sales Activity Snapshot PDF.'
    });
  }
});

async function getDriverSummaryReportPayload(monthValue, yearValue) {
  const month = parseReportInteger(monthValue, 'month', 1, 12);
  const year = parseReportInteger(yearValue, 'year', 2024, 2030);
  const lockStatus = getDriverSummaryLockStatus(year, month);

  if (!lockStatus.isUnlocked) {
    const lockedError = new Error(`${lockStatus.reportLabel} Driver Summary Report is not available yet.`);
    lockedError.statusCode = 423;
    lockedError.payload = {
      success: false,
      error: 'REPORT_LOCKED',
      message: `${lockStatus.reportLabel} Driver Summary Report is not available yet.`,
      reportLabel: lockStatus.reportLabel,
      unlockLabel: lockStatus.unlockLabel,
      lockReason:
        'Monthly Driver Summary Reports unlock at 8:00 AM Eastern on the 5th day of the following month. This allows time for completed settlements, paperwork review, and final corrections before driver performance data is published.'
    };
    throw lockedError;
  }

  const token = await getGraphToken();
  const sourceList = await getDriverSummarySourceList(token, year);

  if (!sourceList) {
    const notFoundError = new Error(`No Bid Listing source list was found for ${year}.`);
    notFoundError.statusCode = 404;
    throw notFoundError;
  }

  const items = await getAllListItemsWithFields(
    token,
    sourceList.listId
  );

  return buildDriverSummaryResponse(items, sourceList, year, month);
}

app.get('/reports/driver-summary', requireLookupAccess, async (req, res) => {
  try {
    const report = await getDriverSummaryReportPayload(req.query.month, req.query.year);
    res.json(report);
  } catch (error) {
    console.error(error);

    res.status(error.statusCode || 500).json(error.payload || {
      success: false,
      error: error.message
    });
  }
});




function getAvailableTrucksSingleLineListId() {
  return (
    process.env.AVAILABLE_TRUCKS_SINGLE_LINE_LIST_ID ||
    process.env.AVAILABLE_EQUIPMENT_SINGLE_LINE_LIST_ID ||
    DEFAULT_AVAILABLE_TRUCKS_SINGLE_LINE_LIST_ID
  );
}

function getAvailableEquipmentSourceListId() {
  return (
    process.env.AVAILABLE_EQUIPMENT_SOURCE_LIST_ID ||
    process.env.AVAILABLE_TRUCKS_SOURCE_LIST_ID ||
    DEFAULT_AVAILABLE_EQUIPMENT_SOURCE_LIST_ID
  );
}

function getAvailableTrucksEmailListId() {
  return (
    process.env.AVAILABLE_TRUCKS_EMAIL_LIST_ID ||
    process.env.AVAILABLE_EQUIPMENT_DISTRIBUTION_LIST_ID ||
    process.env.AVAILABLE_TRUCKS_DISTRIBUTION_LIST_ID ||
    DEFAULT_AVAILABLE_TRUCKS_EMAIL_LIST_ID
  );
}

function cleanAvailableTrucksDistributionText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeDistributionEmail(value) {
  return cleanAvailableTrucksDistributionText(value).toLowerCase();
}

function isLikelyEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function getAvailableTrucksDistributionFieldSelect() {
  return [
    'Title',
    'Email',
    'Active'
  ].join(',');
}

function cleanAvailableTrucksDistributionItem(item) {
  const fields = item.fields || {};
  const company = cleanAvailableTrucksDistributionText(fields.Title);
  const email = cleanAvailableTrucksDistributionText(fields.Email);
  const active = parseBoolean(fields.Active);

  return {
    id: item.id || '',
    webUrl: item.webUrl || '',
    company,
    email,
    emailKey: normalizeDistributionEmail(email),
    active,
    createdAt: item.createdDateTime || fields.Created || '',
    modifiedAt: item.lastModifiedDateTime || fields.Modified || ''
  };
}

function sortAvailableTrucksDistributionRows(a, b) {
  const companyCompare = String(a.company || '').localeCompare(String(b.company || ''));
  if (companyCompare !== 0) return companyCompare;

  return String(a.email || '').localeCompare(String(b.email || ''));
}

async function getAvailableTrucksDistributionRows(token, listId) {
  const bundle = await getAllListItemsWithFieldsResilient(
    token,
    listId,
    getAvailableTrucksDistributionFieldSelect()
  );

  const rows = (bundle.items || [])
    .map(cleanAvailableTrucksDistributionItem)
    .filter((row) => row.company || row.email)
    .sort(sortAvailableTrucksDistributionRows);

  return {
    rows,
    warning: bundle.usedFallback ? bundle.warning : ''
  };
}

function buildAvailableTrucksDistributionFields(columnLookup, input) {
  const company = cleanAvailableTrucksDistributionText(input.company || input.Company || input.title || '');
  const email = normalizeDistributionEmail(input.email || input.Email || '');

  if (!company) {
    const error = new Error('Company is required before adding a distribution-list contact.');
    error.statusCode = 400;
    throw error;
  }

  if (!email) {
    const error = new Error('Email address is required before adding a distribution-list contact.');
    error.statusCode = 400;
    throw error;
  }

  if (!isLikelyEmail(email)) {
    const error = new Error('Enter a valid email address.');
    error.statusCode = 400;
    throw error;
  }

  const fields = {
    Title: company
  };

  const emailColumn = resolveListColumnName(columnLookup, ['Email', 'Email Address', 'EmailAddress']);
  if (!emailColumn) {
    const error = new Error('Email field was not found on the Available Trucks distribution list.');
    error.statusCode = 500;
    throw error;
  }

  fields[emailColumn] = email;

  const activeColumn = resolveListColumnName(columnLookup, ['Active']);
  if (!activeColumn) {
    const error = new Error('Active field was not found on the Available Trucks distribution list.');
    error.statusCode = 500;
    throw error;
  }

  fields[activeColumn] = true;

  return fields;
}

async function getListColumnLookup(token, listId) {
  const data = await graphGet(
    token,
    `https://graph.microsoft.com/v1.0/sites/${process.env.SITE_ID}/lists/${listId}/columns?$select=name,displayName,hidden,readOnly&$top=999`
  );

  const lookup = new Map();

  (data.value || [])
    .filter((column) => column?.hidden !== true && column?.readOnly !== true)
    .forEach((column) => {
      const internalName = column.name || '';
      const displayName = column.displayName || '';

      if (!internalName) return;

      [internalName, displayName]
        .filter(Boolean)
        .forEach((name) => {
          const normalized = normalizeGraphName(name);

          if (!lookup.has(normalized)) {
            lookup.set(normalized, internalName);
          }
        });
    });

  return lookup;
}

function resolveListColumnName(columnLookup, aliases = []) {
  for (const alias of aliases) {
    const normalized = normalizeGraphName(alias);
    if (columnLookup.has(normalized)) {
      return columnLookup.get(normalized);
    }
  }

  return '';
}

function addResolvedListField(fields, columnLookup, aliases, value, options = {}) {
  const clean = String(value ?? '').trim();

  if (!clean && options.includeEmpty !== true) {
    return '';
  }

  const columnName = resolveListColumnName(columnLookup, aliases);

  if (!columnName) {
    if (options.required) {
      throw new Error(`${options.label || aliases[0] || 'Required field'} was not found on the Available Equipment source list.`);
    }

    return '';
  }

  if (['LinkTitle', 'LinkTitleNoMenu'].includes(columnName)) {
    if (options.required) {
      throw new Error(`${options.label || aliases[0] || 'Required field'} resolved to SharePoint's read-only ${columnName} field.`);
    }

    return '';
  }

  fields[columnName] = clean;
  return columnName;
}

function normalizeAvailableTruckTimeOfDay(value) {
  const raw = String(value || '').trim();
  const normalized = normalizeText(raw);

  if (normalized === 'am' || normalized === 'morning') return 'AM';
  if (normalized === 'pm' || normalized === 'afternoon') return 'PM';
  if (normalized === 'evening') return 'Evening';

  return raw;
}

function cleanAvailableTruckFormValue(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function getAvailableTruckDriverColumnAliases(slot, fieldName, cityRank = null) {
  const slotText = String(slot);

  if (fieldName === 'driverName') {
    return [
      `Driver${slotText}`,
      `Driver${slotText}Name`,
      `DriverName${slotText}`,
      `Driver ${slotText}`,
      `Driver ${slotText} Name`,
      `Driver Name ${slotText}`,
      `Driver ${slotText} Driver Name`
    ];
  }

  if (fieldName === 'unitNo') {
    return [
      `Driver${slotText}Unit`,
      `Driver${slotText}UnitNo`,
      `Driver${slotText}UnitNumber`,
      `Driver${slotText}UnitNumbers`,
      `DriverUnit${slotText}`,
      `DriverUnitNo${slotText}`,
      `DriverUnitNumber${slotText}`,
      `DriverUnitNumbers${slotText}`,
      `Unit${slotText}`,
      `UnitNo${slotText}`,
      `UnitNumber${slotText}`,
      `UnitNumbers${slotText}`,
      `Driver ${slotText} Unit`,
      `Driver ${slotText} Unit No`,
      `Driver Unit No ${slotText}`,
      `Driver ${slotText} Unit Number`,
      `Driver Unit Number ${slotText}`,
      `Driver ${slotText} Unit Numbers`,
      `Driver Unit Numbers ${slotText}`
    ];
  }

  if (fieldName === 'equipmentType') {
    return [
      `Driver${slotText}EquipmentType`,
      `DriverEquipmentType${slotText}`,
      `EquipmentType${slotText}`,
      `Driver ${slotText} Equipment Type`,
      `Driver Equipment Type ${slotText}`
    ];
  }

  if (fieldName === 'currentLocation') {
    return [
      `Driver${slotText}CurrentLocation`,
      `DriverCurrentLocation${slotText}`,
      `CurrentLocation${slotText}`,
      `Driver ${slotText} Current Location`,
      `Driver Current Location ${slotText}`
    ];
  }

  if (fieldName === 'proximityLocation') {
    return [
      `Driver${slotText}City${cityRank}`,
      `Driver${slotText}Proximity${cityRank}`,
      `Driver${slotText}ProximityCity${cityRank}`,
      `DriverCity${cityRank}_${slotText}`,
      `DriverCity${cityRank}${slotText}`,
      `DriverProximity${cityRank}${slotText}`,
      `Proximity${cityRank}Driver${slotText}`,
      `Proximity${cityRank}_${slotText}`,
      `Driver ${slotText} City ${cityRank}`,
      `Driver ${slotText} Proximity ${cityRank}`,
      `Driver City ${cityRank} ${slotText}`,
      `Driver ${slotText} Proximity City ${cityRank}`
    ];
  }

  if (fieldName === 'proximityTime') {
    return [
      `Driver${slotText}City${cityRank}Time`,
      `Driver${slotText}CityTime${cityRank}`,
      `Driver${slotText}Proximity${cityRank}Time`,
      `Driver${slotText}ProximityTime${cityRank}`,
      `DriverCity${cityRank}Time${slotText}`,
      `DriverProximity${cityRank}Time${slotText}`,
      `Proximity${cityRank}TimeDriver${slotText}`,
      `Proximity${cityRank}Time_${slotText}`,
      `Driver ${slotText} City ${cityRank} Time`,
      `Driver ${slotText} Proximity ${cityRank} Time`,
      `Driver City ${cityRank} Time ${slotText}`,
      `Driver ${slotText} Proximity Time ${cityRank}`
    ];
  }

  return [];
}

function cleanAvailableTruckSubmissionDriver(row) {
  const proximityStops = Array.isArray(row?.proximityStops) ? row.proximityStops : [];

  return {
    rosterDriverKey: cleanAvailableTruckFormValue(row?.rosterDriverKey),
    driverName: cleanAvailableTruckFormValue(row?.driverName),
    unitNo: cleanAvailableTruckFormValue(row?.unitNo),
    equipmentType: cleanAvailableTruckFormValue(row?.equipmentType),
    currentLocation: cleanAvailableTruckFormValue(row?.currentLocation),
    proximityStops: [0, 1, 2, 3].map((index) => ({
      location: cleanAvailableTruckFormValue(proximityStops[index]?.location),
      timeLabel: cleanAvailableTruckFormValue(proximityStops[index]?.timeLabel)
    }))
  };
}

function hasAvailableTruckSubmissionDriver(row) {
  return Boolean(
    row.rosterDriverKey ||
    row.driverName ||
    row.unitNo ||
    row.equipmentType ||
    row.currentLocation ||
    row.proximityStops.some((stop) => stop.location || stop.timeLabel)
  );
}

function validateAvailableTruckSubmissionDriver(row, slot) {
  const missing = [];

  if (!row.driverName) missing.push('driver name');
  if (!row.unitNo) missing.push('unit number');
  if (!row.equipmentType) missing.push('equipment type');
  if (!row.currentLocation) missing.push('current location');

  if (missing.length > 0) {
    throw new Error(`Truck ${slot} is missing ${missing.join(', ')}.`);
  }
}

function validateAvailableTruckSubmissionDuplicates(drivers = []) {
  const seenRosterDrivers = new Map();
  const seenUnits = new Map();
  const seenDriverNames = new Map();

  drivers.forEach((driver, index) => {
    const rowLabel = `Truck ${index + 1}`;
    const rosterKey = cleanAvailableTruckFormValue(driver.rosterDriverKey);
    const unitKey = normalizeTruckKey(driver.unitNo);
    const driverKey = normalizeSearchValue(driver.driverName);

    if (rosterKey) {
      if (seenRosterDrivers.has(rosterKey)) {
        throw new Error(`${rowLabel} duplicates ${seenRosterDrivers.get(rosterKey)}. Each active roster driver can only be posted once.`);
      }
      seenRosterDrivers.set(rosterKey, rowLabel);
    }

    if (unitKey) {
      if (seenUnits.has(unitKey)) {
        throw new Error(`${rowLabel} duplicates unit ${driver.unitNo} from ${seenUnits.get(unitKey)}.`);
      }
      seenUnits.set(unitKey, rowLabel);
    }

    if (driverKey) {
      if (seenDriverNames.has(driverKey)) {
        throw new Error(`${rowLabel} duplicates driver ${driver.driverName} from ${seenDriverNames.get(driverKey)}.`);
      }
      seenDriverNames.set(driverKey, rowLabel);
    }
  });
}

function getAvailableTruckRosterOptionKey(roster) {
  if (roster?.id) return `roster-${roster.id}`;

  return [roster?.operatorTeamName || roster?.tmsName, roster?.truck]
    .map((value) => normalizeSearchValue(value))
    .filter(Boolean)
    .join('-');
}

function getAvailableTruckRosterEquipmentType(roster) {
  return uniqueNonEmpty([roster?.soloOrTeam, roster?.trailerType]).join(' ');
}

function buildAvailableTruckRosterOptions(rosterItems = []) {
  const seen = new Set();

  return rosterItems
    .filter((roster) => normalizeText(roster.status) === 'active')
    .map((roster) => {
      const driverName = cleanAvailableTruckFormValue(roster.operatorTeamName || roster.tmsName);
      const unitNo = cleanAvailableTruckFormValue(roster.truck);
      const equipmentType = cleanAvailableTruckFormValue(getAvailableTruckRosterEquipmentType(roster));
      const key = getAvailableTruckRosterOptionKey(roster);

      return {
        key,
        id: roster.id || '',
        driverName,
        unitNo,
        equipmentType,
        status: roster.status || '',
        trailerType: roster.trailerType || '',
        soloOrTeam: roster.soloOrTeam || '',
        tmsName: roster.tmsName || ''
      };
    })
    .filter((option) => option.key && (option.driverName || option.unitNo))
    .filter((option) => {
      const duplicateKey = `${normalizeSearchValue(option.driverName)}|${normalizeTruckKey(option.unitNo)}`;
      if (seen.has(duplicateKey)) return false;
      seen.add(duplicateKey);
      return true;
    })
    .sort((a, b) => {
      const nameCompare = String(a.driverName || '').localeCompare(String(b.driverName || ''));
      if (nameCompare !== 0) return nameCompare;
      return String(a.unitNo || '').localeCompare(String(b.unitNo || ''));
    });
}

async function getAvailableTruckRosterOptions(token) {
  if (!process.env.DRIVER_ROSTER_LIST_ID) {
    return [];
  }

  const rosterItems = await getDriverRosterItems(token);
  return buildAvailableTruckRosterOptions(rosterItems);
}

async function resolveAvailableTruckDriversFromRoster(token, drivers = []) {
  if (!drivers.some((driver) => driver.rosterDriverKey)) {
    return drivers;
  }

  const rosterOptions = await getAvailableTruckRosterOptions(token);
  const rosterOptionMap = new Map(rosterOptions.map((option) => [option.key, option]));

  return drivers.map((driver, index) => {
    if (!driver.rosterDriverKey) return driver;

    const rosterOption = rosterOptionMap.get(driver.rosterDriverKey);

    if (!rosterOption) {
      throw new Error(`Truck ${index + 1} selected a driver that is not currently active in Driver Roster. Refresh Available Trucks and choose the driver again.`);
    }

    return {
      ...driver,
      driverName: rosterOption.driverName,
      unitNo: rosterOption.unitNo,
      equipmentType: rosterOption.equipmentType
    };
  });
}

function buildAvailableTruckSourceFields(columnLookup, submission) {
  const fields = {};
  const dateSent = normalizeEasternDateOnly(submission.dateSent) || formatEasternDate();
  const timeOfDay = normalizeAvailableTruckTimeOfDay(submission.timeOfDay) || 'AM';

  fields.Title = `Available Trucks ${dateSent} ${timeOfDay}`;

  addResolvedListField(
    fields,
    columnLookup,
    ['DateSent', 'Date Sent'],
    dateSent,
    { required: true, label: 'Date Sent' }
  );

  addResolvedListField(
    fields,
    columnLookup,
    ['TimeofDay', 'Time Of Day', 'Time of Day'],
    timeOfDay,
    { required: true, label: 'Time of Day' }
  );

  addResolvedListField(
    fields,
    columnLookup,
    ['EmailSent', 'Email Sent'],
    'No'
  );

  submission.drivers.forEach((driver, index) => {
    const slot = index + 1;

    addResolvedListField(fields, columnLookup, getAvailableTruckDriverColumnAliases(slot, 'driverName'), driver.driverName);
    addResolvedListField(fields, columnLookup, getAvailableTruckDriverColumnAliases(slot, 'unitNo'), driver.unitNo);
    addResolvedListField(fields, columnLookup, getAvailableTruckDriverColumnAliases(slot, 'equipmentType'), driver.equipmentType);
    addResolvedListField(fields, columnLookup, getAvailableTruckDriverColumnAliases(slot, 'currentLocation'), driver.currentLocation);

    driver.proximityStops.forEach((stop, stopIndex) => {
      const rank = stopIndex + 1;
      addResolvedListField(fields, columnLookup, getAvailableTruckDriverColumnAliases(slot, 'proximityLocation', rank), stop.location);
      addResolvedListField(fields, columnLookup, getAvailableTruckDriverColumnAliases(slot, 'proximityTime', rank), stop.timeLabel);
    });
  });

  return fields;
}

function getAvailableTruckFieldSelect() {
  return [
    'DateSent',
    'TimeofDay',
    'DriverName',
    'UnitNo',
    'EquipmentType',
    'CurrentLocation',
    'Proximity1',
    'Proximity1Time',
    'Proximity2',
    'Proximity2Time',
    'Proximity3',
    'Proximity3Time',
    'Proximity4',
    'Proximity4Time'
  ].join(',');
}

function cleanAvailableTruckText(value) {
  return stripHtml(value)
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .trim();
}

function normalizeStateAbbreviation(value) {
  const state = String(value || '').trim();
  return /^[A-Za-z]{2}$/.test(state) ? state.toUpperCase() : state;
}

function parseCityState(value) {
  const clean = cleanAvailableTruckText(value);

  if (!clean) {
    return {
      location: '',
      city: '',
      state: '',
      stateKey: ''
    };
  }

  const parts = clean.split(',');

  if (parts.length < 2) {
    return {
      location: clean,
      city: clean,
      state: '',
      stateKey: ''
    };
  }

  const state = normalizeStateAbbreviation(parts.pop());
  const city = parts.join(',').trim();

  return {
    location: [city, state].filter(Boolean).join(', '),
    city,
    state,
    stateKey: state.toUpperCase()
  };
}

function getAvailableEquipmentFamily(value) {
  const raw = cleanAvailableTruckText(value);
  const normalized = raw.toLowerCase();

  if (!normalized) return 'Not listed';
  if (normalized.includes('rgn')) return 'RGN';
  if (normalized.includes('conestoga')) return 'Conestoga';
  if (normalized.includes('stepdeck')) return 'Stepdeck';
  if (normalized.includes('flatbed')) return 'Flatbed';
  if (normalized.includes('dry van') || normalized.includes('van')) return 'Van';

  return raw;
}

function getAvailableTeamType(value) {
  const normalized = cleanAvailableTruckText(value).toLowerCase();

  if (normalized.includes('team')) return 'Team';
  if (normalized.includes('solo')) return 'Solo';

  return 'Unlisted';
}

function getTimeOfDaySortValue(value) {
  const normalized = normalizeText(value);

  if (normalized === 'am' || normalized.includes('morning')) return 1;
  if (normalized === 'pm' || normalized.includes('afternoon')) return 2;
  if (normalized.includes('evening')) return 3;

  return 0;
}

function getAvailableTruckDateSortValue(value) {
  const normalized = normalizeEasternDateOnly(value) || String(value || '').trim();
  const parsed = new Date(`${normalized}T00:00:00Z`);
  const time = parsed.getTime();
  return Number.isNaN(time) ? 0 : time;
}

function cleanAvailableTruckRecord(item) {
  const fields = item.fields || {};
  const currentLocation = parseCityState(fields.CurrentLocation);
  const dateSent = normalizeEasternDateOnly(fields.DateSent) || cleanAvailableTruckText(fields.DateSent);
  const equipmentType = cleanAvailableTruckText(fields.EquipmentType);

  const proximityStops = [1, 2, 3, 4]
    .map((rank) => {
      const parsedLocation = parseCityState(fields[`Proximity${rank}`]);
      const timeLabel = cleanAvailableTruckText(fields[`Proximity${rank}Time`]);

      return {
        rank,
        location: parsedLocation.location,
        city: parsedLocation.city,
        state: parsedLocation.state,
        stateKey: parsedLocation.stateKey,
        timeLabel
      };
    })
    .filter((stop) => stop.location || stop.timeLabel);

  return {
    id: item.id || '',
    webUrl: item.webUrl || '',
    createdAt: item.createdDateTime || fields.Created || '',
    modifiedAt: item.lastModifiedDateTime || fields.Modified || '',
    dateSent,
    timeOfDay: cleanAvailableTruckText(fields.TimeofDay),
    driverName: cleanAvailableTruckText(fields.DriverName),
    unitNo: cleanAvailableTruckText(fields.UnitNo),
    equipmentType,
    equipmentFamily: getAvailableEquipmentFamily(equipmentType),
    teamType: getAvailableTeamType(equipmentType),
    currentLocation: currentLocation.location,
    currentCity: currentLocation.city,
    currentState: currentLocation.state,
    currentStateKey: currentLocation.stateKey,
    proximityStops
  };
}

function compareAvailableTruckRecords(a, b) {
  const dateDiff = getAvailableTruckDateSortValue(b.dateSent) - getAvailableTruckDateSortValue(a.dateSent);
  if (dateDiff !== 0) return dateDiff;

  const timeDiff = getTimeOfDaySortValue(b.timeOfDay) - getTimeOfDaySortValue(a.timeOfDay);
  if (timeDiff !== 0) return timeDiff;

  return String(a.driverName || '').localeCompare(String(b.driverName || ''));
}

function incrementBucket(map, key, label = key) {
  const cleanKey = String(key || '').trim();
  const cleanLabel = String(label || cleanKey).trim();
  if (!cleanKey) return;

  const existing = map.get(cleanKey) || { key: cleanKey, label: cleanLabel, count: 0 };
  existing.count += 1;
  map.set(cleanKey, existing);
}

function getTopBuckets(map, limit = 5) {
  return Array.from(map.values())
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return String(a.label || '').localeCompare(String(b.label || ''));
    })
    .slice(0, limit);
}

function getAvailableTruckDateTimeSortValue(dateValue, timeOfDay) {
  const dateOnly = normalizeEasternDateOnly(dateValue) || String(dateValue || '').trim().slice(0, 10);

  if (!dateOnly) return 0;

  const normalizedTime = normalizeText(timeOfDay);
  let hour = 12;

  if (normalizedTime === 'am' || normalizedTime.includes('morning')) hour = 8;
  else if (normalizedTime === 'pm' || normalizedTime.includes('afternoon')) hour = 15;
  else if (normalizedTime.includes('evening')) hour = 19;

  const parsed = new Date(`${dateOnly}T${String(hour).padStart(2, '0')}:00:00-04:00`);
  const time = parsed.getTime();
  return Number.isNaN(time) ? getAvailableTruckDateSortValue(dateOnly) : time;
}

function normalizeAvailableTruckSuggestionKey(value) {
  return normalizeSearchValue(parseCityState(value).location || value);
}

function buildAvailableTruckProximitySuggestionIndex(records = [], options = {}) {
  const limitPerLocation = Math.max(1, Math.min(Number(options.limitPerLocation) || 8, 12));
  const locationGroups = new Map();

  records.forEach((record) => {
    const currentLocationKey = normalizeAvailableTruckSuggestionKey(record.currentLocation);
    if (!currentLocationKey) return;

    if (!locationGroups.has(currentLocationKey)) {
      locationGroups.set(currentLocationKey, {
        key: currentLocationKey,
        currentLocation: record.currentLocation,
        sourceRecordCount: 0,
        suggestionMap: new Map()
      });
    }

    const group = locationGroups.get(currentLocationKey);
    group.sourceRecordCount += 1;

    const sentTime = getAvailableTruckSentTime(record);

    (record.proximityStops || []).forEach((stop) => {
      const location = cleanAvailableTruckText(stop.location);
      const suggestionKey = normalizeAvailableTruckSuggestionKey(location);

      if (!suggestionKey || suggestionKey === currentLocationKey) return;

      if (!group.suggestionMap.has(suggestionKey)) {
        group.suggestionMap.set(suggestionKey, {
          key: suggestionKey,
          location,
          count: 0,
          lastUsedTime: 0,
          lastUsedDate: '',
          timeMap: new Map()
        });
      }

      const suggestion = group.suggestionMap.get(suggestionKey);
      suggestion.count += 1;

      if (sentTime > suggestion.lastUsedTime) {
        suggestion.lastUsedTime = sentTime;
        suggestion.lastUsedDate = record.dateSent || '';
        suggestion.location = location || suggestion.location;
      }

      const timeLabel = cleanAvailableTruckText(stop.timeLabel);
      const timeKey = normalizeSearchValue(timeLabel || 'time varies');

      if (!suggestion.timeMap.has(timeKey)) {
        suggestion.timeMap.set(timeKey, {
          key: timeKey,
          label: timeLabel,
          count: 0,
          lastUsedTime: 0
        });
      }

      const timeBucket = suggestion.timeMap.get(timeKey);
      timeBucket.count += 1;
      timeBucket.lastUsedTime = Math.max(timeBucket.lastUsedTime, sentTime);
    });
  });

  const output = {};

  Array.from(locationGroups.values()).forEach((group) => {
    const suggestions = Array.from(group.suggestionMap.values())
      .map((suggestion) => {
        const topTime = Array.from(suggestion.timeMap.values())
          .sort((a, b) => {
            const countDiff = b.count - a.count;
            if (countDiff !== 0) return countDiff;
            return b.lastUsedTime - a.lastUsedTime;
          })[0] || null;

        return {
          key: suggestion.key,
          location: suggestion.location,
          timeLabel: topTime?.label || '',
          count: suggestion.count,
          lastUsedDate: suggestion.lastUsedDate,
          timeOptions: Array.from(suggestion.timeMap.values())
            .filter((time) => time.label)
            .sort((a, b) => b.count - a.count || b.lastUsedTime - a.lastUsedTime)
            .slice(0, 3)
            .map((time) => ({
              label: time.label,
              count: time.count
            }))
        };
      })
      .sort((a, b) => {
        const countDiff = b.count - a.count;
        if (countDiff !== 0) return countDiff;
        return getAvailableTruckDateSortValue(b.lastUsedDate) - getAvailableTruckDateSortValue(a.lastUsedDate);
      })
      .slice(0, limitPerLocation);

    if (suggestions.length > 0) {
      output[group.key] = {
        key: group.key,
        currentLocation: group.currentLocation,
        sourceRecordCount: group.sourceRecordCount,
        suggestions
      };
    }
  });

  return output;
}

function getAvailableTruckSentTime(record) {
  const created = new Date(record.createdAt || '').getTime();

  if (!Number.isNaN(created) && created > 0) {
    return created;
  }

  const modified = new Date(record.modifiedAt || '').getTime();

  if (!Number.isNaN(modified) && modified > 0) {
    return modified;
  }

  return getAvailableTruckDateTimeSortValue(record.dateSent, record.timeOfDay);
}

function getAvailableTruckAgeHours(record, now = new Date()) {
  const sentTime = getAvailableTruckSentTime(record);

  if (!sentTime) return null;

  return Math.max(0, (now.getTime() - sentTime) / (60 * 60 * 1000));
}

function isAvailableTruckRecordInLast24Hours(record, now = new Date()) {
  const ageHours = getAvailableTruckAgeHours(record, now);
  return ageHours !== null && ageHours <= 24;
}

function getAvailableTruckAssignmentFieldSelect() {
  return [
    'BOLNumber_x0028_Won_x0029_',
    'Company',
    'Status',
    'Processed',
    'FinalSettleSent',
    'Operator_x002f_Team',
    'TMSName',
    'Truck_x0020_Number',
    'Pickup_x0020_Offer_x0020_Date',
    'Pickup1PickupTime',
    'Pickup1AMorPM',
    'Expected_x0020_Delivery_x0020_Da',
    'Shipment_x0020_Origin',
    'Shipment_x0020_Destination'
  ].join(',');
}

function normalizeSharePointBusinessDate(value) {
  if (!value) return '';

  const raw = String(value || '').trim();
  const dateOnlyMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);

  // SharePoint date-only fields often arrive as YYYY-MM-DDT00:00:00Z.
  // Converting that midnight UTC timestamp to Eastern shifts the business date
  // back one day, which is wrong for pickup/delivery schedule fields.
  if (dateOnlyMatch) return dateOnlyMatch[1];

  return normalizeEasternDateOnly(raw);
}

function isCancelledAvailabilityAssignment(assignment) {
  const status = normalizeText(assignment?.status || '');
  const bol = normalizeText(assignment?.bol || '');

  return (
    status === 'can' ||
    status === 'cancelled' ||
    status === 'canceled' ||
    bol.endsWith('-can') ||
    bol.includes('-can-')
  );
}

function cleanAvailableTruckAssignment(item, sourceList) {
  const fields = item.fields || {};
  const pickupRaw = fields.Pickup_x0020_Offer_x0020_Date || '';
  const pickupDate = normalizeSharePointBusinessDate(pickupRaw);

  return {
    id: item.id || '',
    sourceListId: sourceList?.listId || '',
    sourceList: sourceList?.label || '',
    sourceYear: sourceList?.year || '',
    bol: fields.BOLNumber_x0028_Won_x0029_ || '',
    customer: getChoiceValue(fields.Company || fields['Company/Value'] || ''),
    status: getChoiceValue(fields.Status || fields['Status/Value'] || ''),
    processed: parseBoolean(fields.Processed),
    finalSettleSent: parseBoolean(fields.FinalSettleSent),
    driver: getChoiceValue(fields.Operator_x002f_Team || fields['Operator_x002f_Team/Value'] || ''),
    tmsName: fields.TMSName || '',
    truck: getChoiceValue(fields.Truck_x0020_Number || fields['Truck_x0020_Number/Value'] || ''),
    origin: fields.Shipment_x0020_Origin || '',
    destination: fields.Shipment_x0020_Destination || '',
    pickupDate,
    pickupRaw,
    pickupTime: fields.Pickup1PickupTime || '',
    pickupAMPM: fields.Pickup1AMorPM || '',
    deliveryDate: normalizeSharePointBusinessDate(fields.Expected_x0020_Delivery_x0020_Da)
  };
}

function isActiveOrFutureAssignment(assignment, targetDate = formatEasternDate()) {
  if (normalizeText(assignment.status) !== 'won') return false;
  if (assignment.processed || assignment.finalSettleSent) return false;

  const pickup = assignment.pickupDate || '';
  const delivery = assignment.deliveryDate || '';

  if (delivery && delivery >= targetDate) return true;
  if (pickup && pickup >= targetDate) return true;

  return false;
}

function getAssignmentLabel(assignment) {
  const pieces = [
    assignment.bol,
    assignment.customer,
    assignment.pickupDate ? `Pickup ${formatShortDate(assignment.pickupDate)}` : '',
    assignment.deliveryDate ? `Delivery ${formatShortDate(assignment.deliveryDate)}` : ''
  ].filter(Boolean);

  return pieces.join(' · ');
}

function parseAssignmentPickupClock(pickupTime, pickupAMPM) {
  const text = normalizeText(`${pickupTime || ''} ${pickupAMPM || ''}`);
  let hour = null;
  let minute = 0;

  const match = text.match(/(\d{1,2})(?::(\d{2}))?/);

  if (match) {
    hour = Number(match[1]);
    minute = Number(match[2] || 0);

    if (text.includes('pm') && hour < 12) hour += 12;
    if (text.includes('am') && hour === 12) hour = 0;
  }

  if (hour === null || Number.isNaN(hour)) {
    if (text.includes('morning') || text === 'am') hour = 8;
    else if (text.includes('afternoon') || text === 'pm') hour = 15;
    else if (text.includes('evening')) hour = 19;
    else hour = 12;
  }

  hour = Math.max(0, Math.min(23, hour));
  minute = Math.max(0, Math.min(59, Number.isNaN(minute) ? 0 : minute));

  return { hour, minute };
}

function getAssignmentPickupSortTime(assignment) {
  if (!assignment?.pickupDate) return 0;

  const { hour, minute } = parseAssignmentPickupClock(assignment.pickupTime, assignment.pickupAMPM);
  const parsed = new Date(`${assignment.pickupDate}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00-04:00`);
  const time = parsed.getTime();

  return Number.isNaN(time) ? getAvailableTruckDateSortValue(assignment.pickupDate) : time;
}

function pushAssignmentToMapArray(map, key, assignment) {
  if (!key) return;
  const existing = map.get(key) || [];
  existing.push(assignment);
  map.set(key, existing);
}

function sortAssignmentsByPickup(assignments = []) {
  return assignments.sort((a, b) => {
    const aTime = getAssignmentPickupSortTime(a) || 0;
    const bTime = getAssignmentPickupSortTime(b) || 0;
    if (aTime !== bTime) return aTime - bTime;
    return String(a.bol || '').localeCompare(String(b.bol || ''));
  });
}

function buildActiveFutureAssignmentIndex(items = [], sourceList = null) {
  const targetDate = formatEasternDate();
  const truckMap = new Map();
  const driverMap = new Map();
  const truckAssignmentMap = new Map();
  const driverAssignmentMap = new Map();
  const allTruckAssignmentMap = new Map();
  const allDriverAssignmentMap = new Map();
  const tonuTruckAssignmentMap = new Map();
  const tonuDriverAssignmentMap = new Map();

  const allStatusAssignments = items
    .map((item) => cleanAvailableTruckAssignment(item, sourceList))
    .filter((assignment) => {
      const status = normalizeText(assignment.status);
      return (status === 'won' || status === 'tonu') && !isCancelledAvailabilityAssignment(assignment);
    })
    .map((assignment) => ({
      ...assignment,
      pickupSortTime: getAssignmentPickupSortTime(assignment)
    }))
    .filter((assignment) => assignment.pickupSortTime)
    .sort((a, b) => (a.pickupSortTime || 0) - (b.pickupSortTime || 0));

  const allAssignments = allStatusAssignments.filter((assignment) => normalizeText(assignment.status) === 'won');
  const tonuAssignments = allStatusAssignments.filter((assignment) => normalizeText(assignment.status) === 'tonu');
  const assignments = allAssignments.filter((assignment) => isActiveOrFutureAssignment(assignment, targetDate));

  function indexAssignment(assignment, options = {}) {
    const { active = false } = options;
    const truckKey = normalizeTruckKey(assignment.truck);
    const driverKeys = uniqueNonEmpty([assignment.tmsName, assignment.driver])
      .map((value) => normalizeSearchValue(value))
      .filter(Boolean);

    if (truckKey) {
      pushAssignmentToMapArray(allTruckAssignmentMap, truckKey, assignment);

      if (active) {
        if (!truckMap.has(truckKey)) truckMap.set(truckKey, assignment);
        pushAssignmentToMapArray(truckAssignmentMap, truckKey, assignment);
      }
    }

    driverKeys.forEach((driverKey) => {
      if (!driverKey) return;
      pushAssignmentToMapArray(allDriverAssignmentMap, driverKey, assignment);

      if (active) {
        if (!driverMap.has(driverKey)) driverMap.set(driverKey, assignment);
        pushAssignmentToMapArray(driverAssignmentMap, driverKey, assignment);
      }
    });
  }

  allAssignments.forEach((assignment) => indexAssignment(assignment, { active: false }));
  assignments.forEach((assignment) => indexAssignment(assignment, { active: true }));

  tonuAssignments.forEach((assignment) => {
    const truckKey = normalizeTruckKey(assignment.truck);
    const driverKeys = uniqueNonEmpty([assignment.tmsName, assignment.driver])
      .map((value) => normalizeSearchValue(value))
      .filter(Boolean);

    if (truckKey) {
      pushAssignmentToMapArray(tonuTruckAssignmentMap, truckKey, assignment);
    }

    driverKeys.forEach((driverKey) => {
      if (driverKey) {
        pushAssignmentToMapArray(tonuDriverAssignmentMap, driverKey, assignment);
      }
    });
  });

  [truckAssignmentMap, driverAssignmentMap, allTruckAssignmentMap, allDriverAssignmentMap, tonuTruckAssignmentMap, tonuDriverAssignmentMap].forEach((map) => {
    map.forEach((assignmentsForKey, key) => {
      map.set(key, sortAssignmentsByPickup(assignmentsForKey));
    });
  });

  return {
    truckMap,
    driverMap,
    truckAssignmentMap,
    driverAssignmentMap,
    allTruckAssignmentMap,
    allDriverAssignmentMap,
    tonuTruckAssignmentMap,
    tonuDriverAssignmentMap,
    assignments,
    allAssignments,
    tonuAssignments
  };
}

function serializeAvailableTruckAssignment(assignment, matchType = '') {
  if (!assignment) return null;

  return {
    id: assignment.id,
    sourceListId: assignment.sourceListId,
    sourceList: assignment.sourceList,
    sourceYear: assignment.sourceYear,
    bol: assignment.bol,
    customer: assignment.customer,
    driver: assignment.driver,
    tmsName: assignment.tmsName,
    truck: assignment.truck,
    origin: assignment.origin,
    destination: assignment.destination,
    pickupDate: assignment.pickupDate,
    pickupTime: assignment.pickupTime,
    pickupAMPM: assignment.pickupAMPM,
    deliveryDate: assignment.deliveryDate,
    matchType,
    label: getAssignmentLabel(assignment)
  };
}

function getHoursBetweenAvailabilityAndPickup(record, assignment) {
  if (!record || !assignment) return null;

  const postedTime = getAvailableTruckSentTime(record);
  const pickupTime = getAssignmentPickupSortTime(assignment);

  if (!postedTime || !pickupTime) return null;

  return Math.round(((pickupTime - postedTime) / (60 * 60 * 1000)) * 10) / 10;
}

function formatAvailabilityPickupGapLabel(hours) {
  if (hours === null || hours === undefined || Number.isNaN(Number(hours))) return '';

  if (hours < 0) return 'Pickup already passed';
  if (hours < 1) return 'Less than 1 hour';

  const roundedHours = Math.round(Number(hours));
  const days = Math.floor(roundedHours / 24);
  const remainderHours = roundedHours % 24;

  if (days <= 0) return `${roundedHours} hr${roundedHours === 1 ? '' : 's'}`;
  if (remainderHours <= 0) return `${days} day${days === 1 ? '' : 's'}`;

  return `${days} day${days === 1 ? '' : 's'} ${remainderHours} hr${remainderHours === 1 ? '' : 's'}`;
}

function findNextAvailableTruckAssignment(record, assignmentIndex) {
  const postedTime = getAvailableTruckSentTime(record);
  const truckKey = normalizeTruckKey(record.unitNo);
  const driverKey = normalizeSearchValue(record.driverName);

  // This is intentionally historical follow-through logic, not current-status logic.
  // Active/future filtering is handled separately by truckMap/driverMap. For this
  // modal detail, look for the first Won pickup after the availability row was posted,
  // even if that pickup has already happened by the time the user opens Kole Connect.
  const candidateGroups = [
    { matchType: 'truck', assignments: truckKey ? assignmentIndex?.allTruckAssignmentMap?.get(truckKey) : [] },
    { matchType: 'driver', assignments: driverKey ? assignmentIndex?.allDriverAssignmentMap?.get(driverKey) : [] }
  ];

  for (const group of candidateGroups) {
    const assignments = group.assignments || [];
    const assignment = assignments.find((candidate) => {
      const pickupTime = getAssignmentPickupSortTime(candidate);
      return pickupTime && (!postedTime || pickupTime >= postedTime);
    });

    if (assignment) {
      return { assignment, matchType: group.matchType };
    }
  }

  return { assignment: null, matchType: '' };
}

function getTonuAssignmentsInAvailabilitySpan(record, assignmentIndex, nextAssignment = null) {
  const postedTime = getAvailableTruckSentTime(record);
  const nextPickupTime = getAssignmentPickupSortTime(nextAssignment);
  const truckKey = normalizeTruckKey(record.unitNo);
  const driverKey = normalizeSearchValue(record.driverName);
  const seen = new Set();
  const matches = [];

  const candidateGroups = [
    { matchType: 'truck', assignments: truckKey ? assignmentIndex?.tonuTruckAssignmentMap?.get(truckKey) : [] },
    { matchType: 'driver', assignments: driverKey ? assignmentIndex?.tonuDriverAssignmentMap?.get(driverKey) : [] }
  ];

  candidateGroups.forEach((group) => {
    (group.assignments || []).forEach((candidate) => {
      const pickupTime = getAssignmentPickupSortTime(candidate);

      if (!pickupTime) return;
      if (postedTime && pickupTime < postedTime) return;
      if (nextPickupTime && pickupTime >= nextPickupTime) return;

      const key = candidate.id || `${candidate.bol || ''}-${candidate.pickupDate || ''}-${candidate.truck || ''}`;
      if (seen.has(key)) return;

      seen.add(key);
      matches.push({
        ...candidate,
        matchType: group.matchType
      });
    });
  });

  return sortAssignmentsByPickup(matches);
}

function addAvailableTruckAssignmentStatus(record, assignmentIndex) {
  const truckKey = normalizeTruckKey(record.unitNo);
  const driverKey = normalizeSearchValue(record.driverName);
  const activeFutureMatch =
    (truckKey && assignmentIndex?.truckMap?.get(truckKey))
      ? { assignment: assignmentIndex.truckMap.get(truckKey), matchType: 'truck' }
      : (driverKey && assignmentIndex?.driverMap?.get(driverKey))
        ? { assignment: assignmentIndex.driverMap.get(driverKey), matchType: 'driver' }
        : { assignment: null, matchType: '' };

  const nextMatch = findNextAvailableTruckAssignment(record, assignmentIndex);
  const hoursUntilNextPickup = getHoursBetweenAvailabilityAndPickup(record, nextMatch.assignment);
  const tonuAssignmentsInSpan = getTonuAssignmentsInAvailabilitySpan(record, assignmentIndex, nextMatch.assignment);

  return {
    ...record,
    postedAt: record.createdAt || record.modifiedAt || '',
    hasActiveOrFutureAssignment: Boolean(activeFutureMatch.assignment),
    activeFutureAssignment: serializeAvailableTruckAssignment(activeFutureMatch.assignment, activeFutureMatch.matchType),
    nextAssignment: serializeAvailableTruckAssignment(nextMatch.assignment, nextMatch.matchType),
    hoursUntilNextPickup,
    nextPickupGapLabel: formatAvailabilityPickupGapLabel(hoursUntilNextPickup),
    hasTonuInPickupSpan: tonuAssignmentsInSpan.length > 0,
    tonuInPickupSpanCount: tonuAssignmentsInSpan.length,
    tonuAssignmentsInPickupSpan: tonuAssignmentsInSpan.slice(0, 3).map((assignment) =>
      serializeAvailableTruckAssignment(assignment, assignment.matchType || '')
    )
  };
}

function isAvailableTruckRecordInWindow(record, cutoffTime) {
  if (!cutoffTime) return true;
  const time = getAvailableTruckDateSortValue(record.dateSent);
  return time >= cutoffTime;
}

function getAvailableTruckCurrentIdentityKey(record) {
  const truckKey = normalizeTruckKey(record?.unitNo);
  if (truckKey) return `truck:${truckKey}`;

  const driverKey = normalizeSearchValue(record?.driverName);
  if (driverKey) return `driver:${driverKey}`;

  return `record:${record?.id || Math.random().toString(36).slice(2)}`;
}

function getAvailableTruckCurrentIdentityLabel(record) {
  const unitNo = cleanAvailableTruckText(record?.unitNo);
  if (unitNo) return `unit ${unitNo}`;

  const driverName = cleanAvailableTruckText(record?.driverName);
  if (driverName) return driverName;

  return 'this truck';
}

function compareAvailableTruckCurrentRecency(a, b) {
  const sentDiff = getAvailableTruckSentTime(b) - getAvailableTruckSentTime(a);
  if (sentDiff !== 0) return sentDiff;

  return compareAvailableTruckRecords(a, b);
}

function splitCurrentAvailableTruckRecords(records = []) {
  const seen = new Map();
  const currentRecords = [];
  const supersededRecords = [];

  [...records]
    .sort(compareAvailableTruckCurrentRecency)
    .forEach((record) => {
      const key = getAvailableTruckCurrentIdentityKey(record);
      const newerRecord = seen.get(key);

      if (!newerRecord) {
        seen.set(key, record);
        currentRecords.push(record);
        return;
      }

      supersededRecords.push({
        ...record,
        supersededByCurrentPosting: true,
        supersededBy: {
          id: newerRecord.id || '',
          matchKey: key,
          label: getAvailableTruckCurrentIdentityLabel(newerRecord),
          dateSent: newerRecord.dateSent || '',
          timeOfDay: newerRecord.timeOfDay || '',
          postedAt: newerRecord.postedAt || newerRecord.createdAt || newerRecord.modifiedAt || ''
        }
      });
    });

  return {
    currentRecords: currentRecords.sort(compareAvailableTruckRecords),
    supersededRecords: supersededRecords.sort(compareAvailableTruckRecords)
  };
}

function buildAvailableTrucksResponse(items, options = {}) {
  const lookbackDays = Math.max(1, Math.min(Number(options.lookbackDays) || AVAILABLE_TRUCKS_DEFAULT_LOOKBACK_DAYS, 365));
  const now = options.now instanceof Date ? options.now : new Date();
  const assignmentIndex = options.assignmentIndex || buildActiveFutureAssignmentIndex([], null);
  const sortedRecords = items
    .map(cleanAvailableTruckRecord)
    .filter((record) => record.driverName || record.unitNo || record.currentLocation)
    .map((record) => {
      const recordWithAssignment = addAvailableTruckAssignmentStatus(record, assignmentIndex);
      const ageHours = getAvailableTruckAgeHours(recordWithAssignment, now);

      return {
        ...recordWithAssignment,
        ageHours: ageHours === null ? null : Math.round(ageHours * 10) / 10,
        isWithin24Hours: isAvailableTruckRecordInLast24Hours(recordWithAssignment, now)
      };
    })
    .sort(compareAvailableTruckRecords);

  const latestRecord = sortedRecords[0] || null;
  const latestDate = latestRecord?.dateSent || '';
  const latestTimeOfDay = latestRecord?.timeOfDay || '';
  const latestTimeSort = getTimeOfDaySortValue(latestTimeOfDay);

  const latestBatchRecords = sortedRecords.filter((record) => {
    if (!latestDate || record.dateSent !== latestDate) return false;
    if (!latestTimeOfDay) return true;
    return getTimeOfDaySortValue(record.timeOfDay) === latestTimeSort;
  });

  const recordsWithin24Hours = sortedRecords.filter((record) => record.isWithin24Hours);
  const currentCandidateRecords = recordsWithin24Hours.filter((record) => !record.hasActiveOrFutureAssignment);
  const {
    currentRecords,
    supersededRecords: currentDuplicateExcludedRecords
  } = splitCurrentAvailableTruckRecords(currentCandidateRecords);
  const assignmentExcludedRecords = recordsWithin24Hours.filter((record) => record.hasActiveOrFutureAssignment);
  const staleRecords = sortedRecords.filter((record) => !record.isWithin24Hours);

  const today = new Date(`${formatEasternDate()}T00:00:00Z`);
  const cutoff = new Date(today);
  cutoff.setUTCDate(cutoff.getUTCDate() - (lookbackDays - 1));
  const cutoffTime = cutoff.getTime();
  const recentRecords = sortedRecords.filter((record) => isAvailableTruckRecordInWindow(record, cutoffTime));

  const currentStateBuckets = new Map();
  const currentCityBuckets = new Map();
  const proximityStateBuckets = new Map();
  const proximityLocationBuckets = new Map();
  const equipmentBuckets = new Map();
  const teamBuckets = new Map();
  const driverBuckets = new Map();
  const truckBuckets = new Map();
  let missingProximityTimes = 0;
  let missingCurrentLocation = 0;

  recentRecords.forEach((record) => {
    if (record.currentStateKey) incrementBucket(currentStateBuckets, record.currentStateKey, record.currentState);
    if (record.currentLocation) incrementBucket(currentCityBuckets, record.currentLocation, record.currentLocation);
    if (record.equipmentFamily) incrementBucket(equipmentBuckets, record.equipmentFamily, record.equipmentFamily);
    if (record.teamType) incrementBucket(teamBuckets, record.teamType, record.teamType);
    if (record.driverName) incrementBucket(driverBuckets, normalizeSearchValue(record.driverName), record.driverName);
    if (record.unitNo) incrementBucket(truckBuckets, normalizeSearchValue(record.unitNo), record.unitNo);
    if (!record.currentLocation) missingCurrentLocation += 1;

    record.proximityStops.forEach((stop) => {
      if (stop.stateKey) incrementBucket(proximityStateBuckets, stop.stateKey, stop.state);
      if (stop.location) incrementBucket(proximityLocationBuckets, stop.location, stop.location);
      if (stop.location && !stop.timeLabel) missingProximityTimes += 1;
    });
  });

  const repeatTrucks = getTopBuckets(truckBuckets, 8).filter((bucket) => bucket.count > 1);
  const attention = [];

  if (!currentRecords.length) {
    attention.push({
      level: recordsWithin24Hours.length ? 'info' : 'warning',
      label: recordsWithin24Hours.length ? 'No current unassigned trucks' : 'No availability from the last 24 hours',
      detail: recordsWithin24Hours.length
        ? 'Recent availability exists, but every recent row is tied to a truck/driver with an active or future assignment.'
        : 'The latest available-trucks data is older than 24 hours, so it is not shown as current.'
    });
  }

  if (assignmentExcludedRecords.length > 0) {
    attention.push({
      level: 'info',
      label: 'Removed from current availability',
      detail: `${assignmentExcludedRecords.length} recent row${assignmentExcludedRecords.length === 1 ? ' was' : 's were'} hidden because the driver/truck now has an active or future assignment.`
    });
  }

  if (missingCurrentLocation > 0) {
    attention.push({
      level: 'warning',
      label: 'Missing current locations',
      detail: `${missingCurrentLocation} recent record${missingCurrentLocation === 1 ? ' is' : 's are'} missing a current location.`
    });
  }

  const latestAgeHours = latestRecord ? getAvailableTruckAgeHours(latestRecord, now) : null;
  const proximitySuggestionIndex = buildAvailableTruckProximitySuggestionIndex(sortedRecords);

  return {
    success: true,
    generatedAt: `${formatEasternTimestamp()} Eastern`,
    sourceListId: getAvailableTrucksSingleLineListId(),
    sourceListName: 'Available Trucks Single Line',
    sourceWideListId: getAvailableEquipmentSourceListId(),
    activeDriverOptions: options.activeDriverOptions || [],
    activeDriverOptionsWarning: options.activeDriverOptionsWarning || '',
    lookbackDays,
    currentWindowHours: 24,
    count: currentRecords.length,
    totalRecords: sortedRecords.length,
    summary: {
      latestBatchDate: latestDate,
      latestBatchTimeOfDay: latestTimeOfDay,
      latestBatchCount: latestBatchRecords.length,
      latestBatchAgeHours: latestAgeHours === null ? null : Math.round(latestAgeHours * 10) / 10,
      recordsWithin24Hours: recordsWithin24Hours.length,
      currentRecordCount: currentRecords.length,
      activeFutureAssignmentExclusions: assignmentExcludedRecords.length,
      staleRecordCount: staleRecords.length,
      activeFutureAssignmentsScanned: assignmentIndex.assignments?.length || 0,
      wonAssignmentsScanned: assignmentIndex.allAssignments?.length || 0,
      recentRecordCount: recentRecords.length,
      proximitySuggestionLocationCount: Object.keys(proximitySuggestionIndex).length,
      proximitySuggestionSourceRecordCount: sortedRecords.length,
      uniqueRecentDrivers: new Set(recentRecords.map((record) => normalizeSearchValue(record.driverName)).filter(Boolean)).size,
      uniqueRecentTrucks: new Set(recentRecords.map((record) => normalizeSearchValue(record.unitNo)).filter(Boolean)).size,
      uniqueRecentCurrentLocations: currentCityBuckets.size,
      missingProximityTimes,
      missingCurrentLocation
    },
    insights: {
      topCurrentStates: getTopBuckets(currentStateBuckets),
      topCurrentLocations: getTopBuckets(currentCityBuckets),
      topProximityStates: getTopBuckets(proximityStateBuckets),
      topProximityLocations: getTopBuckets(proximityLocationBuckets),
      equipmentMix: getTopBuckets(equipmentBuckets, 8),
      teamMix: getTopBuckets(teamBuckets, 4),
      repeatTrucks,
      attention
    },
    proximitySuggestionIndex,
    records: currentRecords,
    latestBatchRecords,
    recordsWithin24Hours,
    assignmentExcludedRecords,
    recentRecords: recentRecords.slice(0, 250)
  };
}
function getKoleAutoUpdaterListId() {
  return process.env.KOLE_AUTO_UPDATER_LIST_ID || DEFAULT_KOLE_AUTO_UPDATER_LIST_ID;
}

function escapeODataString(value) {
  return String(value || '').replace(/'/g, "''");
}

function getChoiceValue(value) {
  if (value && typeof value === 'object') {
    return value.Value || value.value || value.Label || value.label || '';
  }

  return value || '';
}

async function getCurrentBidListingSource(token) {
  const lists = await getSearchableBidLists(token);
  return lists.find((list) => list.label === 'Bid Listing') || null;
}

function getIntelliTrackFieldSelect() {
  return [
    'BOLNumber',
    'TruckNumber',
    'Company',
    'Operator',
    'Origin',
    'Destination',
    'PickupDate',
    'PickupTime',
    'DeliveryDate',
    'DeliveryTime',
    'Email1',
    'Email2',
    'Email3',
    'Email4',
    'Email5',
    'Email6',
    'UpdateInterval',
    'OverrideStartDate',
    'OverrideStartTime',
    'OverrideEndDate',
    'OverrideEndTime',
    'LastUpdateSent',
    'NextUpdateScheduled',
    'DisableTracking',
    'CurrentLocation',
    'BidListingID'
  ].join(',');
}

function getIntelliTrackBidFieldSelect() {
  return [
    'BOLNumber_x0028_Won_x0029_',
    'Company',
    'Status',
    'Operator_x002f_Team',
    'Truck_x0020_Number',
    'Shipment_x0020_Origin',
    'Shipment_x0020_Destination',
    'Pickup_x0020_Offer_x0020_Date',
    'Pickup1PickupTime',
    'Pickup1AMorPM',
    'Expected_x0020_Delivery_x0020_Da',
    'Delivery1Time',
    'Delivery1AMorPM',
    'EnableTracking',
    'TrackingActive',
    'FinalSettleSent'
  ].join(',');
}

function cleanIntelliTrackRecord(item) {
  const fields = item.fields || {};
  const recipients = [
    fields.Email1,
    fields.Email2,
    fields.Email3,
    fields.Email4,
    fields.Email5,
    fields.Email6
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  return {
    id: item.id || '',
    BOLNumber: fields.BOLNumber || '',
    TruckNumber: fields.TruckNumber || '',
    Company: fields.Company || '',
    Operator: fields.Operator || '',
    Origin: fields.Origin || '',
    Destination: fields.Destination || '',
    PickupDate: fields.PickupDate || '',
    PickupTime: fields.PickupTime || '',
    DeliveryDate: fields.DeliveryDate || '',
    DeliveryTime: fields.DeliveryTime || '',
    Email1: fields.Email1 || '',
    Email2: fields.Email2 || '',
    Email3: fields.Email3 || '',
    Email4: fields.Email4 || '',
    Email5: fields.Email5 || '',
    Email6: fields.Email6 || '',
    Recipients: recipients,
    UpdateInterval: getChoiceValue(fields.UpdateInterval),
    OverrideStartDate: fields.OverrideStartDate || '',
    OverrideStartTime: fields.OverrideStartTime || '',
    OverrideEndDate: fields.OverrideEndDate || '',
    OverrideEndTime: fields.OverrideEndTime || '',
    LastUpdateSent: fields.LastUpdateSent || '',
    NextUpdateScheduled: fields.NextUpdateScheduled || '',
    DisableTracking: parseBoolean(fields.DisableTracking),
    CurrentLocation: fields.CurrentLocation || '',
    BidListingID: fields.BidListingID || ''
  };
}

function sortIntelliTrackRecords(a, b) {
  const aNext = new Date(a.NextUpdateScheduled || a.PickupDate || 0).getTime();
  const bNext = new Date(b.NextUpdateScheduled || b.PickupDate || 0).getTime();

  if (!Number.isNaN(aNext) && !Number.isNaN(bNext) && aNext !== bNext) {
    return aNext - bNext;
  }

  return String(a.BOLNumber || '').localeCompare(String(b.BOLNumber || ''));
}

function cleanIntelliTrackBidOrder(item, sourceList) {
  const fields = item.fields || {};
  const status = String(getChoiceValue(fields.Status) || '').trim();
  const bol = fields.BOLNumber_x0028_Won_x0029_ || '';
  const enableTracking = parseBoolean(fields.EnableTracking);
  const trackingActive = parseBoolean(fields.TrackingActive);
  const finalSettleSent = parseBoolean(fields.FinalSettleSent);

  let startBlockedReason = '';

  if (!bol) {
    startBlockedReason = 'Missing BOL — tracking cannot be started.';
  } else if (status !== 'Won') {
    startBlockedReason = 'Not a won order — tracking cannot be started.';
  } else if (finalSettleSent) {
    startBlockedReason = 'Settled order — tracking cannot be started.';
  }

  return {
    id: item.id || '',
    SourceListId: sourceList?.listId || '',
    SourceList: sourceList?.label || '',
    BOL: bol,
    Customer: fields.Company || '',
    Status: status,
    Driver: getChoiceValue(fields.Operator_x002f_Team) || '',
    Truck: getChoiceValue(fields.Truck_x0020_Number) || '',
    Origin: fields.Shipment_x0020_Origin || '',
    Destination: fields.Shipment_x0020_Destination || '',
    PickupDate: fields.Pickup_x0020_Offer_x0020_Date || '',
    PickupTime: fields.Pickup1PickupTime || '',
    PickupAMPM: fields.Pickup1AMorPM || '',
    DeliveryDate: fields.Expected_x0020_Delivery_x0020_Da || '',
    DeliveryTime: fields.Delivery1Time || '',
    DeliveryAMPM: fields.Delivery1AMorPM || '',
    EnableTracking: enableTracking,
    TrackingActive: trackingActive,
    FinalSettleSent: finalSettleSent,
    CanStartTracking: !startBlockedReason,
    StartBlockedReason: startBlockedReason
  };
}

async function findCurrentBidOrderByBol(token, currentList, bol) {
  const fieldSelect = getIntelliTrackBidFieldSelect();
  const safeBol = escapeODataString(normalizeBolKey(bol));
  const url = `https://graph.microsoft.com/v1.0/sites/${process.env.SITE_ID}/lists/${currentList.listId}/items?$select=id,createdDateTime,lastModifiedDateTime&$expand=fields($select=${fieldSelect})&$filter=fields/BOLNumber_x0028_Won_x0029_ eq '${safeBol}'&$top=5`;

  try {
    const data = await graphGet(token, url, {
      Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly'
    });

    return (data.value || [])[0] || null;
  } catch (error) {
    // Graph can be moody about filtering SharePoint list fields. Fall back to a
    // full current-list scan so the app still behaves predictably.
    const items = await getAllListItemsWithFields(token, currentList.listId, fieldSelect);
    return items.find((item) => normalizeBolKey(item.fields?.BOLNumber_x0028_Won_x0029_) === normalizeBolKey(bol)) || null;
  }
}



app.get('/available-trucks/distribution-list', requireLookupAccess, async (req, res) => {
  try {
    const listId = getAvailableTrucksEmailListId();

    if (!listId) {
      return res.status(500).json({
        success: false,
        error: 'AVAILABLE_TRUCKS_EMAIL_LIST_ID is not configured on the server.'
      });
    }

    const token = await getGraphToken();
    const { rows, warning } = await getAvailableTrucksDistributionRows(token, listId);
    const activeRows = rows.filter((row) => row.active);
    const inactiveRows = rows.filter((row) => !row.active);

    res.json({
      success: true,
      generatedAt: `${formatEasternTimestamp()} Eastern`,
      sourceListId: listId,
      count: activeRows.length,
      inactiveCount: inactiveRows.length,
      rows: activeRows,
      inactiveRows,
      sourceWarning: warning
    });
  } catch (error) {
    console.error(error);

    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || 'Unable to load Available Trucks distribution list.'
    });
  }
});

app.post('/available-trucks/distribution-list', requireLookupAccess, async (req, res) => {
  try {
    const listId = getAvailableTrucksEmailListId();

    if (!listId) {
      return res.status(500).json({
        success: false,
        error: 'AVAILABLE_TRUCKS_EMAIL_LIST_ID is not configured on the server.'
      });
    }

    const token = await getGraphToken();
    const columnLookup = await getListColumnLookup(token, listId);
    const fields = buildAvailableTrucksDistributionFields(columnLookup, req.body || {});
    const emailKey = normalizeDistributionEmail(fields.Email || req.body?.email || req.body?.Email);

    const { rows } = await getAvailableTrucksDistributionRows(token, listId);
    const duplicate = rows.find((row) => row.emailKey === emailKey);

    if (duplicate) {
      const statusLabel = duplicate.active ? 'active' : 'inactive/hidden';

      return res.status(409).json({
        success: false,
        error: `${duplicate.email} is already ${statusLabel} on the Available Trucks distribution list${duplicate.company ? ` under ${duplicate.company}` : ''}.`
      });
    }

    const createdItem = await graphPost(
      token,
      `https://graph.microsoft.com/v1.0/sites/${process.env.SITE_ID}/lists/${listId}/items`,
      { fields }
    );

    const created = cleanAvailableTrucksDistributionItem(createdItem);

    res.status(201).json({
      success: true,
      message: `${created.company || fields.Title} added to the Available Trucks distribution list.`,
      item: created
    });
  } catch (error) {
    console.error(error);

    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || 'Unable to add distribution-list contact.'
    });
  }
});


app.post('/available-trucks', requireLookupAccess, async (req, res) => {
  try {
    const listId = getAvailableEquipmentSourceListId();

    if (!listId) {
      return res.status(500).json({
        success: false,
        error: 'AVAILABLE_EQUIPMENT_SOURCE_LIST_ID is not configured on the server.'
      });
    }

    const drivers = (Array.isArray(req.body?.drivers) ? req.body.drivers : [])
      .slice(0, 8)
      .map(cleanAvailableTruckSubmissionDriver)
      .filter(hasAvailableTruckSubmissionDriver);

    if (drivers.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Add at least one available truck before submitting.'
      });
    }

    const token = await getGraphToken();
    const resolvedDrivers = await resolveAvailableTruckDriversFromRoster(token, drivers);

    resolvedDrivers.forEach((driver, index) => validateAvailableTruckSubmissionDriver(driver, index + 1));
    validateAvailableTruckSubmissionDuplicates(resolvedDrivers);

    const submission = {
      dateSent: req.body?.dateSent,
      timeOfDay: req.body?.timeOfDay,
      drivers: resolvedDrivers
    };

    const columnLookup = await getListColumnLookup(token, listId);
    const fields = buildAvailableTruckSourceFields(columnLookup, submission);

    const createdItem = await graphPost(
      token,
      `https://graph.microsoft.com/v1.0/sites/${process.env.SITE_ID}/lists/${listId}/items`,
      { fields }
    );

    res.status(201).json({
      success: true,
      sourceListId: listId,
      itemId: createdItem.id || '',
      driverCount: resolvedDrivers.length,
      message: `${resolvedDrivers.length} available truck${resolvedDrivers.length === 1 ? '' : 's'} submitted. Power Automate will send and dissect the source row shortly.`
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message || 'Unable to submit available trucks.'
    });
  }
});

app.get('/available-trucks', requireLookupAccess, async (req, res) => {
  try {
    const listId = getAvailableTrucksSingleLineListId();

    if (!listId) {
      return res.status(500).json({
        success: false,
        error: 'AVAILABLE_TRUCKS_SINGLE_LINE_LIST_ID is not configured on the server.'
      });
    }

    const lookbackDays = Math.max(
      1,
      Math.min(Number(req.query.days) || AVAILABLE_TRUCKS_DEFAULT_LOOKBACK_DAYS, 365)
    );

    const token = await getGraphToken();
    const currentList = await getCurrentBidListingSource(token);
    let activeDriverOptionsWarning = process.env.DRIVER_ROSTER_LIST_ID
      ? ''
      : 'DRIVER_ROSTER_LIST_ID is not configured, so active roster driver options could not be loaded.';

    const activeDriverOptionsPromise = process.env.DRIVER_ROSTER_LIST_ID
      ? getAvailableTruckRosterOptions(token).catch((error) => {
          activeDriverOptionsWarning = error.message || 'Driver Roster could not be loaded for available-truck posting.';
          return [];
        })
      : Promise.resolve([]);

    const [items, assignmentItems, activeDriverOptions] = await Promise.all([
      getAllListItemsWithFields(
        token,
        listId,
        getAvailableTruckFieldSelect()
      ),
      currentList
        ? getAllListItemsWithFields(
            token,
            currentList.listId,
            getAvailableTruckAssignmentFieldSelect()
          )
        : Promise.resolve([]),
      activeDriverOptionsPromise
    ]);

    const assignmentIndex = buildActiveFutureAssignmentIndex(assignmentItems, currentList);

    res.json(buildAvailableTrucksResponse(items, {
      lookbackDays,
      assignmentIndex,
      activeDriverOptions,
      activeDriverOptionsWarning
    }));
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message || 'Unable to load Available Trucks.'
    });
  }
});

app.get('/tracking/intellitrack', requireLookupAccess, async (req, res) => {
  try {
    const listId = getKoleAutoUpdaterListId();

    if (!listId) {
      return res.status(500).json({
        success: false,
        error: 'KOLE_AUTO_UPDATER_LIST_ID is not configured on the server.'
      });
    }

    const token = await getGraphToken();
    const items = await getAllListItemsWithFields(
      token,
      listId,
      getIntelliTrackFieldSelect()
    );

    const records = items
      .map(cleanIntelliTrackRecord)
      .filter((record) => !record.DisableTracking)
      .sort(sortIntelliTrackRecords);

    res.json({
      success: true,
      generatedAt: `${formatEasternTimestamp()} Eastern`,
      sourceListId: listId,
      count: records.length,
      records
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message || 'Unable to load IntelliTrack.'
    });
  }
});

app.get('/tracking/intellitrack/order', requireLookupAccess, async (req, res) => {
  try {
    const bol = normalizeBolKey(req.query.bol);

    if (!bol) {
      return res.status(400).json({
        success: false,
        error: 'Enter a BOL number.'
      });
    }

    const token = await getGraphToken();
    const currentList = await getCurrentBidListingSource(token);

    if (!currentList) {
      return res.status(404).json({
        success: false,
        error: 'Bid Listing not found.'
      });
    }

    const item = await findCurrentBidOrderByBol(token, currentList, bol);

    if (!item) {
      return res.status(404).json({
        success: false,
        error: `No current Bid Listing order was found for ${bol}.`
      });
    }

    res.json({
      success: true,
      order: cleanIntelliTrackBidOrder(item, currentList)
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message || 'Unable to search IntelliTrack order.'
    });
  }
});

app.post('/tracking/intellitrack/order/:id', requireLookupAccess, async (req, res) => {
  try {
    const enabled = req.body?.enabled === true;
    const orderId = String(req.params.id || '').trim();

    if (!orderId) {
      return res.status(400).json({
        success: false,
        error: 'A Bid Listing item ID is required.'
      });
    }

    const token = await getGraphToken();
    const currentList = await getCurrentBidListingSource(token);

    if (!currentList) {
      return res.status(404).json({
        success: false,
        error: 'Bid Listing not found.'
      });
    }

    const fieldSelect = getIntelliTrackBidFieldSelect();
    const readUrl = `https://graph.microsoft.com/v1.0/sites/${process.env.SITE_ID}/lists/${currentList.listId}/items/${orderId}?$select=id,createdDateTime,lastModifiedDateTime&$expand=fields($select=${fieldSelect})`;
    const currentItem = await graphGet(token, readUrl);
    const currentOrder = cleanIntelliTrackBidOrder(currentItem, currentList);

    if (enabled && !currentOrder.CanStartTracking) {
      return res.status(400).json({
        success: false,
        error: currentOrder.StartBlockedReason || 'This order is not eligible for IntelliTrack.'
      });
    }

    const patchUrl = `https://graph.microsoft.com/v1.0/sites/${process.env.SITE_ID}/lists/${currentList.listId}/items/${orderId}/fields`;
    await graphPatch(token, patchUrl, {
      EnableTracking: enabled
    });

    const updatedItem = await graphGet(token, readUrl);
    const updatedOrder = cleanIntelliTrackBidOrder(updatedItem, currentList);

    res.json({
      success: true,
      enabled,
      message: enabled
        ? 'IntelliTrack request submitted. Power Automate will create the tracking record shortly.'
        : 'IntelliTrack stop request submitted. Power Automate will remove the tracking record shortly.',
      order: updatedOrder
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message || 'Unable to update IntelliTrack status.'
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

app.get(['/operations/today', '/operations/snapshot'], requireLookupAccess, async (req, res) => {
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

    const targetDate = formatEasternDate();
    const plus7 = addDaysToDateInput(targetDate, 7);

    const allWon = items
      .map((item) => buildOperationsRecord(item, currentList))
      .filter((r) => normalizeText(r.Status) === 'won');

    const openWon = allWon.filter((r) => !parseBoolean(r.Processed));

    const [evidenceSets, driverTimeOffResult, driverTimeOffRosterOptions] = await Promise.all([
      getUploadEvidenceSets(token),
      getDriverTimeOffListId()
        ? getDriverTimeOffRows(token).catch((error) => ({ rows: [], warning: error.message || 'Driver Time Off could not be loaded.' }))
        : Promise.resolve({ rows: [], warning: 'DRIVER_TIME_OFF_LOG_LIST_ID is not configured.' }),
      process.env.DRIVER_ROSTER_LIST_ID
        ? getAvailableTruckRosterOptions(token).catch(() => [])
        : Promise.resolve([])
    ]);
    const driverTimeOffCurrent = buildDriverTimeOffCurrentResponse(driverTimeOffResult.rows || [], { targetDate });

    const activeToday = openWon
      .filter((r) => {
        const pickup = normalizeEasternDateOnly(r.PickupDate);
        const delivery = normalizeEasternDateOnly(r.DeliveryDate);

        return pickup && delivery && pickup <= targetDate && delivery >= targetDate;
      })
      .map((r) => addUploadEvidence(r, evidenceSets));

    const loadingToday = openWon
      .filter((r) => normalizeEasternDateOnly(r.PickupDate) === targetDate)
      .map((r) => addUploadEvidence(r, evidenceSets));

    const deliveringToday = allWon
      .filter((r) => normalizeEasternDateOnly(r.DeliveryDate) === targetDate)
      .map((r) => addUploadEvidence(r, evidenceSets));

    const loadingNext7 = openWon
      .filter((r) => {
        const pickup = normalizeEasternDateOnly(r.PickupDate);
        return pickup > targetDate && pickup <= plus7;
      })
      .map((r) => addUploadEvidence(r, evidenceSets));

    res.json({
      success: true,
      generatedAt: `${formatEasternTimestamp()} Eastern`,
      targetDate,
      counts: {
        rawItemsScanned: items.length,
        eligibleWon: allWon.length,
        eligibleWonOpen: openWon.length,
        eligibleWonSettled: allWon.length - openWon.length,
        activeToday: activeToday.length,
        loadingToday: loadingToday.length,
        deliveringToday: deliveringToday.length,
        loadingNext7: loadingNext7.length
      },
      uploadDigest: {
        checked: true,
        recordsScanned: evidenceSets.uploadDigestCount
      },
      driverTimeOff: {
        ...driverTimeOffCurrent,
        warning: driverTimeOffResult.warning || '',
        activeDriverOptions: driverTimeOffRosterOptions || []
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



app.get('/driver-time-off/current', requireLookupAccess, async (req, res) => {
  try {
    const token = await getGraphToken();
    const [{ rows, warning }, activeDriverOptions] = await Promise.all([
      getDriverTimeOffRows(token),
      process.env.DRIVER_ROSTER_LIST_ID ? getAvailableTruckRosterOptions(token).catch(() => []) : Promise.resolve([])
    ]);

    res.json({
      ...buildDriverTimeOffCurrentResponse(rows),
      warning,
      activeDriverOptions
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message || 'Unable to load current Driver Time Off.' });
  }
});

app.get('/reports/driver-time-off', requireLookupAccess, async (req, res) => {
  try {
    const currentYear = Number(formatEasternDate().slice(0, 4));
    const minYear = currentYear - DRIVER_TIME_OFF_DEFAULT_REPORT_YEARS_BACK;
    const maxYear = currentYear + 1;
    const year = parseReportInteger(req.query.year || currentYear, 'year', minYear, maxYear);
    const token = await getGraphToken();
    const [{ rows, warning }, activeDriverOptions] = await Promise.all([
      getDriverTimeOffRows(token),
      process.env.DRIVER_ROSTER_LIST_ID ? getAvailableTruckRosterOptions(token).catch(() => []) : Promise.resolve([])
    ]);

    res.json({
      ...buildDriverTimeOffReportResponse(rows, { year }),
      warning,
      activeDriverOptions
    });
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Unable to load Driver Time Off report.' });
  }
});


app.get('/reports/driver-time-off/pdf', requireLookupAccess, async (req, res) => {
  try {
    const currentYear = Number(formatEasternDate().slice(0, 4));
    const minYear = currentYear - DRIVER_TIME_OFF_DEFAULT_REPORT_YEARS_BACK;
    const maxYear = currentYear + 1;
    const year = parseReportInteger(req.query.year || currentYear, 'year', minYear, maxYear);
    const token = await getGraphToken();
    const { rows, warning } = await getDriverTimeOffRows(token);
    const baseReport = {
      ...buildDriverTimeOffReportResponse(rows, { year }),
      warning
    };
    const report = applyDriverTimeOffReportFilter(baseReport, {
      filterType: req.query.filterType,
      filterKey: req.query.filterKey,
      filterLabel: req.query.filterLabel
    });
    const pdfBuffer = createDriverTimeOffPdfBuffer(report);
    const safeYear = String(year || 'driver-time-off').replace(/[^0-9A-Za-z_-]+/g, '-');
    const safeFilter = report.filter?.label
      ? `_${String(report.filter.label).replace(/[^0-9A-Za-z_-]+/g, '-').replace(/^-+|-+$/g, '')}`
      : '';
    const fileName = `Kole_Driver_Time_Off_${safeYear}${safeFilter}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', pdfBuffer.length);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.end(pdfBuffer);
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || 'Unable to export Driver Time Off report PDF.'
    });
  }
});

app.post('/driver-time-off', requireLookupAccess, async (req, res) => {
  try {
    const listId = getDriverTimeOffListId();
    if (!listId) {
      return res.status(500).json({ success: false, error: 'DRIVER_TIME_OFF_LOG_LIST_ID is not configured on the server.' });
    }
    const token = await getGraphToken();
    const rosterOption = await resolveDriverTimeOffRosterOption(token, req.body?.rosterDriverKey);
    const fields = buildDriverTimeOffFieldsFromBody(req.body, rosterOption);
    const createdItem = await graphPost(
      token,
      `https://graph.microsoft.com/v1.0/sites/${process.env.SITE_ID}/lists/${listId}/items`,
      { fields }
    );

    res.status(201).json({ success: true, itemId: createdItem.id || '', message: 'Driver time off added.' });
  } catch (error) {
    console.error(error);
    res.status(400).json({ success: false, error: error.message || 'Unable to add Driver Time Off.' });
  }
});

app.patch('/driver-time-off/:id', requireLookupAccess, async (req, res) => {
  try {
    const listId = getDriverTimeOffListId();
    const itemId = String(req.params.id || '').trim();
    if (!listId) {
      return res.status(500).json({ success: false, error: 'DRIVER_TIME_OFF_LOG_LIST_ID is not configured on the server.' });
    }
    if (!itemId) {
      return res.status(400).json({ success: false, error: 'A Driver Time Off item ID is required.' });
    }
    const token = await getGraphToken();
    const rosterOption = await resolveDriverTimeOffRosterOption(token, req.body?.rosterDriverKey);
    const fields = buildDriverTimeOffFieldsFromBody(req.body, rosterOption);
    await graphPatch(
      token,
      `https://graph.microsoft.com/v1.0/sites/${process.env.SITE_ID}/lists/${listId}/items/${itemId}/fields`,
      fields
    );

    res.json({ success: true, itemId, message: 'Driver time off updated.' });
  } catch (error) {
    console.error(error);
    res.status(400).json({ success: false, error: error.message || 'Unable to update Driver Time Off.' });
  }
});


app.get('/reports/no-availability', requireLookupAccess, async (req, res) => {
  try {
    const yearParam = String(req.query.year || 'all').trim().toLowerCase();
    const selectedYear = yearParam === 'all'
      ? 'all'
      : parseReportInteger(yearParam, 'year', ARCHIVE_YEAR_MIN, ARCHIVE_YEAR_MAX);
    const sources = getNoAvailabilitySources();

    if (sources.length === 0) {
      return res.status(500).json({
        success: false,
        error: 'No Availability list IDs are not configured on the server.'
      });
    }

    const token = await getGraphToken();
    const settled = await Promise.allSettled(
      sources.map(async (source) => {
        const items = await getAllListItemsWithFields(
          token,
          source.listId,
          getNoAvailabilityFieldSelect()
        );

        return items.map((item) => cleanNoAvailabilityItem(item, source));
      })
    );

    const rows = settled
      .filter((result) => result.status === 'fulfilled')
      .flatMap((result) => result.value);

    const failedLists = settled
      .map((result, index) => ({ result, source: sources[index] }))
      .filter((entry) => entry.result.status === 'rejected')
      .map((entry) => ({
        sourceLabel: entry.source.label,
        listId: entry.source.listId,
        error: entry.result.reason?.message || 'Unknown No Availability list failure'
      }));

    const report = buildNoAvailabilityResponse(rows, { year: selectedYear });

    res.json({
      ...report,
      source: 'No Availability + archives',
      sourceLists: sources.map((source) => ({
        key: source.key,
        label: source.label,
        sourceYear: source.sourceYear,
        listId: source.listId
      })),
      sourceRecordsScanned: rows.length,
      failedLists
    });
  } catch (error) {
    console.error(error);

    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || 'Unable to load No Availability report.'
    });
  }
});

app.get('/reports/customer-booking-trends', requireLookupAccess, async (req, res) => {
  try {
    const throughMonth = parseReportInteger(req.query.month, 'month', 1, 12);
    const throughYear = parseReportInteger(req.query.year, 'year', ARCHIVE_YEAR_MIN, ARCHIVE_YEAR_MAX);
    const lockStatus = getCustomerTrendReportLockStatus(throughYear, throughMonth);

    if (!lockStatus.isUnlocked) {
      return res.status(423).json({
        success: false,
        error: 'REPORT_LOCKED',
        message: `${lockStatus.reportLabel} Customer Booking Trends is not available yet.`,
        reportLabel: lockStatus.reportLabel,
        unlockLabel: lockStatus.unlockLabel,
        lockReason:
          'Customer Booking Trends unlock at 8:00 AM Eastern on the 5th day of the following month. This keeps monthly sales reporting aligned with finalized prior-month activity.'
      });
    }

    const token = await getGraphToken();
    const allLists = await getSearchableBidLists(token);
    const currentList = allLists.find((list) => list.label === 'Bid Listing') || null;
    const currentEasternYear = getEasternParts().year;
    const sourceLists = [];

    for (let year = ARCHIVE_YEAR_MIN; year <= throughYear; year += 1) {
      const archiveSource = allLists.find((list) => String(list.year) === String(year));
      const yearSource = Number(year) === Number(currentEasternYear)
        ? (currentList || archiveSource)
        : archiveSource;

      if (yearSource) {
        sourceLists.push(yearSource);
      }
    }

    if (sourceLists.length === 0) {
      return res.status(404).json({
        success: false,
        error: `No Bid Listing source list was found for customer trends through ${lockStatus.reportLabel}.`
      });
    }

    const settled = await Promise.allSettled(
      sourceLists.map(async (sourceList) => {
        const bundle = await getAllListItemsWithFieldsResilient(
          token,
          sourceList.listId,
          getCustomerBookingTrendsSourceFieldSelect()
        );

        return {
          sourceList,
          items: bundle.items.map((item) => ({ item, sourceList })),
          usedFallback: bundle.usedFallback,
          warning: bundle.warning
        };
      })
    );

    const fulfilledBundles = settled
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value);

    const successfulItems = fulfilledBundles.flatMap((bundle) => bundle.items);

    const sourceWarnings = fulfilledBundles
      .filter((bundle) => bundle.usedFallback)
      .map((bundle) => ({
        SourceList: bundle.sourceList.label,
        warning: 'Selected field fetch failed for this source, so the server retried with full fields.',
        detail: bundle.warning
      }));

    const failedLists = settled
      .map((result, index) => ({ result, list: sourceLists[index] }))
      .filter((entry) => entry.result.status === 'rejected')
      .map((entry) => ({
        SourceList: entry.list.label,
        error: entry.result.reason?.message || 'Unknown customer trend list failure'
      }));

    const trendRecords = successfulItems
      .map(({ item, sourceList }) => getCustomerBookingTrendRecordFromBidItem(item, sourceList))
      .filter(Boolean);

    const report = buildCustomerBookingTrendsResponse(trendRecords, throughYear, throughMonth);

    res.json({
      ...report,
      source: 'Bid Listing + archives',
      sourceLists: sourceLists.map((list) => ({ label: list.label, year: list.year, listId: list.listId })),
      sourceRecordsScanned: successfulItems.length,
      sourceWarnings,
      failedLists
    });
  } catch (error) {
    console.error(error);

    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || 'Unable to load Customer Booking Trends.'
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