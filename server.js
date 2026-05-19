require('dotenv').config();

const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 5000;

const ARCHIVE_YEAR_MIN = 2024;
const ARCHIVE_YEAR_MAX = 2030;

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
    Origin: fields.Shipment_x0020_Origin || '',
    Destination: fields.Shipment_x0020_Destination || '',
    Status: fields.Status || '',
    Truck: fields.Truck_x0020_Number || '',
    Driver: fields.Operator_x002f_Team || '',
    TMSName: fields.TMSName || '',
    OperatorInactive: fields.OperatorInactive ?? false,
    PickupDate: fields.Pickup_x0020_Offer_x0020_Date || ''
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

    if (!process.env.DISPATCH_ONEDRIVE_ID || !process.env.LOAD_PICTURES_FOLDER_ID) {
      return res.status(500).json({
        success: false,
        error: 'Load Pictures folder environment variables are not configured.'
      });
    }

    const token = await getGraphToken();

    const rootItems = await getAllChildrenFromFolder(
      token,
      process.env.DISPATCH_ONEDRIVE_ID,
      process.env.LOAD_PICTURES_FOLDER_ID
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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});