require('dotenv').config();

const express = require('express');
const cors = require('cors');
const msal = require('@azure/msal-node');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 5000;

const ARCHIVE_YEAR_MIN = 2024;
const ARCHIVE_YEAR_MAX = 2030;

let cachedBidLists = null;
let cachedBidListsAt = 0;
const BID_LIST_CACHE_MS = 5 * 60 * 1000;

function requireLookupAccess(req, res, next) {
  const token = req.headers['x-lookup-token'];

  if (!process.env.LOOKUP_ACCESS_TOKEN) {
    return res.status(500).json({
      success: false,
      error: 'Lookup access token is not configured on the server.'
    });
  }

  if (!token || token !== process.env.LOOKUP_ACCESS_TOKEN) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized'
    });
  }

  next();
}

const msalClient = new msal.ConfidentialClientApplication({
  auth: {
    clientId: process.env.CLIENT_ID,
    authority: `https://login.microsoftonline.com/${process.env.TENANT_ID}`,
    clientSecret: process.env.CLIENT_SECRET
  }
});

async function getGraphToken() {
  const tokenResponse = await msalClient.acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default']
  });

  return tokenResponse.accessToken;
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

function getArchiveYear(displayName) {
  const match = String(displayName || '').match(/^Bid Listing Archive (\d{4})$/);
  if (!match) return null;

  const year = Number(match[1]);

  if (year < ARCHIVE_YEAR_MIN || year > ARCHIVE_YEAR_MAX) return null;

  return year;
}

async function getSearchableBidLists(token, forceRefresh = false) {
  const now = Date.now();

  if (
    !forceRefresh &&
    cachedBidLists &&
    now - cachedBidListsAt < BID_LIST_CACHE_MS
  ) {
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
    Driver: fields.Operator_x002f_Team || ''
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
    const q = (req.query.q || '').toString().trim().toLowerCase();

    if (!q) {
      return res.status(400).json({
        success: false,
        message: 'Missing search query. Use /search?q=yourSearchText'
      });
    }

    const lists = await getSearchableBidLists(token);

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

    const results = successfulGroups.filter((item) =>
      Object.values(item).some((value) =>
        value.toString().toLowerCase().includes(q)
      )
    );

    res.json({
      success: true,
      query: q,
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

    res.status(500).json({
      success: false,
      error: error.message
    });
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

    res.status(500).json({
      success: false,
      error: error.message
    });
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
    res.status(500).json({
      success: false,
      error: error.message
    });
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
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});