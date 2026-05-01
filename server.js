const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 5000;

// Root check
app.get('/', (req, res) => {
  res.send('Kole Lookup API is running');
});

// Test endpoint
app.get('/test', (req, res) => {
  res.json({
    message: 'API working',
    time: new Date()
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});