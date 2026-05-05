import { useState } from 'react';
import './App.css';

const API = 'https://kole-lookup-console.onrender.com';

export default function App() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searchedRecords, setSearchedRecords] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [selected, setSelected] = useState(null);

  async function handleSearch() {
    const q = query.trim();
    if (!q) return;

    setLoading(true);
    setError('');
    setHasSearched(true);
    setSelected(null);

    try {
      const res = await fetch(`${API}/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();

      if (!data.success) throw new Error(data.error || 'Search failed');

      setResults(data.results || []);
      setSearchedRecords(data.searchedRecords || 0);
    } catch (err) {
      setError(err.message);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadDetails(id) {
    if (!id) {
      setError('This row does not have a record ID.');
      return;
    }

    setLoadingDetail(true);
    setError('');

    try {
      const res = await fetch(`${API}/record/${id}`);
      const data = await res.json();

      if (!data.success) throw new Error(data.error || 'Unable to load record details');

      setSelected(data);
    } catch (err) {
      setError(err.message);
      setSelected(null);
    } finally {
      setLoadingDetail(false);
    }
  }

  function getStatusClass(status) {
    const s = (status || '').toLowerCase();

    if (s === 'won') return 'status won';
    if (s === 'lost') return 'status lost';
    if (s === 'tonu') return 'status tonu';
    if (s === 'can') return 'status cancelled';

    return 'status';
  }

  function formatDateTime(dateValue, timeValue, ampmValue) {
    if (!dateValue) return '-';

    const date = new Date(dateValue);

    const dateText = date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });

    const timeText = [timeValue, ampmValue].filter(Boolean).join(' ');

    if (!timeText) return dateText;

    return `${dateText} @ ${timeText}`;
  }

  return (
    <div className="container">
      <h1>Kole Lookup Console</h1>

      <div className="search-bar">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Search BOL, Customer, Driver, Truck..."
        />

        <button onClick={handleSearch} disabled={loading}>
          {loading ? 'Searching...' : 'Search'}
        </button>
      </div>

      {hasSearched && !loading && !error && (
        <div className="summary">
          {results.length} result{results.length === 1 ? '' : 's'} from {searchedRecords} records
        </div>
      )}

      {loading && <div className="msg">Searching...</div>}
      {loadingDetail && <div className="msg">Loading record details...</div>}
      {error && <div className="msg error">{error}</div>}

      {hasSearched && !loading && !error && results.length === 0 && (
        <div className="msg">No results found</div>
      )}

      {results.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>BOL</th>
              <th>Customer</th>
              <th>Origin</th>
              <th>Destination</th>
              <th>Driver</th>
              <th>Truck</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>

          <tbody>
            {results.map((r, i) => (
              <tr key={r.id || i} className={selected?.id === r.id ? 'selected-row' : ''}>
                <td>{r.BOL}</td>
                <td>{r.Customer}</td>
                <td>{r.Origin}</td>
                <td>{r.Destination}</td>
                <td>{r.Driver}</td>
                <td>{r.Truck}</td>
                <td>
                  <span className={getStatusClass(r.Status)}>
                    {r.Status || '-'}
                  </span>
                </td>
                <td>
                  <button className="view-button" onClick={() => loadDetails(r.id)}>
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selected && (
        <div className="detail-panel">
          <div className="detail-header">
            <div>
              <h2>Load Details</h2>
              <p>{selected.Customer || 'No customer listed'}</p>
            </div>

            <button className="close-button" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>

          <div className="detail-grid">
            <div className="detail-item"><span>BOL</span><strong>{selected.BOL || '-'}</strong></div>
            <div className="detail-item"><span>Bid ID</span><strong>{selected.BidID || '-'}</strong></div>
            <div className="detail-item"><span>Status</span><strong>{selected.Status || '-'}</strong></div>
            <div className="detail-item"><span>Requestor</span><strong>{selected.Requestor || '-'}</strong></div>
            <div className="detail-item"><span>Driver</span><strong>{selected.Driver || '-'}</strong></div>
            <div className="detail-item"><span>Truck</span><strong>{selected.Truck || '-'}</strong></div>

            <div className="detail-item wide"><span>Origin</span><strong>{selected.Origin || '-'}</strong></div>
            <div className="detail-item wide"><span>Destination</span><strong>{selected.Destination || '-'}</strong></div>
            <div className="detail-item wide"><span>Freight</span><strong>{selected.Freight || '-'}</strong></div>

            <div className="detail-item">
              <span>Dimensions</span>
              <strong>{selected.Length || '-'} × {selected.Width || '-'} × {selected.Height || '-'}</strong>
            </div>

            <div className="detail-item">
              <span>Miles</span>
              <strong>{selected.LoadedMiles || '0'} loaded / {selected.EmptyMiles || '0'} empty</strong>
            </div>

            <div className="detail-item">
              <span>Revenue</span>
              <strong>{selected.QuotedTotal ? `$${selected.QuotedTotal}` : '-'}</strong>
            </div>

            <div className="detail-item">
              <span>$/Mile</span>
              <strong>{selected.RatePerMile || '-'}</strong>
            </div>

            <div className="detail-item">
              <span>Pickup</span>
              <strong>
                {formatDateTime(selected.PickupDate, selected.PickupTime, selected.PickupAMPM)}
              </strong>
            </div>

            <div className="detail-item">
              <span>Delivery</span>
              <strong>
                {formatDateTime(selected.DeliveryDate, selected.DeliveryTime, selected.DeliveryAMPM)}
              </strong>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}