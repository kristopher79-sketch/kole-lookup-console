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

app.get('/site-test', async (req, res) => {
  try {
    const token = await getGraphToken();

    const response = await fetch(
      'https://graph.microsoft.com/v1.0/sites/netorgft3137173.sharepoint.com:/sites/koletrucking.com',
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/lists-test', async (req, res) => {
  try {
    const token = await getGraphToken();

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/sites/${process.env.SITE_ID}/lists`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    const data = await response.json();

    res.json(
      data.value.map(list => ({
        id: list.id,
        name: list.name,
        displayName: list.displayName
      }))
    );
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

    const cleaned = data.value.map(item => ({
      BOL: item.fields.BOLNumber_x0028_Won_x0029_,
      BidID: item.fields.BidID,
      Customer: item.fields.Company,
      Origin: item.fields.Shipment_x0020_Origin,
      Destination: item.fields.Shipment_x0020_Destination,
      Status: item.fields.Status,
      Truck: item.fields.Truck_x0020_Number,
      Driver: item.fields.Operator_x002f_Team
    }));

    res.json(cleaned);

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

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/sites/${process.env.SITE_ID}/lists/${process.env.BID_LIST_ID}/items?$expand=fields&$top=100`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    const data = await response.json();

    const cleaned = data.value.map(item => ({
      BOL: item.fields.BOLNumber_x0028_Won_x0029_ || '',
      BidID: item.fields.BidID || '',
      Customer: item.fields.Company || '',
      Origin: item.fields.Shipment_x0020_Origin || '',
      Destination: item.fields.Shipment_x0020_Destination || '',
      Status: item.fields.Status || '',
      Truck: item.fields.Truck_x0020_Number || '',
      Driver: item.fields.Operator_x002f_Team || ''
    }));

    const results = cleaned.filter(item =>
      Object.values(item).some(value =>
        value.toString().toLowerCase().includes(q)
      )
    );

    res.json({
      success: true,
      query: q,
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