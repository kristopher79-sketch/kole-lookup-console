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
  const [selectedView, setSelectedView] = useState('basic');

  async function handleSearch() {
    const q = query.trim();
    if (!q) return;

    setLoading(true);
    setError('');
    setHasSearched(true);
    setSelected(null);
    setSelectedView('basic');

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

  async function loadDetails(id, view = 'basic') {
    if (!id) {
      setError('This row does not have a record ID.');
      return;
    }

    setSelectedView(view);
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

  function canShowOrderViews(status) {
    const s = (status || '').toLowerCase();
    return s === 'won' || s === 'tonu';
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

  function formatMoney(value) {
    if (value === null || value === undefined || value === '') return '-';

    const number = Number(value);

    if (Number.isNaN(number)) return value;

    return number.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD'
    });
  }

  function viewTitle() {
    if (selectedView === 'dispatch') return 'Dispatch Info';
    if (selectedView === 'billing') return 'Billing Info';
    return 'Basic Load Info';
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

      <div className={selected ? 'console-layout has-detail' : 'console-layout'}>
        <div className="results-panel">
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
                  <th>Actions</th>
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
                      <div className="row-actions">
                        <button className="view-button" onClick={() => loadDetails(r.id, 'basic')}>
                          Basic
                        </button>

                        {canShowOrderViews(r.Status) && (
                          <>
                            <button className="view-button" onClick={() => loadDetails(r.id, 'dispatch')}>
                              Dispatch
                            </button>

                            <button className="view-button" onClick={() => loadDetails(r.id, 'billing')}>
                              Billing
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {selected && (
          <div className="detail-panel side-panel">
            <div className="detail-header">
              <div>
                <h2>{viewTitle()}</h2>
                <p>{selected.Customer || 'No customer listed'} · {selected.BOL || 'No BOL'}</p>
              </div>

              <button className="close-button" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>

            {selectedView === 'basic' && (
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
                  <strong>{formatMoney(selected.QuotedTotal)}</strong>
                </div>

                <div className="detail-item">
                  <span>$/Mile</span>
                  <strong>{selected.RatePerMile || '-'}</strong>
                </div>

                <div className="detail-item">
                  <span>Pickup</span>
                  <strong>{formatDateTime(selected.PickupDate, selected.PickupTime, selected.PickupAMPM)}</strong>
                </div>

                <div className="detail-item">
                  <span>Delivery</span>
                  <strong>{formatDateTime(selected.DeliveryDate, selected.DeliveryTime, selected.DeliveryAMPM)}</strong>
                </div>
              </div>
            )}

            {selectedView === 'dispatch' && (
              <div className="detail-grid">
                <div className="detail-item"><span>BOL</span><strong>{selected.BOL || '-'}</strong></div>
                <div className="detail-item"><span>Driver</span><strong>{selected.Driver || '-'}</strong></div>
                <div className="detail-item"><span>Truck</span><strong>{selected.Truck || '-'}</strong></div>
                <div className="detail-item"><span>Team Required</span><strong>{selected.TeamRequired || '-'}</strong></div>

                <div className="detail-item wide">
                  <span>Pickup Location</span>
                  <strong>{selected.Pickup1Name || '-'}</strong>
                  <small>
                    {[selected.Pickup1Address1, selected.Pickup1City, selected.Pickup1State, selected.Pickup1Zip]
                      .filter(Boolean)
                      .join(', ')}
                  </small>
                </div>

                <div className="detail-item wide">
                  <span>Pickup Contact</span>
                  <strong>{selected.Pickup1ContactName || '-'}</strong>
                  <small>{selected.Pickup1ContactNumber || ''}</small>
                </div>

                <div className="detail-item">
                  <span>Pickup Time</span>
                  <strong>{formatDateTime(selected.PickupDate, selected.PickupTime, selected.PickupAMPM)}</strong>
                </div>

                <div className="detail-item wide">
                  <span>Delivery Location</span>
                  <strong>{selected.Delivery1Name || '-'}</strong>
                  <small>
                    {[selected.Delivery1Address1, selected.Delivery1City, selected.Delivery1State, selected.Delivery1Zip]
                      .filter(Boolean)
                      .join(', ')}
                  </small>
                </div>

                <div className="detail-item wide">
                  <span>Delivery Contact</span>
                  <strong>{selected.Delivery1ContactName || '-'}</strong>
                  <small>{selected.Delivery1ContactNumber || ''}</small>
                </div>

                <div className="detail-item">
                  <span>Delivery Time</span>
                  <strong>{formatDateTime(selected.DeliveryDate, selected.DeliveryTime, selected.DeliveryAMPM)}</strong>
                </div>

                <div className="detail-item"><span>Total Pieces</span><strong>{selected.TotalPieces || '-'}</strong></div>
                <div className="detail-item"><span>Weight</span><strong>{selected.EstimatedWeight || '-'}</strong></div>
                <div className="detail-item"><span>Shipper #</span><strong>{selected.ShipperNumber || '-'}</strong></div>
                <div className="detail-item"><span>Contract</span><strong>{selected.Contract || '-'}</strong></div>

                <div className="detail-item wide">
                  <span>Freight Item</span>
                  <strong>
                    {selected.Item1QTY || '-'} × {selected.Item1Description || '-'}
                  </strong>
                  <small>
                    Serial: {selected.Item1Serial || '-'} · Dimensions: {selected.Item1Dimensions || '-'}
                  </small>
                </div>
              </div>
            )}

            {selectedView === 'billing' && (
              <div className="detail-grid">
                <div className="detail-item"><span>BOL</span><strong>{selected.BOL || '-'}</strong></div>
                <div className="detail-item"><span>Bid ID</span><strong>{selected.BidID || '-'}</strong></div>
                <div className="detail-item"><span>Customer</span><strong>{selected.Customer || '-'}</strong></div>
                <div className="detail-item"><span>Customer Code</span><strong>{selected.CustomerCode || '-'}</strong></div>

                <div className="detail-item"><span>Quoted Total</span><strong>{formatMoney(selected.QuotedTotal)}</strong></div>
                <div className="detail-item"><span>$/Mile</span><strong>{selected.RatePerMile || '-'}</strong></div>
                <div className="detail-item"><span>Permits/Escort</span><strong>{formatMoney(selected.PermitsEscortFees)}</strong></div>
                <div className="detail-item"><span>Driver Pay</span><strong>{formatMoney(selected.EstimatedDriverPay)}</strong></div>

                <div className="detail-item"><span>Linehaul Billed</span><strong>{formatMoney(selected.LinehaulBilled)}</strong></div>
                <div className="detail-item"><span>Fuel Surcharge Billed</span><strong>{formatMoney(selected.FuelSurchargeBilled)}</strong></div>
                <div className="detail-item"><span>Tarping Billed</span><strong>{formatMoney(selected.TarpingBilled)}</strong></div>
                <div className="detail-item"><span>Tarps Needed</span><strong>{selected.NoOfTarpsNeeded || '-'}</strong></div>

                <div className="detail-item"><span>Linehaul Driver Pay</span><strong>{formatMoney(selected.LinehaulDriverPay)}</strong></div>
                <div className="detail-item"><span>Fuel Surcharge Driver Pay</span><strong>{formatMoney(selected.FuelSurchargeDriverPay)}</strong></div>
                <div className="detail-item"><span>Tarping Driver Pay</span><strong>{formatMoney(selected.TarpingDriverPay)}</strong></div>

                <div className="detail-item"><span>Processed</span><strong>{String(selected.Processed)}</strong></div>
                <div className="detail-item"><span>Final Settlement Sent</span><strong>{String(selected.FinalSettleSent)}</strong></div>
                <div className="detail-item"><span>Written to Excel</span><strong>{String(selected.WrittentoExcel)}</strong></div>
                <div className="detail-item"><span>Excel Status</span><strong>{selected.ExcelWriteStatus || '-'}</strong></div>

                <div className="detail-item wide"><span>TMS Name</span><strong>{selected.TMSName || '-'}</strong></div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}