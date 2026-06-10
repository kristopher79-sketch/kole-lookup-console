import { useEffect, useMemo, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import './App.css';
import koleLogo from './assets/kole-logo.png';

const isTauriRuntime = Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__);
const isViteDev = import.meta.env?.DEV === true;
const configuredApiBase = String(import.meta.env?.VITE_KOLE_API_BASE || '').trim();
const isLocalDevHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);

const API =
  configuredApiBase ||
  ((isViteDev || isLocalDevHost)
    ? 'http://localhost:5000'
    : 'https://kole-lookup-console.onrender.com');

const SALES_NOTE_MAX_LENGTH = 63000;

async function openExternalLink(url) {
  if (!url) return;

  if (isTauriRuntime) {
    try {
      await openUrl(url);
      return;
    } catch (err) {
      console.warn('Tauri link opener failed. Falling back to browser open.', err);
    }
  }

  const openedWindow = window.open(url, '_blank', 'noopener,noreferrer');

  if (!openedWindow) {
    window.location.href = url;
  }
}


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


function getEasternDateInputValue(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function addDaysToDateInput(dateValue, days) {
  const [year, month, day] = String(dateValue || getEasternDateInputValue())
    .split('-')
    .map(Number);

  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);

  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0')
  ].join('-');
}

function formatDateInputLabel(dateValue) {
  if (!dateValue) return '';

  const [year, month, day] = String(dateValue).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (Number.isNaN(date.getTime())) return dateValue;

  return date.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function isTodayOrFutureDateInput(dateValue) {
  return String(dateValue || '') >= getEasternDateInputValue();
}

function clampUploadDigestDate(dateValue) {
  const today = getEasternDateInputValue();
  const value = String(dateValue || today);

  return value > today ? today : value;
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
  const [driverPositionsData, setDriverPositionsData] = useState(null);
  const [driverPositionsLoading, setDriverPositionsLoading] = useState(false);
  const [driverPositionsError, setDriverPositionsError] = useState('');
  const [selectedDriverRoster, setSelectedDriverRoster] = useState(null);
  const [sortField, setSortField] = useState('');
  const [sortDirection, setSortDirection] = useState('asc');
  const initialReportDate = useMemo(() => {
    const date = new Date();
    date.setMonth(date.getMonth() - 1);
    return date;
  }, []);
  const [reportMonth, setReportMonth] = useState(() => initialReportDate.getMonth() + 1);
  const [reportYear, setReportYear] = useState(() => initialReportDate.getFullYear());
  const [grossRevenueYear, setGrossRevenueYear] = useState(() => new Date().getFullYear());
  const [grossRevenueReport, setGrossRevenueReport] = useState(null);
  const [grossRevenueLoading, setGrossRevenueLoading] = useState(false);
  const [grossRevenueError, setGrossRevenueError] = useState(null);
  const [grossRevenueModalOpen, setGrossRevenueModalOpen] = useState(false);
  const [openGrossRevenueQuarters, setOpenGrossRevenueQuarters] = useState([]);
  const [selectedGrossRevenueTruck, setSelectedGrossRevenueTruck] = useState(null);
  const [driverSummaryReport, setDriverSummaryReport] = useState(null);
  const [driverSummaryLoading, setDriverSummaryLoading] = useState(false);
  const [driverSummaryError, setDriverSummaryError] = useState(null);
  const [driverSummaryModalOpen, setDriverSummaryModalOpen] = useState(false);
  const [settlementCutoffDate, setSettlementCutoffDate] = useState(getDefaultSettlementCutoffDate);
  const [ordersDueSettlementReport, setOrdersDueSettlementReport] = useState(null);
  const [ordersDueSettlementLoading, setOrdersDueSettlementLoading] = useState(false);
  const [ordersDueSettlementError, setOrdersDueSettlementError] = useState(null);
  const [ordersDueSettlementModalOpen, setOrdersDueSettlementModalOpen] = useState(false);
  const [weeklySettlementReport, setWeeklySettlementReport] = useState(null);
  const [weeklySettlementLoading, setWeeklySettlementLoading] = useState(false);
  const [weeklySettlementError, setWeeklySettlementError] = useState(null);
  const [weeklySettlementModalOpen, setWeeklySettlementModalOpen] = useState(false);
  const [wonNotRegisteredReport, setWonNotRegisteredReport] = useState(null);
  const [wonNotRegisteredLoading, setWonNotRegisteredLoading] = useState(false);
  const [wonNotRegisteredError, setWonNotRegisteredError] = useState(null);
  const [wonNotRegisteredModalOpen, setWonNotRegisteredModalOpen] = useState(false);
  const [inactiveDriverRosterReport, setInactiveDriverRosterReport] = useState(null);
  const [inactiveDriverRosterLoading, setInactiveDriverRosterLoading] = useState(false);
  const [inactiveDriverRosterError, setInactiveDriverRosterError] = useState(null);
  const [inactiveDriverRosterModalOpen, setInactiveDriverRosterModalOpen] = useState(false);
  const [activeReportPanel, setActiveReportPanel] = useState('');
  const [openReportGroups, setOpenReportGroups] = useState([]);
  const [salesLeadsView, setSalesLeadsView] = useState('all');
  const [salesLeadsSort, setSalesLeadsSort] = useState('name');
  const [salesLeadsReport, setSalesLeadsReport] = useState(null);
  const [salesLeadsLoading, setSalesLeadsLoading] = useState(false);
  const [salesLeadsError, setSalesLeadsError] = useState(null);
  const [salesActivityLookbackDays, setSalesActivityLookbackDays] = useState(7);
  const [salesActivityReport, setSalesActivityReport] = useState(null);
  const [salesActivityModalOpen, setSalesActivityModalOpen] = useState(false);
  const [salesActivityLoading, setSalesActivityLoading] = useState(false);
  const [salesActivityError, setSalesActivityError] = useState(null);
  const [selectedSalesLead, setSelectedSalesLead] = useState(null);
  const [customerLookupLoading, setCustomerLookupLoading] = useState(false);
  const [customerLookupError, setCustomerLookupError] = useState('');
  const [salesSearchReturnLead, setSalesSearchReturnLead] = useState(null);
  const [salesNoteDraft, setSalesNoteDraft] = useState('');
  const [salesNoteSaving, setSalesNoteSaving] = useState(false);
  const [salesNoteMessage, setSalesNoteMessage] = useState('');
  const [salesNoteError, setSalesNoteError] = useState('');

  const [authError, setAuthError] = useState('');
  const [uploadDigestDate, setUploadDigestDate] = useState(getEasternDateInputValue);
  const [uploadDigestData, setUploadDigestData] = useState(null);
  const [uploadDigestLoading, setUploadDigestLoading] = useState(false);
  const [uploadDigestError, setUploadDigestError] = useState('');
  const [uploadDigestActionError, setUploadDigestActionError] = useState('');
  const [uploadDigestOpen, setUploadDigestOpen] = useState(false);
  

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
    const runtimeClass = isTauriRuntime ? 'tauri-runtime' : 'web-runtime';
    document.body.classList.add(runtimeClass);

    return () => document.body.classList.remove(runtimeClass);
  }, []);

  useEffect(() => {
    function handleEsc(e) {
      if (e.key === 'Escape') {
        setSelected(null);
        setGrossRevenueModalOpen(false);
        setSelectedGrossRevenueTruck(null);
        setDriverSummaryModalOpen(false);
        setOrdersDueSettlementModalOpen(false);
        setWeeklySettlementModalOpen(false);
        setWonNotRegisteredModalOpen(false);
        setInactiveDriverRosterModalOpen(false);
        setSalesActivityModalOpen(false);
        setSelectedDriverRoster(null);
        setSelectedSalesLead(null);
      }
    }

    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return undefined;

    loadOperationsDashboard();
    loadDriverPositions();
    loadUploadDigest(uploadDigestDate);

    const interval = window.setInterval(() => {
      loadOperationsDashboard({ silent: true });
      loadDriverPositions({ silent: true });
      loadUploadDigest(uploadDigestDate, { silent: true });
    }, 10 * 60 * 1000);

    return () => window.clearInterval(interval);
  }, [isAuthenticated, accessToken, uploadDigestDate]);

  function toggleSort(field) {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }

    setSortField(field);
    setSortDirection('asc');
    setSelectedSalesLead(null);
    setCustomerLookupError('');
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
    setSalesSearchReturnLead(null);
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

  async function authedFetch(url, options = {}) {
    const res = await fetch(url, {
      cache: 'no-store',
      ...options,
      headers: {
        'X-Lookup-Token': accessToken,
        'Cache-Control': 'no-cache',
        ...(options.headers || {})
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
    setSalesSearchReturnLead(null);
  }

  function clearOrderSearch() {
    setQuery('');
    setResults([]);
    setSearchedRecords(0);
    setSelected(null);
    setHasSearched(false);
    setError('');
    setStatusFilter('All');
    setDocumentError('');
    setSortField('');
    setSortDirection('asc');
    setSalesSearchReturnLead(null);
  }

  function returnToCustomerCard() {
    if (!salesSearchReturnLead) return;

    const customerToRestore = salesSearchReturnLead;

    setQuery('');
    setResults([]);
    setSearchedRecords(0);
    setSelected(null);
    setHasSearched(false);
    setError('');
    setStatusFilter('All');
    setDocumentError('');
    setSortField('');
    setSortDirection('asc');
    setSalesSearchReturnLead(null);
    setSelectedSalesLead(customerToRestore);
    setCustomerLookupError('');
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
    setSalesSearchReturnLead(null);

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

async function loadDriverPositions(options = {}) {
  const { silent = false } = options;

  if (!silent) {
    setDriverPositionsLoading(true);
  }

  setDriverPositionsError('');

  try {
    const res = await authedFetch(
      `${API}/tracking/driver-positions`
    );

    const data = await res.json();

    if (!data.success) {
      throw new Error(data.error || 'Unable to load driver position tracking.');
    }

    setDriverPositionsData(data);
  } catch (err) {
    setDriverPositionsError(err.message);

    if (!silent) {
      setDriverPositionsData(null);
    }
  } finally {
    if (!silent) {
      setDriverPositionsLoading(false);
    }
  }
}

async function loadUploadDigest(dateValue = uploadDigestDate, options = {}) {
  const { silent = false } = options;
  const targetDate = dateValue || getEasternDateInputValue();

  if (!silent) {
    setUploadDigestLoading(true);
  }

  setUploadDigestError('');
  setUploadDigestActionError('');

  try {
    const res = await authedFetch(
      `${API}/upload-digest?date=${encodeURIComponent(targetDate)}`
    );

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Unable to load Upload Digest.');
    }

    setUploadDigestData(data);
  } catch (err) {
    setUploadDigestError(err.message || 'Unable to load Upload Digest.');

    if (!silent) {
      setUploadDigestData(null);
    }
  } finally {
    if (!silent) {
      setUploadDigestLoading(false);
    }
  }
}


function changeUploadDigestDate(days) {
  setUploadDigestDate((current) => clampUploadDigestDate(addDaysToDateInput(current, days)));
}

function resetUploadDigestToToday() {
  setUploadDigestDate(getEasternDateInputValue());
}

async function openUploadDigestLoadPhotos(record) {
  const bol = String(record?.BOLNumber || '').trim();

  if (!bol) {
    setUploadDigestActionError('This Upload Digest row does not have a BOL number.');
    return;
  }

  const loadingKey = `upload-digest-loadphotos-${record?.id || bol}`;

  setDocumentLoading(loadingKey);
  setUploadDigestActionError('');

  try {
    const params = new URLSearchParams({ bol });

    if (record?.CompositeKey) {
      params.set('compositeKey', record.CompositeKey);
    }

    if (record?.DriverName) {
      params.set('driver', record.DriverName);
    }

    if (record?.UploadType) {
      params.set('uploadType', record.UploadType);
    }

    const res = await authedFetch(
      `${API}/documents/loadphotos/by-bol?${params.toString()}`
    );

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Unable to find Load Photos folder.');
    }

    if (!data.webUrl) {
      throw new Error('Load Photos folder was found, but no OneDrive link was returned.');
    }

    await openExternalLink(data.webUrl);
  } catch (err) {
    setUploadDigestActionError(err.message || 'Unable to open Load Photos folder.');
  } finally {
    setDocumentLoading('');
  }
}

function refreshOperationsAndTracking() {
  loadOperationsDashboard();
  loadDriverPositions();
  loadUploadDigest(uploadDigestDate);
}

function closeDriverRosterModal() {
  setSelectedDriverRoster(null);
}

function formatTrackingTimestamp(value) {
  if (!value) return '-';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'numeric',
    day: 'numeric',
    year: '2-digit',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function formatRosterDate(value) {
  if (!value) return '-';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'numeric',
    day: 'numeric',
    year: '2-digit'
  });
}

function formatRosterNumber(value) {
  if (value === null || value === undefined || value === '') return '-';

  const number = Number(value);

  if (Number.isNaN(number)) return value;

  return number.toLocaleString('en-US');
}

function formatPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');

  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }

  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  return value || '-';
}

