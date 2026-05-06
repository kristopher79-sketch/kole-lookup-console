require('dotenv').config();

const express = require('express');
const cors = require('cors');
const msal = require('@azure/msal-node');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 5000;

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

function cleanBidItem(item) {
  const fields = item.fields || {};

  return {
    id: item.id || '',
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

async function getAllBidItems(token) {
  let url = `https://graph.microsoft.com/v1.0/sites/${process.env.SITE_ID}/lists/${process.env.BID_LIST_ID}/items?$expand=fields&$top=999`;
  const allItems = [];

  while (url) {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(JSON.stringify(data));
    }

    allItems.push(...(data.value || []));
    url = data['@odata.nextLink'] || null;
  }

  return allItems;
}

app.get('/', (req, res) => {
  res.send('Kole Lookup API is running');
});

app.get('/test', (req, res) => {
  res.json({
    message: 'API working',
    time: new Date()
  });
});

app.get('/graph-test', async (req, res) => {
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

app.get('/bids-test', async (req, res) => {
  try {
    const token = await getGraphToken();

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/sites/${process.env.SITE_ID}/lists/${process.env.BID_LIST_ID}/items?$expand=fields&$top=5`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(JSON.stringify(data));
    }

    res.json((data.value || []).map(cleanBidItem));
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/search', async (req, res) => {
  try {
    const token = await getGraphToken();
    const q = (req.query.q || '').toString().trim().toLowerCase();

    if (!q) {
      return res.status(400).json({
        success: false,
        message: 'Missing search query. Use /search?q=yourSearchText'
      });
    }

    const items = await getAllBidItems(token);
    const cleaned = items.map(cleanBidItem);

    const results = cleaned.filter(item =>
      Object.values(item).some(value =>
        value.toString().toLowerCase().includes(q)
      )
    );

    res.json({
      success: true,
      query: q,
      searchedRecords: cleaned.length,
      count: results.length,
      results
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/record/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const token = await getGraphToken();

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/sites/${process.env.SITE_ID}/lists/${process.env.BID_LIST_ID}/items/${id}?$expand=fields`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(JSON.stringify(data));
    }

    const f = data.fields || {};

    res.json({
      success: true,
      id: data.id || '',

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
      NoOfTarpsNeeded: f.No_x002e_ofTarpsNeeded || '',
      TarpingBilled: f.TarpingBilled || '',
      FuelSurchargeBilled: f.FuelSurchargeBilled || '',
      LinehaulBilled: f.LinehaulBilled || '',
      TarpingDriverPay: f.TarpingDriverPay || '',
      FuelSurchargeDriverPay: f.FuelSurchargeDriverPay || '',
      LinehaulDriverPay: f.LinehaulDriverPay || '',
      Processed: f.Processed ?? '',
      FinalSettleSent: f.FinalSettleSent ?? '',
      CustomerCode: f.CustomerCode || '',
      TMSName: f.TMSName || '',
      WrittentoExcel: f.WrittentoExcel ?? '',
      ExcelWriteStatus: f.ExcelWriteStatus || ''
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

app.get('/record-fields/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const token = await getGraphToken();

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/sites/${process.env.SITE_ID}/lists/${process.env.BID_LIST_ID}/items/${id}?$expand=fields`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(JSON.stringify(data));
    }

    res.json({
      success: true,
      id: data.id || '',
      fields: data.fields || {}
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});