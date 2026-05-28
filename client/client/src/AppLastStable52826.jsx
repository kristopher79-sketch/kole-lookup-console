import { useEffect, useMemo, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import './App.css';
import koleLogo from './assets/kole-logo.png';

const API =
  window.location.hostname === 'localhost'
    ? 'http://localhost:5000'
    : 'https://kole-lookup-console.onrender.com';
    


function getDefaultSettlementCutoffDate() {
  const today = new Date();
  const day = today.getDay(); // Sunday = 0, Thursday = 4
  const diffToMostRecentThursday = day >= 4 ? day - 4 : day + 3;
  const cutoff = new Date(today);
  cutoff.setDate(today.getDate() - diffToMostRecentThursday);

  return [
    cutoff.getFullYear(),
    String(cutoff.getMonth() + 1).padStart(2, '0'),
    String(cutoff.getDate()).padStart(2, '0')
  ].join('-');
}


export default function App() {
  const [accessToken, setAccessToken] = useState(() => sessionStorage.getItem('koleLookupToken') || '');
  const [password, setPassword] = useState('');
  const isAuthenticated = Boolean(accessToken);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searchedRecords, setSearchedRecords] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [selected, setSelected] = useState(null);
  const [selectedView, setSelectedView] = useState('basic');
  const [statusFilter, setStatusFilter] = useState('All');
  const [includeArchives, setIncludeArchives] = useState(false);
  const [documentLoading, setDocumentLoading] = useState('');
  const [documentError, setDocumentError] = useState('');
  const [operationsData, setOperationsData] = useState(null);
  const [operationsLoading, setOperationsLoading] = useState(false);
  const [operationsError, setOperationsError] = useState('');
  const [sortField, setSortField] = useState('');
  const [sortDirection, setSortDirection] = useState('asc');
  const initialReportDate = useMemo(() => {
    const date = new Date();
    date.setMonth(date.getMonth() - 1);
    return date;
  }, []);
  const [reportMonth, setReportMonth] = useState(() => initialReportDate.getMonth() + 1);
  const [reportYear, setReportYear] = useState(() => initialReportDate.getFullYear());
  const [driverSummaryReport, setDriverSummaryReport] = useState(null);
  const [driverSummaryLoading, setDriverSummaryLoading] = useState(false);
  const [driverSummaryError, setDriverSummaryError] = useState(null);
  const [driverSummaryModalOpen, setDriverSummaryModalOpen] = useState(false);
  const [settlementCutoffDate, setSettlementCutoffDate] = useState(getDefaultSettlementCutoffDate);
  const [weeklySettlementReport, setWeeklySettlementReport] = useState(null);
  const [weeklySettlementLoading, setWeeklySettlementLoading] = useState(false);
  const [weeklySettlementError, setWeeklySettlementError] = useState(null);
  const [weeklySettlementModalOpen, setWeeklySettlementModalOpen] = useState(false);
  const [activeReportPanel, setActiveReportPanel] = useState('');

  const [authError, setAuthError] = useState('');
  

  function isBolLookup(value) {
    const q = value.trim().toUpperCase();
    return /^[A-Z]\d{6}$/.test(q);
  }

  const showStatusFilter =
    hasSearched &&
    !loading &&
    !error &&
    results.length > 0 &&
    !isBolLookup(query);

  const statusOptions = [
    'All',
    ...Array.from(
      new Set(results.map((r) => r.Status).filter(Boolean))
    ).sort()
  ];

  const filteredResults =
    statusFilter === 'All'
      ? results
      : results.filter((r) => r.Status === statusFilter);

  const sortedResults = useMemo(() => {
    if (!sortField) {
      return filteredResults;
    }

    const sorted = [...filteredResults];

    sorted.sort((a, b) => {
      const aValue = String(a?.[sortField] || '').toLowerCase();
      const bValue = String(b?.[sortField] || '').toLowerCase();

      const aNum = Number(aValue);
      const bNum = Number(bValue);

      let comparison = 0;

      if (!Number.isNaN(aNum) && !Number.isNaN(bNum) && aValue !== '' && bValue !== '') {
        comparison = aNum - bNum;
      } else {
        comparison = aValue.localeCompare(bValue);
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return sorted;
  }, [filteredResults, sortField, sortDirection]);

  useEffect(() => {
    function handleEsc(e) {
      if (e.key === 'Escape') {
        setSelected(null);
        setDriverSummaryModalOpen(false);
        setWeeklySettlementModalOpen(false);
      }
    }

    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return undefined;

    loadOperationsDashboard();

    const interval = window.setInterval(() => {
      loadOperationsDashboard({ silent: true });
    }, 10 * 60 * 1000);

    return () => window.clearInterval(interval);
  }, [isAuthenticated, accessToken]);

  function toggleSort(field) {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }

    setSortField(field);
    setSortDirection('asc');
  }

  function getSortIndicator(field) {
    if (sortField !== field) return '↕';

    return sortDirection === 'asc' ? '▲' : '▼';
  }

  function resetAppState() {
    setQuery('');
    setResults([]);
    setSearchedRecords(0);
    setSelected(null);
    setHasSearched(false);
    setError('');
    setAuthError('');
    setDocumentError('');
    setSortField('');
    setSortDirection('asc');
  }

  async function handleLogin() {
    const token = password.trim();

    if (!token) {
      setAuthError('Enter an access token.');
      return;
    }

    setAuthError('');

    try {
      const res = await fetch(`${API}/auth-check`, {
        headers: {
          'X-Lookup-Token': token
        }
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Access token was not accepted.');
      }

      sessionStorage.setItem('koleLookupToken', token);
      setAccessToken(token);
      setPassword('');
    } catch (err) {
      setAuthError(err.message || 'Login failed.');
    }
  }

  function handleLogout() {
    sessionStorage.removeItem('koleLookupToken');
    setAccessToken('');
    setPassword('');
    resetAppState();
  }

  async function authedFetch(url) {
    const res = await fetch(url, {
      cache: 'no-store',
      headers: {
        'X-Lookup-Token': accessToken,
        'Cache-Control': 'no-cache'
      }
    });

    if (res.status === 401 || res.status === 403) {
      sessionStorage.removeItem('koleLookupToken');
      setAccessToken('');
      throw new Error('Access was denied. Please log in again.');
    }

    return res;
  }

  function handleQueryChange(value) {
    setQuery(value);
    setResults([]);
    setSearchedRecords(0);
    setSelected(null);
    setHasSearched(false);
    setError('');
    setStatusFilter('All');
    setDocumentError('');
    setSortField('');
    setSortDirection('asc');
  }

  async function handleSearch() {
    const q = query.trim();
    if (!q) return;

    setLoading(true);
    setError('');
    setHasSearched(true);
    setSelected(null);
    setSelectedView('basic');
    setStatusFilter('All');
    setDocumentError('');
    setSortField('');
    setSortDirection('asc');

    try {
      const res = await authedFetch(
        `${API}/search?q=${encodeURIComponent(q)}&includeArchives=${includeArchives}`
      );
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
  
async function loadOperationsDashboard(options = {}) {
  const { silent = false } = options;

  if (!silent) {
    setOperationsLoading(true);
  }

  setOperationsError('');

  try {
    const res = await authedFetch(
      `${API}/operations/today`
    );

    const data = await res.json();

    if (!data.success) {
      throw new Error(data.error || 'Unable to load operations dashboard.');
    }

    setOperationsData(data);
  } catch (err) {
    setOperationsError(err.message);

    if (!silent) {
      setOperationsData(null);
    }
  } finally {
    if (!silent) {
      setOperationsLoading(false);
    }
  }
}
  async function loadDetails(id, view = 'basic', sourceListId = '') {
    if (!id) {
      setError('This row does not have a record ID.');
      return;
    }

    setSelectedView(view);
    setLoadingDetail(true);
    setError('');
    setDocumentError('');

    try {
      const endpoint = sourceListId
        ? `${API}/record/${encodeURIComponent(sourceListId)}/${encodeURIComponent(id)}`
        : `${API}/record/${encodeURIComponent(id)}`;

      const res = await authedFetch(endpoint);
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

  async function openBolDocument() {
    if (!selected?.BOL) {
      setDocumentError('This record does not have a BOL number.');
      return;
    }

    setDocumentLoading('bol');
    setDocumentError('');

    try {
      const res = await authedFetch(
        `${API}/documents/bol?bol=${encodeURIComponent(selected.BOL)}&bidId=${encodeURIComponent(selected.BidID || '')}`
      );

      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || 'Unable to find BOL document.');
      }

      if (!data.webUrl) {
        throw new Error('BOL document was found, but no SharePoint link was returned.');
      }

      await openUrl(data.webUrl);
    } catch (err) {
      setDocumentError(err.message);
    } finally {
      setDocumentLoading('');
    }
  }

  async function openFinalSettleDocument() {
    if (!selected?.BOL) {
      setDocumentError('This record does not have a BOL number.');
      return;
    }

    setDocumentLoading('finalsettle');
    setDocumentError('');

    try {
      const res = await authedFetch(
        `${API}/documents/finalsettle?bol=${encodeURIComponent(selected.BOL)}`
      );

      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || 'Unable to find Final Settle document.');
      }

      if (!data.webUrl) {
        throw new Error('Final Settle document was found, but no SharePoint link was returned.');
      }

      await openUrl(data.webUrl);
    } catch (err) {
      setDocumentError(err.message);
    } finally {
      setDocumentLoading('');
    }
  }

  async function openDispatchSheetDocument() {
    if (!selected?.BOL) {
      setDocumentError('This record does not have a BOL number.');
      return;
    }

    setDocumentLoading('dispatchsheet');
    setDocumentError('');

    try {
      const res = await authedFetch(
        `${API}/documents/dispatchsheet?bol=${encodeURIComponent(selected.BOL)}`
      );

      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || 'Unable to find Dispatch Sheet document.');
      }

      if (!data.webUrl) {
        throw new Error('Dispatch Sheet was found, but no SharePoint link was returned.');
      }

      await openUrl(data.webUrl);
    } catch (err) {
      setDocumentError(err.message);
    } finally {
      setDocumentLoading('');
    }
  }

  async function openLoadPhotosFolder() {
    if (!selected?.BOL) {
      setDocumentError('This record does not have a BOL number.');
      return;
    }

    if (!selected?.Driver) {
      setDocumentError('This record does not have an operator/driver name.');
      return;
    }

    setDocumentLoading('loadphotos');
    setDocumentError('');

    try {
      const res = await authedFetch(
  `${API}/documents/loadphotos?bol=${encodeURIComponent(selected.BOL)}&driver=${encodeURIComponent(selected.TMSName || selected.Driver || '')}&operatorInactive=${encodeURIComponent(selected.OperatorInactive || false)}`
);

      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || 'Unable to find Load Photos folder.');
      }

      if (!data.webUrl) {
        throw new Error('Load Photos folder was found, but no OneDrive link was returned.');
      }

      await openUrl(data.webUrl);
    } catch (err) {
      setDocumentError(err.message);
    } finally {
      setDocumentLoading('');
    }
  }


  async function openPermitFolder(record = selected) {
    if (!record?.BOL) {
      setDocumentError('This record does not have a BOL number.');
      return;
    }

    if (!record?.Driver) {
      setDocumentError('This record does not have an Operator/Team value.');
      return;
    }

    if (!hasPermitFolder(record)) {
      setDocumentError('This record does not have estimated permits/escorts.');
      return;
    }

    setDocumentLoading('permits');
    setDocumentError('');

    try {
      const res = await authedFetch(
        `${API}/documents/permits?bol=${encodeURIComponent(record.BOL)}&operatorTeam=${encodeURIComponent(record.Driver || '')}`
      );

      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || 'Unable to find Permit folder.');
      }

      if (!data.webUrl) {
        throw new Error('Permit folder was found, but no OneDrive link was returned.');
      }

      await openUrl(data.webUrl);
    } catch (err) {
      setDocumentError(err.message);
    } finally {
      setDocumentLoading('');
    }
  }

  function closeModal() {
    setSelected(null);
    setDocumentError('');
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

  function SortableHeader({ field, label }) {
    return (
      <th
        className="sortable-header"
        onClick={() => toggleSort(field)}
      >
        <div className="sortable-header-content">
          <span>{label}</span>
          <span className="sort-indicator">
            {getSortIndicator(field)}
          </span>
        </div>
      </th>
    );
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

  function formatDateOnly(value) {
    if (!value) return '-';

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return value;

    return date.toLocaleDateString('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: '2-digit'
    });
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

  function formatReportMoney(value) {
    const number = Number(value || 0);

    return number.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD'
    });
  }

  function formatReportNumber(value, digits = 0) {
    const number = Number(value || 0);

    return number.toLocaleString('en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function getReportMonthName(month) {
    return new Date(2026, Number(month) - 1, 1).toLocaleString('en-US', {
      month: 'long'
    });
  }

  function getReportYears() {
    const currentYear = new Date().getFullYear();
    const years = [];

    for (let year = currentYear; year >= 2024; year -= 1) {
      years.push(year);
    }

    return years;
  }

  async function loadDriverSummaryReport() {
    const selectedMonth = Number(reportMonth);
    const selectedYear = Number(reportYear);
    const selectedReportLabel = `${getReportMonthName(selectedMonth)} ${selectedYear}`;

    setDriverSummaryLoading(true);
    setDriverSummaryError(null);
    setDriverSummaryReport(null);
    setDriverSummaryModalOpen(false);

    try {
      const res = await authedFetch(
        `${API}/reports/driver-summary?month=${encodeURIComponent(selectedMonth)}&year=${encodeURIComponent(selectedYear)}&includeArchives=true`
      );

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        setDriverSummaryError({
          code: data.error || 'REPORT_ERROR',
          message: data.message || data.error || 'Unable to load Driver Summary Report.',
          reportLabel: data.reportLabel || selectedReportLabel,
          unlockLabel: data.unlockLabel || '',
          lockReason: data.lockReason || ''
        });
        return;
      }

      setDriverSummaryReport({
        ...data,
        month: selectedMonth,
        year: selectedYear,
        reportLabel: selectedReportLabel
      });
      setDriverSummaryModalOpen(true);
    } catch (err) {
      setDriverSummaryError({
        code: 'REPORT_ERROR',
        message: err.message || 'Unable to load Driver Summary Report.',
        reportLabel: selectedReportLabel
      });
    } finally {
      setDriverSummaryLoading(false);
    }
  }

  function closeDriverSummaryModal() {
    setDriverSummaryModalOpen(false);
  }

  async function loadWeeklySettlementReport() {
    if (!settlementCutoffDate) {
      setWeeklySettlementError({
        code: 'REPORT_ERROR',
        message: 'Choose a cutoff date before previewing the Weekly Settlement Report.'
      });
      return;
    }

    setWeeklySettlementLoading(true);
    setWeeklySettlementError(null);
    setWeeklySettlementReport(null);
    setWeeklySettlementModalOpen(false);

    try {
      const res = await authedFetch(
        `${API}/reports/weekly-settlement?cutoffDate=${encodeURIComponent(settlementCutoffDate)}`
      );

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || 'Unable to load Weekly Settlement Report.');
      }

      setWeeklySettlementReport(data);
      setWeeklySettlementModalOpen(true);
    } catch (err) {
      setWeeklySettlementError({
        code: 'REPORT_ERROR',
        message: err.message || 'Unable to load Weekly Settlement Report.'
      });
    } finally {
      setWeeklySettlementLoading(false);
    }
  }

  function closeWeeklySettlementModal() {
    setWeeklySettlementModalOpen(false);
  }

  function toggleReportPanel(panelName) {
    setActiveReportPanel((current) => (current === panelName ? '' : panelName));
  }