function formatSpeed(value) {
  const number = Number(value);

  if (Number.isNaN(number)) return '-';

  return `${number.toLocaleString('en-US', { maximumFractionDigits: 0 })} mph`;
}

function getPositionStatusClass(position) {
  if (position?.isStale) return 'tracking-pill stale';
  if (Number(position?.speed || 0) > 0) return 'tracking-pill moving';
  return 'tracking-pill stopped';
}

function getPositionStatusLabel(position) {
  if (position?.isStale) return 'Stale';
  if (Number(position?.speed || 0) > 0) return 'Moving';
  return 'Stopped';
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

      await openExternalLink(data.webUrl);
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

      await openExternalLink(data.webUrl);
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

      await openExternalLink(data.webUrl);
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

      await openExternalLink(data.webUrl);
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

      await openExternalLink(data.webUrl);
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


  function getDefaultGrossRevenueQuarter(reportYear) {
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();

    if (Number(reportYear) !== currentYear) {
      return 'Q1';
    }

    return `Q${Math.floor(currentDate.getMonth() / 3) + 1}`;
  }

  function toggleGrossRevenueQuarter(quarterLabel) {
    setOpenGrossRevenueQuarters((current) => (
      current.includes(quarterLabel)
        ? current.filter((label) => label !== quarterLabel)
        : [...current, quarterLabel]
    ));
  }


  async function loadGrossRevenueReport() {
    const selectedYear = Number(grossRevenueYear);

    setGrossRevenueLoading(true);
    setGrossRevenueError(null);
    setGrossRevenueReport(null);
    setGrossRevenueModalOpen(false);
    setSelectedGrossRevenueTruck(null);

    try {
      const res = await authedFetch(
        `${API}/reports/gross-revenue-totals?year=${encodeURIComponent(selectedYear)}`
      );

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || 'Unable to load Gross Revenue Totals.');
      }

      setGrossRevenueReport(data);
      setOpenGrossRevenueQuarters([getDefaultGrossRevenueQuarter(selectedYear)]);
      setGrossRevenueModalOpen(true);
    } catch (err) {
      setGrossRevenueError({
        code: 'REPORT_ERROR',
        message: err.message || 'Unable to load Gross Revenue Totals.'
      });
    } finally {
      setGrossRevenueLoading(false);
    }
  }

  function closeGrossRevenueModal() {
    setGrossRevenueModalOpen(false);
    setSelectedGrossRevenueTruck(null);
  }

  function closeGrossRevenueTruckModal() {
    setSelectedGrossRevenueTruck(null);
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


  async function loadOrdersDueSettlementReport() {
    setOrdersDueSettlementLoading(true);
    setOrdersDueSettlementError(null);
    setOrdersDueSettlementReport(null);
    setOrdersDueSettlementModalOpen(false);

    try {
      const res = await authedFetch(
        `${API}/reports/orders-due-for-settlement`
      );

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || 'Unable to load Orders Due for Settlement.');
      }

      setOrdersDueSettlementReport(data);
      setOrdersDueSettlementModalOpen(true);
    } catch (err) {
      setOrdersDueSettlementError({
        code: 'REPORT_ERROR',
        message: err.message || 'Unable to load Orders Due for Settlement.'
      });
    } finally {
      setOrdersDueSettlementLoading(false);
    }
  }

  function closeOrdersDueSettlementModal() {
    setOrdersDueSettlementModalOpen(false);
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

  async function loadWonNotRegisteredReport() {
    setWonNotRegisteredLoading(true);
    setWonNotRegisteredError(null);
    setWonNotRegisteredReport(null);
    setWonNotRegisteredModalOpen(false);

    try {
      const res = await authedFetch(
        `${API}/reports/won-not-registered`
      );

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || 'Unable to load Orders Won and Not Registered report.');
      }

      setWonNotRegisteredReport(data);
      setWonNotRegisteredModalOpen(true);
    } catch (err) {
      setWonNotRegisteredError({
        code: 'REPORT_ERROR',
        message: err.message || 'Unable to load Orders Won and Not Registered report.'
      });
    } finally {
      setWonNotRegisteredLoading(false);
    }
  }

  function closeWonNotRegisteredModal() {
    setWonNotRegisteredModalOpen(false);
  }

  async function loadInactiveDriverRosterReport() {
    setInactiveDriverRosterLoading(true);
    setInactiveDriverRosterError(null);
    setInactiveDriverRosterReport(null);
    setInactiveDriverRosterModalOpen(false);

    try {
      const res = await authedFetch(
        `${API}/reports/inactive-driver-roster`
      );

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || 'Unable to load Inactive Driver Roster.');
      }

      setInactiveDriverRosterReport(data);
      setInactiveDriverRosterModalOpen(true);
    } catch (err) {
      setInactiveDriverRosterError({
        code: 'REPORT_ERROR',
        message: err.message || 'Unable to load Inactive Driver Roster.'
      });
    } finally {
      setInactiveDriverRosterLoading(false);
    }
  }

  function closeInactiveDriverRosterModal() {
    setInactiveDriverRosterModalOpen(false);
  }


  const salesLeadViewOptions = [
    { value: 'all', label: 'Total Customers', summaryKey: 'total', defaultSort: 'name' },
    { value: 'converted', label: 'Converted', summaryKey: 'converted', defaultSort: 'wins' },
    { value: 'unconverted', label: 'Unconverted', summaryKey: 'unconverted', defaultSort: 'quotes' },
    { value: 'followUpDue', label: 'Follow-up Due', summaryKey: 'followUpDue', defaultSort: 'followUp' },
    { value: 'aviation', label: 'Aviation', summaryKey: 'aviation', defaultSort: 'quotes' },
    { value: 'suppressed', label: 'Suppressed / Ignored', summaryKey: 'suppressed', defaultSort: 'name' }
  ];

  function toggleReportGroup(groupName) {
    setOpenReportGroups((current) => (
      current.includes(groupName)
        ? current.filter((name) => name !== groupName)
        : [...current, groupName]
    ));
  }

  function isReportGroupOpen(groupName) {
    return openReportGroups.includes(groupName);
  }

  function getSalesLeadViewLabel(view = salesLeadsView) {
    return salesLeadViewOptions.find((option) => option.value === view)?.label || 'Customer Cards';
  }

  function getDefaultSalesLeadSort(view = salesLeadsView) {
    return salesLeadViewOptions.find((option) => option.value === view)?.defaultSort || 'name';
  }

  function normalizeSalesLeadDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 10);
  }

  function isPlaceholderSalesDate(value) {
    const normalized = normalizeSalesLeadDate(value);
    return normalized >= '2099-01-01';
  }

  function formatSalesDate(value) {
    if (!value || isPlaceholderSalesDate(value)) return '-';
    return formatDateOnly(value);
  }

  function truncateSalesText(value, maxLength = 170) {
    const clean = String(value || '').replace(/\s+/g, ' ').trim();

    if (clean.length <= maxLength) return clean;

    return `${clean.slice(0, maxLength - 1).trim()}…`;
  }

  function formatSalesActivityLabel(value) {
    return value || '-';
  }

  function formatSalesActivityDate(value) {
    return formatSalesDate(value);
  }

  function formatPercent(value) {
    const number = Number(value || 0);
    return `${(number * 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
  }

  function getSalesLeadStatusClass(status) {
    const s = String(status || '').toLowerCase();
    if (s === 'converted') return 'sales-status converted';
    if (s === 'unconverted') return 'sales-status unconverted';
    if (s === 'ignore') return 'sales-status ignored';
    if (s === 'inactive') return 'sales-status inactive';
    return 'sales-status';
  }

  function normalizeSalesLeadText(value) {
    return String(value || '').trim().toLowerCase();
  }

  function filterSalesLeadRecords(records, view = 'all') {
    const normalized = normalizeSalesLeadText(view);

    if (normalized === 'converted') {
      return records.filter((record) => normalizeSalesLeadText(record.Status) === 'converted');
    }

    if (normalized === 'unconverted') {
      return records.filter((record) => normalizeSalesLeadText(record.Status) === 'unconverted');
    }

    if (normalized === 'followupdue' || normalized === 'follow-up due') {
      return records.filter((record) => record.FollowUpDue === true);
    }

    if (normalized === 'aviation') {
      return records.filter((record) => record.AviationRelated === true);
    }

    if (normalized === 'suppressed') {
      return records.filter((record) => (
        normalizeSalesLeadText(record.FollowUpHandling) === 'suppressed' ||
        normalizeSalesLeadText(record.Status) === 'ignore' ||
        normalizeSalesLeadText(record.Status) === 'inactive'
      ));
    }

    return records;
  }

  function sortSalesLeadRecords(records, sortMode = 'name') {
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
        const aDate = normalizeSalesLeadDate(a.NextTouchDate) || '9999-12-31';
        const bDate = normalizeSalesLeadDate(b.NextTouchDate) || '9999-12-31';
        const diff = aDate.localeCompare(bDate);
        if (diff !== 0) return diff;
      }

      return String(a.CompanyName || '').localeCompare(String(b.CompanyName || ''));
    });

    return sorted;
  }

  async function loadSalesLeadsReport() {
    setSalesLeadsLoading(true);
    setSalesLeadsError(null);

    try {
      // Heavy Graph poll happens here only. Filters/sorts are local after this returns.
      const params = new URLSearchParams({ view: 'all', sort: 'name' });
      const res = await authedFetch(`${API}/reports/sales-leads?${params.toString()}`);
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || 'Unable to load Sales Leads.');
      }

      setSalesLeadsReport({
        ...data,
        view: 'all',
        sort: 'name'
      });
    } catch (err) {
      setSalesLeadsError({
        code: 'REPORT_ERROR',
        message: err.message || 'Unable to load Sales Leads.'
      });
    } finally {
      setSalesLeadsLoading(false);
    }
  }

  async function loadSalesActivityReport() {
    setSalesActivityLoading(true);
    setSalesActivityError(null);
    setSalesActivityReport(null);
    setSalesActivityModalOpen(false);

    try {
      const params = new URLSearchParams({ days: String(salesActivityLookbackDays) });
      const res = await authedFetch(`${API}/reports/sales-activity?${params.toString()}`);
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || 'Unable to load Sales Activity Snapshot.');
      }

      setSalesActivityReport(data);
      setSalesActivityModalOpen(true);
    } catch (err) {
      setSalesActivityError({
        code: 'REPORT_ERROR',
        message: err.message || 'Unable to load Sales Activity Snapshot.'
      });
    } finally {
      setSalesActivityLoading(false);
    }
  }

  function closeSalesActivityModal() {
    setSalesActivityModalOpen(false);
  }

  async function openCustomerCardForName(customerName, customerCode = '') {
    const cleanName = String(customerName || '').trim();
    const cleanCode = String(customerCode || '').trim();

    if (!cleanName && !cleanCode) {
      setCustomerLookupError('This order does not have a customer name or customer code to match.');
      return;
    }

    setCustomerLookupLoading(true);
    setCustomerLookupError('');

    try {
      const params = new URLSearchParams();
      if (cleanName) params.set('customer', cleanName);
      if (cleanCode) params.set('customerCode', cleanCode);
      const res = await authedFetch(`${API}/sales-leads/by-customer?${params.toString()}`);
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || 'Unable to lookup customer card.');
      }

      if (!data.matches || data.matches.length === 0) {
        throw new Error(`No Sales Leads customer card matched ${cleanName}.`);
      }

      setSelectedSalesLead(data.matches[0]);
      setSalesNoteDraft('');
      setSalesNoteMessage('');
      setSalesNoteError('');
    } catch (err) {
      setCustomerLookupError(err.message || 'Unable to lookup customer card.');
    } finally {
      setCustomerLookupLoading(false);
    }
  }

  async function loadCustomerYearOrders(lead, yearDetail) {
    const customerCode = String(lead?.CustomerCode || '').trim();
    const year = Number(yearDetail?.year || 0);

    if (!customerCode || !year) {
      setCustomerLookupError('This customer/year row does not have enough information to search orders.');
      return;
    }

    setSelectedSalesLead(null);
    setSalesSearchReturnLead(lead);
    setLoading(true);
    setError('');
    setCustomerLookupError('');
    setHasSearched(true);
    setSelected(null);
    setSelectedView('basic');
    setStatusFilter('All');
    setDocumentError('');
    setSortField('');
    setSortDirection('asc');
    window.scrollTo({ top: 0, behavior: 'smooth' });

    try {
      const params = new URLSearchParams({
        customerCode,
        year: String(year)
      });

      const res = await authedFetch(`${API}/reports/sales-leads/orders?${params.toString()}`);
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || 'Unable to load customer orders for that year.');
      }

      setQuery(`${lead.CompanyName || customerCode} - ${year}`);
      setResults(data.results || []);
      setSearchedRecords(data.searchedRecords || (data.results || []).length || 0);
    } catch (err) {
      setError(err.message || 'Unable to load customer orders for that year.');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  async function submitSalesLeadNote() {
    if (!selectedSalesLead) return;

    const note = salesNoteDraft.trim();

    if (!selectedSalesLead.CustomerCode) {
      setSalesNoteError('This customer card does not have a Customer Code, so a note cannot be saved.');
      return;
    }

    if (!note) {
      setSalesNoteError('Enter a note before saving.');
      return;
    }

    if (note.length > SALES_NOTE_MAX_LENGTH) {
      setSalesNoteError(`Sales note is too long. Limit notes to ${SALES_NOTE_MAX_LENGTH.toLocaleString('en-US')} characters.`);
      return;
    }

    setSalesNoteSaving(true);
    setSalesNoteError('');
    setSalesNoteMessage('');

    try {
      const res = await authedFetch(`${API}/sales-leads/notes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          customerCode: selectedSalesLead.CustomerCode,
          customerName: selectedSalesLead.CompanyName,
          note
        })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || 'Unable to save sales note.');
      }

      setSalesNoteDraft('');
      setSalesNoteMessage(data.message || 'Sales note added. Refresh the Sales Leads customer cards to see it in the log.');
    } catch (err) {
      setSalesNoteError(err.message || 'Unable to save sales note.');
    } finally {
      setSalesNoteSaving(false);
    }
  }

  function openSalesLeadCard(lead) {
    setSelectedSalesLead(lead);
    setCustomerLookupError('');
    setSalesNoteDraft('');
    setSalesNoteMessage('');
    setSalesNoteError('');
  }

  function closeSalesLeadModal() {
    setSelectedSalesLead(null);
    setSalesNoteDraft('');
    setSalesNoteMessage('');
    setSalesNoteError('');
  }

  function openRosterFromReport(roster) {
    if (!roster) return;

    setSelectedDriverRoster({
      id: roster.id || '',
      equipmentId: roster.truck || '',
      driverName: roster.tmsName || roster.operatorTeamName || '',
      currentCityState: 'Inactive Driver',
      positionTimeUtc: '',
      speed: 0,
      isMoving: false,
      isStale: false,
      hasRosterDetails: true,
      rosterModalTitle: 'Inactive Driver Roster',
      rosterModalSubtitle: `${roster.tmsName || roster.operatorTeamName || 'Driver'} · Truck ${roster.truck || '-'}`,
      roster
    });
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

  function OperationStatusPill({ record }) {
    const settled = record?.IsSettled || record?.IsProcessed;

    return (
      <span className={`operation-status-pill ${settled ? 'settled' : 'open'}`}>
        {settled ? 'Settled' : 'Open'}
      </span>
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

        <DetailItem label="Customer" value={selected.Customer} wide>
          <button
            type="button"
            className="view-button customer-card-button"
            onClick={() => openCustomerCardForName(selected.Customer, selected.CustomerCode)}
            disabled={!selected.Customer || customerLookupLoading}
          >
            {customerLookupLoading ? 'Looking up...' : 'View Customer Card'}
          </button>
          {customerLookupError && <small className="inline-error">{customerLookupError}</small>}
        </DetailItem>
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



  function getLoadMonthNumber(value) {
    if (!value) return null;

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;

    return date.getUTCMonth() + 1;
  }

  function getTruckMonthLoadCount(truck, monthNumber) {
    const directCount = Number(truck?.monthLoadCounts?.[monthNumber] || 0);
    if (directCount) return directCount;

    return (truck?.loads || []).filter((load) => getLoadMonthNumber(load.PickupDate) === Number(monthNumber)).length;
  }

  function getTruckQuarterTotal(truck, quarterMonths) {
    return quarterMonths.reduce((sum, month) => sum + Number(truck?.monthTotals?.[month.month] || 0), 0);
  }

  function getTruckQuarterLoadCount(truck, quarterMonths) {
    return quarterMonths.reduce((sum, month) => sum + getTruckMonthLoadCount(truck, month.month), 0);
  }

  function isGrossRevenueDriverTermed(truck) {
    const status = String(truck?.rosterStatus || '').trim().toLowerCase();

    return Boolean(truck?.rosterTermDate || (status && status !== 'active'));
  }

  function GrossRevenueDriverPill({ truck }) {
    const status = String(truck?.rosterStatus || '').trim();
    const normalizedStatus = status.toLowerCase();
    const termDate = truck?.rosterTermDate;

    if (termDate) {
      return <span className="gross-driver-status-pill inactive">Termed {formatDateOnly(termDate)}</span>;
    }

    if (status && normalizedStatus !== 'active') {
      return <span className="gross-driver-status-pill inactive">{status}</span>;
    }

    return null;
  }

  function GrossRevenueTotalsPreview() {
    if (!grossRevenueReport) return null;

    const months = grossRevenueReport.months || [];
    const trucks = grossRevenueReport.trucks || [];
    const monthlyTotals = grossRevenueReport.totals?.monthlyTotals || {};
    const monthlyLoadCounts = grossRevenueReport.totals?.monthlyLoadCounts || {};
    const quarterGroups = [
      { label: 'Q1', months: months.filter((month) => [1, 2, 3].includes(Number(month.month))) },
      { label: 'Q2', months: months.filter((month) => [4, 5, 6].includes(Number(month.month))) },
      { label: 'Q3', months: months.filter((month) => [7, 8, 9].includes(Number(month.month))) },
      { label: 'Q4', months: months.filter((month) => [10, 11, 12].includes(Number(month.month))) }
    ].filter((quarter) => quarter.months.length > 0);

    function getQuarterTotalFromMonthlyTotals(quarterMonths) {
      return quarterMonths.reduce((sum, month) => sum + Number(monthlyTotals[month.month] || 0), 0);
    }

    function getQuarterLoadCountFromMonthlyCounts(quarterMonths) {
      return quarterMonths.reduce((sum, month) => sum + Number(monthlyLoadCounts[month.month] || 0), 0);
    }

    return (
      <div className="driver-report-preview modal-report-preview gross-revenue-preview">
        <div className="driver-report-generated">
          Generated: {grossRevenueReport.generatedAt}
        </div>

        <div className="report-kpi-grid gross-revenue-kpi-grid">
          <div className="report-kpi-card">
            <span>Gross Revenue</span>
            <strong>{formatReportMoney(grossRevenueReport.totals?.totalGrossRevenue)}</strong>
          </div>
          <div className="report-kpi-card">
            <span>Loads</span>
            <strong>{formatReportNumber(grossRevenueReport.totals?.loadCount)}</strong>
          </div>
          <div className="report-kpi-card">
            <span>Permits/Escorts Excluded</span>
            <strong>{formatReportMoney(grossRevenueReport.totals?.totalPermitEscortExcluded)}</strong>
          </div>
          <div className="report-kpi-card">
            <span>Avg Rev / Month</span>
            <strong>{formatReportMoney(grossRevenueReport.totals?.averageActiveMonthRevenue ?? grossRevenueReport.totals?.averageMonthlyRevenue)}</strong>
            <small>{formatReportNumber(grossRevenueReport.totals?.monthsElapsed || 12)} month basis</small>
          </div>
        </div>

        {trucks.length === 0 ? (
          <div className="msg">No Won or TONU loads were found for this year.</div>
        ) : (
          <div className="gross-revenue-quarter-stack">
            {quarterGroups.map((quarter) => {
              const isOpen = openGrossRevenueQuarters.includes(quarter.label);
              const quarterTotal = getQuarterTotalFromMonthlyTotals(quarter.months);
              const quarterLoadCount = getQuarterLoadCountFromMonthlyCounts(quarter.months);
              const displayedTrucks = trucks.filter((truck) => {
                const truckQuarterTotal = getTruckQuarterTotal(truck, quarter.months);

                return truckQuarterTotal > 0 || !isGrossRevenueDriverTermed(truck);
              });

              return (
                <section className="gross-revenue-quarter-card" key={quarter.label}>
                  <button
                    type="button"
                    className="gross-revenue-quarter-header"
                    onClick={() => toggleGrossRevenueQuarter(quarter.label)}
                    aria-expanded={isOpen}
                  >
                    <div className="gross-revenue-quarter-title">
                      <span className={`quarter-caret ${isOpen ? 'open' : ''}`}>▸</span>
                      <div>
                        <h3>{quarter.label}</h3>
                        <p>{quarter.months.map((month) => month.shortName || month.name).join(' / ')}</p>
                      </div>
                    </div>
                    <div className="gross-revenue-quarter-total">
                      <span>Quarter Total</span>
                      <strong>{formatReportMoney(quarterTotal)}</strong>
                      <small>{formatReportNumber(quarterLoadCount)} load{quarterLoadCount === 1 ? '' : 's'}</small>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="report-table-wrap gross-revenue-quarter-table-wrap">
                      <table className="driver-report-table gross-revenue-quarter-table">
                        <thead>
                          <tr>
                            <th>Truck</th>
                            <th>Operator</th>
                            {quarter.months.map((month) => (
                              <th key={month.month}>{month.shortName || month.name}</th>
                            ))}
                            <th>{quarter.label} Total</th>
                            <th>Year Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="report-total-row">
                            <td></td>
                            <td>Grand Total / Month</td>
                            {quarter.months.map((month) => (
                              <td key={month.month}>{formatReportMoney(monthlyTotals[month.month])}</td>
                            ))}
                            <td>{formatReportMoney(quarterTotal)}</td>
                            <td>{formatReportMoney(grossRevenueReport.totals?.totalGrossRevenue)}</td>
                          </tr>

                          {displayedTrucks.length === 0 ? (
                            <tr>
                              <td colSpan={quarter.months.length + 4}>No active or revenue-producing drivers were found in this quarter.</td>
                            </tr>
                          ) : displayedTrucks.map((truck) => {
                            const truckQuarterTotal = getTruckQuarterTotal(truck, quarter.months);
                            const truckQuarterLoads = getTruckQuarterLoadCount(truck, quarter.months);
                            const isZeroQuarter = truckQuarterTotal === 0;

                            return (
                              <tr
                                key={`${quarter.label}-${truck.truck}`}
                                className={`gross-revenue-driver-row ${isZeroQuarter ? 'gross-revenue-zero-row' : ''}`}
                                role="button"
                                tabIndex={0}
                                onClick={() => setSelectedGrossRevenueTruck(truck)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    setSelectedGrossRevenueTruck(truck);
                                  }
                                }}
                                aria-label={`Open 12-month revenue detail for ${truck.operator || 'driver'} truck ${truck.truck || ''}`}
                              >
                                <td>{truck.truck || '-'}</td>
                                <td>
                                  <button
                                    type="button"
                                    className="table-link-button gross-driver-link"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedGrossRevenueTruck(truck);
                                    }}
                                  >
                                    {truck.operator || '-'}
                                  </button>
                                  <GrossRevenueDriverPill truck={truck} />
                                </td>
                                {quarter.months.map((month) => (
                                  <td key={`${quarter.label}-${truck.truck}-${month.month}`}>
                                    {formatReportMoney(truck.monthTotals?.[month.month])}
                                  </td>
                                ))}
                                <td>
                                  {formatReportMoney(truckQuarterTotal)}
                                  <small className="gross-load-count-note">{formatReportNumber(truckQuarterLoads)} load{truckQuarterLoads === 1 ? '' : 's'}</small>
                                </td>
                                <td>{formatReportMoney(truck.totalGrossRevenue)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  function GrossRevenueDriverDetailModal() {
    if (!grossRevenueReport || !selectedGrossRevenueTruck) return null;

    const truck = selectedGrossRevenueTruck;
    const months = grossRevenueReport.months || [];
    const monthsWithRevenue = Number(truck.monthsWithRevenue || 0);
    const monthsElapsed = Number(truck.monthsElapsed || grossRevenueReport.totals?.monthsElapsed || 12);
    const [currentEasternYear, currentEasternMonth] = getEasternDateInputValue().split('-').map(Number);
    const shouldHighlightCurrentMonth =
      Number(grossRevenueReport.year) === currentEasternYear && !isGrossRevenueDriverTermed(truck);

    return (
      <div className="modal-overlay report-modal-overlay nested-report-modal-overlay" onClick={closeGrossRevenueTruckModal}>
        <div className="detail-modal report-modal gross-driver-detail-modal" onClick={(e) => e.stopPropagation()}>
          <div className="detail-header report-modal-header">
            <div>
              <h2>{truck.operator || 'Driver Revenue Detail'}</h2>
              <p>12-Month Revenue Detail · Truck {truck.truck || '-'} · {grossRevenueReport.year}</p>
            </div>

            <button className="close-button" onClick={closeGrossRevenueTruckModal}>
              Close
            </button>
          </div>

          <div className="modal-body report-modal-body">
            <div className="report-kpi-grid gross-driver-kpi-grid">
              <div className="report-kpi-card">
                <span>Year Total</span>
                <strong>{formatReportMoney(truck.totalGrossRevenue)}</strong>
              </div>
              <div className="report-kpi-card">
                <span>Loads</span>
                <strong>{formatReportNumber(truck.loadCount)}</strong>
              </div>
              <div className="report-kpi-card">
                <span>Avg Rev / Month</span>
                <strong>{formatReportMoney(truck.averageActiveMonthRevenue ?? truck.averageMonthlyRevenue)}</strong>
                <small>{formatReportNumber(monthsElapsed)} month basis</small>
              </div>
              <div className="report-kpi-card">
                <span>Revenue Months</span>
                <strong>{formatReportNumber(monthsWithRevenue)} / 12</strong>
              </div>
              <div className="report-kpi-card">
                <span>Roster Status</span>
                <strong>{truck.rosterTermDate ? `Termed ${formatDateOnly(truck.rosterTermDate)}` : (truck.rosterStatus || 'Not Matched')}</strong>
              </div>
            </div>

            <div className="gross-driver-month-grid">
              {months.map((month) => {
                const revenue = Number(truck.monthTotals?.[month.month] || 0);
                const loadCount = getTruckMonthLoadCount(truck, month.month);

                const isCurrentMonth = shouldHighlightCurrentMonth && Number(month.month) === currentEasternMonth;

                return (
                  <div
                    key={`driver-month-${truck.truck}-${month.month}`}
                    className={`gross-driver-month-card ${revenue === 0 ? 'zero' : ''} ${isCurrentMonth ? 'current-month' : ''}`}
                  >
                    <span>{month.name}</span>
                    {isCurrentMonth && <em>Current Month</em>}
                    <strong>{formatReportMoney(revenue)}</strong>
                    <small>{formatReportNumber(loadCount)} load{loadCount === 1 ? '' : 's'}</small>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  function DriverSummaryPreview() {
    if (!driverSummaryReport) return null;

    return (
      <div className="driver-report-preview modal-report-preview">
        <div className="driver-report-generated">
          Generated: {driverSummaryReport.generatedAt}
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
            <span>Rev / Load Mile</span>
            <strong>{formatReportMoney(driverSummaryReport.totals.revenuePerLoadedMile)}</strong>
          </div>
          <div className="report-kpi-card">
            <span>Revenue / All Miles</span>
            <strong>{formatReportMoney(driverSummaryReport.totals.revenuePerTotalMile)}</strong>
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
                <div><span>$/Load Mile</span><strong>{formatReportMoney(driver.revenuePerLoadedMile)}</strong></div>
                <div><span>$/All Miles</span><strong>{formatReportMoney(driver.revenuePerTotalMile)}</strong></div>
                <div><span>Net Driver Pay</span><strong>{formatReportMoney(driver.driverPay)}</strong></div>
              </div>

              <div className="report-table-wrap">
                <table className="driver-report-table">
                  <thead>
                    <tr>
                      <th>BOL</th>
                      <th>Company</th>
                      <th>Pickup</th>
                      <th>Route</th>
                      <th>Deadhead</th>
                      <th>Loaded</th>
                      <th>Quoted</th>
                      <th>$/Ld Mile</th>
                      <th>$/All Miles</th>
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
                        <td>{load.Route || '-'}</td>
                        <td>{formatReportNumber(load.EmptyMiles)}</td>
                        <td>{formatReportNumber(load.LoadedMiles)}</td>
                        <td>{formatReportMoney(load.QuotedTotal)}</td>
                        <td>{formatReportMoney(load.RatePerLoadedMile ?? load.RatePerMile)}</td>
                        <td>{formatReportMoney(load.RatePerAllMiles)}</td>
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


  function OrdersDueSettlementPreview() {
    const rows = ordersDueSettlementReport?.rows || [];

    if (!ordersDueSettlementReport) return null;

    return (
      <div className="settlement-report-preview modal-report-preview">
        <div className="driver-report-generated">
          Generated: {ordersDueSettlementReport.generatedAt}
        </div>

        <div className="report-kpi-grid won-not-registered-kpi-grid">
          <div className="report-kpi-card">
            <span>Orders Due</span>
            <strong>{formatReportNumber(ordersDueSettlementReport.count)}</strong>
          </div>
          <div className="report-kpi-card">
            <span>Bid Total</span>
            <strong>{formatReportMoney(ordersDueSettlementReport.totals?.bidTotal)}</strong>
          </div>
          <div className="report-kpi-card">
            <span>Driver Pay</span>
            <strong>{formatReportMoney(ordersDueSettlementReport.totals?.driverPayTotal)}</strong>
          </div>
          <div className="report-kpi-card">
            <span>Source</span>
            <strong>{ordersDueSettlementReport.dataSource || 'Bid Listing'}</strong>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="msg">No delivered Won or TONU orders are currently due for settlement.</div>
        ) : (
          <div className="report-table-wrap">
            <table className="settlement-report-table orders-due-settlement-table">
              <thead>
                <tr>
                  <th>BOL</th>
                  <th>Operator</th>
                  <th>Truck</th>
                  <th>Customer</th>
                  <th>Delivery</th>
                  <th>Route</th>
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
                    <td>{load.BOL || '-'}</td>
                    <td>{load.Operator || '-'}</td>
                    <td>{load.Truck || '-'}</td>
                    <td>{load.Customer || '-'}</td>
                    <td>{load.DeliveryDateDisplay || formatDateOnly(load.DeliveryDate)}</td>
                    <td>{load.Route || [load.OriginST, load.DestST].filter(Boolean).join(' to ') || '-'}</td>
                    <td>{formatReportMoney(load.BidAmount)}</td>
                    <td>{formatReportMoney(load.DriverPay)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  function WeeklySettlementPreview() {
    if (!weeklySettlementReport) return null;

    return (
      <div className="settlement-report-preview modal-report-preview">
        <div className="driver-report-title">
          <div>
       
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


  function WonNotRegisteredPreview() {
    const rows = wonNotRegisteredReport?.rows || [];

    if (!wonNotRegisteredReport) return null;

    return (
      <div className="driver-report-preview modal-report-preview">
        <div className="driver-report-generated">
          Generated: {wonNotRegisteredReport.generatedAt}
        </div>

        <div className="report-kpi-grid won-not-registered-kpi-grid">
          <div className="report-kpi-card">
            <span>Open Orders</span>
            <strong>{formatReportNumber(wonNotRegisteredReport.count)}</strong>
          </div>
          <div className="report-kpi-card">
            <span>Source</span>
            <strong>{wonNotRegisteredReport.dataSource || 'Bid Listing'}</strong>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="msg">No won orders are currently missing a BOL number.</div>
        ) : (
          <div className="report-table-wrap">
            <table className="driver-report-table won-not-registered-table">
              <thead>
                <tr>
                  <th>Bid ID</th>
                  <th>Company</th>
                  <th>Operator/Team</th>
                  <th>Pickup Date</th>
                  <th>Origin</th>
                  <th>Destination</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((load, index) => (
                  <tr
                    key={`${load.BidID || load.id || index}-${index}`}
                    className={load.id ? 'report-clickable-row' : ''}
                    onClick={() => loadDetails(load.id, 'basic', load.SourceListId)}
                    title={load.id ? 'Open full order screen' : ''}
                  >
                    <td>{load.BidID || '-'}</td>
                    <td>{load.Customer || '-'}</td>
                    <td>{load.Driver || '-'}</td>
                    <td>{load.PickupDateDisplay || formatDateOnly(load.PickupDate)}</td>
                    <td>{load.Origin || '-'}</td>
                    <td>{load.Destination || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }


  function InactiveDriverRosterPreview() {
    const rows = inactiveDriverRosterReport?.rows || [];

    if (!inactiveDriverRosterReport) return null;

    return (
      <div className="driver-report-preview modal-report-preview">
        <div className="driver-report-generated">
          Generated: {inactiveDriverRosterReport.generatedAt}
        </div>

        <div className="report-kpi-grid inactive-driver-roster-kpi-grid">
          <div className="report-kpi-card">
            <span>Inactive Drivers</span>
            <strong>{formatReportNumber(inactiveDriverRosterReport.count)}</strong>
          </div>
          <div className="report-kpi-card">
            <span>Source</span>
            <strong>Driver Roster</strong>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="msg">No inactive drivers were found in the Driver Roster.</div>
        ) : (
          <div className="report-table-wrap">
            <table className="driver-report-table inactive-driver-roster-table">
              <thead>
                <tr>
                  <th>Operator / Team</th>
                  <th>TMS Name</th>
                  <th>Truck</th>
                  <th>Phone</th>
                  <th>Email</th>
                  <th>Trailer Type</th>
                  <th>Start Date</th>
                  <th>Term Date</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((roster, index) => (
                  <tr
                    key={`${roster.id || roster.truck || roster.tmsName || index}-${index}`}
                    className="report-clickable-row"
                    onClick={() => openRosterFromReport(roster)}
                    title="Open inactive driver roster details"
                  >
                    <td>{roster.operatorTeamName || '-'}</td>
                    <td>{roster.tmsName || '-'}</td>
                    <td>{roster.truck || '-'}</td>
                    <td>{formatPhone(roster.cellPhone1) || '-'}</td>
                    <td>{roster.emailAddress1 || '-'}</td>
                    <td>{roster.trailerType || '-'}</td>
                    <td>{formatRosterDate(roster.startDate)}</td>
                    <td>{formatRosterDate(roster.termDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  function DriverPositionTrackingPanel() {
    const positions = driverPositionsData?.positions || [];

    return (
      <div className="driver-position-panel">
        <div className="driver-position-header">
          <div>
            <h3>Active Driver Roster</h3>
          
          </div>

          {driverPositionsData?.counts && (
            <div className="driver-position-counts">
              <span>{driverPositionsData.counts.total} active units</span>
              <span>{driverPositionsData.counts.moving} moving</span>
              <span>{driverPositionsData.counts.stale} stale</span>
              {driverPositionsData.counts.missingRosterDetails > 0 && (
                <span>{driverPositionsData.counts.missingRosterDetails} missing roster</span>
              )}
            </div>
          )}
        </div>

        {driverPositionsError && <div className="msg error">{driverPositionsError}</div>}
        {driverPositionsLoading && !driverPositionsData && <div className="msg">Loading active driver roster...</div>}

        {driverPositionsData && positions.length === 0 && (
          <div className="msg">No active driver roster rows were found.</div>
        )}

        {positions.length > 0 && (
          <div className="operations-table-wrap driver-position-table-wrap">
            <table className="driver-position-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Truck</th>
                  <th>Driver</th>
                  <th>Location</th>
                  <th>Speed</th>
                  <th>Ignition</th>
                  <th>Position Time</th>
                </tr>
              </thead>

              <tbody>
                {positions.map((position) => (
                  <tr
                    key={position.id || position.equipmentId}
                    className={`driver-position-row ${position.hasRosterDetails ? 'has-roster-details' : 'missing-roster-details'}`}
                    onClick={() => setSelectedDriverRoster(position)}
                    title={position.hasRosterDetails ? 'Open driver roster details' : 'Open active position details'}
                  >
                    <td>
                      <span className={getPositionStatusClass(position)}>
                        {getPositionStatusLabel(position)}
                      </span>
                    </td>
                    <td>{position.equipmentId || '-'}</td>
                    <td>
                      <strong>{position.roster?.tmsName || position.driverName || 'Unmatched'}</strong>
                      {position.roster?.operatorTeamName && position.roster.operatorTeamName !== position.roster.tmsName && (
                        <small>{position.roster.operatorTeamName}</small>
                      )}
                      {!position.hasRosterDetails && (
                        <small className="roster-warning-text">No roster details matched</small>
                      )}
                    </td>
                    <td>{position.currentCityState || '-'}</td>
                    <td>{formatSpeed(position.speed)}</td>
                    <td>{position.ignitionStatusLabel || '-'}</td>
                    <td>{formatTrackingTimestamp(position.positionTimeUtc)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }


  function DriverRosterModal() {
    if (!selectedDriverRoster) return null;

    const roster = selectedDriverRoster.roster || {};
    const hasRoster = Boolean(selectedDriverRoster.hasRosterDetails && selectedDriverRoster.roster);
    const displayName = roster.tmsName || selectedDriverRoster.driverName || 'Driver Roster Details';
    const truck = roster.truck || selectedDriverRoster.equipmentId || '-';
    const modalTitle = selectedDriverRoster.rosterModalTitle || 'Active Driver Roster';
    const modalSubtitle = selectedDriverRoster.rosterModalSubtitle || `${displayName} · Truck ${truck}`;
    const hasLivePosition = !selectedDriverRoster.rosterModalTitle;

    return (
      <div className="modal-overlay" onClick={closeDriverRosterModal}>
        <div className="detail-modal driver-roster-modal" onClick={(e) => e.stopPropagation()}>
          <div className="detail-header">
            <div>
              <h2>{modalTitle}</h2>
              <p>{modalSubtitle}</p>
            </div>

            <button className="close-button" onClick={closeDriverRosterModal}>
              Close
            </button>
          </div>

          <div className="modal-body">
            {!hasRoster ? (
              <div className="report-alert locked">
                <h4>No roster details matched this active position.</h4>
                <p>
                  The position row is active, but Kole Connect could not match truck {selectedDriverRoster.equipmentId || '-'}
                  {' '}to a Driver Roster record. Check the Driver Positions EquipmentID against Driver Roster Trucks.
                </p>
              </div>
            ) : (
              <div className="detail-grid driver-roster-grid">
                <SectionTitle>Driver / Contact</SectionTitle>
                <DetailItem label="TMS Name" value={roster.tmsName} wide />
                <DetailItem label="Operator / Team" value={roster.operatorTeamName} />
                <DetailItem label="Truck" value={roster.truck} />
                <DetailItem label="Cell Phone 1" value={formatPhone(roster.cellPhone1)} />
                <DetailItem label="Cell Phone 2" value={formatPhone(roster.cellPhone2)} />
                <DetailItem label="Email Address 1" value={roster.emailAddress1} wide />
                <DetailItem label="Email Address 2" value={roster.emailAddress2} wide />
                <DetailItem label="Driver PIN" value={roster.pin} />
                <DetailItem label="Start Date" value={formatRosterDate(roster.startDate)} />
                <DetailItem label="Term Date" value={formatRosterDate(roster.termDate)} />

                <SectionTitle>Operational</SectionTitle>
                <DetailItem label="Status" value={roster.status} />
                <DetailItem label="Driver Type" value={roster.driverType} />
                <DetailItem label="Solo / Team" value={roster.soloOrTeam} />
                <DetailItem label="BOL Prefix" value={roster.bolLetterPrefix} />
                <DetailItem label="Trailer Type" value={roster.trailerType} wide />
                <DetailItem label="Registered Weight" value={formatRosterNumber(roster.registeredWeight)} />
                {hasLivePosition && (
                  <>
                    <DetailItem label="Currently Moving" value={selectedDriverRoster.isMoving ? 'Yes' : 'No'} />
                    <DetailItem label="Last Known Location" value={selectedDriverRoster.currentCityState} wide />
                    <DetailItem label="Position Time" value={formatTrackingTimestamp(selectedDriverRoster.positionTimeUtc)} wide />
                  </>
                )}

                <SectionTitle>Tractor</SectionTitle>
                <DetailItem label="Make" value={roster.tractorMake} />
                <DetailItem label="Year" value={roster.tractorYear} />
                <DetailItem label="Plate" value={roster.tractorPlate} />
                <DetailItem label="Registered State" value={roster.tractorRegisteredState} />
                <DetailItem label="VIN" value={roster.tractorVin} wide />
                <DetailItem label="Owner" value={roster.tractorOwner} wide />
                <DetailItem label="Axles" value={roster.tractorAxles} />

                <SectionTitle>Trailer</SectionTitle>
                <DetailItem label="Trailer Unit" value={roster.trailerUnitNumber} />
                <DetailItem label="Length" value={roster.trailerLength} />
                <DetailItem label="Make" value={roster.trailerMake} />
                <DetailItem label="Year" value={roster.trailerYear} />
                <DetailItem label="Plate" value={roster.trailerPlate} />
                <DetailItem label="Registered State" value={roster.trailerRegisteredState} />
                <DetailItem label="VIN" value={roster.trailerVin} wide />
                <DetailItem label="Owner" value={roster.trailerOwner} wide />
                <DetailItem label="Axles" value={roster.trailerAxles} />

                <SectionTitle>Dimensional / Weight Data</SectionTitle>
                <DetailItem label="Empty Weight" value={formatRosterNumber(roster.emptyWeight)} />
                <DetailItem label="Steer Axle Weight" value={formatRosterNumber(roster.steerAxleWeight)} />
                <DetailItem label="Overall Length" value={formatRosterNumber(roster.overallLength)} />
                <DetailItem label="Lowest Deck Height" value={formatRosterNumber(roster.lowestDeckHeight)} />
                <DetailItem label="Spacing 1 to 2" value={formatRosterNumber(roster.spacing1to2)} />
                <DetailItem label="Spacing 2 to 3" value={formatRosterNumber(roster.spacing2to3)} />
                <DetailItem label="Spacing 3 to 4" value={formatRosterNumber(roster.spacing3to4)} />
                <DetailItem label="Spacing 4 to 5" value={formatRosterNumber(roster.spacing4to5)} />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  function UploadDigestPanel() {
    const records = uploadDigestData?.records || [];
    const count = uploadDigestData?.count ?? records.length;
    const activeDigestDate = uploadDigestData?.targetDate || uploadDigestDate;
    const dateLabel = formatDateInputLabel(activeDigestDate);
    const isUploadDigestToday = isTodayOrFutureDateInput(activeDigestDate);

    return (
      <div className="search-card upload-digest-panel">
        <div className="upload-digest-section-header">
          <h2>Job Photo Uploads</h2>
        </div>

        <div className="upload-digest-header-row">
          <button
            className="upload-digest-arrow"
            onClick={() => changeUploadDigestDate(-1)}
            disabled={uploadDigestLoading}
            aria-label="Previous upload digest day"
            title="Previous day"
          >
            ‹
          </button>

          <button
            className="upload-digest-summary"
            onClick={() => setUploadDigestOpen((current) => !current)}
            aria-expanded={uploadDigestOpen}
          >
            <span className="upload-digest-title">
              Pickup and Delivery Photos for {dateLabel}
            </span>
            <span className="upload-digest-count">
              {uploadDigestLoading ? 'Loading...' : `${count} logged`}
            </span>
            <span className="upload-digest-chevron">
              {uploadDigestOpen ? '▲' : '▼'}
            </span>
          </button>

          <button
            type="button"
            className={`upload-digest-today-button ${isUploadDigestToday ? 'hidden' : ''}`}
            onClick={resetUploadDigestToToday}
            disabled={uploadDigestLoading || isUploadDigestToday}
            aria-hidden={isUploadDigestToday}
            tabIndex={isUploadDigestToday ? -1 : 0}
            title="Return to today"
          >
            Today
          </button>

          <button
            className="upload-digest-arrow"
            onClick={() => changeUploadDigestDate(1)}
            disabled={uploadDigestLoading || isUploadDigestToday}
            aria-label="Next upload digest day"
            title={isUploadDigestToday ? 'Already on today' : 'Next day'}
          >
            ›
          </button>
        </div>

        {uploadDigestError && <div className="msg error">{uploadDigestError}</div>}
        {uploadDigestActionError && <div className="msg error">{uploadDigestActionError}</div>}

        {uploadDigestOpen && !uploadDigestError && (
          <div className="upload-digest-body">
            {records.length === 0 ? (
              <div className="msg">No pickup or delivery uploads logged for this date.</div>
            ) : (
              <div className="operations-table-wrap upload-digest-table-wrap">
                <table className="upload-digest-table">
                  <thead>
                    <tr>
                      <th>BOL</th>
                      <th>Driver</th>
                      <th>Type</th>
                      <th>Folder</th>
                    </tr>
                  </thead>

                  <tbody>
                    {records.map((record, i) => (
                      <tr key={record.id || `${record.CompositeKey || record.BOLNumber}-${i}`}>
                        <td>{record.BOLNumber || '-'}</td>
                        <td>{record.DriverName || '-'}</td>
                        <td>{record.UploadType || '-'}</td>
                        <td>
                          <button
                            type="button"
                            className="table-link-button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openUploadDigestLoadPhotos(record);
                            }}
                            disabled={!record.BOLNumber || documentLoading === `upload-digest-loadphotos-${record.id || record.BOLNumber}`}
                          >
                            {documentLoading === `upload-digest-loadphotos-${record.id || record.BOLNumber}`
                              ? 'Opening...'
                              : `${record.UploadType || 'Open'} Folder`}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

          </div>
        )}
      </div>
    );
  }


  function SalesLeadCard({ lead }) {
    const winRate = lead.QuoteCount > 0 ? lead.QuotesWon / lead.QuoteCount : 0;
    const followUpLabel = lead.FollowUpDue
      ? `Due ${formatSalesDate(lead.NextTouchDate)}`
      : lead.FollowUpHandling === 'Suppressed'
        ? 'Suppressed'
        : 'None due';

    return (
      <button
        type="button"
        className={`sales-lead-card ${lead.FollowUpDue ? 'follow-up-due' : ''}`}
        onClick={() => openSalesLeadCard(lead)}
      >
        <div className="sales-lead-card-header">
          <div>
            <h4>{lead.CompanyName || 'Unnamed customer'}</h4>
            <p>{lead.CustomerCode || 'No customer code'}</p>
          </div>
          <div className="sales-lead-badges">
            <span className={getSalesLeadStatusClass(lead.Status)}>{lead.Status || '-'}</span>
            {lead.AviationRelated && <span className="sales-status aviation">Aviation</span>}
          </div>
        </div>

        <div className="sales-lead-metrics">
          <div>
            <span>Quotes</span>
            <strong>{formatReportNumber(lead.QuoteCount)}</strong>
          </div>
          <div>
            <span>Wins</span>
            <strong>{formatReportNumber(lead.QuotesWon)}</strong>
          </div>
          <div>
            <span>Win Rate</span>
            <strong>{formatPercent(winRate)}</strong>
          </div>
        </div>

        <div className="sales-lead-footer">
          <span>Last quote: {formatSalesDate(lead.LastQuoteDate)}</span>
          <strong>{followUpLabel}</strong>
        </div>

        {Number(lead.SalesNotesCount || 0) > 0 && (
          <div className="sales-lead-note-count">
            {formatReportNumber(lead.SalesNotesCount)} note{Number(lead.SalesNotesCount || 0) === 1 ? '' : 's'} logged
          </div>
        )}
      </button>
    );
  }

  function SalesActivityLeadTable({ title, description, rows }) {
    const safeRows = Array.isArray(rows) ? rows : [];

    return (
      <div className="driver-report-section sales-activity-section">
        <div className="driver-report-section-header">
          <div>
            <h4>{title}</h4>
            {description && <p>{description}</p>}
          </div>
          <div className="driver-report-section-total">
            {formatReportNumber(safeRows.length)}
          </div>
        </div>

        {safeRows.length === 0 ? (
          <div className="msg sales-activity-empty">Nothing to show here.</div>
        ) : (
          <div className="report-table-wrap sales-activity-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Customer Code</th>
                  <th>Next Touch</th>
                  <th>Quote Count</th>
                  <th>First Quote</th>
                  <th>Last Quote</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {safeRows.map((row) => (
                  <tr key={`${title}-${row.id || row.CustomerCode || row.CompanyName}`}>
                    <td>{formatSalesActivityLabel(row.CompanyName)}</td>
                    <td>{formatSalesActivityLabel(row.CustomerCode)}</td>
                    <td>{formatSalesActivityDate(row.NextTouchDate)}</td>
                    <td>{formatReportNumber(row.QuoteCount)}</td>
                    <td>{formatSalesActivityDate(row.FirstQuoteDate)}</td>
                    <td>{formatSalesActivityDate(row.LastQuoteDate)}</td>
                    <td><span className={getSalesLeadStatusClass(row.Status)}>{row.Status || '-'}</span></td>
                    <td>
                      <button
                        type="button"
                        className="view-button"
                        onClick={() => openCustomerCardForName(row.CompanyName, row.CustomerCode)}
                        disabled={customerLookupLoading}
                      >
                        Open Card
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  function SalesActivityNoteList({ title, description, rows, dateField = 'ActivityDate' }) {
    const safeRows = Array.isArray(rows) ? rows : [];

    return (
      <div className="driver-report-section sales-activity-section">
        <div className="driver-report-section-header">
          <div>
            <h4>{title}</h4>
            {description && <p>{description}</p>}
          </div>
          <div className="driver-report-section-total">
            {formatReportNumber(safeRows.length)}
          </div>
        </div>

        {safeRows.length === 0 ? (
          <div className="msg sales-activity-empty">Nothing to show here.</div>
        ) : (
          <div className="sales-activity-note-list">
            {safeRows.map((row) => (
              <article key={`${title}-${row.id || row.CustomerCode || row.ActivityDate}`} className="sales-activity-note-card">
                <div className="sales-activity-note-card-header">
                  <div>
                    <strong>{row.CompanyName || 'Unknown Customer'}</strong>
                    <span>
                      {[row.CustomerCode, formatSalesActivityDate(row[dateField]), row.Author].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="view-button"
                    onClick={() => openCustomerCardForName(row.CompanyName, row.CustomerCode)}
                    disabled={customerLookupLoading}
                  >
                    Open Card
                  </button>
                </div>
                <p>{truncateSalesText(row.Note || row.Title || '-', 260)}</p>
              </article>
            ))}
          </div>
        )}
      </div>
    );
  }

  function SalesActivitySnapshotPreview() {
    const report = salesActivityReport;

    if (!report) return null;

    const summary = report?.summary || {};
    const sections = report?.sections || {};

    return (
      <div className="modal-report-preview sales-activity-preview">
        {report.notesStatus && report.notesStatus !== 'available' && (
          <div className="report-alert locked sales-notes-alert">
            <h4>Sales notes are not connected yet.</h4>
            <p>{report.notesError || 'Confirm the Sales Leads Notes Log list name or set SALES_LEADS_NOTES_LIST_ID on the server.'}</p>
          </div>
        )}

        <div className="sales-summary-grid sales-activity-summary-grid">
          <div>
            <span>Overdue</span>
            <strong>{formatReportNumber(summary.overdueFollowUps)}</strong>
          </div>
          <div>
            <span>Due Window</span>
            <strong>{formatReportNumber(summary.dueFollowUps)}</strong>
          </div>
          <div>
            <span>Notes Added</span>
            <strong>{formatReportNumber(summary.notesAdded)}</strong>
          </div>
          <div>
            <span>Completed Touches</span>
            <strong>{formatReportNumber(summary.completedFollowUps)}</strong>
          </div>
          <div>
            <span>Touched Customers</span>
            <strong>{formatReportNumber(summary.touchedCustomers)}</strong>
          </div>
        </div>

        <div className="sales-activity-split-label">Needs Attention</div>
        <SalesActivityLeadTable
          title="Overdue Follow-Ups"
          description="Follow-up pending and Next Touch before today."
          rows={sections.overdueFollowUps}
        />
        <SalesActivityLeadTable
          title="Follow-Ups Due in Window"
          description={`Follow-up pending from ${report.duePeriodLabel || 'the selected due window'}.`}
          rows={sections.dueFollowUps}
        />

        <div className="sales-activity-split-label">Recent Activity</div>
        <SalesActivityNoteList
          title="Notes Added"
          description={`Notes created from ${report.activityPeriodLabel || 'the selected activity window'}.`}
          rows={sections.notesAdded}
          dateField="ActivityDate"
        />
        <SalesActivityNoteList
          title="Follow-Ups Completed"
          description={`Touch dates recorded from ${report.activityPeriodLabel || 'the selected activity window'}.`}
          rows={sections.completedFollowUps}
          dateField="TouchDate"
        />
      </div>
    );
  }

  function SalesActivitySnapshotPanel() {
    const report = salesActivityReport;
    const hasReport = Boolean(report);

    return (
      <div className="report-card compact-report-card accordion-inner-card sales-report-card sales-activity-card">
        <div className="report-card-header centered-report-header">
          <div>
            <h3>Sales Activity Snapshot</h3>
            {hasReport ? (
              <p>
                Activity: {report.activityPeriodLabel || '-'} · Due window: {report.duePeriodLabel || '-'} · Generated {report.generatedAt || ''}
              </p>
            ) : (
              <p>Review recent notes, completed touches, overdue follow-ups, and upcoming follow-up obligations.</p>
            )}
          </div>
        </div>

        <div className="report-controls centered-report-controls sales-report-controls sales-activity-controls">
          <label>
            <span>Activity Lookback</span>
            <select
              value={salesActivityLookbackDays}
              onChange={(e) => {
                setSalesActivityLookbackDays(Number(e.target.value));
                setSalesActivityReport(null);
                setSalesActivityError(null);
                setSalesActivityModalOpen(false);
              }}
              disabled={salesActivityLoading}
            >
              <option value={7}>Last 7 days / Next 7 days due</option>
              <option value={14}>Last 14 days / Next 14 days due</option>
              <option value={30}>Last 30 days / Next 30 days due</option>
              <option value={60}>Last 60 days / Next 60 days due</option>
              <option value={90}>Last 90 days / Next 90 days due</option>
            </select>
          </label>

          <button onClick={loadSalesActivityReport} disabled={salesActivityLoading}>
            {salesActivityLoading ? 'Loading Snapshot...' : 'Preview Snapshot'}
          </button>
        </div>

        {salesActivityLoading && (
          <div className="sales-report-loading">
            Polling sales activity...
          </div>
        )}

        {salesActivityError && (
          <div className="report-alert error">
            <h4>Sales Activity Snapshot could not be loaded.</h4>
            <p>{salesActivityError.message}</p>
          </div>
        )}

        {hasReport && !salesActivityModalOpen && (
          <div className="report-ready-card">
            <div>
              <strong>Sales Activity Snapshot is ready.</strong>
              <span> The preview opens in a report window.</span>
            </div>
            <button className="view-button" onClick={() => setSalesActivityModalOpen(true)}>
              Reopen Preview
            </button>
          </div>
        )}
      </div>
    );
  }

  function SalesLeadsReportPanel() {
    const summary = salesLeadsReport?.summary || {};
    const allRecords = salesLeadsReport?.records || [];
    const hasSalesLeadsReport = Boolean(salesLeadsReport);
    const activeReportView = salesLeadsView;
    const activeReportSort = salesLeadsSort;
    const activeViewLabel = getSalesLeadViewLabel(activeReportView);
    const records = sortSalesLeadRecords(
      filterSalesLeadRecords(allRecords, activeReportView),
      activeReportSort
    );
    const summaryButtons = salesLeadViewOptions.map((option) => ({
      ...option,
      count: Number(summary?.[option.summaryKey] || 0)
    }));

    function loadInitialSalesCards() {
      const initialView = 'all';
      const initialSort = getDefaultSalesLeadSort(initialView);

      setSalesLeadsView(initialView);
      setSalesLeadsSort(initialSort);
      loadSalesLeadsReport();
    }

    function changeSalesLeadView(nextView) {
      const nextSort = getDefaultSalesLeadSort(nextView);

      setSalesLeadsView(nextView);
      setSalesLeadsSort(nextSort);
      setSelectedSalesLead(null);
      setSalesLeadsError(null);
    }

    function changeSalesLeadSort(nextSort) {
      setSalesLeadsSort(nextSort);
      setSelectedSalesLead(null);
      setSalesLeadsError(null);
    }

    return (
      <div className="report-card compact-report-card accordion-inner-card sales-report-card">
        <div className="report-card-header centered-report-header">
          <div>
            <h3>{hasSalesLeadsReport ? activeViewLabel : 'Customer Cards'}</h3>
            {hasSalesLeadsReport && (
              <p>
                {formatReportNumber(records.length)} shown · {formatReportNumber(salesLeadsReport.recordsScanned || 0)} scanned · {salesLeadsReport.generatedAt || ''}
              </p>
            )}
          </div>
        </div>

        {!hasSalesLeadsReport && !salesLeadsLoading && (
          <div className="sales-report-start">
            <button onClick={loadInitialSalesCards} disabled={salesLeadsLoading}>
              Load Customer Cards
            </button>
          </div>
        )}

        {salesLeadsLoading && (
          <div className="sales-report-loading">
            Polling customer cards...
          </div>
        )}

        {salesLeadsError && (
          <div className="report-alert error">
            <h4>Sales report could not be loaded.</h4>
            <p>{salesLeadsError.message}</p>
          </div>
        )}

        {hasSalesLeadsReport && salesLeadsReport.notesStatus && salesLeadsReport.notesStatus !== 'available' && (
          <div className="report-alert locked sales-notes-alert">
            <h4>Sales notes are not connected yet.</h4>
            <p>{salesLeadsReport.notesError || 'Confirm the Sales Leads Notes Log list name or set SALES_LEADS_NOTES_LIST_ID on the server.'}</p>
          </div>
        )}

        {hasSalesLeadsReport && (
          <>
            <div className="sales-summary-grid sales-summary-button-grid">
              {summaryButtons.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`sales-summary-button ${activeReportView === option.value ? 'active-sales-summary-button' : ''}`}
                  onClick={() => changeSalesLeadView(option.value)}
                  disabled={salesLeadsLoading}
                >
                  <span>{option.label}</span>
                  <strong>{formatReportNumber(option.count)}</strong>
                </button>
              ))}
            </div>

            <p className="sales-summary-helper">
              Click a card to filter the customer cards below.
            </p>

            <div className="report-controls centered-report-controls sales-report-controls">
              <label>
                <span>Sort</span>
                <select
                  value={activeReportSort}
                  onChange={(e) => changeSalesLeadSort(e.target.value)}
                  disabled={salesLeadsLoading}
                >
                  <option value="name">Alphabetical</option>
                  <option value="quotes">Most quotes</option>
                  <option value="wins">Most wins</option>
                  <option value="revenue">Most revenue won</option>
                  <option value="lastQuote">Recently quoted</option>
                  <option value="followUp">Follow-up due</option>
                </select>
              </label>

              <button onClick={loadSalesLeadsReport} disabled={salesLeadsLoading}>
                {salesLeadsLoading ? 'Refreshing Customers...' : 'Refresh Customer Cards'}
              </button>
            </div>

            <div className="sales-report-results">
              {records.length === 0 ? (
                <div className="msg">No customers matched this sales view.</div>
              ) : (
                <div className="sales-lead-card-grid">
                  {records.map((lead) => (
                    <SalesLeadCard key={lead.id || lead.CompanyName} lead={lead} />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  function SalesLeadProfileModal() {
    if (!selectedSalesLead) return null;

    const lead = selectedSalesLead;
    const salesNotes = Array.isArray(lead.SalesNotes) ? lead.SalesNotes : [];
    const winRate = lead.QuoteCount > 0 ? lead.QuotesWon / lead.QuoteCount : 0;
    const activeYears = (lead.YearDetails || []).filter((year) => (
      year.quotes ||
      year.wins ||
      year.revenueWon ||
      year.firstQuote ||
      year.lastQuote
    ));

    return (
      <div className="modal-overlay report-modal-overlay sales-profile-overlay" onClick={closeSalesLeadModal}>
        <div className="detail-modal report-modal sales-profile-modal" onClick={(e) => e.stopPropagation()}>
          <div className="detail-header report-modal-header">
            <div>
              <h2>{lead.CompanyName || 'Customer Card'}</h2>
              <p>{lead.CustomerCode || 'No customer code'} · {lead.Status || 'No status'}</p>
            </div>

            <button className="close-button" onClick={closeSalesLeadModal}>
              Close
            </button>
          </div>

          <div className="modal-body report-modal-body" id="sales-profile-modal-body">
            <div className="sales-profile-headline-grid">
              <div>
                <span>Revenue Won</span>
                <strong>{formatReportMoney(lead.RevenueWon)}</strong>
              </div>
              <div>
                <span>Quotes</span>
                <strong>{formatReportNumber(lead.QuoteCount)}</strong>
              </div>
              <div>
                <span>Wins</span>
                <strong>{formatReportNumber(lead.QuotesWon)}</strong>
              </div>
              <div>
                <span>Win Rate</span>
                <strong>{formatPercent(winRate)}</strong>
              </div>
            </div>

            <div className="detail-grid sales-profile-grid">
              <SectionTitle>Customer Summary</SectionTitle>
              <DetailItem label="Company" value={lead.CompanyName} wide />
              <DetailItem label="Customer Code" value={lead.CustomerCode} />
              <DetailItem label="Status" value={lead.Status} />
              <DetailItem label="Aviation Related" value={lead.AviationRelated ? 'Yes' : 'No'} />
              <DetailItem label="Converted Cold" value={lead.ConvertedCold ? 'Yes' : 'No'} />
              <DetailItem label="First Seen" value={formatSalesDate(lead.FirstSeen)} />
              <DetailItem label="Conversion Date" value={formatSalesDate(lead.ConversionDate)} />

              <SectionTitle>Activity</SectionTitle>
              <DetailItem label="Revenue Won" value={formatReportMoney(lead.RevenueWon)} />
              <DetailItem label="Quote Count" value={formatReportNumber(lead.QuoteCount)} />
              <DetailItem label="Quotes Won" value={formatReportNumber(lead.QuotesWon)} />
              <DetailItem label="Win Rate" value={formatPercent(winRate)} />
              <DetailItem label="First Quote" value={formatSalesDate(lead.FirstQuoteDate)} />
              <DetailItem label="Last Quote" value={formatSalesDate(lead.LastQuoteDate)} />
              <DetailItem label="Touch Count" value={formatReportNumber(lead.TouchCount)} />

              <SectionTitle>Follow-up</SectionTitle>
              <DetailItem label="Follow-up Pending" value={lead.FollowUpPending ? 'Yes' : 'No'} />
              <DetailItem label="Follow-up Due" value={lead.FollowUpDue ? 'Yes' : 'No'} />
              <DetailItem label="Next Touch" value={formatSalesDate(lead.NextTouchDate)} />
              <DetailItem label="Handling" value={lead.FollowUpHandling} />
              <DetailItem label="Suppression Date" value={formatSalesDate(lead.SuppressionDate)} />
              <DetailItem label="Suppression Reason" value={lead.SuppressionReason} className="full" />
            </div>

            <div className="driver-report-section sales-notes-section">
              <div className="driver-report-section-header">
                <div>
                  <h4>Sales Notes Log</h4>
                </div>
                <div className="driver-report-section-total">
                  {formatReportNumber(salesNotes.length)} note{salesNotes.length === 1 ? '' : 's'}
                </div>
              </div>

              <div className="sales-note-composer">
                <label>
                  <span>Add Note</span>
                  <textarea
                    value={salesNoteDraft}
                    maxLength={SALES_NOTE_MAX_LENGTH}
                    placeholder={`Add a note for ${lead.CustomerCode || 'this customer'}...`}
                    onChange={(e) => {
                      const modalBody = document.getElementById('sales-profile-modal-body');
                      const scrollTop = modalBody?.scrollTop || 0;

                      setSalesNoteDraft(e.target.value);
                      setSalesNoteError('');
                      setSalesNoteMessage('');

                      window.requestAnimationFrame(() => {
                        const nextModalBody = document.getElementById('sales-profile-modal-body');
                        if (nextModalBody) {
                          nextModalBody.scrollTop = scrollTop;
                        }
                      });
                    }}
                  />
                </label>

                <div className="sales-note-composer-footer">
                  <small>
                    Note Date: today · {salesNoteDraft.length.toLocaleString('en-US')} / {SALES_NOTE_MAX_LENGTH.toLocaleString('en-US')} characters. New notes will not show below until the Sales Leads customer cards are refreshed.
                  </small>
                  <button
                    type="button"
                    onClick={submitSalesLeadNote}
                    disabled={salesNoteSaving || !salesNoteDraft.trim() || !lead.CustomerCode}
                  >
                    {salesNoteSaving ? 'Saving...' : 'Add Note'}
                  </button>
                </div>

                {salesNoteMessage && <div className="msg sales-note-save-message">{salesNoteMessage}</div>}
                {salesNoteError && <div className="msg error sales-note-save-message">{salesNoteError}</div>}
              </div>

              {salesNotes.length === 0 ? (
                <div className="msg">No sales notes logged for this customer code.</div>
              ) : (
                <div className="sales-notes-list">
                  {salesNotes.map((note) => (
                    <article key={note.id || `${note.NoteDate}-${note.Title}`} className="sales-note-card">
                      <div className="sales-note-card-header">
                        <div>
                          <strong>Note Date: {formatSalesDate(note.NoteDate)}</strong>
                        </div>
                      </div>
                      <p>{note.Note || '-'}</p>
                    </article>
                  ))}
                </div>
              )}
            </div>

            <div className="driver-report-section sales-year-section">
              <div className="driver-report-section-header">
                <div>
                  <h4>Year-by-Year Quote Activity</h4>
                </div>
              </div>

              {activeYears.length === 0 ? (
                <div className="msg">No yearly quote activity recorded.</div>
              ) : (
                <div className="report-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Year</th>
                        <th>Quotes</th>
                        <th>Wins</th>
                        <th>Revenue Won</th>
                        <th>First Quote</th>
                        <th>Last Quote</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeYears.map((year) => (
                        <tr
                          key={year.year}
                          className="sales-year-clickable-row"
                          onClick={() => loadCustomerYearOrders(lead, year)}
                          title={`Search ${lead.CompanyName || lead.CustomerCode || 'this customer'} orders for ${year.year}`}
                        >
                          <td>{year.year}{year.isCurrentYear ? ' (Current)' : ''}</td>
                          <td>{formatReportNumber(year.quotes)}</td>
                          <td>{formatReportNumber(year.wins)}</td>
                          <td>{formatReportMoney(year.revenueWon)}</td>
                          <td>{formatSalesDate(year.firstQuote)}</td>
                          <td>{formatSalesDate(year.lastQuote)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  function DriverSummaryReport() {
    const monthOptions = Array.from({ length: 12 }, (_, index) => index + 1);
    const isGrossRevenueOpen = activeReportPanel === 'grossRevenue';
    const isDriverSummaryOpen = activeReportPanel === 'driverSummary';
    const isOrdersDueSettlementOpen = activeReportPanel === 'ordersDueSettlement';
    const isWeeklySettlementOpen = activeReportPanel === 'weeklySettlement';
    const isWonNotRegisteredOpen = activeReportPanel === 'wonNotRegistered';
    const isInactiveDriverRosterOpen = activeReportPanel === 'inactiveDriverRoster';
    const isSalesActivityOpen = activeReportPanel === 'salesActivity';
    const isSalesLeadsOpen = activeReportPanel === 'salesLeads';
    const isOperationalReportsOpen = isReportGroupOpen('operational');
    const isSalesReportsOpen = isReportGroupOpen('sales');

    return (
      <div className="search-card reports-panel">
        <div className="reports-header">
          <div>
            <h2>Reports</h2>
          </div>
        </div>

        <div className="reports-accordion-list">
          <div className={`report-group-accordion ${isOperationalReportsOpen ? 'open' : ''}`}>
            <button
              type="button"
              className="report-group-button"
              onClick={() => toggleReportGroup('operational')}
            >
              <div>
                <strong>Operational Reports</strong>
                <span>Revenue, settlements, driver/order reporting</span>
              </div>
              <span className="report-accordion-icon">{isOperationalReportsOpen ? '▼' : '▶'}</span>
            </button>

            {isOperationalReportsOpen && (
              <div className="report-group-body">
          <div className={`report-accordion ${isGrossRevenueOpen ? 'open' : ''}`}>
            <button
              type="button"
              className="report-accordion-button"
              onClick={() => toggleReportPanel('grossRevenue')}
            >
              <span>Gross Revenue Totals</span>
              <span className="report-accordion-icon">{isGrossRevenueOpen ? '▼' : '▶'}</span>
            </button>

            {isGrossRevenueOpen && (
              <div className="report-accordion-body">
                <div className="report-card compact-report-card accordion-inner-card">
                  <div className="report-card-header centered-report-header">
                    <div>
                      <h3>Gross Revenue Totals</h3>
                    </div>
                  </div>

                  <div className="report-controls centered-report-controls">
                    <label>
                      <span>Year</span>
                      <select
                        value={grossRevenueYear}
                        onChange={(e) => {
                          setGrossRevenueYear(Number(e.target.value));
                          setGrossRevenueReport(null);
                          setGrossRevenueError(null);
                          setGrossRevenueModalOpen(false);
                        }}
                      >
                        {getReportYears().map((year) => (
                          <option key={year} value={year}>
                            {year}
                          </option>
                        ))}
                      </select>
                    </label>

                    <button onClick={loadGrossRevenueReport} disabled={grossRevenueLoading}>
                      {grossRevenueLoading ? 'Loading Report...' : 'Preview Report'}
                    </button>
                  </div>

                  {grossRevenueReport && !grossRevenueModalOpen && (
                    <div className="report-ready-card">
                      <div>
                        <strong>{grossRevenueReport.reportLabel} is ready.</strong>
                        <span> The preview opens in a report window.</span>
                      </div>
                      <button className="view-button" onClick={() => setGrossRevenueModalOpen(true)}>
                        Reopen Preview
                      </button>
                    </div>
                  )}

                  {grossRevenueError && (
                    <div className="report-alert error">
                      <h4>Report could not be loaded.</h4>
                      <p>{grossRevenueError.message}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className={`report-accordion ${isDriverSummaryOpen ? 'open' : ''}`}>
            <button
              type="button"
              className="report-accordion-button"
              onClick={() => toggleReportPanel('driverSummary')}
            >
              <span>Monthly Driver Summary Report</span>
              <span className="report-accordion-icon">{isDriverSummaryOpen ? '▼' : '▶'}</span>
            </button>

            {isDriverSummaryOpen && (
              <div className="report-accordion-body">
                <div className="report-card compact-report-card accordion-inner-card">
                  <div className="report-card-header centered-report-header">
                    <div>
                      <h3>Monthly Driver Summary Report</h3>
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

          <div className={`report-accordion ${isOrdersDueSettlementOpen ? 'open' : ''}`}>
            <button
              type="button"
              className="report-accordion-button"
              onClick={() => toggleReportPanel('ordersDueSettlement')}
            >
              <span>Orders Due for Settlement</span>
              <span className="report-accordion-icon">{isOrdersDueSettlementOpen ? '▼' : '▶'}</span>
            </button>

            {isOrdersDueSettlementOpen && (
              <div className="report-accordion-body">
                <div className="report-card compact-report-card accordion-inner-card">
                  <div className="report-card-header centered-report-header">
                    <div>
                      <h3>Orders Due for Settlement</h3>
                    </div>
                  </div>

                  <div className="report-controls centered-report-controls">
                    <button onClick={loadOrdersDueSettlementReport} disabled={ordersDueSettlementLoading}>
                      {ordersDueSettlementLoading ? 'Loading Report...' : 'Preview Report'}
                    </button>
                  </div>

                  {ordersDueSettlementReport && !ordersDueSettlementModalOpen && (
                    <div className="report-ready-card">
                      <div>
                        <strong>{ordersDueSettlementReport.reportLabel} is ready.</strong>
                        <span> The preview opens in a report window.</span>
                      </div>
                      <button className="view-button" onClick={() => setOrdersDueSettlementModalOpen(true)}>
                        Reopen Preview
                      </button>
                    </div>
                  )}

                  {ordersDueSettlementError && (
                    <div className="report-alert error">
                      <h4>Report could not be loaded.</h4>
                      <p>{ordersDueSettlementError.message}</p>
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
                    <label className="settlement-date-control">
                      <span>Cutoff Date</span>
                      <input
                        type="date"
                        value={settlementCutoffDate}
                        aria-label="Weekly settlement cutoff date"
                        onChange={(e) => {
                          setSettlementCutoffDate(e.target.value);
                          setWeeklySettlementReport(null);
                          setWeeklySettlementError(null);
                          setWeeklySettlementModalOpen(false);
                        }}
                      />
                      <small>Pick the Thursday cutoff date, then preview the report.</small>
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


          <div className={`report-accordion ${isWonNotRegisteredOpen ? 'open' : ''}`}>
            <button
              type="button"
              className="report-accordion-button"
              onClick={() => toggleReportPanel('wonNotRegistered')}
            >
              <span>Orders Won and Not Registered</span>
              <span className="report-accordion-icon">{isWonNotRegisteredOpen ? '▼' : '▶'}</span>
            </button>

            {isWonNotRegisteredOpen && (
              <div className="report-accordion-body">
                <div className="report-card compact-report-card accordion-inner-card">
                  <div className="report-card-header centered-report-header">
                    <div>
                      <h3>Orders Won and Not Registered</h3>
                    </div>
                  </div>

                  <div className="report-controls centered-report-controls">
                    <button onClick={loadWonNotRegisteredReport} disabled={wonNotRegisteredLoading}>
                      {wonNotRegisteredLoading ? 'Loading Report...' : 'Preview Report'}
                    </button>
                  </div>

                  {wonNotRegisteredReport && !wonNotRegisteredModalOpen && (
                    <div className="report-ready-card">
                      <div>
                        <strong>{wonNotRegisteredReport.reportLabel} is ready.</strong>
                        <span> The preview opens in a report window.</span>
                      </div>
                      <button className="view-button" onClick={() => setWonNotRegisteredModalOpen(true)}>
                        Reopen Preview
                      </button>
                    </div>
                  )}

                  {wonNotRegisteredError && (
                    <div className="report-alert error">
                      <h4>Report could not be loaded.</h4>
                      <p>{wonNotRegisteredError.message}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>


          <div className={`report-accordion ${isInactiveDriverRosterOpen ? 'open' : ''}`}>
            <button
              type="button"
              className="report-accordion-button"
              onClick={() => toggleReportPanel('inactiveDriverRoster')}
            >
              <span>Inactive Driver Roster</span>
              <span className="report-accordion-icon">{isInactiveDriverRosterOpen ? '▼' : '▶'}</span>
            </button>

            {isInactiveDriverRosterOpen && (
              <div className="report-accordion-body">
                <div className="report-card compact-report-card accordion-inner-card">
                  <div className="report-card-header centered-report-header">
                    <div>
                      <h3>Inactive Driver Roster</h3>
                    </div>
                  </div>

                  <div className="report-controls centered-report-controls">
                    <button onClick={loadInactiveDriverRosterReport} disabled={inactiveDriverRosterLoading}>
                      {inactiveDriverRosterLoading ? 'Loading Report...' : 'Preview Report'}
                    </button>
                  </div>

                  {inactiveDriverRosterReport && !inactiveDriverRosterModalOpen && (
                    <div className="report-ready-card">
                      <div>
                        <strong>{inactiveDriverRosterReport.reportLabel} is ready.</strong>
                        <span> The preview opens in a report window.</span>
                      </div>
                      <button className="view-button" onClick={() => setInactiveDriverRosterModalOpen(true)}>
                        Reopen Preview
                      </button>
                    </div>
                  )}

                  {inactiveDriverRosterError && (
                    <div className="report-alert error">
                      <h4>Report could not be loaded.</h4>
                      <p>{inactiveDriverRosterError.message}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
              </div>
            )}
          </div>

          <div className={`report-group-accordion ${isSalesReportsOpen ? 'open' : ''}`}>
            <button
              type="button"
              className="report-group-button"
              onClick={() => toggleReportGroup('sales')}
            >
              <div>
                <strong>Sales Reports</strong>
                <span>Customers, leads, follow-ups, aviation prospects</span>
              </div>
              <span className="report-accordion-icon">{isSalesReportsOpen ? '▼' : '▶'}</span>
            </button>

            {isSalesReportsOpen && (
              <div className="report-group-body">
                <div className={`report-accordion ${isSalesActivityOpen ? 'open' : ''}`}>
                  <button
                    type="button"
                    className="report-accordion-button"
                    onClick={() => toggleReportPanel('salesActivity')}
                  >
                    <span>Sales Activity Snapshot</span>
                    <span className="report-accordion-icon">{isSalesActivityOpen ? '▼' : '▶'}</span>
                  </button>

                  {isSalesActivityOpen && (
                    <div className="report-accordion-body">
                      <SalesActivitySnapshotPanel />
                    </div>
                  )}
                </div>

                <div className={`report-accordion ${isSalesLeadsOpen ? 'open' : ''}`}>
                  <button
                    type="button"
                    className="report-accordion-button"
                    onClick={() => toggleReportPanel('salesLeads')}
                  >
                    <span>{getSalesLeadViewLabel()}</span>
                    <span className="report-accordion-icon">{isSalesLeadsOpen ? '▼' : '▶'}</span>
                  </button>

                  {isSalesLeadsOpen && (
                    <div className="report-accordion-body">
                      <SalesLeadsReportPanel />
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
  alt="Kole Trucking"
  className="brand-logo-large"
  style={{ width: '520px' }}
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
  alt="Kole Trucking"
  className="brand-logo-large"
  style={{ width: '520px' }}
/>

    <h1>Kole Connect</h1>
    <p>
      Search orders, BOLs, customers, drivers,
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

          <button
            type="button"
            className="search-secondary-button"
            onClick={clearOrderSearch}
            disabled={loading && !hasSearched}
          >
            Clear
          </button>

          {salesSearchReturnLead && (
            <button
              type="button"
              className="search-return-button"
              onClick={returnToCustomerCard}
            >
              Return to customer
            </button>
          )}
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
                setSalesSearchReturnLead(null);
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
    <div className="operations-header-bar">
      <div>
        <h2>Operations Today</h2>
        {operationsData?.generatedAt && (
          <p>Generated: {operationsData.generatedAt}</p>
        )}
      </div>

      <button onClick={refreshOperationsAndTracking} disabled={operationsLoading || driverPositionsLoading}>
        {operationsLoading || driverPositionsLoading ? 'Refreshing...' : 'Refresh Operations'}
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

        <DriverPositionTrackingPanel />

        <div style={{ marginTop: '24px' }}>
          <h3 style={{ marginBottom: '12px' }}>Active Today</h3>

          {operationsData.activeToday.length === 0 ? (
            <div className="msg">No active shipments today.</div>
          ) : (
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
          )}
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
                    <th>Status</th>
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
                      <td><OperationStatusPill record={r} /></td>
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

  <UploadDigestPanel />

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

      {grossRevenueModalOpen && grossRevenueReport && (
        <div className="modal-overlay report-modal-overlay" onClick={closeGrossRevenueModal}>
          <div className="detail-modal report-modal wide-report-modal" onClick={(e) => e.stopPropagation()}>
            <div className="detail-header report-modal-header">
              <div>
                <h2>{grossRevenueReport.reportLabel || 'Gross Revenue Totals'}</h2>
              </div>

              <button className="close-button" onClick={closeGrossRevenueModal}>
                Close
              </button>
            </div>

            <div className="modal-body report-modal-body">
              <GrossRevenueTotalsPreview />
            </div>
          </div>
        </div>
      )}

      <GrossRevenueDriverDetailModal />

      {driverSummaryModalOpen && driverSummaryReport && (
        <div className="modal-overlay report-modal-overlay" onClick={closeDriverSummaryModal}>
          <div className="detail-modal report-modal" onClick={(e) => e.stopPropagation()}>
            <div className="detail-header report-modal-header">
              <div>
                <h2>{driverSummaryReport.reportLabel} Driver Summary Report</h2>
           
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

      {ordersDueSettlementModalOpen && ordersDueSettlementReport && (
        <div className="modal-overlay report-modal-overlay" onClick={closeOrdersDueSettlementModal}>
          <div className="detail-modal report-modal" onClick={(e) => e.stopPropagation()}>
            <div className="detail-header report-modal-header">
              <div>
                <h2>{ordersDueSettlementReport.reportLabel || 'Orders Due for Settlement'}</h2>
                <p>Delivered Won/TONU orders with Final Settle not marked sent.</p>
              </div>

              <button className="close-button" onClick={closeOrdersDueSettlementModal}>
                Close
              </button>
            </div>

            <div className="modal-body report-modal-body">
              <OrdersDueSettlementPreview />
            </div>
          </div>
        </div>
      )}

      {weeklySettlementModalOpen && weeklySettlementReport && (
        <div className="modal-overlay report-modal-overlay" onClick={closeWeeklySettlementModal}>
          <div className="detail-modal report-modal" onClick={(e) => e.stopPropagation()}>
            <div className="detail-header report-modal-header">
              <div>
  <h2>{weeklySettlementReport.reportLabel || 'Weekly Settlement Report'}</h2>
  <p>Cutoff {weeklySettlementReport.cutoffLabel}</p>
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

      {wonNotRegisteredModalOpen && wonNotRegisteredReport && (
        <div className="modal-overlay report-modal-overlay" onClick={closeWonNotRegisteredModal}>
          <div className="detail-modal report-modal" onClick={(e) => e.stopPropagation()}>
            <div className="detail-header report-modal-header">
              <div>
                <h2>{wonNotRegisteredReport.reportLabel || 'Orders Won and Not Registered'}</h2>

              </div>

              <button className="close-button" onClick={closeWonNotRegisteredModal}>
                Close
              </button>
            </div>

            <div className="modal-body report-modal-body">
              <WonNotRegisteredPreview />
            </div>
          </div>
        </div>
      )}


      {inactiveDriverRosterModalOpen && inactiveDriverRosterReport && (
        <div className="modal-overlay report-modal-overlay" onClick={closeInactiveDriverRosterModal}>
          <div className="detail-modal report-modal" onClick={(e) => e.stopPropagation()}>
            <div className="detail-header report-modal-header">
              <div>
                <h2>{inactiveDriverRosterReport.reportLabel || 'Inactive Driver Roster'}</h2>
              </div>

              <button className="close-button" onClick={closeInactiveDriverRosterModal}>
                Close
              </button>
            </div>

            <div className="modal-body report-modal-body">
              <InactiveDriverRosterPreview />
            </div>
          </div>
        </div>
      )}

      {salesActivityModalOpen && salesActivityReport && (
        <div className="modal-overlay report-modal-overlay" onClick={closeSalesActivityModal}>
          <div className="detail-modal report-modal wide-report-modal sales-activity-modal" onClick={(e) => e.stopPropagation()}>
            <div className="detail-header report-modal-header">
              <div>
                <h2>Sales Activity Snapshot</h2>
                <p>{salesActivityReport.activityPeriodLabel || '-'} · Due window {salesActivityReport.duePeriodLabel || '-'}</p>
              </div>

              <button className="close-button" onClick={closeSalesActivityModal}>
                Close
              </button>
            </div>

            <div className="modal-body report-modal-body">
              <SalesActivitySnapshotPreview />
            </div>
          </div>
        </div>
      )}

      <DriverRosterModal />
      {SalesLeadProfileModal()}

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