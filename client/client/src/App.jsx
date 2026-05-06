import { useEffect, useState } from 'react';
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

  useEffect(() => {
    function handleEsc(e) {
      if (e.key === 'Escape') {
        setSelected(null);
      }
    }

    window.addEventListener('keydown', handleEsc);

    return () => window.removeEventListener('keydown', handleEsc);
  }, []);

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

  function closeModal() {
    setSelected(null);
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

  function formatValue(value) {
    if (value === null || value === undefined || value === '') return '-';
    return value;
  }

  function viewTitle() {
    if (selectedView === 'dispatch') return 'Dispatch Info';
    if (selectedView === 'billing') return 'Billing Info';
    return 'Basic Load Info';
  }

  function DetailItem({ label, value, wide = false, children }) {
    return (
      <div className={wide ? 'detail-item wide' : 'detail-item'}>
        <span>{label}</span>
        <strong>{formatValue(value)}</strong>
        {children}
      </div>
    );
  }

  function SectionTitle({ children }) {
    return <div className="section-title">{children}</div>;
  }

  function BasicView() {
    return (
      <div className="detail-grid">
        <SectionTitle>Load Overview</SectionTitle>

        <DetailItem label="BOL" value={selected.BOL} />
        <DetailItem label="Bid ID" value={selected.BidID} />
        <DetailItem label="Status" value={selected.Status} />
        <DetailItem label="Requestor" value={selected.Requestor} />

        <DetailItem label="Customer" value={selected.Customer} wide />
        <DetailItem label="Freight" value={selected.Freight} wide />

        <SectionTitle>Route & Schedule</SectionTitle>

        <DetailItem label="Origin" value={selected.Origin} wide />
        <DetailItem label="Destination" value={selected.Destination} wide />

        <DetailItem
          label="Pickup"
          value={formatDateTime(selected.PickupDate, selected.PickupTime, selected.PickupAMPM)}
        />

        <DetailItem
          label="Delivery"
          value={formatDateTime(selected.DeliveryDate, selected.DeliveryTime, selected.DeliveryAMPM)}
        />

        <DetailItem label="Route" value={selected.Route} wide />

        <SectionTitle>Truck, Driver & Freight</SectionTitle>

        <DetailItem label="Driver" value={selected.Driver} />
        <DetailItem label="Truck" value={selected.Truck} />
        <DetailItem label="Team Required" value={selected.TeamRequired} />
        <DetailItem label="Aircraft Related" value={selected.AircraftRelated} />

        <DetailItem
          label="Dimensions"
          value={`${selected.Length || '-'} × ${selected.Width || '-'} × ${selected.Height || '-'}`}
        />

        <DetailItem
          label="Miles"
          value={`${selected.LoadedMiles || '0'} loaded / ${selected.EmptyMiles || '0'} empty`}
        />

        <DetailItem label="Revenue" value={formatMoney(selected.QuotedTotal)} />
        <DetailItem label="$/Mile" value={selected.RatePerMile} />
      </div>
    );
  }

  function DispatchView() {
    return (
      <div className="detail-grid">
        <SectionTitle>Dispatch Overview</SectionTitle>

        <DetailItem label="BOL" value={selected.BOL} />
        <DetailItem label="Driver" value={selected.Driver} />
        <DetailItem label="Truck" value={selected.Truck} />
        <DetailItem label="Team Required" value={selected.TeamRequired} />

        <SectionTitle>Pickup</SectionTitle>

        <DetailItem label="Pickup Location" value={selected.Pickup1Name} wide>
          <small>
            {[selected.Pickup1Address1, selected.Pickup1City, selected.Pickup1State, selected.Pickup1Zip]
              .filter(Boolean)
              .join(', ')}
          </small>
        </DetailItem>

        <DetailItem label="Pickup Contact" value={selected.Pickup1ContactName} wide>
          <small>{selected.Pickup1ContactNumber || ''}</small>
        </DetailItem>

        <DetailItem
          label="Pickup Time"
          value={formatDateTime(selected.PickupDate, selected.PickupTime, selected.PickupAMPM)}
        />

        <DetailItem label="Pickup Snapshot" value={selected.Pickup1TimeSnapshot} />

        <SectionTitle>Delivery</SectionTitle>

        <DetailItem label="Delivery Location" value={selected.Delivery1Name} wide>
          <small>
            {[selected.Delivery1Address1, selected.Delivery1City, selected.Delivery1State, selected.Delivery1Zip]
              .filter(Boolean)
              .join(', ')}
          </small>
        </DetailItem>

        <DetailItem label="Delivery Contact" value={selected.Delivery1ContactName} wide>
          <small>{selected.Delivery1ContactNumber || ''}</small>
        </DetailItem>

        <DetailItem
          label="Delivery Time"
          value={formatDateTime(selected.DeliveryDate, selected.DeliveryTime, selected.DeliveryAMPM)}
        />

        <DetailItem label="Delivery Snapshot" value={selected.Delivery1TimeSnapshot} />

        <SectionTitle>Freight Details</SectionTitle>

        <DetailItem label="Total Pieces" value={selected.TotalPieces} />
        <DetailItem label="Weight" value={selected.EstimatedWeight} />
        <DetailItem label="Shipper #" value={selected.ShipperNumber} />
        <DetailItem label="Contract" value={selected.Contract} />

        <DetailItem
          label="Freight Item"
          value={`${selected.Item1QTY || '-'} × ${selected.Item1Description || '-'}`}
          wide
        >
          <small>
            Serial: {selected.Item1Serial || '-'} · Dimensions: {selected.Item1Dimensions || '-'}
          </small>
        </DetailItem>
      </div>
    );
  }

  function BillingView() {
    return (
      <div className="detail-grid">
        <SectionTitle>Billing Overview</SectionTitle>

        <DetailItem label="BOL" value={selected.BOL} />
        <DetailItem label="Bid ID" value={selected.BidID} />
        <DetailItem label="Customer" value={selected.Customer} />
        <DetailItem label="Customer Code" value={selected.CustomerCode} />

        <SectionTitle>Revenue</SectionTitle>

        <DetailItem label="Quoted Total" value={formatMoney(selected.QuotedTotal)} />
        <DetailItem label="$/Mile" value={selected.RatePerMile} />
        <DetailItem label="Permits/Escort" value={formatMoney(selected.PermitsEscortFees)} />
        <DetailItem label="Driver Pay" value={formatMoney(selected.EstimatedDriverPay)} />

        <DetailItem label="Linehaul Billed" value={formatMoney(selected.LinehaulBilled)} />
        <DetailItem label="Fuel Surcharge Billed" value={formatMoney(selected.FuelSurchargeBilled)} />
        <DetailItem label="Tarping Billed" value={formatMoney(selected.TarpingBilled)} />
        <DetailItem label="Tarps Needed" value={selected.NoOfTarpsNeeded} />

        <SectionTitle>Driver Pay Breakdown</SectionTitle>

        <DetailItem label="Linehaul Driver Pay" value={formatMoney(selected.LinehaulDriverPay)} />
        <DetailItem label="Fuel Surcharge Driver Pay" value={formatMoney(selected.FuelSurchargeDriverPay)} />
        <DetailItem label="Tarping Driver Pay" value={formatMoney(selected.TarpingDriverPay)} />

        <SectionTitle>Processing Status</SectionTitle>

        <DetailItem label="Processed" value={String(selected.Processed)} />
        <DetailItem label="Final Settlement Sent" value={String(selected.FinalSettleSent)} />
        <DetailItem label="Written to Excel" value={String(selected.WrittentoExcel)} />
        <DetailItem label="Excel Status" value={selected.ExcelWriteStatus} />

        <DetailItem label="TMS Name" value={selected.TMSName} wide />
      </div>
    );
  }

  return (
    <div className="container">
      <header className="app-header">
        <div>
          <h1>Kole Lookup Console</h1>
          <p>Search Bid Listing records, review order details, and inspect dispatch or billing data.</p>
        </div>
      </header>

      <div className="search-card">
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
      </div>

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
                <tr
                  key={r.id || i}
                  className={selected?.id === r.id ? 'selected-row' : ''}
                  onClick={() => loadDetails(r.id, 'basic')}
                >
                  <td>{r.BOL || '-'}</td>
                  <td>{r.Customer || '-'}</td>
                  <td>{r.Origin || '-'}</td>
                  <td>{r.Destination || '-'}</td>
                  <td>{r.Driver || '-'}</td>
                  <td>{r.Truck || '-'}</td>
                  <td>
                    <span className={getStatusClass(r.Status)}>
                      {r.Status || '-'}
                    </span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="view-button"
                        onClick={(e) => {
                          e.stopPropagation();
                          loadDetails(r.id, 'basic');
                        }}
                      >
                        Basic
                      </button>

                      {canShowOrderViews(r.Status) && (
                        <>
                          <button
                            className="view-button"
                            onClick={(e) => {
                              e.stopPropagation();
                              loadDetails(r.id, 'dispatch');
                            }}
                          >
                            Dispatch
                          </button>

                          <button
                            className="view-button"
                            onClick={(e) => {
                              e.stopPropagation();
                              loadDetails(r.id, 'billing');
                            }}
                          >
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
        <div className="modal-overlay" onClick={closeModal}>
          <div className="detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="detail-header">
              <div>
                <h2>{viewTitle()}</h2>
                <p>{selected.Customer || 'No customer listed'} · {selected.BOL || 'No BOL'}</p>
              </div>

              <button className="close-button" onClick={closeModal}>
                Close
              </button>
            </div>

            <div className="view-tabs">
              <button
                className={selectedView === 'basic' ? 'active-tab' : ''}
                onClick={() => setSelectedView('basic')}
              >
                Basic Load Info
              </button>

              {canShowOrderViews(selected.Status) && (
                <>
                  <button
                    className={selectedView === 'dispatch' ? 'active-tab' : ''}
                    onClick={() => setSelectedView('dispatch')}
                  >
                    Dispatch Info
                  </button>

                  <button
                    className={selectedView === 'billing' ? 'active-tab' : ''}
                    onClick={() => setSelectedView('billing')}
                  >
                    Billing Info
                  </button>
                </>
              )}
            </div>

            <div className="modal-body">
              {selectedView === 'basic' && <BasicView />}
              {selectedView === 'dispatch' && <DispatchView />}
              {selectedView === 'billing' && <BillingView />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}