function openReportLoadDetails(load) {
  if (!load?.id) {
    setDriverSummaryError({
      code: 'REPORT_ERROR',
      message: 'This report row does not have a SharePoint item ID to open.',
      reportLabel: driverSummaryReport?.reportLabel || `${getReportMonthName(reportMonth)} ${reportYear}`
    });
    return;
  }

  loadDetails(load.id, 'basic', load.SourceListId || '');
}

  function formatValue(value) {
    if (value === null || value === undefined || value === '') return '-';
    return value;
  }

  function getNumber(value) {
    if (value === null || value === undefined || value === '') return 0;

    const number = Number(String(value).replace(/[$,]/g, ''));

    if (Number.isNaN(number)) return 0;

    return number;
  }

  function hasPermitFolder(record) {
    return getNumber(record?.PermitsEscortFees) > 0;
  }

  function getDriverPayDisplay(record) {
    const isSettled =
      record.Processed === true ||
      String(record.Processed).toLowerCase() === 'true';

    const value =
      record.NetPayabletoDriver ||
      record.EstimatedDriverPay ||
      (
        getNumber(record.LinehaulDriverPay) +
        getNumber(record.FuelSurchargeDriverPay) +
        getNumber(record.TarpingDriverPay) +
        getNumber(record.AdditionalDriverPay)
      );

    return {
      label: isSettled ? 'Net Driver Pay' : 'Estimated Driver Pay',
      value: value ? formatMoney(value) : '-'
    };
  }

  function viewTitle() {
    if (selectedView === 'dispatch') return 'Dispatch Info';
    if (selectedView === 'billing') return 'Billing Info';
    if (selectedView === 'documents') return 'Documents';
    return 'Basic Load Info';
  }

  function DetailItem({ label, value, wide = false, className = '', children }) {
    return (
      <div className={`detail-item ${wide ? 'wide' : ''} ${className}`}>
        <span>{label}</span>
        <strong>{formatValue(value)}</strong>
        {children}
      </div>
    );
  }

  function SectionTitle({ children }) {
    return <div className="section-title">{children}</div>;
  }

  function DocumentCard({ title, description, buttonText, onClick, disabled, loading }) {
    return (
      <div className="detail-item wide">
        <span>{title}</span>
        <strong>{description}</strong>
        <button
          className="view-button"
          onClick={onClick}
          disabled={disabled || loading}
          style={{ marginTop: '10px', width: 'fit-content' }}
        >
          {loading ? 'Opening...' : buttonText}
        </button>
      </div>
    );
  }


  function EvidenceDot({ hasEvidence, label }) {
    return (
      <span
        title={hasEvidence ? `${label} evidence received` : `No ${label.toLowerCase()} evidence received yet`}
        aria-label={hasEvidence ? `${label} evidence received` : `No ${label.toLowerCase()} evidence received yet`}
        style={{
          display: 'inline-block',
          width: '14px',
          height: '14px',
          borderRadius: '50%',
          backgroundColor: hasEvidence ? '#2e9d50' : '#c93f3f',
          boxShadow: '0 0 0 2px rgba(255,255,255,0.9), 0 1px 4px rgba(0,0,0,0.25)'
        }}
      />
    );
  }

  function BasicView() {
    return (
      <div className="detail-grid">
        <SectionTitle>Load Overview</SectionTitle>

        <DetailItem label="BOL" value={selected.BOL} />
        <DetailItem label="Bid ID" value={selected.BidID} />
        <DetailItem label="Status" value={selected.Status} />
        <DetailItem label="Source" value={selected.SourceYear || selected.SourceList} />
        <DetailItem label="Requestor" value={selected.Requestor} />

        <DetailItem label="Customer" value={selected.Customer} wide />
        <DetailItem label="Freight" value={selected.Freight} />

        <SectionTitle>Route & Schedule</SectionTitle>

        <DetailItem label="Origin" value={selected.Origin} wide />
        <DetailItem label="Destination" value={selected.Destination} wide />

        <DetailItem
          label="Pickup"
          value={formatDateTime(selected.PickupDate, selected.PickupTime, selected.PickupAMPM)}
          wide
        />

        <DetailItem
          label="Delivery"
          value={formatDateTime(selected.DeliveryDate, selected.DeliveryTime, selected.DeliveryAMPM)}
          wide
        />

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

        <DetailItem label="Pickup Contact" value={selected.Pickup1ContactName}>
          <small>{selected.Pickup1ContactNumber || ''}</small>
        </DetailItem>

        <DetailItem
          label="Pickup Time"
          value={formatDateTime(selected.PickupDate, selected.PickupTime, selected.PickupAMPM)}
        />

        <SectionTitle>Delivery</SectionTitle>

        <DetailItem label="Delivery Location" value={selected.Delivery1Name}>
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

        <SectionTitle>Freight Details</SectionTitle>

        <DetailItem label="Total Pieces" value={selected.TotalPieces} />
        <DetailItem label="Weight" value={selected.EstimatedWeight} />
        <DetailItem label="Shipper #" value={selected.ShipperNumber} />
        <DetailItem label="Contract" value={selected.Contract} />

        <DetailItem
          label="Freight Item"
          value={`${selected.Item1QTY || '-'} × ${selected.Item1Description || '-'}`}
          className="full"
        >
          <small>
            Serial: {selected.Item1Serial || '-'} · Dimensions: {selected.Item1Dimensions || '-'}
          </small>
        </DetailItem>
      </div>
    );
  }

  function BillingView() {
    const driverPayDisplay = getDriverPayDisplay(selected);

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
        <DetailItem label="Linehaul Billed" value={formatMoney(selected.LinehaulBilled)} />
        <DetailItem label="Fuel Surcharge Billed" value={formatMoney(selected.FuelSurchargeBilled)} />

        <DetailItem label="Tarping Billed" value={formatMoney(selected.TarpingBilled)} />
        <DetailItem label="Permits/Escort" value={formatMoney(selected.PermitsEscortFees)} />
        <DetailItem label="Additional Charges" value={formatMoney(selected.AdditionalCharges)} />
        <DetailItem label="Tarps Needed" value={selected.NoOfTarpsNeeded} />

        <SectionTitle>Driver Pay Breakdown</SectionTitle>

        <DetailItem label={driverPayDisplay.label} value={driverPayDisplay.value} />
        <DetailItem label="Linehaul Driver Pay" value={formatMoney(selected.LinehaulDriverPay)} />
        <DetailItem label="Fuel Surcharge Driver Pay" value={formatMoney(selected.FuelSurchargeDriverPay)} />
        <DetailItem label="Tarping Driver Pay" value={formatMoney(selected.TarpingDriverPay)} />
        <DetailItem label="Additional Driver Pay" value={formatMoney(selected.AdditionalDriverPay)} />

        <SectionTitle>Processing Status</SectionTitle>

        <DetailItem
          label="Accounting Status"
          value={
            selected.Processed === true ||
            String(selected.Processed).toLowerCase() === 'true'
              ? 'Sent to Accounting'
              : 'Not Settled/Sent'
          }
        />

        <DetailItem
          label="Paperwork Submitted"
          value={
            selected.PpwrkSubmitted
              ? `${formatDateOnly(selected.PpwrkSubmitted)} ${selected.PpwrkSubmittedTime || ''}`.trim()
              : '-'
          }
        />

        <DetailItem label="TMS Name" value={selected.TMSName} />
      </div>
    );
  }

  function DocumentsView() {
    return (
      <div className="detail-grid">
        <SectionTitle>Order Documents</SectionTitle>

        <DocumentCard
          title="BOL"
          description={selected.BOL ? `Open BOL ${selected.BOL}` : 'No BOL number found'}
          buttonText="Open BOL"
          onClick={openBolDocument}
          disabled={!selected.BOL}
          loading={documentLoading === 'bol'}
        />

        <DocumentCard
          title="Dispatch Sheet"
          description={
            selected.BOL
              ? `Open Dispatch Sheet for ${selected.BOL}`
              : 'No BOL number found'
          }
          buttonText="Open Dispatch Sheet"
          onClick={openDispatchSheetDocument}
          disabled={!selected.BOL}
          loading={documentLoading === 'dispatchsheet'}
        />

        <DocumentCard
          title="Load Photos"
          description={
            selected.BOL
              ? `Open Load Photo Folder for ${selected.BOL}`
              : 'No BOL number found'
          }
          buttonText="Open Load Photos"
          onClick={openLoadPhotosFolder}
          disabled={!selected.BOL}
          loading={documentLoading === 'loadphotos'}
        />

        {hasPermitFolder(selected) && (
          <DocumentCard
            title="Permits"
            description={
              selected.BOL && selected.Driver
                ? `Open Permit Folder for ${selected.BOL} (${selected.Driver})`
                : 'BOL number or Operator/Team value missing'
            }
            buttonText="Open Permits"
            onClick={() => openPermitFolder(selected)}
            disabled={!selected.BOL || !selected.Driver}
            loading={documentLoading === 'permits'}
          />
        )}

        <DocumentCard
          title="Final Settle"
          description={
            selected.BOL
              ? `Final Settle Worksheet for ${selected.BOL}`
              : 'No BOL number found'
          }
          buttonText="Open Final Settle"
          onClick={openFinalSettleDocument}
          disabled={!selected.BOL}
          loading={documentLoading === 'finalsettle'}
        />

        {documentError && <div className="msg error full">{documentError}</div>}
      </div>
    );
  }


  function DriverSummaryPreview() {
    if (!driverSummaryReport) return null;

    return (
      <div className="driver-report-preview modal-report-preview">
        <div className="driver-report-title">
          <div>
            <h3>{driverSummaryReport.reportLabel} Driver Summary Report</h3>
            <p>
              Generated: {driverSummaryReport.generatedAt}
            </p>
          </div>
        </div>

        <div className="report-kpi-grid">
          <div className="report-kpi-card">
            <span>Loads</span>
            <strong>{formatReportNumber(driverSummaryReport.totals.loadCount)}</strong>
          </div>
          <div className="report-kpi-card">
            <span>Quoted Total</span>
            <strong>{formatReportMoney(driverSummaryReport.totals.quotedTotal)}</strong>
          </div>
          <div className="report-kpi-card">
            <span>Loaded Miles</span>
            <strong>{formatReportNumber(driverSummaryReport.totals.loadedMiles)}</strong>
          </div>
          <div className="report-kpi-card">
            <span>Empty Miles</span>
            <strong>{formatReportNumber(driverSummaryReport.totals.emptyMiles)}</strong>
          </div>
          <div className="report-kpi-card">
            <span>Revenue / Loaded Mile</span>
            <strong>{formatReportMoney(driverSummaryReport.totals.revenuePerLoadedMile)}</strong>
          </div>
          <div className="report-kpi-card">
            <span>Net Driver Pay</span>
            <strong>{formatReportMoney(driverSummaryReport.totals.driverPay)}</strong>
          </div>
        </div>

        {driverSummaryReport.drivers.length === 0 ? (
          <div className="msg">No Won or TONU loads were found for this report month.</div>
        ) : (
          driverSummaryReport.drivers.map((driver) => (
            <div className="driver-report-section" key={driver.truck}>
              <div className="driver-report-section-header">
                <div>
                  <h4>Truck {driver.truck}</h4>
                  <p>{driver.operator}</p>
                </div>
                <div className="driver-report-section-total">
                  {formatReportMoney(driver.quotedTotal)}
                </div>
              </div>

              <div className="driver-report-totals-grid">
                <div><span>Loads</span><strong>{formatReportNumber(driver.loadCount)}</strong></div>
                <div><span>Empty Miles</span><strong>{formatReportNumber(driver.emptyMiles)}</strong></div>
                <div><span>Loaded Miles</span><strong>{formatReportNumber(driver.loadedMiles)}</strong></div>
                <div><span>$/Loaded Mile</span><strong>{formatReportMoney(driver.revenuePerLoadedMile)}</strong></div>
                <div><span>Net Driver Pay</span><strong>{formatReportMoney(driver.driverPay)}</strong></div>
              </div>

              <div className="report-table-wrap">
                <table className="driver-report-table">
                  <thead>
                    <tr>
                      <th>BOL</th>
                      <th>Company</th>
                      <th>Pickup</th>
                      <th>Delivery</th>
                      <th>Route</th>
                      <th>Deadhead</th>
                      <th>Loaded</th>
                      <th>Quoted</th>
                      <th>$/Mile</th>
                      <th>Driver Pay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {driver.loads.map((load, index) => (
                      <tr
                        key={`${load.BOL || load.id || driver.truck}-${index}`}
                        className={load.id ? 'report-clickable-row' : ''}
                        onClick={() => openReportLoadDetails(load)}
                        title={load.id ? 'Open full order screen' : ''}
                      >
                        <td>{load.BOL || '-'}</td>
                        <td>{load.Customer || '-'}</td>
                        <td>{load.PickupDateDisplay || '-'}</td>
                        <td>{load.DeliveryDateDisplay || '-'}</td>
                        <td>{load.Route || '-'}</td>
                        <td>{formatReportNumber(load.EmptyMiles)}</td>
                        <td>{formatReportNumber(load.LoadedMiles)}</td>
                        <td>{formatReportMoney(load.QuotedTotal)}</td>
                        <td>{formatReportMoney(load.RatePerMile)}</td>
                        <td>{formatReportMoney(load.DriverPay)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </div>
    );
  }


  function SettlementTotalsGrid({ totals }) {
    return (
      <div className="settlement-totals-grid">
        <div><span>Orders</span><strong>{formatReportNumber(totals?.orderCount)}</strong></div>
        <div><span>Drivers</span><strong>{formatReportNumber(totals?.driverCount)}</strong></div>
        <div><span>Customers</span><strong>{formatReportNumber(totals?.customerCount)}</strong></div>
        <div><span>Bid Total</span><strong>{formatReportMoney(totals?.bidTotal)}</strong></div>
        <div><span>Driver Pay</span><strong>{formatReportMoney(totals?.driverPayTotal)}</strong></div>
        <div><span>Margin</span><strong>{formatReportMoney(totals?.margin)}</strong></div>
      </div>
    );
  }

  function SettlementRows({ rows }) {
    if (!rows || rows.length === 0) {
      return <div className="msg">No orders were found for this settlement bucket.</div>;
    }

    return (
      <div className="report-table-wrap">
        <table className="settlement-report-table">
          <thead>
            <tr>
              <th>BOL</th>
              <th>Operator</th>
              <th>Truck</th>
              <th>Customer</th>
              <th>Pickup</th>
              <th>Route</th>
              <th>Submitted</th>
              <th>Bid Amount</th>
              <th>Driver Pay</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((load, index) => (
              <tr
                key={`${load.BOL || load.id || index}-${index}`}
                className={load.id ? 'report-clickable-row' : ''}
                onClick={() => openReportLoadDetails(load)}
                title={load.id ? 'Open full order screen' : ''}
              >
                <td>
                  {load.Starred && <span className="settlement-star">*</span>}
                  {load.BOL || '-'}
                </td>
                <td>{load.Operator || '-'}</td>
                <td>{load.Truck || '-'}</td>
                <td>{load.Customer || '-'}</td>
                <td>{load.PUDateDisplay || '-'}</td>
                <td>{load.Route || [load.OriginST, load.DestST].filter(Boolean).join(' to ') || '-'}</td>
                <td>
                  {[load.SubmitDateDisplay, load.SubmitTimeDisplay].filter(Boolean).join(' ') || '-'}
                </td>
                <td>{formatReportMoney(load.BidAmount)}</td>
                <td>{formatReportMoney(load.DriverPay)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function WeeklySettlementPreview() {
    if (!weeklySettlementReport) return null;

    return (
      <div className="settlement-report-preview modal-report-preview">
        <div className="driver-report-title">
          <div>
            <h3>{weeklySettlementReport.reportLabel}</h3>
            <p>
              Generated: {weeklySettlementReport.generatedAt}
            </p>
                </div>
        </div>

        <div className="settlement-window-note">
          <strong>Main settlement window:</strong> {weeklySettlementReport.mainWindowLabel}
          <br />
          <strong>Likely next week:</strong> {weeklySettlementReport.suggestWindowLabel}
        </div>

        <div className="settlement-report-section">
          <div className="driver-report-section-header">
            <div>
              <h4>Main Settlement</h4>
              <p>Orders submitted after the prior Thursday noon cutoff through the selected cutoff.</p>
            </div>
            <div className="driver-report-section-total">
              {formatReportMoney(weeklySettlementReport.totals?.main?.driverPayTotal)}
            </div>
          </div>

          <SettlementTotalsGrid totals={weeklySettlementReport.totals?.main} />
          <SettlementRows rows={weeklySettlementReport.main} />

          <div className="settlement-footnote">
            * Submitted after the prior cutoff but before the end of that prior cutoff date.
          </div>
        </div>

        <div className="settlement-report-section suggest">
          <div className="driver-report-section-header">
            <div>
              <h4>Likely for Next Week</h4>
              <p>Orders submitted after the selected cutoff but before the end of that same day.</p>
            </div>
            <div className="driver-report-section-total">
              {formatReportMoney(weeklySettlementReport.totals?.suggest?.driverPayTotal)}
            </div>
          </div>

          <SettlementTotalsGrid totals={weeklySettlementReport.totals?.suggest} />
          <SettlementRows rows={weeklySettlementReport.suggest} />
        </div>

        {weeklySettlementReport.counts?.excludedProcessedRecordsMissingSubmissionTimestamp > 0 && (
          <div className="report-alert locked">
            <h4>Some processed orders were skipped.</h4>
            <p>
              {weeklySettlementReport.counts.excludedProcessedRecordsMissingSubmissionTimestamp} processed order(s)
              did not have a usable paperwork submitted date/time.
            </p>
          </div>
        )}
      </div>
    );
  }

  function DriverSummaryReport() {
    const monthOptions = Array.from({ length: 12 }, (_, index) => index + 1);
    const isDriverSummaryOpen = activeReportPanel === 'driverSummary';
    const isWeeklySettlementOpen = activeReportPanel === 'weeklySettlement';

    return (
      <div className="search-card reports-panel">
        <div className="reports-header">
          <div>
            <h2>Reports</h2>
          </div>
        </div>

        <div className="reports-accordion-list">
          <div className={`report-accordion ${isDriverSummaryOpen ? 'open' : ''}`}>
            <button
              type="button"
              className="report-accordion-button"
              onClick={() => toggleReportPanel('driverSummary')}
            >
              <span>Monthly Driver Route Summary</span>
              <span className="report-accordion-icon">{isDriverSummaryOpen ? '▼' : '▶'}</span>
            </button>

            {isDriverSummaryOpen && (
              <div className="report-accordion-body">
                <div className="report-card compact-report-card accordion-inner-card">
                  <div className="report-card-header centered-report-header">
                    <div>
                      <h3>Monthly Driver Route Summary</h3>
                    </div>
                  </div>

                  <div className="report-controls centered-report-controls">
                    <label>
                      <span>Month</span>
                      <select
                        value={reportMonth}
                        onChange={(e) => {
                          setReportMonth(Number(e.target.value));
                          setDriverSummaryReport(null);
                          setDriverSummaryError(null);
                          setDriverSummaryModalOpen(false);
                        }}
                      >
                        {monthOptions.map((month) => (
                          <option key={month} value={month}>
                            {getReportMonthName(month)}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      <span>Year</span>
                      <select
                        value={reportYear}
                        onChange={(e) => {
                          setReportYear(Number(e.target.value));
                          setDriverSummaryReport(null);
                          setDriverSummaryError(null);
                          setDriverSummaryModalOpen(false);
                        }}
                      >
                        {getReportYears().map((year) => (
                          <option key={year} value={year}>
                            {year}
                          </option>
                        ))}
                      </select>
                    </label>

                    <button onClick={loadDriverSummaryReport} disabled={driverSummaryLoading}>
                      {driverSummaryLoading ? 'Loading Report...' : 'Preview Report'}
                    </button>
                  </div>

                  {driverSummaryReport && !driverSummaryModalOpen && (
                    <div className="report-ready-card">
                      <div>
                        <strong>{driverSummaryReport.reportLabel} is ready.</strong>
                        <span> The preview opens in a report window.</span>
                      </div>
                      <button className="view-button" onClick={() => setDriverSummaryModalOpen(true)}>
                        Reopen Preview
                      </button>
                    </div>
                  )}

                  {driverSummaryError && (
                    <div className={`report-alert ${driverSummaryError.code === 'REPORT_LOCKED' ? 'locked' : 'error'}`}>
                      <h4>
                        {driverSummaryError.code === 'REPORT_LOCKED'
                          ? 'This report is not available yet.'
                          : 'Report could not be loaded.'}
                      </h4>
                      <p>{driverSummaryError.message}</p>

                      {driverSummaryError.code === 'REPORT_LOCKED' && (
                        <>
                          <div className="report-alert-grid">
                            <div>
                              <span>Selected report</span>
                              <strong>{driverSummaryError.reportLabel}</strong>
                            </div>
                            <div>
                              <span>Available starting</span>
                              <strong>{driverSummaryError.unlockLabel || '-'}</strong>
                            </div>
                          </div>

                          {driverSummaryError.lockReason && <p>{driverSummaryError.lockReason}</p>}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className={`report-accordion ${isWeeklySettlementOpen ? 'open' : ''}`}>
            <button
              type="button"
              className="report-accordion-button"
              onClick={() => toggleReportPanel('weeklySettlement')}
            >
              <span>Weekly Settlement Report</span>
              <span className="report-accordion-icon">{isWeeklySettlementOpen ? '▼' : '▶'}</span>
            </button>

            {isWeeklySettlementOpen && (
              <div className="report-accordion-body">
                <div className="report-card compact-report-card settlement-report-card accordion-inner-card">
                  <div className="report-card-header centered-report-header">
                    <div>
                      <h3>Weekly Settlement Report</h3>
                    </div>
                  </div>

                  <div className="report-controls centered-report-controls">
                    <label>
                      <span>Cutoff Date</span>
                      <input
                        type="date"
                        value={settlementCutoffDate}
                        onChange={(e) => {
                          setSettlementCutoffDate(e.target.value);
                          setWeeklySettlementReport(null);
                          setWeeklySettlementError(null);
                          setWeeklySettlementModalOpen(false);
                        }}
                      />
                    </label>

                    <button onClick={loadWeeklySettlementReport} disabled={weeklySettlementLoading}>
                      {weeklySettlementLoading ? 'Loading Report...' : 'Preview Report'}
                    </button>
                  </div>

                  {weeklySettlementReport && !weeklySettlementModalOpen && (
                    <div className="report-ready-card">
                      <div>
                        <strong>{weeklySettlementReport.reportLabel} is ready.</strong>
                        <span> The preview opens in a report window.</span>
                      </div>
                      <button className="view-button" onClick={() => setWeeklySettlementModalOpen(true)}>
                        Reopen Preview
                      </button>
                    </div>
                  )}

                  {weeklySettlementError && (
                    <div className="report-alert error">
                      <h4>Report could not be loaded.</h4>
                      <p>{weeklySettlementError.message}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="container">
        <header className="app-header app-header-branded">
  <div className="brand-stack">
    <img
      src={koleLogo}
      alt="Kole Trucking Logo"
      className="brand-logo-large"
    />

    <h1>Kole Connect</h1>

    <p>
      Enter your Kole Connect access token to continue.
    </p>
  </div>
</header>

        <div className="search-card">
          <div className="search-bar">
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setAuthError('');
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              placeholder="Access token"
              autoFocus
            />

            <button
              onClick={handleLogin}
              disabled={!password.trim()}
            >
              Log In
            </button>
          </div>

          {authError && <div className="msg error">{authError}</div>}

          <div className="msg">
            All Information Contained Within is Property of Kole Trucking LLC
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <header className="app-header app-header-branded">
  <div className="brand-stack">
    <img
      src={koleLogo}
      alt="Kole Trucking Logo"
      className="brand-logo-large"
    />

    <h1>Kole Connect</h1>
    <p>
      Search Bid Listing records, review order details,
      and inspect dispatch or billing data.
    </p>
  </div>

  <button className="close-button header-logoff" onClick={handleLogout}>
    Log Off
  </button>
</header>

      <div className="search-card">
        <div className="search-bar">
          <input
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Search BOL, Customer, Driver, Truck..."
          />

          <button onClick={handleSearch} disabled={loading}>
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>

        <div className="search-options">
          <label className="archive-toggle">
            <input
              type="checkbox"
              checked={includeArchives}
              onChange={(e) => {
                setIncludeArchives(e.target.checked);
                setResults([]);
                setSearchedRecords(0);
                setSelected(null);
                setHasSearched(false);
                setError('');
                setStatusFilter('All');
                setDocumentError('');
                setSortField('');
                setSortDirection('asc');
              }}
            />
            <span>Include archive years</span>
          </label>
        </div>

        {hasSearched && !loading && !error && (
          <div className="summary">
            {sortedResults.length} result{sortedResults.length === 1 ? '' : 's'} from {searchedRecords} records
          </div>
        )}

        {showStatusFilter && (
          <div className="filter-bar">
            <span>Status:</span>

            {statusOptions.map((status) => (
              <button
                key={status}
                className={
                  statusFilter === status
                    ? 'filter-button active-filter'
                    : 'filter-button'
                }
                onClick={() => setStatusFilter(status)}
              >
                {status}
              </button>
            ))}
          </div>
        )}

        {loading && <div className="msg">Searching...</div>}
        {loadingDetail && <div className="msg">Loading record details...</div>}
        {error && <div className="msg error">{error}</div>}

        {hasSearched && !loading && !error && results.length === 0 && (
          <div className="msg">No results found</div>
        )}
{!hasSearched && (
  <>
  <div className="search-card operations-panel">
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px' }}>
      <div>
    <h2>Today&apos;s Operations</h2>
        {operationsData?.generatedAt && (
          <p>Generated: {operationsData.generatedAt}</p>
        )}
      </div>

      <button onClick={() => loadOperationsDashboard()} disabled={operationsLoading}>
        {operationsLoading ? 'Refreshing...' : 'Refresh Operations'}
      </button>
    </div>

    {operationsError && <div className="msg error">{operationsError}</div>}
    {operationsLoading && !operationsData && <div className="msg">Loading operations...</div>}

    {operationsData && (
      <>
        <div className="operations-grid">
          <div className="operations-card">
            <span>Active Today</span>
            <strong>{operationsData.counts.activeToday}</strong>
          </div>

          <div className="operations-card">
            <span>Loading Today</span>
            <strong>{operationsData.counts.loadingToday}</strong>
          </div>

          <div className="operations-card">
            <span>Delivering Today</span>
            <strong>{operationsData.counts.deliveringToday}</strong>
          </div>

          <div className="operations-card">
            <span>Loading Next 7 Days</span>
            <strong>{operationsData.counts.loadingNext7}</strong>
          </div>
        </div>

        <div style={{ marginTop: '24px' }}>
          <h3 style={{ marginBottom: '12px' }}>Active Today</h3>

          <div className="operations-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>BOL</th>
                  <th>Driver</th>
                  <th>Origin</th>
                  <th>Destination</th>
                  <th>Delivery</th>
                </tr>
              </thead>

              <tbody>
                {operationsData.activeToday.map((r, i) => (
                  <tr
                    key={`active-${r.id || i}`}
                    onClick={() => loadDetails(r.id, 'basic', r.SourceListId)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td>{r.BOL || '-'}</td>
                    <td>{r.Driver || '-'}</td>
                    <td>{r.Origin || '-'}</td>
                    <td>{r.Destination || '-'}</td>
                    <td>{formatDateOnly(r.DeliveryDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ marginTop: '32px' }}>
          <h3 style={{ marginBottom: '12px' }}>Loading Today</h3>

          {operationsData.loadingToday.length === 0 ? (
            <div className="msg">No loads scheduled to load today.</div>
          ) : (
            <div className="operations-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Picked Up</th>
                    <th>BOL</th>
                    <th>Driver</th>
                    <th>Origin</th>
                    <th>Destination</th>
                    <th>Pickup</th>
                  </tr>
                </thead>

                <tbody>
                  {operationsData.loadingToday.map((r, i) => (
                    <tr
                      key={`loading-${r.id || i}`}
                      onClick={() => loadDetails(r.id, 'basic', r.SourceListId)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>
                        <EvidenceDot hasEvidence={r.hasPickupEvidence} label="Pickup" />
                      </td>
                      <td>{r.BOL || '-'}</td>
                      <td>{r.Driver || '-'}</td>
                      <td>{r.Origin || '-'}</td>
                      <td>{r.Destination || '-'}</td>
                      <td>{formatDateOnly(r.PickupDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ marginTop: '32px' }}>
          <h3 style={{ marginBottom: '12px' }}>Delivering Today</h3>

          {operationsData.deliveringToday.length === 0 ? (
            <div className="msg">No deliveries scheduled today.</div>
          ) : (
            <div className="operations-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Delivered</th>
                    <th>BOL</th>
                    <th>Driver</th>
                    <th>Origin</th>
                    <th>Destination</th>
                    <th>Delivery</th>
                  </tr>
                </thead>

                <tbody>
                  {operationsData.deliveringToday.map((r, i) => (
                    <tr
                      key={`delivering-${r.id || i}`}
                      onClick={() => loadDetails(r.id, 'basic', r.SourceListId)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>
                        <EvidenceDot hasEvidence={r.hasDeliveryEvidence} label="Delivery" />
                      </td>
                      <td>{r.BOL || '-'}</td>
                      <td>{r.Driver || '-'}</td>
                      <td>{r.Origin || '-'}</td>
                      <td>{r.Destination || '-'}</td>
                      <td>{formatDateOnly(r.DeliveryDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ marginTop: '32px' }}>
          <h3 style={{ marginBottom: '12px' }}>Loading Next 7 Days</h3>

          {operationsData.loadingNext7.length === 0 ? (
            <div className="msg">No upcoming loads in the next 7 days.</div>
          ) : (
            <div className="operations-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>BOL</th>
                    <th>Driver</th>
                    <th>Origin</th>
                    <th>Destination</th>
                    <th>Pickup</th>
                  </tr>
                </thead>

                <tbody>
                  {operationsData.loadingNext7.map((r, i) => (
                    <tr
                      key={`next7-${r.id || i}`}
                      onClick={() => loadDetails(r.id, 'basic', r.SourceListId)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>{r.BOL || '-'}</td>
                      <td>{r.Driver || '-'}</td>
                      <td>{r.Origin || '-'}</td>
                      <td>{r.Destination || '-'}</td>
                      <td>{formatDateOnly(r.PickupDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </>
    )}
  </div>

  <DriverSummaryReport />
  </>
)}
      </div>

      <div className="results-panel">
        {sortedResults.length > 0 && (
          <table>
            <thead>
              <tr>
                <SortableHeader field="SourceYear" label="Year" />
                <SortableHeader field="BOL" label="BOL" />
                <SortableHeader field="Customer" label="Customer" />
                <SortableHeader field="Origin" label="Origin" />
                <SortableHeader field="Destination" label="Destination" />
                <SortableHeader field="Driver" label="Driver" />
                <SortableHeader field="Truck" label="Truck" />
                <SortableHeader field="Status" label="Status" />
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {sortedResults.map((r, i) => (
                <tr
                  key={`${r.SourceListId || 'current'}-${r.id || i}`}
                  className={selected?.id === r.id && selected?.SourceListId === r.SourceListId ? 'selected-row' : ''}
                  onClick={() => loadDetails(r.id, 'basic', r.SourceListId)}
                >
                  <td>{r.SourceYear || '-'}</td>
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
                          loadDetails(r.id, 'basic', r.SourceListId);
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
                              loadDetails(r.id, 'dispatch', r.SourceListId);
                            }}
                          >
                            Dispatch
                          </button>

                          <button
                            className="view-button"
                            onClick={(e) => {
                              e.stopPropagation();
                              loadDetails(r.id, 'billing', r.SourceListId);
                            }}
                          >
                            Billing
                          </button>

                          {r.BOL && (
                            <button
                              className="view-button"
                              onClick={(e) => {
                                e.stopPropagation();
                                loadDetails(r.id, 'documents', r.SourceListId);
                              }}
                            >
                              Documents
                            </button>
                          )}

                          {r.BOL && hasPermitFolder(r) && (
                            <button
                              className="view-button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openPermitFolder(r);
                              }}
                              disabled={documentLoading === 'permits'}
                            >
                              {documentLoading === 'permits' ? 'Opening...' : 'Permits'}
                            </button>
                          )}
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

      {driverSummaryModalOpen && driverSummaryReport && (
        <div className="modal-overlay report-modal-overlay" onClick={closeDriverSummaryModal}>
          <div className="detail-modal report-modal" onClick={(e) => e.stopPropagation()}>
            <div className="detail-header report-modal-header">
              <div>
                <h2>{driverSummaryReport.reportLabel} Driver Route Summary</h2>
           
              </div>

              <button className="close-button" onClick={closeDriverSummaryModal}>
                Close
              </button>
            </div>

            <div className="modal-body report-modal-body">
              <DriverSummaryPreview />
            </div>
          </div>
        </div>
      )}

      {weeklySettlementModalOpen && weeklySettlementReport && (
        <div className="modal-overlay report-modal-overlay" onClick={closeWeeklySettlementModal}>
          <div className="detail-modal report-modal" onClick={(e) => e.stopPropagation()}>
            <div className="detail-header report-modal-header">
              <div>
                <h2>{weeklySettlementReport.reportLabel}</h2>
                <p>{weeklySettlementReport.cutoffLabel}</p>
              </div>

              <button className="close-button" onClick={closeWeeklySettlementModal}>
                Close
              </button>
            </div>

            <div className="modal-body report-modal-body">
              <WeeklySettlementPreview />
            </div>
          </div>
        </div>
      )}

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

                  <button
                    className={selectedView === 'documents' ? 'active-tab' : ''}
                    onClick={() => setSelectedView('documents')}
                  >
                    Documents
                  </button>
                </>
              )}
            </div>

            <div className="modal-body">
              {selectedView === 'basic' && <BasicView />}
              {selectedView === 'dispatch' && <DispatchView />}
              {selectedView === 'billing' && <BillingView />}
              {selectedView === 'documents' && <DocumentsView />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}