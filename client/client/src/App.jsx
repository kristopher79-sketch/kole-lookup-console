import { useEffect, useMemo, useRef, useState } from 'react';
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
const AVAILABLE_TRUCK_MAX_ROWS = 8;
const SEARCH_RESULT_CACHE_MS = 2 * 60 * 1000;
const ON_THIS_DAY_CLIENT_CACHE_MS = 5 * 60 * 1000;
const ON_THIS_DAY_CLIENT_CACHE_LIMIT = 10;
const ORDER_NOTES_CLIENT_CACHE_MS = 60 * 1000;
const ORDER_NOTE_MAX_LENGTH = 20000;
const ORDER_NOTE_TYPE_OPTIONS = ['Dispatch', 'Paperwork', 'Permits', 'Billing', 'Operations'];
const DRIVER_TIME_OFF_REASON_OPTIONS = ['Home Time', 'Repairs'];
const RECRUITING_CANDIDATE_STATUS_OPTIONS = [
  'Heads-Up',
  'All',
  'Follow-Up Due',
  'Open QR Lines',
  'Prospect',
  'Applied',
  'Active Qualification',
  'Ready to Qualify',
  'Qualified',
  'Disqualified',
  'Withdrawn',
  'Dormant'
];
const RECRUITING_CLOSED_STATUSES = ['Qualified', 'Disqualified', 'Withdrawn', 'Dormant'];
const RECRUITING_HEADS_UP_STATUSES = ['Prospect', 'Applied', 'Active Qualification', 'Ready to Qualify'];
const RECRUITING_CANDIDATE_TYPE_OPTIONS = ['Solo', 'Team', 'Co-Driver', 'Unknown'];
const RECRUITING_SOURCE_OPTIONS = ['Website', 'Referral', 'Call-In', 'Facebook', 'Returning', 'Indeed', 'LinkedIn', 'Other'];
const RECRUITING_RELATIONSHIP_OPTIONS = ['Percentage', 'Company', 'Per Mile Solo', 'Absentee Owner Percentage', 'Unknown'];
const RECRUITING_NOTE_TYPE_OPTIONS = ['Call', 'Email', 'Follow-Up', 'Application', 'Qualification', 'Disqualification', 'Internal', 'System', 'Other'];
const RECRUITING_REQUIREMENT_RESULT_OPTIONS = ['Satisfactory', 'Unsatisfactory'];
const RECRUITING_TWIC_WAIVER_RESULT_OPTION = 'Satisfactory waived';
const RECRUITING_TWIC_WAIVER_STATUS = 'Waived';
const RECRUITING_CORE_REQUIREMENT_ORDER = ['Background Check', 'Drug Screen', 'MVR', 'Contract', 'Previous Employment', 'TWIC'];
const RECRUITING_PREVIEW_ROW_LIMIT = 8;
const RECRUITING_MANUAL_STATUS_OPTIONS = ['Prospect', 'Applied', 'Active Qualification', 'Disqualified', 'Withdrawn', 'Dormant'];
const RECRUITING_MANUAL_CLOSED_STATUS_OPTIONS = ['Disqualified', 'Withdrawn', 'Dormant'];
const DRIVER_ROSTER_PORT_STATUS_OPTIONS = ['Active', 'Inactive'];
const DRIVER_ROSTER_PORT_SOLO_TEAM_OPTIONS = ['Solo', 'Team'];
const DRIVER_ROSTER_PORT_DRIVER_TYPE_OPTIONS = ['%', 'Company', 'Per Mile Solo', 'Absentee Owner Percentage', 'Unknown'];
const DRIVER_ROSTER_PORT_TRAILER_TYPE_OPTIONS = [
  '',
  "53' Conestoga Stepdeck (Team)",
  "53' Conestoga Stepdeck (Solo)",
  "48' Conestoga Stepdeck (Solo)",
  "48' Conestoga Stepdeck (Team)",
  "48' RGN",
  "53' Stepdeck (Solo)",
  "53' Stepdeck (Team)",
  "53' Stepdeck Low Profile (Solo)",
  "53' Stepdeck Low Profile (Team)",
  "50' Stepdeck (Solo)",
  "48' Stepdeck (Solo)",
  "48' Stepdeck (Team)"
];
const DRIVER_ROSTER_PORT_UNIT_MAX_LENGTH = 17;
const RECRUITING_ROSTER_HANDOFF_STATUS = {
  NOT_NEEDED: 'Not Needed',
  PENDING: 'Pending',
  CREATED: 'Created',
  LINKED_EXISTING: 'Linked Existing',
  SKIPPED: 'Skipped'
};

function getRecruitingCandidateDisplayName(firstName = '', lastName = '') {
  return [firstName, lastName]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' ');
}

function createRecruitingCandidateDraft() {
  return {
    firstName: '',
    lastName: '',
    displayName: '',
    candidateType: 'Solo',
    teamId: '',
    primaryPhone: '',
    secondaryPhone: '',
    email: '',
    homeStreet: '',
    homeCity: '',
    homeState: '',
    homeZip: '',
    applicationDate: getEasternDateInputValue(),
    source: 'Referral',
    relationshipType: 'Percentage',
    ownsTruck: true,
    ownsTrailer: false
  };
}

function getRecruitingDriverRosterSoloOrTeam(candidateType = '') {
  const cleanType = String(candidateType || '').trim();

  if (cleanType === 'Team' || cleanType === 'Co-Driver') return 'Team';
  return 'Solo';
}

function limitDriverRosterPortUnitValue(value = '') {
  return String(value || '').slice(0, DRIVER_ROSTER_PORT_UNIT_MAX_LENGTH);
}

function getRecruitingDriverRosterPortTrailerUnitNumber(truck = '') {
  const cleanTruck = limitDriverRosterPortUnitValue(truck).trim();
  if (!cleanTruck) return '';

  const baseTruck = cleanTruck.length >= DRIVER_ROSTER_PORT_UNIT_MAX_LENGTH
    ? cleanTruck.slice(0, DRIVER_ROSTER_PORT_UNIT_MAX_LENGTH - 1)
    : cleanTruck;

  return `${baseTruck}A`.slice(0, DRIVER_ROSTER_PORT_UNIT_MAX_LENGTH);
}

function normalizeDriverRosterPortDriverType(value = '') {
  const cleanValue = String(value || '').trim();
  if (cleanValue.toLowerCase() === 'percentage') return '%';
  return cleanValue;
}

function createRecruitingDriverRosterPortDraft(candidate = {}) {
  const displayName = candidate.displayName || getRecruitingCandidateDisplayName(candidate.firstName, candidate.lastName) || candidate.title || '';
  const operatorTeamName = candidate.title || displayName;
  const truck = limitDriverRosterPortUnitValue(candidate.linkedDriveRosterTruck || '');
  const candidateDriverType = normalizeDriverRosterPortDriverType(candidate.relationshipType);
  const driverType = DRIVER_ROSTER_PORT_DRIVER_TYPE_OPTIONS.includes(candidateDriverType)
    ? candidateDriverType
    : (candidateDriverType || '%');

  return {
    operatorTeamName,
    tmsName: displayName || operatorTeamName,
    truck,
    pin: '',
    cellPhone1: candidate.primaryPhone || '',
    cellPhone2: candidate.secondaryPhone || '',
    emailAddress1: candidate.email || '',
    emailAddress2: '',
    status: 'Active',
    driverType,
    soloOrTeam: getRecruitingDriverRosterSoloOrTeam(candidate.type),
    bolLetterPrefix: '',
    trailerType: '',
    registeredWeight: '',
    startDate: getEasternDateInputValue(),
    tractorPlate: '',
    tractorYear: '',
    tractorMake: '',
    tractorVin: '',
    tractorOwner: displayName || operatorTeamName,
    tractorAxles: '',
    tractorRegisteredState: String(candidate.homeState || '').trim().toUpperCase(),
    trailerUnitNumber: getRecruitingDriverRosterPortTrailerUnitNumber(truck),
    trailerLength: '',
    trailerPlate: '',
    trailerRegisteredState: String(candidate.homeState || '').trim().toUpperCase(),
    trailerYear: '',
    trailerMake: '',
    trailerVin: '',
    trailerOwner: candidate.ownsTrailer ? (displayName || operatorTeamName) : '',
    trailerAxles: '',
    emptyWeight: '',
    steerAxleWeight: '',
    spacing1to2: '',
    spacing2to3: '',
    spacing3to4: '',
    spacing4to5: '',
    overallLength: '',
    lowestDeckHeight: ''
  };
}

function getRecruitingStatusClass(status) {
  const normalized = String(status || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `recruiting-status-pill ${normalized || 'unknown'}`;
}

function isRecruitingCandidateClosed(candidate) {
  return RECRUITING_CLOSED_STATUSES.includes(candidate?.status);
}

function getRequirementSortIndex(type) {
  const index = RECRUITING_CORE_REQUIREMENT_ORDER.indexOf(type);
  return index === -1 ? 999 : index;
}

function isRecruitingTwicRequirement(requirement) {
  return String(requirement?.type || '').trim().toLowerCase() === 'twic';
}

function isRecruitingTwicWaiverSelection(value) {
  return String(value || '').trim() === RECRUITING_TWIC_WAIVER_RESULT_OPTION;
}

function getRecruitingRequirementResultLabel(requirement) {
  const result = String(requirement?.result || '').trim();
  const status = String(requirement?.status || '').trim();

  if (isRecruitingTwicRequirement(requirement) && (status === RECRUITING_TWIC_WAIVER_STATUS || (result === 'Satisfactory' && requirement?.required === false))) {
    return RECRUITING_TWIC_WAIVER_STATUS;
  }

  return result || status || 'Pending';
}


function normalizeDriverTimeOffReason(value) {
  const normalized = String(value || '').trim().toLowerCase();

  if (normalized.includes('repair')) return 'Repairs';
  return 'Home Time';
}

const STARTUP_SPLASH_MIN_MS = 5000;
const STARTUP_SPLASH_EXIT_MS = 420;
const STARTUP_SPLASH_FAKE_LIGHTS_COMPLETE_MS = 4600;
const KOLE_THEME_STORAGE_KEY = 'koleConnectTheme';
const KOLE_USER_PREFS_STORAGE_KEY = 'koleConnectUserPreferences';
const DRIVER_TIME_OFF_PANE_OPTIONS = ['current', 'ended', 'starting-soon'];
const SALES_AND_LEADS_PANEL_KEYS = ['customerBookingTrends', 'salesActivity', 'leadSuppression', 'salesLeads'];

const DEFAULT_KOLE_USER_PREFERENCES = {
  driverRosterDefaultOpen: false,
  driverTimeOffDefaultOpen: false,
  driverTimeOffDefaultPane: 'current',
  uploadDigestDefaultOpen: false,
  intelliTrackDefaultOpen: false,
  availableTrucksDefaultOpen: false,
  hideOperationsToday: false,
  hideUploadDigest: false,
  hideIntelliTrack: false,
  hideAvailableTrucks: false,
  salesAndLeadsDefaultOpen: false,
  operationsNext7DefaultClosed: false,
  reportsDefaultOpen: false,
  hideSalesAndLeads: false,
  compactDashboardMode: false,
  orderCardView: false,
  hideYearlyProjection: false,
  hideOnThisDay: false,
  hideWeeklySettlementReport: false,
  hideRecruiting: false,
  recruitingDefaultOpen: true,
  skipStartupSplash: false
};

function getSavedKoleTheme() {
  try {
    return localStorage.getItem(KOLE_THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch (err) {
    return 'dark';
  }
}

function normalizeKoleUserPreferences(value = {}) {
  const prefs = {
    ...DEFAULT_KOLE_USER_PREFERENCES,
    ...(value && typeof value === 'object' ? value : {})
  };

  if (!DRIVER_TIME_OFF_PANE_OPTIONS.includes(prefs.driverTimeOffDefaultPane)) {
    prefs.driverTimeOffDefaultPane = DEFAULT_KOLE_USER_PREFERENCES.driverTimeOffDefaultPane;
  }

  Object.keys(DEFAULT_KOLE_USER_PREFERENCES).forEach((key) => {
    if (key !== 'driverTimeOffDefaultPane') {
      prefs[key] = Boolean(prefs[key]);
    }
  });

  return prefs;
}

function getSavedKoleUserPreferences() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KOLE_USER_PREFS_STORAGE_KEY) || '{}');
    return normalizeKoleUserPreferences(parsed);
  } catch (err) {
    return { ...DEFAULT_KOLE_USER_PREFERENCES };
  }
}

function saveKoleUserPreferences(preferences) {
  try {
    localStorage.setItem(KOLE_USER_PREFS_STORAGE_KEY, JSON.stringify(normalizeKoleUserPreferences(preferences)));
  } catch (err) {
    // Local storage may be unavailable in a locked-down webview; preferences still work for this session.
  }
}

function getStartupStepClass(state) {
  return `startup-splash-step ${state === 'complete' ? 'complete' : ''} ${state === 'active' ? 'active' : ''}`.trim();
}

function StartupSplashStep({ label, detail, state = 'waiting' }) {
  return (
    <li className={getStartupStepClass(state)}>
      <span className="startup-splash-step-dot" aria-hidden="true" />
      <div>
        <strong>{label}</strong>
        {detail && <small>{detail}</small>}
      </div>
    </li>
  );
}

function KoleStartupSplash({
  exiting = false,
  operationsData,
  operationsError,
  uploadDigestData,
  uploadDigestError,
  reportActionAlerts,
  reportActionAlertsError,
  fakeProgressMs = 0,
  onSkip
}) {
  const operationsSettled = Boolean(operationsData || operationsError);
  const uploadsSettled = Boolean(uploadDigestData || uploadDigestError || fakeProgressMs >= 1800);
  const reportsSettled = Boolean(reportActionAlerts || reportActionAlertsError || fakeProgressMs >= 3200);
  const driverSnapshotsSettled = fakeProgressMs >= STARTUP_SPLASH_FAKE_LIGHTS_COMPLETE_MS;

  return (
    <div
      className={`startup-splash-overlay ${exiting ? 'startup-splash-exiting' : ''}`}
      role="status"
      aria-live="polite"
      aria-label="Kole Connect is loading"
    >
      <div className="startup-splash-card">
        <div className="startup-splash-orbit" aria-hidden="true" />
        <img src={koleLogo} alt="Kole Trucking" className="startup-splash-logo" />
        <div className="startup-splash-route" aria-hidden="true">
          <span />
        </div>
        <h2>Kole Connect Online Status</h2>
        <p>Loading Operations Today and staging the dashboard.</p>

        <ul className="startup-splash-steps">
          <StartupSplashStep
            label="Access token accepted"
            detail="Kole Connect session authenticated"
            state="complete"
          />
          <StartupSplashStep
            label="Loading Operations Today"
            detail={operationsSettled ? 'Active loads are ready' : 'Active jobs, loading today, delivering today'}
            state={operationsSettled ? 'complete' : 'active'}
          />
          <StartupSplashStep
            label="Checking job uploads"
            detail={uploadsSettled ? 'Upload digest checked' : 'Pickup and delivery photos'}
            state={operationsSettled ? (uploadsSettled ? 'complete' : 'active') : 'waiting'}
          />
          <StartupSplashStep
            label="Scanning report alerts"
            detail={reportsSettled ? 'Report alerts checked' : 'Operational alerts standing by'}
            state={uploadsSettled ? (reportsSettled ? 'complete' : 'active') : 'waiting'}
          />
          <StartupSplashStep
            label="Staging drilldowns"
            detail={driverSnapshotsSettled ? 'Driver drilldowns staged' : 'Performance tools standing by'}
            state={reportsSettled ? (driverSnapshotsSettled ? 'complete' : 'active') : 'waiting'}
          />
        </ul>

        <div className="startup-splash-footer">
          <span>{operationsSettled ? 'Operations Today is ready. Finishing the light show.' : 'Operations Today usually takes a few seconds.'}</span>
          <button type="button" onClick={onSkip}>Skip</button>
        </div>
      </div>
    </div>
  );
}

function KoleBrandTitle({ animate = false, revealKey = 0, subtitle }) {
  return (
    <div className={`kole-brand-title-zone ${animate ? 'brand-reveal-active' : ''}`}>
      <div className="brand-static-copy" aria-hidden={animate ? 'true' : undefined}>
        <h1 className="brand-title-text">Kole Connect</h1>
        {subtitle && <p className="brand-subtitle-text">{subtitle}</p>}
      </div>

      {animate && (
        <div key={revealKey} className="brand-reveal-stage" aria-hidden="true">
          <h1 className="brand-reveal-target">Kole Connect</h1>

          <div className="brand-cloud-field">
            <span className="brand-cloud brand-cloud-one" />
            <span className="brand-cloud brand-cloud-two" />
            <span className="brand-cloud brand-cloud-three" />
            <span className="brand-cloud brand-cloud-four" />
            <span className="brand-cloud brand-cloud-five" />
            <span className="brand-cloud brand-cloud-six" />
          </div>

          <span className="brand-plane-symbol">
            <svg viewBox="0 0 128 56" role="img" aria-label="Small airplane flying right">
              <g className="brand-plane-drawing">
                <path
                  className="brand-plane-tail"
                  d="M20 24L5 10h14l19 14H20Zm0 12L5 48h14l19-12H20Z"
                />
                <path
                  className="brand-plane-body"
                  d="M18 23h70c15 0 28 6 36 14-8 8-21 13-36 13H18c-7 0-12-6-12-13s5-14 12-14Z"
                />
                <path
                  className="brand-plane-wing"
                  d="M61 29L39 6h16l31 25-6 5-19-7Zm0 13L42 55h16l28-15-5-5-20 7Z"
                />
                <path
                  className="brand-plane-nose"
                  d="M92 24c12 2 24 7 32 13-8 7-20 11-32 13 5-7 5-18 0-26Z"
                />
                <path
                  className="brand-plane-window-line"
                  d="M27 31h49"
                />
                <circle className="brand-plane-window" cx="36" cy="31" r="2.2" />
                <circle className="brand-plane-window" cx="48" cy="31" r="2.2" />
                <circle className="brand-plane-window" cx="60" cy="31" r="2.2" />
                <circle className="brand-plane-window" cx="72" cy="31" r="2.2" />
              </g>
            </svg>
          </span>

          <div className="brand-roll-back">
            <h1>Kole Connect</h1>
            {subtitle && <p>{subtitle}</p>}
          </div>
        </div>
      )}
    </div>
  );
}


function getClientCacheRecord(cache, key, ttlMs) {
  const cached = cache.get(key);
  if (!cached) return null;

  if (Date.now() - cached.cachedAt > ttlMs) {
    cache.delete(key);
    return null;
  }

  return cached.value;
}

function setLimitedClientCacheRecord(cache, key, value, maxEntries = 20) {
  if (cache.has(key)) cache.delete(key);

  cache.set(key, {
    cachedAt: Date.now(),
    value
  });

  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }

  return value;
}

function createAvailableTruckDraftRow(seed = Date.now()) {
  return {
    key: `${seed}-${Math.random().toString(36).slice(2, 9)}`,
    rosterDriverKey: '',
    driverName: '',
    unitNo: '',
    equipmentType: '',
    currentLocation: '',
    proximity1: '',
    proximity1Time: '',
    proximity2: '',
    proximity2Time: '',
    proximity3: '',
    proximity3Time: '',
    proximity4: '',
    proximity4Time: ''
  };
}

function getDefaultAvailableTruckTimeOfDay() {
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    hour12: false
  }).format(new Date()));

  if (hour < 12) return 'AM';
  if (hour < 17) return 'PM';
  return 'Evening';
}

function hasAvailableTruckDraftData(row) {
  return Boolean(
    row.driverName ||
    row.unitNo ||
    row.equipmentType ||
    row.currentLocation ||
    row.proximity1 ||
    row.proximity1Time ||
    row.proximity2 ||
    row.proximity2Time ||
    row.proximity3 ||
    row.proximity3Time ||
    row.proximity4 ||
    row.proximity4Time
  );
}


function normalizeSearchValue(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeAvailableTruckSuggestionKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getAvailableTruckRowSuggestionGroup(row, suggestionIndex = {}) {
  const key = normalizeAvailableTruckSuggestionKey(row?.currentLocation);
  if (!key) return null;

  return suggestionIndex?.[key] || null;
}


function getMailtoLink(email) {
  const clean = String(email || '').trim();
  if (!clean) return '';

  return `mailto:${clean}`;
}

async function openEmailLink(email, event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  const url = getMailtoLink(email);
  if (!url) return;

  await openExternalLink(url);
}

function EmailLink({ email }) {
  const clean = String(email || '').trim();
  if (!clean) return <>-</>;

  return (
    <a
      className="email-link"
      href={getMailtoLink(clean)}
      onClick={(event) => openEmailLink(clean, event)}
      title={`Compose email to ${clean}`}
    >
      {clean}
    </a>
  );
}


function AvailableTruckFormRow({
  row,
  index,
  canRemove,
  submitting,
  driverOptions = [],
  selectedRosterDriverKeys = new Set(),
  suggestionGroup = null,
  onSelectDriver,
  onUpdate,
  onApplySuggestion,
  onRemove
}) {
  const rowNumber = index + 1;
  const hasRosterOptions = driverOptions.length > 0;
  const isRosterLocked = Boolean(row.rosterDriverKey);
  const currentLocationLabel = String(row.currentLocation || '').trim();
  const hasCurrentLocation = Boolean(currentLocationLabel);
  const currentLocationSuggestionKey = normalizeAvailableTruckSuggestionKey(currentLocationLabel);
  const historicalSuggestionMatches = suggestionGroup?.suggestions || [];
  const immediateSuggestion = hasCurrentLocation
    ? {
        key: `immediate-${currentLocationSuggestionKey}`,
        location: currentLocationLabel,
        timeLabel: 'Immediate',
        count: suggestionGroup?.sourceRecordCount || 0,
        isImmediate: true
      }
    : null;
  const suggestionMatches = [
    immediateSuggestion,
    ...historicalSuggestionMatches.filter((suggestion) =>
      normalizeAvailableTruckSuggestionKey(suggestion?.location) !== currentLocationSuggestionKey
    )
  ].filter(Boolean);

  return (
    <div className="available-truck-form-row-card">
      <div className="available-truck-form-row-header">
        <div>
          <strong>Truck {rowNumber}</strong>
          <span>Choose an active roster driver; unit and equipment fill from Driver Roster.</span>
        </div>
        {canRemove && (
          <button
            type="button"
            className="danger-button compact-action-button"
            onClick={() => onRemove(row.key)}
            disabled={submitting}
          >
            Remove
          </button>
        )}
      </div>

      <div className="available-truck-main-grid">
        <label>
          <span>Driver Name</span>
          {hasRosterOptions ? (
            <select
              value={row.rosterDriverKey || ''}
              onChange={(e) => onSelectDriver(row.key, e.target.value)}
              disabled={submitting}
            >
              <option value="">Select active driver</option>
              {driverOptions.map((option) => {
                const disabledElsewhere =
                  option.key !== row.rosterDriverKey && selectedRosterDriverKeys.has(option.key);

                return (
                  <option key={option.key} value={option.key} disabled={disabledElsewhere}>
                    {option.driverName || option.unitNo || 'Unnamed driver'}{disabledElsewhere ? ' · already selected' : ''}
                  </option>
                );
              })}
            </select>
          ) : (
            <input
              value={row.driverName}
              onChange={(e) => onUpdate(row.key, 'driverName', e.target.value)}
              placeholder="Driver / team"
              disabled={submitting}
            />
          )}
          <small className="available-truck-field-hint">
            {hasRosterOptions
              ? (row.driverName ? `Posting as ${row.driverName}` : 'Active Driver Roster is the source of truth.')
              : 'Roster options unavailable; manual entry is still allowed.'}
          </small>
        </label>
        <label>
          <span>Unit No</span>
          <input
            value={row.unitNo}
            onChange={(e) => onUpdate(row.key, 'unitNo', e.target.value)}
            placeholder="Truck #"
            readOnly={isRosterLocked}
            disabled={submitting}
          />
        </label>
        <label>
          <span>Equipment Type</span>
          <input
            value={row.equipmentType}
            onChange={(e) => onUpdate(row.key, 'equipmentType', e.target.value)}
            placeholder="Solo stepdeck, RGN, etc."
            readOnly={isRosterLocked}
            disabled={submitting}
          />
        </label>
        <label>
          <span>Current Location</span>
          <input
            value={row.currentLocation}
            onChange={(e) => onUpdate(row.key, 'currentLocation', e.target.value)}
            placeholder="City, ST"
            disabled={submitting}
          />
        </label>
      </div>

      {hasCurrentLocation && (
        <div className="available-truck-suggestion-box">
          <div className="available-truck-suggestion-header">
            <strong>Suggested proximity from past postings</strong>
            <span>
              {suggestionMatches.length > 0
                ? `${suggestionMatches.length} suggestion${suggestionMatches.length === 1 ? '' : 's'} for ${suggestionGroup?.currentLocation || row.currentLocation}`
                : `No saved suggestion matches for ${row.currentLocation}`}
            </span>
          </div>

          {suggestionMatches.length > 0 && (
            <div className="available-truck-suggestion-list">
              {suggestionMatches.slice(0, 8).map((suggestion) => (
                <button
                  key={suggestion.key || suggestion.location}
                  type="button"
                  className="available-truck-suggestion-chip"
                  onClick={() => onApplySuggestion(row.key, suggestion)}
                  disabled={submitting}
                  title="Fill the next open proximity city/time slot"
                >
                  <strong>{suggestion.location}</strong>
                  <span>
                    {suggestion.isImmediate
                      ? 'Immediate · current location'
                      : `${suggestion.timeLabel || 'time varies'} · ${suggestion.count} prior use${suggestion.count === 1 ? '' : 's'}`}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="available-truck-proximity-grid">
        {[1, 2, 3, 4].map((rank) => (
          <div key={`${row.key}-proximity-${rank}`} className="available-truck-proximity-pair">
            <label>
              <span>City {rank}</span>
              <input
                value={row[`proximity${rank}`]}
                onChange={(e) => onUpdate(row.key, `proximity${rank}`, e.target.value)}
                placeholder="City, ST"
                disabled={submitting}
              />
            </label>
            <label>
              <span>Time {rank}</span>
              <input
                value={row[`proximity${rank}Time`]}
                onChange={(e) => onUpdate(row.key, `proximity${rank}Time`, e.target.value)}
                placeholder="2 hrs, AM, etc."
                disabled={submitting}
              />
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}


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

function sortAvailableTruckDistributionRowsForDisplay(rows, sortField = 'company', sortDirection = 'asc') {
  const field = sortField === 'email' ? 'email' : 'company';
  const direction = sortDirection === 'desc' ? -1 : 1;

  return [...(rows || [])].sort((a, b) => {
    const primaryCompare = String(a?.[field] || '').localeCompare(String(b?.[field] || ''), undefined, {
      sensitivity: 'base',
      numeric: true
    });

    if (primaryCompare !== 0) return primaryCompare * direction;

    const secondaryField = field === 'company' ? 'email' : 'company';
    return String(a?.[secondaryField] || '').localeCompare(String(b?.[secondaryField] || ''), undefined, {
      sensitivity: 'base',
      numeric: true
    });
  });
}


function normalizeDriverHistoryTruckKey(value) {
  const cleaned = String(value || '').trim().toUpperCase();

  if (!cleaned) return '';

  if (/^0*\d+$/.test(cleaned)) {
    return cleaned.replace(/^0+(?=\d)/, '').padStart(4, '0');
  }

  return cleaned.replace(/[^A-Z0-9]+/g, '');
}

function getDriverHistoryTruckFromCard(card) {
  return String(card?.roster?.truck || card?.equipmentId || card?.truck || '').trim();
}


export default function App() {
  const [accessToken, setAccessToken] = useState(() => sessionStorage.getItem('koleLookupToken') || '');
  const [password, setPassword] = useState('');
  const [colorTheme, setColorTheme] = useState(getSavedKoleTheme);
  const [userPrefs, setUserPrefs] = useState(getSavedKoleUserPreferences);
  const [preferencesModalOpen, setPreferencesModalOpen] = useState(false);
  const [brandRevealActive, setBrandRevealActive] = useState(false);
  const [brandRevealKey, setBrandRevealKey] = useState(0);
  const brandRevealTimerRef = useRef(null);
  const lastRefreshCueAtRef = useRef(0);
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
  const [orderReturnTrailLabel, setOrderReturnTrailLabel] = useState('');
  const [orderDrilldownReturn, setOrderDrilldownReturn] = useState(null);
  const [statusFilter, setStatusFilter] = useState('All');
  const [includeArchives, setIncludeArchives] = useState(false);
  const [documentLoading, setDocumentLoading] = useState('');
  const [documentError, setDocumentError] = useState('');
  const [orderNotesData, setOrderNotesData] = useState(null);
  const [orderNotesLoading, setOrderNotesLoading] = useState(false);
  const [orderNotesError, setOrderNotesError] = useState('');
  const [orderNotesTypeFilter, setOrderNotesTypeFilter] = useState('All');
  const [orderNoteComposerOpen, setOrderNoteComposerOpen] = useState(false);
  const [orderNoteDraftType, setOrderNoteDraftType] = useState('Dispatch');
  const [orderNoteDraftBody, setOrderNoteDraftBody] = useState('');
  const [orderNoteSaving, setOrderNoteSaving] = useState(false);
  const [orderNoteSaveMessage, setOrderNoteSaveMessage] = useState('');
  const [orderNoteSaveError, setOrderNoteSaveError] = useState('');
  const [operationsData, setOperationsData] = useState(null);
  const [operationsLoading, setOperationsLoading] = useState(false);
  const [operationsError, setOperationsError] = useState('');
  const [driverPositionsData, setDriverPositionsData] = useState(null);
  const [driverPositionsLoading, setDriverPositionsLoading] = useState(false);
  const [driverPositionsError, setDriverPositionsError] = useState('');
  const [driverRosterAccordionOpen, setDriverRosterAccordionOpen] = useState(() => userPrefs.driverRosterDefaultOpen);
  const [driverTimeOffAccordionOpen, setDriverTimeOffAccordionOpen] = useState(() => userPrefs.driverTimeOffDefaultOpen);
  const [driverTimeOffPaneFilter, setDriverTimeOffPaneFilter] = useState(() => userPrefs.driverTimeOffDefaultPane);
  const [selectedDriverRoster, setSelectedDriverRoster] = useState(null);
  const [driverHistoryModalOpen, setDriverHistoryModalOpen] = useState(false);
  const [driverHistorySnapshot, setDriverHistorySnapshot] = useState(null);
  const [driverHistoryLoading, setDriverHistoryLoading] = useState(false);
  const [driverHistoryError, setDriverHistoryError] = useState('');
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
  const [yearlyProjectionYear, setYearlyProjectionYear] = useState(() => new Date().getFullYear());
  const [yearlyProjectionReport, setYearlyProjectionReport] = useState(null);
  const [yearlyProjectionLoading, setYearlyProjectionLoading] = useState(false);
  const [yearlyProjectionError, setYearlyProjectionError] = useState(null);
  const [yearlyProjectionModalOpen, setYearlyProjectionModalOpen] = useState(false);
  const [yearlyProjectionCustomOpen, setYearlyProjectionCustomOpen] = useState(false);
  const [yearlyProjectionCustomName, setYearlyProjectionCustomName] = useState('What if');
  const [yearlyProjectionCustomDriverCount, setYearlyProjectionCustomDriverCount] = useState('');
  const [openGrossRevenueQuarters, setOpenGrossRevenueQuarters] = useState([]);
  const [selectedGrossRevenueTruck, setSelectedGrossRevenueTruck] = useState(null);
  const [selectedGrossRevenueMonth, setSelectedGrossRevenueMonth] = useState(null);
  const [projectionRevenueDrilldownLoadingTruck, setProjectionRevenueDrilldownLoadingTruck] = useState('');
  const [projectionRevenueDrilldownError, setProjectionRevenueDrilldownError] = useState('');
  const [driverSummaryReport, setDriverSummaryReport] = useState(null);
  const [driverSummaryLoading, setDriverSummaryLoading] = useState(false);
  const [driverSummaryError, setDriverSummaryError] = useState(null);
  const [driverSummaryModalOpen, setDriverSummaryModalOpen] = useState(false);
  const [driverSummaryPdfLoading, setDriverSummaryPdfLoading] = useState(false);
  const [driverSummaryPdfError, setDriverSummaryPdfError] = useState('');
  const [monthlyOpsMonth, setMonthlyOpsMonth] = useState(() => initialReportDate.getMonth() + 1);
  const [monthlyOpsYear, setMonthlyOpsYear] = useState(() => initialReportDate.getFullYear());
  const [monthlyOpsReport, setMonthlyOpsReport] = useState(null);
  const [monthlyOpsLoading, setMonthlyOpsLoading] = useState(false);
  const [monthlyOpsError, setMonthlyOpsError] = useState(null);
  const [monthlyOpsModalOpen, setMonthlyOpsModalOpen] = useState(false);
  const [selectedMonthlyOpsDrilldown, setSelectedMonthlyOpsDrilldown] = useState(null);
  const [monthlyOpsPdfLoading, setMonthlyOpsPdfLoading] = useState(false);
  const [monthlyOpsPdfError, setMonthlyOpsPdfError] = useState('');
  const [pdfExportNotice, setPdfExportNotice] = useState(null);
  const [settlementCutoffDate, setSettlementCutoffDate] = useState(getDefaultSettlementCutoffDate);
  const [ordersDueSettlementReport, setOrdersDueSettlementReport] = useState(null);
  const [ordersDueSettlementLoading, setOrdersDueSettlementLoading] = useState(false);
  const [ordersDueSettlementError, setOrdersDueSettlementError] = useState(null);
  const [ordersDueSettlementModalOpen, setOrdersDueSettlementModalOpen] = useState(false);
  const [weeklySettlementReport, setWeeklySettlementReport] = useState(null);
  const [weeklySettlementLoading, setWeeklySettlementLoading] = useState(false);
  const [weeklySettlementError, setWeeklySettlementError] = useState(null);
  const [weeklySettlementModalOpen, setWeeklySettlementModalOpen] = useState(false);
  const [weeklySettlementPdfLoading, setWeeklySettlementPdfLoading] = useState(false);
  const [weeklySettlementPdfError, setWeeklySettlementPdfError] = useState('');
  const [wonNotRegisteredReport, setWonNotRegisteredReport] = useState(null);
  const [wonNotRegisteredLoading, setWonNotRegisteredLoading] = useState(false);
  const [wonNotRegisteredError, setWonNotRegisteredError] = useState(null);
  const [wonNotRegisteredModalOpen, setWonNotRegisteredModalOpen] = useState(false);
  const [permitGovernanceReport, setPermitGovernanceReport] = useState(null);
  const [permitGovernanceLoading, setPermitGovernanceLoading] = useState(false);
  const [permitGovernanceError, setPermitGovernanceError] = useState(null);
  const [permitGovernanceModalOpen, setPermitGovernanceModalOpen] = useState(false);
  const [permitGovernanceFilter, setPermitGovernanceFilter] = useState('currentlyPermitted');
  const [selectedPermitHistoryLoad, setSelectedPermitHistoryLoad] = useState(null);
  const [permitHistoryOrderReturnLoad, setPermitHistoryOrderReturnLoad] = useState(null);
  const [reportActionAlerts, setReportActionAlerts] = useState(null);
  const [reportActionAlertsLoading, setReportActionAlertsLoading] = useState(false);
  const [reportActionAlertsError, setReportActionAlertsError] = useState('');
  const [activeDriverRosterReport, setActiveDriverRosterReport] = useState(null);
  const [activeDriverRosterLoading, setActiveDriverRosterLoading] = useState(false);
  const [activeDriverRosterError, setActiveDriverRosterError] = useState(null);
  const [activeDriverRosterModalOpen, setActiveDriverRosterModalOpen] = useState(false);
  const [activeDriverRosterPdfLoading, setActiveDriverRosterPdfLoading] = useState(false);
  const [activeDriverRosterPdfError, setActiveDriverRosterPdfError] = useState('');
  const [inactiveDriverRosterReport, setInactiveDriverRosterReport] = useState(null);
  const [inactiveDriverRosterLoading, setInactiveDriverRosterLoading] = useState(false);
  const [inactiveDriverRosterError, setInactiveDriverRosterError] = useState(null);
  const [inactiveDriverRosterModalOpen, setInactiveDriverRosterModalOpen] = useState(false);
  const [inactiveDriverRosterPdfLoading, setInactiveDriverRosterPdfLoading] = useState(false);
  const [inactiveDriverRosterPdfError, setInactiveDriverRosterPdfError] = useState('');
  const [fleetEquipmentStatus, setFleetEquipmentStatus] = useState('active');
  const [fleetEquipmentReport, setFleetEquipmentReport] = useState(null);
  const [fleetEquipmentLoading, setFleetEquipmentLoading] = useState(false);
  const [fleetEquipmentError, setFleetEquipmentError] = useState(null);
  const [fleetEquipmentModalOpen, setFleetEquipmentModalOpen] = useState(false);
  const [fleetEquipmentPdfLoading, setFleetEquipmentPdfLoading] = useState(false);
  const [fleetEquipmentPdfError, setFleetEquipmentPdfError] = useState('');
  const [onThisDayDate, setOnThisDayDate] = useState(getEasternDateInputValue);
  const [onThisDayMode, setOnThisDayMode] = useState('exact');
  const [onThisDayReport, setOnThisDayReport] = useState(null);
  const [onThisDayLoading, setOnThisDayLoading] = useState(false);
  const [onThisDayError, setOnThisDayError] = useState(null);
  const [onThisDayModalOpen, setOnThisDayModalOpen] = useState(false);
  const [onThisDayPdfLoading, setOnThisDayPdfLoading] = useState(false);
  const [onThisDayPdfError, setOnThisDayPdfError] = useState('');
  const [operationalNotesReport, setOperationalNotesReport] = useState(null);
  const [operationalNotesLoading, setOperationalNotesLoading] = useState(false);
  const [operationalNotesError, setOperationalNotesError] = useState(null);
  const [operationalNotesModalOpen, setOperationalNotesModalOpen] = useState(false);
  const [operationalNotesTypeFilter, setOperationalNotesTypeFilter] = useState('Dispatch');
  const [operationalNotesOpenOrderKey, setOperationalNotesOpenOrderKey] = useState('');
  const [operationalNotesOpenOrderError, setOperationalNotesOpenOrderError] = useState('');
  const [noAvailabilityYear, setNoAvailabilityYear] = useState(() => String(new Date().getFullYear()));
  const [noAvailabilityReport, setNoAvailabilityReport] = useState(null);
  const [noAvailabilityLoading, setNoAvailabilityLoading] = useState(false);
  const [noAvailabilityError, setNoAvailabilityError] = useState(null);
  const [noAvailabilityPdfLoading, setNoAvailabilityPdfLoading] = useState(false);
  const [noAvailabilityPdfError, setNoAvailabilityPdfError] = useState('');
  const [noAvailabilityModalOpen, setNoAvailabilityModalOpen] = useState(false);
  const [driverTimeOffYear, setDriverTimeOffYear] = useState(() => new Date().getFullYear());
  const [driverTimeOffReport, setDriverTimeOffReport] = useState(null);
  const [driverTimeOffLoading, setDriverTimeOffLoading] = useState(false);
  const [driverTimeOffError, setDriverTimeOffError] = useState(null);
  const [driverTimeOffModalOpen, setDriverTimeOffModalOpen] = useState(false);
  const [driverTimeOffReportFilter, setDriverTimeOffReportFilter] = useState(null);
  const [driverTimeOffFormOpen, setDriverTimeOffFormOpen] = useState(false);
  const [driverTimeOffEditingRecord, setDriverTimeOffEditingRecord] = useState(null);
  const [driverTimeOffSubmitting, setDriverTimeOffSubmitting] = useState(false);
  const [driverTimeOffActionMessage, setDriverTimeOffActionMessage] = useState('');
  const [driverTimeOffActionError, setDriverTimeOffActionError] = useState('');
  const [showRecentlyEndedTimeOff, setShowRecentlyEndedTimeOff] = useState(false);
  const [driverTimeOffDraft, setDriverTimeOffDraft] = useState(() => ({
    rosterDriverKey: '',
    operatorName: '',
    truckNumber: '',
    startDate: getEasternDateInputValue(),
    endDate: getEasternDateInputValue(),
    reason: 'Home Time',
    status: 'Active'
  }));
  const [activeReportPanel, setActiveReportPanel] = useState('');
  const [openReportGroups, setOpenReportGroups] = useState([]);
  const [salesLeadsView, setSalesLeadsView] = useState('all');
  const [salesLeadsSort, setSalesLeadsSort] = useState('name');
  const [leadSuppressionView, setLeadSuppressionView] = useState('suppressed');
  const [leadSuppressionSort, setLeadSuppressionSort] = useState('name');
  const [salesLeadsReport, setSalesLeadsReport] = useState(null);
  const [salesLeadsLoading, setSalesLeadsLoading] = useState(false);
  const [salesLeadsError, setSalesLeadsError] = useState(null);
  const [salesSuppressionPdfLoading, setSalesSuppressionPdfLoading] = useState(false);
  const [salesSuppressionPdfError, setSalesSuppressionPdfError] = useState('');
  const [salesActivityLookbackDays, setSalesActivityLookbackDays] = useState(7);
  const [salesActivityReport, setSalesActivityReport] = useState(null);
  const [salesActivityModalOpen, setSalesActivityModalOpen] = useState(false);
  const [salesActivityLoading, setSalesActivityLoading] = useState(false);
  const [salesActivityError, setSalesActivityError] = useState(null);
  const [salesActivityPdfLoading, setSalesActivityPdfLoading] = useState(false);
  const [salesActivityPdfError, setSalesActivityPdfError] = useState('');
  const [driverTimeOffPdfLoading, setDriverTimeOffPdfLoading] = useState(false);
  const [driverTimeOffPdfError, setDriverTimeOffPdfError] = useState('');
  const [customerTrendMonth, setCustomerTrendMonth] = useState(() => initialReportDate.getMonth() + 1);
  const [customerTrendYear, setCustomerTrendYear] = useState(() => initialReportDate.getFullYear());
  const [customerTrendReport, setCustomerTrendReport] = useState(null);
  const [customerTrendModalOpen, setCustomerTrendModalOpen] = useState(false);
  const [customerTrendLoading, setCustomerTrendLoading] = useState(false);
  const [customerTrendError, setCustomerTrendError] = useState(null);
  const [customerTrendBucket, setCustomerTrendBucket] = useState('all');
  const [customerTrendSort, setCustomerTrendSort] = useState('revenue');
  const [selectedCustomerTrend, setSelectedCustomerTrend] = useState(null);
  const [selectedSalesLead, setSelectedSalesLead] = useState(null);
  const [customerLookupLoading, setCustomerLookupLoading] = useState(false);
  const [customerLookupError, setCustomerLookupError] = useState('');
  const [driverLookupLoading, setDriverLookupLoading] = useState(false);
  const [driverLookupError, setDriverLookupError] = useState('');
  const [salesSearchReturnLead, setSalesSearchReturnLead] = useState(null);
  const [salesNoteDraft, setSalesNoteDraft] = useState('');
  const [salesNoteSaving, setSalesNoteSaving] = useState(false);
  const [salesNoteMessage, setSalesNoteMessage] = useState('');
  const [salesNoteError, setSalesNoteError] = useState('');
  const [salesLeadSuppressionReason, setSalesLeadSuppressionReason] = useState('');
  const [salesLeadSuppressionSaving, setSalesLeadSuppressionSaving] = useState(false);
  const [salesLeadSuppressionMessage, setSalesLeadSuppressionMessage] = useState('');
  const [salesLeadSuppressionError, setSalesLeadSuppressionError] = useState('');
  const salesLeadsPrewarmStartedRef = useRef(false);
  const searchCacheRef = useRef(new Map());
  const pendingSearchControllerRef = useRef(null);
  const onThisDayReportCacheRef = useRef(new Map());
  const driverHistoryRequestRef = useRef(0);
  const driverHistoryCacheRef = useRef(new Map());
  const orderNotesCacheRef = useRef(new Map());
  const orderNotesRequestRef = useRef(0);
  const startupSplashStartedAtRef = useRef(Date.now());
  const startupSplashCloseTimerRef = useRef(null);
  const operationsActiveTodayRef = useRef(null);
  const operationsLoadingTodayRef = useRef(null);
  const operationsDeliveringTodayRef = useRef(null);
  const operationsLoadingNext7Ref = useRef(null);

  const [operationsNext7Open, setOperationsNext7Open] = useState(() => !userPrefs.operationsNext7DefaultClosed);
  const [authError, setAuthError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginStatusMessage, setLoginStatusMessage] = useState('');
  const [startupSplashVisible, setStartupSplashVisible] = useState(() => Boolean(sessionStorage.getItem('koleLookupToken')) && !userPrefs.skipStartupSplash);
  const [startupSplashExiting, setStartupSplashExiting] = useState(false);
  const [startupSplashDismissed, setStartupSplashDismissed] = useState(false);
  const [startupSplashElapsedMs, setStartupSplashElapsedMs] = useState(0);
  const [uploadDigestDate, setUploadDigestDate] = useState(getEasternDateInputValue);
  const [uploadDigestData, setUploadDigestData] = useState(null);
  const [uploadDigestLoading, setUploadDigestLoading] = useState(false);
  const [uploadDigestError, setUploadDigestError] = useState('');
  const [uploadDigestActionError, setUploadDigestActionError] = useState('');
  const [uploadDigestSectionOpen, setUploadDigestSectionOpen] = useState(() => userPrefs.uploadDigestDefaultOpen && !userPrefs.hideUploadDigest);
  const [intelliTrackSectionOpen, setIntelliTrackSectionOpen] = useState(() => userPrefs.intelliTrackDefaultOpen && !userPrefs.hideIntelliTrack);
  const [intelliTrackOpen, setIntelliTrackOpen] = useState(false);
  const [intelliTrackActionOpen, setIntelliTrackActionOpen] = useState(false);
  const [intelliTrackData, setIntelliTrackData] = useState(null);
  const [intelliTrackLoading, setIntelliTrackLoading] = useState(false);
  const [intelliTrackError, setIntelliTrackError] = useState('');
  const [intelliTrackActionError, setIntelliTrackActionError] = useState('');
  const [intelliTrackActionMessage, setIntelliTrackActionMessage] = useState('');
  const [intelliTrackSearchBol, setIntelliTrackSearchBol] = useState('');
  const [intelliTrackSearchResult, setIntelliTrackSearchResult] = useState(null);
  const [intelliTrackSearchLoading, setIntelliTrackSearchLoading] = useState(false);
  const [intelliTrackSearchError, setIntelliTrackSearchError] = useState('');
  const [intelliTrackActionLoading, setIntelliTrackActionLoading] = useState('');
  const [intelliTrackPendingBol, setIntelliTrackPendingBol] = useState('');
  const [intelliTrackSuppressedBols, setIntelliTrackSuppressedBols] = useState([]);
  const [availableTrucksSectionOpen, setAvailableTrucksSectionOpen] = useState(() => userPrefs.availableTrucksDefaultOpen && !userPrefs.hideAvailableTrucks);
  const [availableTrucksCurrentOpen, setAvailableTrucksCurrentOpen] = useState(false);
  const [availableTrucksOpen, setAvailableTrucksOpen] = useState(false);
  const [availableTrucksActionOpen, setAvailableTrucksActionOpen] = useState(false);
  const [availableTruckDistributionOpen, setAvailableTruckDistributionOpen] = useState(false);
  const [availableTruckDistributionData, setAvailableTruckDistributionData] = useState(null);
  const [availableTruckDistributionLoading, setAvailableTruckDistributionLoading] = useState(false);
  const [availableTruckDistributionError, setAvailableTruckDistributionError] = useState('');
  const [availableTruckDistributionCompany, setAvailableTruckDistributionCompany] = useState('');
  const [availableTruckDistributionEmail, setAvailableTruckDistributionEmail] = useState('');
  const [availableTruckDistributionSubmitting, setAvailableTruckDistributionSubmitting] = useState(false);
  const [availableTruckDistributionMessage, setAvailableTruckDistributionMessage] = useState('');
  const [availableTruckDistributionSortField, setAvailableTruckDistributionSortField] = useState('company');
  const [availableTruckDistributionSortDirection, setAvailableTruckDistributionSortDirection] = useState('asc');
  const [availableTruckDistributionInactiveModalOpen, setAvailableTruckDistributionInactiveModalOpen] = useState(false);
  const [availableTrucksData, setAvailableTrucksData] = useState(null);
  const [availableTrucksLoading, setAvailableTrucksLoading] = useState(false);
  const [availableTrucksError, setAvailableTrucksError] = useState('');
  const [availableTruckFormDate, setAvailableTruckFormDate] = useState(getEasternDateInputValue);
  const [availableTruckTimeOfDay, setAvailableTruckTimeOfDay] = useState(getDefaultAvailableTruckTimeOfDay);
  const [availableTruckRows, setAvailableTruckRows] = useState(() => [createAvailableTruckDraftRow('initial')]);
  const [availableTruckSubmitting, setAvailableTruckSubmitting] = useState(false);
  const [availableTruckRepublishingId, setAvailableTruckRepublishingId] = useState('');
  const [availableTruckActionMessage, setAvailableTruckActionMessage] = useState('');
  const [availableTruckActionError, setAvailableTruckActionError] = useState('');
  const [availableTruckDrilldown, setAvailableTruckDrilldown] = useState(null);
  const [reportsSectionOpen, setReportsSectionOpen] = useState(() => userPrefs.reportsDefaultOpen);
  const [salesAndLeadsSectionOpen, setSalesAndLeadsSectionOpen] = useState(() => userPrefs.salesAndLeadsDefaultOpen);
  const [recruitingSectionOpen, setRecruitingSectionOpen] = useState(() => userPrefs.recruitingDefaultOpen && !userPrefs.hideRecruiting);
  const [recruitingData, setRecruitingData] = useState(null);
  const [recruitingLoading, setRecruitingLoading] = useState(false);
  const [recruitingError, setRecruitingError] = useState('');
  const [recruitingStatusFilter, setRecruitingStatusFilter] = useState('Heads-Up');
  const [recruitingSearch, setRecruitingSearch] = useState('');
  const [selectedRecruitingProfile, setSelectedRecruitingProfile] = useState(null);
  const [recruitingProfileLoading, setRecruitingProfileLoading] = useState(false);
  const [recruitingProfileError, setRecruitingProfileError] = useState('');
  const [recruitingActionLoading, setRecruitingActionLoading] = useState('');
  const [recruitingActionMessage, setRecruitingActionMessage] = useState('');
  const [recruitingActionError, setRecruitingActionError] = useState('');
  const [recruitingCreateModalOpen, setRecruitingCreateModalOpen] = useState(false);
  const [recruitingCandidateDraft, setRecruitingCandidateDraft] = useState(createRecruitingCandidateDraft);
  const [recruitingCandidateCreating, setRecruitingCandidateCreating] = useState(false);
  const [recruitingNoteDraft, setRecruitingNoteDraft] = useState('');
  const [recruitingNoteType, setRecruitingNoteType] = useState('Internal');
  const [recruitingFollowUpDate, setRecruitingFollowUpDate] = useState('');
  const [recruitingStatusDraft, setRecruitingStatusDraft] = useState('');
  const [recruitingStatusReason, setRecruitingStatusReason] = useState('');
  const [recruitingStatusPickerOpen, setRecruitingStatusPickerOpen] = useState(false);
  const [recruitingOwnerOverride, setRecruitingOwnerOverride] = useState(false);
  const [driverRosterPortModalOpen, setDriverRosterPortModalOpen] = useState(false);
  const [driverRosterPortCandidate, setDriverRosterPortCandidate] = useState(null);
  const [driverRosterPortDraft, setDriverRosterPortDraft] = useState(() => createRecruitingDriverRosterPortDraft());
  const [driverRosterPortSaving, setDriverRosterPortSaving] = useState(false);
  const [driverRosterPortError, setDriverRosterPortError] = useState('');
  const [recruitingSnapshotModalOpen, setRecruitingSnapshotModalOpen] = useState(false);
  const [recruitingSnapshotReport, setRecruitingSnapshotReport] = useState(null);
  const [recruitingSnapshotLoading, setRecruitingSnapshotLoading] = useState(false);
  const [recruitingSnapshotError, setRecruitingSnapshotError] = useState('');
  const [recruitingSnapshotView, setRecruitingSnapshotView] = useState('solo');

  const isAnyModalOpen = Boolean(
    preferencesModalOpen ||
    selected ||
    selectedDriverRoster ||
    driverHistoryModalOpen ||
    grossRevenueModalOpen ||
    yearlyProjectionModalOpen ||
    selectedGrossRevenueTruck ||
    driverSummaryModalOpen ||
    monthlyOpsModalOpen ||
    ordersDueSettlementModalOpen ||
    weeklySettlementModalOpen ||
    wonNotRegisteredModalOpen ||
    permitGovernanceModalOpen ||
    selectedPermitHistoryLoad ||
    operationalNotesModalOpen ||
    activeDriverRosterModalOpen ||
    inactiveDriverRosterModalOpen ||
    fleetEquipmentModalOpen ||
    onThisDayModalOpen ||
    noAvailabilityModalOpen ||
    driverTimeOffModalOpen ||
    driverTimeOffFormOpen ||
    salesActivityModalOpen ||
    customerTrendModalOpen ||
    selectedCustomerTrend ||
    selectedSalesLead ||
    selectedRecruitingProfile ||
    recruitingCreateModalOpen ||
    recruitingSnapshotModalOpen ||
    driverRosterPortModalOpen ||
    availableTruckDistributionInactiveModalOpen ||
    availableTruckDrilldown ||
    startupSplashVisible
  );

  function beginStartupSplashClose() {
    if (startupSplashCloseTimerRef.current) {
      window.clearTimeout(startupSplashCloseTimerRef.current);
      startupSplashCloseTimerRef.current = null;
    }

    setStartupSplashExiting(true);

    startupSplashCloseTimerRef.current = window.setTimeout(() => {
      setStartupSplashVisible(false);
      setStartupSplashExiting(false);
      setStartupSplashDismissed(true);
      startupSplashCloseTimerRef.current = null;
    }, STARTUP_SPLASH_EXIT_MS);
  }

  function getCachedDriverHistorySnapshot(truck) {
    const key = normalizeDriverHistoryTruckKey(truck);
    return key ? driverHistoryCacheRef.current.get(key) || null : null;
  }

  function cacheDriverHistorySnapshot(truck, snapshot, error = '') {
    const key = normalizeDriverHistoryTruckKey(truck || snapshot?.normalizedTruck || snapshot?.truck);
    if (!key) return;

    driverHistoryCacheRef.current.set(key, {
      snapshot: snapshot || null,
      error: error || '',
      cachedAt: Date.now()
    });
  }
  

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

  const statusOptions = useMemo(() => [
    'All',
    ...Array.from(
      new Set(results.map((r) => r.Status).filter(Boolean))
    ).sort()
  ], [results]);

  const filteredResults = useMemo(() => (
    statusFilter === 'All'
      ? results
      : results.filter((r) => r.Status === statusFilter)
  ), [results, statusFilter]);

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


  const availableTruckDriverOptions = useMemo(() => {
    const options = availableTrucksData?.activeDriverOptions || [];

    return options
      .map((option, index) => {
        const driverName = String(option?.driverName || '').trim();
        const unitNo = String(option?.unitNo || '').trim();
        const equipmentType = String(option?.equipmentType || '').trim();
        const key = String(option?.key || option?.id || `${driverName}-${unitNo}-${index}`).trim();

        return {
          key,
          id: option?.id || '',
          driverName,
          unitNo,
          equipmentType,
          status: option?.status || '',
          trailerType: option?.trailerType || '',
          soloOrTeam: option?.soloOrTeam || '',
          tmsName: option?.tmsName || ''
        };
      })
      .filter((option) => option.key && (option.driverName || option.unitNo))
      .sort((a, b) => {
        const nameCompare = a.driverName.localeCompare(b.driverName);
        if (nameCompare !== 0) return nameCompare;
        return a.unitNo.localeCompare(b.unitNo);
      });
  }, [availableTrucksData]);

  const selectedAvailableTruckRosterKeys = useMemo(() => {
    return new Set(
      availableTruckRows
        .map((row) => String(row.rosterDriverKey || '').trim())
        .filter(Boolean)
    );
  }, [availableTruckRows]);

  const availableTruckSuggestionIndex = useMemo(() => {
    return availableTrucksData?.proximitySuggestionIndex || {};
  }, [availableTrucksData]);

  const reportActionAlertCounts = useMemo(() => {
    const alertData = reportActionAlerts?.alerts || {};
    const ordersDueSettlementCount = Number(
      alertData.ordersDueSettlement?.count ?? ordersDueSettlementReport?.count ?? 0
    ) || 0;
    const wonNotRegisteredCount = Number(
      alertData.wonNotRegistered?.count ?? wonNotRegisteredReport?.count ?? 0
    ) || 0;
    const permitGovernanceCount = Number(
      alertData.permitGovernance?.count ?? permitGovernanceReport?.alertCount ?? permitGovernanceReport?.counts?.ordersNeedingPermits ?? 0
    ) || 0;

    return {
      ordersDueSettlement: ordersDueSettlementCount,
      wonNotRegistered: wonNotRegisteredCount,
      permitGovernance: permitGovernanceCount,
      total: ordersDueSettlementCount + wonNotRegisteredCount + permitGovernanceCount,
      isLoaded: Boolean(reportActionAlerts)
    };
  }, [reportActionAlerts, ordersDueSettlementReport, wonNotRegisteredReport, permitGovernanceReport]);

  const visibleSalesLeadRecords = useMemo(() => {
    const sourceRecords = salesLeadsReport?.records || [];
    return sortSalesLeadRecords(
      filterSalesLeadRecords(sourceRecords, salesLeadsView),
      salesLeadsSort
    );
  }, [salesLeadsReport, salesLeadsView, salesLeadsSort]);

  const ordersDueSettlementActionBlocked =
    reportActionAlertCounts.isLoaded && reportActionAlertCounts.ordersDueSettlement <= 0;
  const wonNotRegisteredActionBlocked =
    reportActionAlertCounts.isLoaded && reportActionAlertCounts.wonNotRegistered <= 0;

  const liveOrdersDueSettlementReport = useMemo(() => (
    ordersDueSettlementReport || reportActionAlerts?.alerts?.ordersDueSettlement?.report || null
  ), [ordersDueSettlementReport, reportActionAlerts]);

  const liveWonNotRegisteredReport = useMemo(() => (
    wonNotRegisteredReport || reportActionAlerts?.alerts?.wonNotRegistered?.report || null
  ), [wonNotRegisteredReport, reportActionAlerts]);

  const reportActionAlertSummary = useMemo(() => {
    if (reportActionAlertsLoading && !reportActionAlerts) return 'Checking Operations Reports...';
    if (reportActionAlertsError) return 'Operations Reports alert check failed';

    const total = reportActionAlertCounts.total;

    if (total <= 0) return 'Operations Reports: Clear';

    const parts = [
      reportActionAlertCounts.ordersDueSettlement > 0
        ? `${formatReportNumber(reportActionAlertCounts.ordersDueSettlement)} settlement`
        : '',
      reportActionAlertCounts.wonNotRegistered > 0
        ? `${formatReportNumber(reportActionAlertCounts.wonNotRegistered)} won/not registered`
        : '',
      reportActionAlertCounts.permitGovernance > 0
        ? `${formatReportNumber(reportActionAlertCounts.permitGovernance)} permit`
        : ''
    ].filter(Boolean);

    return `Operations Reports: ${formatReportNumber(total)} ${total === 1 ? 'alert' : 'alerts'}${parts.length ? ` · ${parts.join(' · ')}` : ''}`;
  }, [reportActionAlertCounts, reportActionAlertsLoading, reportActionAlerts, reportActionAlertsError]);

  const startupDashboardSettled = useMemo(() => (
    Boolean(operationsData || operationsError) &&
    !operationsLoading
  ), [
    operationsData,
    operationsError,
    operationsLoading
  ]);

  function getActionReportClearMessage(reportLabel) {
    return `${reportLabel} is already clear in the Reports ticker. This point-in-time report is hidden until the next refresh finds something actionable.`;
  }

  function playBrandReveal() {
    if (brandRevealTimerRef.current) {
      window.clearTimeout(brandRevealTimerRef.current);
    }

    setBrandRevealKey((key) => key + 1);
    setBrandRevealActive(true);

    brandRevealTimerRef.current = window.setTimeout(() => {
      setBrandRevealActive(false);
      brandRevealTimerRef.current = null;
    }, 2900);
  }

  async function playRefreshPlaneSound() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;

      const audioContext = new AudioContextClass();

      if (audioContext.state === 'suspended' && typeof audioContext.resume === 'function') {
        await audioContext.resume();
      }

      const now = audioContext.currentTime;
      const duration = 1.18;
      const masterGain = audioContext.createGain();
      masterGain.gain.setValueAtTime(0.0001, now);
      masterGain.gain.exponentialRampToValueAtTime(0.085, now + 0.08);
      masterGain.gain.setValueAtTime(0.085, now + 0.82);
      masterGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      masterGain.connect(audioContext.destination);

      const propChopGain = audioContext.createGain();
      propChopGain.gain.setValueAtTime(0.32, now);
      propChopGain.connect(masterGain);

      // The little propeller "chop": quick repeating pulses over a low engine hum.
      for (let offset = 0; offset < duration; offset += 0.047) {
        const pulseAt = now + offset;
        propChopGain.gain.setValueAtTime(0.24, pulseAt);
        propChopGain.gain.linearRampToValueAtTime(0.82, pulseAt + 0.011);
        propChopGain.gain.exponentialRampToValueAtTime(0.28, pulseAt + 0.041);
      }

      const engineFilter = audioContext.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.setValueAtTime(520, now);
      engineFilter.frequency.exponentialRampToValueAtTime(760, now + 0.5);
      engineFilter.frequency.exponentialRampToValueAtTime(440, now + duration);
      engineFilter.Q.setValueAtTime(0.65, now);
      engineFilter.connect(propChopGain);

      const engine = audioContext.createOscillator();
      engine.type = 'sawtooth';
      engine.frequency.setValueAtTime(72, now);
      engine.frequency.exponentialRampToValueAtTime(104, now + 0.42);
      engine.frequency.exponentialRampToValueAtTime(86, now + duration);
      engine.connect(engineFilter);
      engine.start(now);
      engine.stop(now + duration);

      const harmonicGain = audioContext.createGain();
      harmonicGain.gain.setValueAtTime(0.22, now);
      harmonicGain.connect(engineFilter);

      const harmonic = audioContext.createOscillator();
      harmonic.type = 'triangle';
      harmonic.frequency.setValueAtTime(144, now);
      harmonic.frequency.exponentialRampToValueAtTime(208, now + 0.42);
      harmonic.frequency.exponentialRampToValueAtTime(172, now + duration);
      harmonic.connect(harmonicGain);
      harmonic.start(now);
      harmonic.stop(now + duration);

      const bufferSize = Math.max(1, Math.floor(audioContext.sampleRate * duration));
      const noiseBuffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
      const noise = noiseBuffer.getChannelData(0);
      let lastNoiseValue = 0;

      for (let index = 0; index < bufferSize; index += 1) {
        lastNoiseValue = (lastNoiseValue + (Math.random() * 2 - 1) * 0.18) * 0.72;
        noise[index] = lastNoiseValue;
      }

      const noiseSource = audioContext.createBufferSource();
      noiseSource.buffer = noiseBuffer;

      const noiseFilter = audioContext.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.setValueAtTime(260, now);
      noiseFilter.frequency.exponentialRampToValueAtTime(380, now + 0.48);
      noiseFilter.frequency.exponentialRampToValueAtTime(230, now + duration);
      noiseFilter.Q.setValueAtTime(0.9, now);

      const noiseGain = audioContext.createGain();
      noiseGain.gain.setValueAtTime(0.0001, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.035, now + 0.08);
      noiseGain.gain.setValueAtTime(0.035, now + 0.82);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      noiseSource.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(masterGain);
      noiseSource.start(now);
      noiseSource.stop(now + duration);

      window.setTimeout(() => {
        if (typeof audioContext.close === 'function') {
          audioContext.close().catch(() => {});
        }
      }, 1500);
    } catch (err) {
      // Browser/Tauri audio permissions vary. If the sound is blocked, the visual refresh cue still runs.
    }
  }

  function playDataRefreshCue({ sound = true } = {}) {
    const now = Date.now();

    if (now - lastRefreshCueAtRef.current < 2500) {
      return;
    }

    lastRefreshCueAtRef.current = now;
    playBrandReveal();

    if (sound) {
      void playRefreshPlaneSound();
    }
  }

  function toggleColorTheme() {
    setColorTheme((currentTheme) => currentTheme === 'light' ? 'dark' : 'light');
  }

  function ThemeToggleButton({ className = '' }) {
    const isLight = colorTheme === 'light';

    return (
      <button
        type="button"
        className={`theme-toggle-button ${isLight ? 'light' : 'dark'} ${className}`.trim()}
        onClick={toggleColorTheme}
        aria-pressed={isLight}
        title={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
      >
        <span className="theme-toggle-icon" aria-hidden="true">{isLight ? '☀' : '☾'}</span>
        <span>{isLight ? 'Light Mode' : 'Dark Mode'}</span>
      </button>
    );
  }

  function applyDashboardPreferenceDefaults(preferences = userPrefs) {
    const nextPrefs = normalizeKoleUserPreferences(preferences);

    setDriverRosterAccordionOpen(nextPrefs.driverRosterDefaultOpen);
    setDriverTimeOffAccordionOpen(nextPrefs.driverTimeOffDefaultOpen);
    setDriverTimeOffPaneFilter(nextPrefs.driverTimeOffDefaultPane);
    setUploadDigestSectionOpen(nextPrefs.hideUploadDigest ? false : nextPrefs.uploadDigestDefaultOpen);
    setIntelliTrackSectionOpen(nextPrefs.hideIntelliTrack ? false : nextPrefs.intelliTrackDefaultOpen);
    setAvailableTrucksSectionOpen(nextPrefs.hideAvailableTrucks ? false : nextPrefs.availableTrucksDefaultOpen);
    setOperationsNext7Open(nextPrefs.hideOperationsToday ? false : !nextPrefs.operationsNext7DefaultClosed);

    if (nextPrefs.hideOperationsToday) {
      setDriverRosterAccordionOpen(false);
      setDriverTimeOffAccordionOpen(false);
    }
    setSalesAndLeadsSectionOpen(nextPrefs.hideSalesAndLeads ? false : nextPrefs.salesAndLeadsDefaultOpen);
    setRecruitingSectionOpen(nextPrefs.hideRecruiting ? false : nextPrefs.recruitingDefaultOpen);
    setReportsSectionOpen(nextPrefs.reportsDefaultOpen);

    if (!nextPrefs.intelliTrackDefaultOpen || nextPrefs.hideIntelliTrack) {
      closeIntelliTrackSubsections();
    }

    if (!nextPrefs.availableTrucksDefaultOpen || nextPrefs.hideAvailableTrucks) {
      closeAvailableTruckSubsections();
    }

    if (!nextPrefs.salesAndLeadsDefaultOpen || nextPrefs.hideSalesAndLeads) {
      closeSalesAndLeadsSubsections();
    }

    if (!nextPrefs.recruitingDefaultOpen || nextPrefs.hideRecruiting) {
      closeRecruitingSubsections();
    }

    if (!nextPrefs.reportsDefaultOpen) {
      closeReportSubsections();
    }
  }

  function applySinglePreference(key, value) {
    if (key === 'driverRosterDefaultOpen') {
      setDriverRosterAccordionOpen(Boolean(value));
    }

    if (key === 'driverTimeOffDefaultOpen') {
      setDriverTimeOffAccordionOpen(Boolean(value));
    }

    if (key === 'driverTimeOffDefaultPane') {
      setDriverTimeOffPaneFilter(DRIVER_TIME_OFF_PANE_OPTIONS.includes(value) ? value : 'current');
    }

    if (key === 'uploadDigestDefaultOpen') {
      setUploadDigestSectionOpen(userPrefs.hideUploadDigest ? false : Boolean(value));
    }

    if (key === 'intelliTrackDefaultOpen') {
      setIntelliTrackSectionOpen(userPrefs.hideIntelliTrack ? false : Boolean(value));
      if (!value || userPrefs.hideIntelliTrack) closeIntelliTrackSubsections();
    }

    if (key === 'availableTrucksDefaultOpen') {
      setAvailableTrucksSectionOpen(userPrefs.hideAvailableTrucks ? false : Boolean(value));
      if (!value || userPrefs.hideAvailableTrucks) closeAvailableTruckSubsections();
    }

    if (key === 'salesAndLeadsDefaultOpen') {
      setSalesAndLeadsSectionOpen(userPrefs.hideSalesAndLeads ? false : Boolean(value));
      if (!value || userPrefs.hideSalesAndLeads) closeSalesAndLeadsSubsections();
    }

    if (key === 'recruitingDefaultOpen') {
      setRecruitingSectionOpen(userPrefs.hideRecruiting ? false : Boolean(value));
      if (!value || userPrefs.hideRecruiting) closeRecruitingSubsections();
    }

    if (key === 'operationsNext7DefaultClosed') {
      setOperationsNext7Open(userPrefs.hideOperationsToday ? false : !Boolean(value));
    }

    if (key === 'hideOperationsToday') {
      if (value) {
        setOperationsNext7Open(false);
        setDriverRosterAccordionOpen(false);
        setDriverTimeOffAccordionOpen(false);
      } else {
        setOperationsNext7Open(!userPrefs.operationsNext7DefaultClosed);
        setDriverRosterAccordionOpen(userPrefs.driverRosterDefaultOpen);
        setDriverTimeOffAccordionOpen(userPrefs.driverTimeOffDefaultOpen);
      }
    }

    if (key === 'hideUploadDigest') {
      if (value) {
        setUploadDigestSectionOpen(false);
      } else if (userPrefs.uploadDigestDefaultOpen) {
        setUploadDigestSectionOpen(true);
      }
    }

    if (key === 'hideIntelliTrack') {
      if (value) {
        setIntelliTrackSectionOpen(false);
        closeIntelliTrackSubsections();
      } else if (userPrefs.intelliTrackDefaultOpen) {
        setIntelliTrackSectionOpen(true);
      }
    }

    if (key === 'hideAvailableTrucks') {
      if (value) {
        setAvailableTrucksSectionOpen(false);
        closeAvailableTruckSubsections();
      } else if (userPrefs.availableTrucksDefaultOpen) {
        setAvailableTrucksSectionOpen(true);
      }
    }

    if (key === 'hideSalesAndLeads') {
      if (value) {
        setSalesAndLeadsSectionOpen(false);
        closeSalesAndLeadsSubsections();
        if (SALES_AND_LEADS_PANEL_KEYS.includes(activeReportPanel)) {
          setActiveReportPanel('');
        }
      } else if (userPrefs.salesAndLeadsDefaultOpen) {
        setSalesAndLeadsSectionOpen(true);
      }
    }

    if (key === 'hideRecruiting') {
      if (value) {
        setRecruitingSectionOpen(false);
        closeRecruitingSubsections();
      } else if (userPrefs.recruitingDefaultOpen) {
        setRecruitingSectionOpen(true);
      }
    }

    if (key === 'reportsDefaultOpen') {
      setReportsSectionOpen(Boolean(value));
      if (!value) closeReportSubsections();
    }

    if (key === 'hideYearlyProjection' && value && activeReportPanel === 'yearlyProjection') {
      setActiveReportPanel('');
    }

    if (key === 'hideOnThisDay' && value && activeReportPanel === 'onThisDay') {
      setActiveReportPanel('');
    }

    if (key === 'hideWeeklySettlementReport' && value && activeReportPanel === 'weeklySettlement') {
      setActiveReportPanel('');
    }

    if (key === 'skipStartupSplash' && value && startupSplashVisible) {
      beginStartupSplashClose();
    }

    if (key === 'skipStartupSplash' && value && isAuthenticated) {
      setStartupSplashDismissed(true);
    }
  }

  function updateUserPreference(key, value, options = {}) {
    const applyNow = options.applyNow !== false;

    setUserPrefs((currentPrefs) => {
      const nextPrefs = normalizeKoleUserPreferences({
        ...currentPrefs,
        [key]: value
      });

      saveKoleUserPreferences(nextPrefs);

      if (applyNow) {
        applySinglePreference(key, nextPrefs[key]);
      }

      return nextPrefs;
    });
  }

  function resetUserPreferences() {
    const nextPrefs = { ...DEFAULT_KOLE_USER_PREFERENCES };

    saveKoleUserPreferences(nextPrefs);
    setUserPrefs(nextPrefs);
    applyDashboardPreferenceDefaults(nextPrefs);

    if (activeReportPanel === 'yearlyProjection' || activeReportPanel === 'onThisDay' || SALES_AND_LEADS_PANEL_KEYS.includes(activeReportPanel)) {
      setActiveReportPanel('');
    }
  }

  function PreferencesButton({ className = '' }) {
    return (
      <button
        type="button"
        className={`preferences-toggle-button ${className}`.trim()}
        onClick={() => setPreferencesModalOpen(true)}
        title="Open Kole Connect preferences"
      >
        <span className="preferences-toggle-icon" aria-hidden="true">⚙</span>
        <span>Preferences</span>
      </button>
    );
  }

  function PreferenceSwitch({ label, description, checked, onChange, locked = false }) {
    return (
      <label className={`preference-toggle-row ${locked ? 'locked' : ''}`.trim()}>
        <span>
          <strong>{label}</strong>
          {description && <small>{description}</small>}
        </span>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={locked}
        />
      </label>
    );
  }

  function renderPreferencesModal() {
    if (!preferencesModalOpen) return null;

    return (
      <div className="modal-overlay preferences-overlay" role="presentation">
        <div className="detail-modal preferences-modal" role="dialog" aria-modal="true" aria-labelledby="preferences-modal-title">
          <div className="detail-header preferences-modal-header">
            <div>
              <h2 id="preferences-modal-title">Kole Connect Preferences</h2>
              <p>These settings are saved on this device. Theme stays separate so light/dark mode remains one-click.</p>
            </div>
            <button type="button" className="close-button" onClick={() => setPreferencesModalOpen(false)}>
              Close
            </button>
          </div>

          <div className="modal-body preferences-modal-body">
            <section className="preferences-section">
              <div className="preferences-section-heading">
                <h3>Dashboard startup</h3>
                <p>Choose what should already be open when Kole Connect starts.</p>
              </div>

              <div className="preferences-grid">
                <PreferenceSwitch
                  label="Driver Roster starts open"
                  description={userPrefs.hideOperationsToday ? 'Unavailable while Operations Today is hidden.' : 'Keeps the roster visible without a fresh click each session.'}
                  checked={userPrefs.driverRosterDefaultOpen && !userPrefs.hideOperationsToday}
                  onChange={(checked) => updateUserPreference('driverRosterDefaultOpen', checked)}
                  locked={userPrefs.hideOperationsToday}
                />
                <PreferenceSwitch
                  label="Current Driver Time Off starts open"
                  description={userPrefs.hideOperationsToday ? 'Unavailable while Operations Today is hidden.' : 'Pairs well with roster if you read both together.'}
                  checked={userPrefs.driverTimeOffDefaultOpen && !userPrefs.hideOperationsToday}
                  onChange={(checked) => updateUserPreference('driverTimeOffDefaultOpen', checked)}
                  locked={userPrefs.hideOperationsToday}
                />
                <PreferenceSwitch
                  label="Job Photo Uploads starts open"
                  description={userPrefs.hideUploadDigest ? 'Unavailable while Job Photo Uploads is hidden.' : "Open today's pickup and delivery uploads automatically."}
                  checked={userPrefs.uploadDigestDefaultOpen && !userPrefs.hideUploadDigest}
                  onChange={(checked) => updateUserPreference('uploadDigestDefaultOpen', checked)}
                  locked={userPrefs.hideUploadDigest}
                />
                <PreferenceSwitch
                  label="IntelliTrack starts open"
                  description={userPrefs.hideIntelliTrack ? 'Unavailable while IntelliTrack is hidden.' : 'Open active tracking tools at startup.'}
                  checked={userPrefs.intelliTrackDefaultOpen && !userPrefs.hideIntelliTrack}
                  onChange={(checked) => updateUserPreference('intelliTrackDefaultOpen', checked)}
                  locked={userPrefs.hideIntelliTrack}
                />
                <PreferenceSwitch
                  label="Available Equipment starts open"
                  description={userPrefs.hideAvailableTrucks ? 'Unavailable while Available Equipment is hidden.' : 'Open availability analysis and posting tools at startup.'}
                  checked={userPrefs.availableTrucksDefaultOpen && !userPrefs.hideAvailableTrucks}
                  onChange={(checked) => updateUserPreference('availableTrucksDefaultOpen', checked)}
                  locked={userPrefs.hideAvailableTrucks}
                />
                <PreferenceSwitch
                  label="Start Loading Next 7 Days closed"
                  description={userPrefs.hideOperationsToday ? 'Unavailable while Operations Today is hidden.' : 'Default is open; turn this on only when you want the forward-looking table collapsed on launch.'}
                  checked={userPrefs.operationsNext7DefaultClosed && !userPrefs.hideOperationsToday}
                  onChange={(checked) => updateUserPreference('operationsNext7DefaultClosed', checked)}
                  locked={userPrefs.hideOperationsToday}
                />
                <PreferenceSwitch
                  label="Reports starts open"
                  description="Open the report hub automatically."
                  checked={userPrefs.reportsDefaultOpen}
                  onChange={(checked) => updateUserPreference('reportsDefaultOpen', checked)}
                />
                <PreferenceSwitch
                  label="Recruiting starts open"
                  description={userPrefs.hideRecruiting ? 'Unavailable while Recruiting is hidden.' : 'Open the recruiting pipeline automatically.'}
                  checked={userPrefs.recruitingDefaultOpen && !userPrefs.hideRecruiting}
                  onChange={(checked) => updateUserPreference('recruitingDefaultOpen', checked)}
                  locked={userPrefs.hideRecruiting}
                />
                <PreferenceSwitch
                  label="Sales & Leads starts open"
                  description={userPrefs.hideSalesAndLeads ? 'Unavailable while Sales & Leads is hidden.' : 'Open customer cards and sales reports automatically.'}
                  checked={userPrefs.salesAndLeadsDefaultOpen && !userPrefs.hideSalesAndLeads}
                  onChange={(checked) => updateUserPreference('salesAndLeadsDefaultOpen', checked)}
                  locked={userPrefs.hideSalesAndLeads}
                />
              </div>

              <label className="preference-select-row">
                <span>
                  <strong>Driver Time Off default pill</strong>
                  <small>Used when Current Driver Time Off starts open.</small>
                </span>
                <select
                  value={userPrefs.driverTimeOffDefaultPane}
                  onChange={(e) => updateUserPreference('driverTimeOffDefaultPane', e.target.value)}
                >
                  <option value="current">Current</option>
                  <option value="ended">Ended</option>
                  <option value="starting-soon">Starting Soon</option>
                </select>
              </label>
            </section>

            <section className="preferences-section">
              <div className="preferences-section-heading">
                <h3>Display and access</h3>
                <p>Use these when the app needs to behave more like a personal cockpit than a one-size dashboard.</p>
              </div>

              <div className="preferences-grid">
                <PreferenceSwitch
                  label="Hide Operations Today"
                  description="Removes the Operations Today block, including current driver time off and active roster, from the main dashboard on this device."
                  checked={userPrefs.hideOperationsToday}
                  onChange={(checked) => updateUserPreference('hideOperationsToday', checked)}
                />
                <PreferenceSwitch
                  label="Hide Job Photo Uploads"
                  description="Removes the pickup and delivery photo upload digest from the main dashboard on this device."
                  checked={userPrefs.hideUploadDigest}
                  onChange={(checked) => updateUserPreference('hideUploadDigest', checked)}
                />
                <PreferenceSwitch
                  label="Hide IntelliTrack"
                  description="Removes active tracking tools from the main dashboard on this device."
                  checked={userPrefs.hideIntelliTrack}
                  onChange={(checked) => updateUserPreference('hideIntelliTrack', checked)}
                />
                <PreferenceSwitch
                  label="Hide Available Equipment"
                  description="Removes availability analysis and posting tools from the main dashboard on this device."
                  checked={userPrefs.hideAvailableTrucks}
                  onChange={(checked) => updateUserPreference('hideAvailableTrucks', checked)}
                />
                <PreferenceSwitch
                  label="Hide Sales & Leads"
                  description="Removes the Sales and Leads section from the main dashboard on this device."
                  checked={userPrefs.hideSalesAndLeads}
                  onChange={(checked) => updateUserPreference('hideSalesAndLeads', checked)}
                />
                <PreferenceSwitch
                  label="Hide Recruiting"
                  description="Removes the Recruiting section from the main dashboard on this device."
                  checked={userPrefs.hideRecruiting}
                  onChange={(checked) => updateUserPreference('hideRecruiting', checked)}
                />
                <PreferenceSwitch
                  label="Compact dashboard mode"
                  description="Tightens spacing and table padding for power-user scanning."
                  checked={userPrefs.compactDashboardMode}
                  onChange={(checked) => updateUserPreference('compactDashboardMode', checked)}
                />
                <PreferenceSwitch
                  label="Order Card View"
                  description="Shows order-oriented lists as cards instead of table rows. Search results and Operations Today are included first."
                  checked={userPrefs.orderCardView}
                  onChange={(checked) => updateUserPreference('orderCardView', checked)}
                />
              </div>
            </section>

            <section className="preferences-section">
              <div className="preferences-section-heading">
                <h3>Hide optional report tools</h3>
                <p>Operational exception reports stay visible; these are comfort/noise controls.</p>
              </div>

              <div className="preferences-grid">
                <PreferenceSwitch
                  label="Hide Yearly Revenue Projection"
                  description="Removes the projection accordion from Financial Reports."
                  checked={userPrefs.hideYearlyProjection}
                  onChange={(checked) => updateUserPreference('hideYearlyProjection', checked)}
                />
                <PreferenceSwitch
                  label="Hide On This Day"
                  description="Removes the historical daily snapshot from Operational Reports."
                  checked={userPrefs.hideOnThisDay}
                  onChange={(checked) => updateUserPreference('hideOnThisDay', checked)}
                />
                <PreferenceSwitch
                  label="Hide Weekly Settlement Report"
                  description="Removes the Weekly Settlement Report from Financial Reports."
                  checked={userPrefs.hideWeeklySettlementReport}
                  onChange={(checked) => updateUserPreference('hideWeeklySettlementReport', checked)}
                />
              </div>
            </section>

            <section className="preferences-section">
              <div className="preferences-section-heading">
                <h3>Startup behavior</h3>
                <p>Keeps the dashboard loading normally, but hides the full-screen startup animation.</p>
              </div>

              <div className="preferences-grid">
                <PreferenceSwitch
                  label="Hide startup loading overlay"
                  description="Keeps normal dashboard loading, but removes the full-screen startup animation."
                  checked={userPrefs.skipStartupSplash}
                  onChange={(checked) => updateUserPreference('skipStartupSplash', checked)}
                />
              </div>
            </section>

            <div className="preferences-footer">
              <button type="button" className="secondary-button" onClick={resetUserPreferences}>
                Reset Preferences
              </button>
              <button type="button" onClick={() => setPreferencesModalOpen(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }


  useEffect(() => {
    const runtimeClass = isTauriRuntime ? 'tauri-runtime' : 'web-runtime';
    document.body.classList.add(runtimeClass);

    return () => document.body.classList.remove(runtimeClass);
  }, []);

  useEffect(() => {
    const normalizedTheme = colorTheme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = normalizedTheme;
    document.body.dataset.theme = normalizedTheme;

    try {
      localStorage.setItem(KOLE_THEME_STORAGE_KEY, normalizedTheme);
    } catch (err) {
      // Local storage may be unavailable in a locked-down webview; the toggle still works for this session.
    }
  }, [colorTheme]);

  useEffect(() => {
    document.body.classList.toggle('compact-dashboard-mode', Boolean(userPrefs.compactDashboardMode));

    return () => document.body.classList.remove('compact-dashboard-mode');
  }, [userPrefs.compactDashboardMode]);

  useEffect(() => {
    if (!userPrefs.skipStartupSplash || !isAuthenticated) return;

    setStartupSplashVisible(false);
    setStartupSplashExiting(false);
    setStartupSplashDismissed(true);
    setStartupSplashElapsedMs(0);
  }, [userPrefs.skipStartupSplash, isAuthenticated]);

  useEffect(() => {
    const hiddenPanels = [];

    if (userPrefs.hideYearlyProjection) hiddenPanels.push('yearlyProjection');
    if (userPrefs.hideOnThisDay) hiddenPanels.push('onThisDay');
    if (userPrefs.hideWeeklySettlementReport) hiddenPanels.push('weeklySettlement');
    if (userPrefs.hideSalesAndLeads) hiddenPanels.push(...SALES_AND_LEADS_PANEL_KEYS);

    if (hiddenPanels.includes(activeReportPanel)) {
      setActiveReportPanel('');
    }
  }, [userPrefs.hideYearlyProjection, userPrefs.hideOnThisDay, userPrefs.hideWeeklySettlementReport, userPrefs.hideSalesAndLeads, activeReportPanel]);

  useEffect(() => {
    const body = document.body;
    const root = document.documentElement;
    const previousBodyOverflow = body.style.overflow;
    const previousRootOverflow = root.style.overflow;

    if (isAnyModalOpen) {
      body.style.overflow = 'hidden';
      root.style.overflow = 'hidden';
    }

    return () => {
      body.style.overflow = previousBodyOverflow;
      root.style.overflow = previousRootOverflow;
    };
  }, [isAnyModalOpen]);

  useEffect(() => {
    return () => {
      if (brandRevealTimerRef.current) {
        window.clearTimeout(brandRevealTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    function handleEsc(e) {
      if (e.key === 'Escape') {
        setSelected(null);
        setOrderReturnTrailLabel('');
        setOrderDrilldownReturn(null);
        setOrderNotesData(null);
        setOrderNotesLoading(false);
        setOrderNotesError('');
        setOrderNotesTypeFilter('All');
        resetOrderNoteComposer();
        orderNotesRequestRef.current += 1;
        setGrossRevenueModalOpen(false);
        setSelectedGrossRevenueTruck(null);
        setSelectedGrossRevenueMonth(null);
        setDriverSummaryModalOpen(false);
        setOrdersDueSettlementModalOpen(false);
        setWeeklySettlementModalOpen(false);
        setWonNotRegisteredModalOpen(false);
        setPermitGovernanceModalOpen(false);
        setSelectedPermitHistoryLoad(null);
        setPermitHistoryOrderReturnLoad(null);
        setActiveDriverRosterModalOpen(false);
        setInactiveDriverRosterModalOpen(false);
        setFleetEquipmentModalOpen(false);
        setNoAvailabilityModalOpen(false);
        setDriverTimeOffModalOpen(false);
        setDriverTimeOffFormOpen(false);
        setSalesActivityModalOpen(false);
        setCustomerTrendModalOpen(false);
        setSelectedCustomerTrend(null);
        setDriverHistoryModalOpen(false);
        setSelectedDriverRoster(null);
        setSelectedSalesLead(null);
        setSelectedRecruitingProfile(null);
        setRecruitingCreateModalOpen(false);
        setAvailableTruckDrilldown(null);
      }
    }

    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, []);

  useEffect(() => {
    return () => {
      if (startupSplashCloseTimerRef.current) {
        window.clearTimeout(startupSplashCloseTimerRef.current);
        startupSplashCloseTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      if (startupSplashCloseTimerRef.current) {
        window.clearTimeout(startupSplashCloseTimerRef.current);
        startupSplashCloseTimerRef.current = null;
      }

      setStartupSplashVisible(false);
      setStartupSplashExiting(false);
      setStartupSplashDismissed(false);
      setStartupSplashElapsedMs(0);
      return;
    }

    if (userPrefs.skipStartupSplash) {
      setStartupSplashVisible(false);
      setStartupSplashExiting(false);
      setStartupSplashDismissed(true);
      setStartupSplashElapsedMs(0);
      return;
    }

    if (!startupSplashDismissed && !startupSplashVisible && !startupDashboardSettled) {
      startupSplashStartedAtRef.current = Date.now();
      setStartupSplashElapsedMs(0);
      setStartupSplashExiting(false);
      setStartupSplashVisible(true);
    }
  }, [isAuthenticated, userPrefs.skipStartupSplash, startupSplashDismissed, startupSplashVisible, startupDashboardSettled]);

  useEffect(() => {
    if (!startupSplashVisible || !isAuthenticated) return undefined;

    function updateSplashElapsed() {
      setStartupSplashElapsedMs(Date.now() - startupSplashStartedAtRef.current);
    }

    updateSplashElapsed();
    const interval = window.setInterval(updateSplashElapsed, 250);

    return () => window.clearInterval(interval);
  }, [startupSplashVisible, isAuthenticated]);

  useEffect(() => {
    if (!startupSplashVisible || startupSplashExiting || !isAuthenticated) return undefined;
    if (!startupDashboardSettled) return undefined;
    if (startupSplashElapsedMs < STARTUP_SPLASH_FAKE_LIGHTS_COMPLETE_MS) return undefined;

    const elapsedMs = Date.now() - startupSplashStartedAtRef.current;
    const closeDelayMs = Math.max(STARTUP_SPLASH_MIN_MS - elapsedMs, 0);
    const closeTimer = window.setTimeout(() => {
      beginStartupSplashClose();
    }, closeDelayMs);

    return () => window.clearTimeout(closeTimer);
  }, [startupSplashVisible, startupSplashExiting, isAuthenticated, startupDashboardSettled, startupSplashElapsedMs]);

  useEffect(() => {
    if (!isAuthenticated) return undefined;

    loadOperationsDashboard();
    loadDriverPositions();
    loadIntelliTrack();
    loadAvailableTrucks();
    loadAvailableTruckDistributionList({ silent: true });
    loadRecruitingDashboard({ silent: true });
    loadReportActionAlerts({ silent: true });

    const interval = window.setInterval(() => {
      const operationsRefresh = loadOperationsDashboard({ silent: true });

      loadDriverPositions({ silent: true });
      loadIntelliTrack({ silent: true });
      loadAvailableTrucks({ silent: true });
      loadAvailableTruckDistributionList({ silent: true });
      loadRecruitingDashboard({ silent: true });
      loadReportActionAlerts({ silent: true });

      operationsRefresh.then((operationsSucceeded) => {
        if (operationsSucceeded) {
          playDataRefreshCue();
        }
      });
    }, 10 * 60 * 1000);

    return () => window.clearInterval(interval);
  }, [isAuthenticated, accessToken]);

  useEffect(() => {
    if (!isAuthenticated) return undefined;

    loadUploadDigest(uploadDigestDate);

    const interval = window.setInterval(() => {
      loadUploadDigest(uploadDigestDate, { silent: true });
    }, 10 * 60 * 1000);

    return () => window.clearInterval(interval);
  }, [isAuthenticated, accessToken, uploadDigestDate]);

  useEffect(() => {
    driverHistoryRequestRef.current += 1;
    setDriverHistoryModalOpen(false);
    setDriverHistorySnapshot(null);
    setDriverHistoryLoading(false);
    setDriverHistoryError('');
  }, [
    selectedDriverRoster?.id,
    selectedDriverRoster?.equipmentId,
    selectedDriverRoster?.hasRosterDetails,
    selectedDriverRoster?.roster?.truck
  ]);

  useEffect(() => {
    if (!isAuthenticated) {
      salesLeadsPrewarmStartedRef.current = false;
      return undefined;
    }

    if (salesLeadsPrewarmStartedRef.current || salesLeadsReport) return undefined;

    if (!startupDashboardSettled) return undefined;

    salesLeadsPrewarmStartedRef.current = true;

    let idleCallbackId = null;
    const timeoutId = window.setTimeout(() => {
      const runPrewarm = () => prewarmSalesLeadsReport();

      if ('requestIdleCallback' in window) {
        idleCallbackId = window.requestIdleCallback(runPrewarm, { timeout: 8000 });
        return;
      }

      runPrewarm();
    }, 1500);

    return () => {
      window.clearTimeout(timeoutId);
      if (idleCallbackId && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(idleCallbackId);
      }
    };
  }, [
    isAuthenticated,
    salesLeadsReport,
    startupDashboardSettled
  ]);

  useEffect(() => {
    const pendingBol = String(intelliTrackPendingBol || '').trim().toUpperCase();
    if (!pendingBol) return;

    const records = intelliTrackData?.records || [];
    const isNowTracking = records.some((record) =>
      String(record?.BOLNumber || '').trim().toUpperCase() === pendingBol
    );

    if (isNowTracking) {
      setIntelliTrackPendingBol('');
      setIntelliTrackActionMessage(`${pendingBol} is now showing in Currently Tracking.`);
    }
  }, [intelliTrackData, intelliTrackPendingBol]);

  useEffect(() => {
    if (!intelliTrackActionMessage) return undefined;

    const timeout = window.setTimeout(() => {
      setIntelliTrackActionMessage('');
    }, 7000);

    return () => window.clearTimeout(timeout);
  }, [intelliTrackActionMessage]);

  useEffect(() => {
    if (!availableTruckActionMessage) return undefined;

    const timeout = window.setTimeout(() => {
      setAvailableTruckActionMessage('');
    }, 9000);

    return () => window.clearTimeout(timeout);
  }, [availableTruckActionMessage]);

  function toggleSort(field) {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }

    setSortField(field);
    setSortDirection('asc');
    setSelectedSalesLead(null);
    setCustomerLookupError('');
    setDriverLookupError('');
  }

  function getSortIndicator(field) {
    if (sortField !== field) return '↕';

    return sortDirection === 'asc' ? '▲' : '▼';
  }

  function closeIntelliTrackSubsections() {
    setIntelliTrackOpen(false);
    setIntelliTrackActionOpen(false);
  }

  function closeAvailableTruckSubsections() {
    setAvailableTrucksCurrentOpen(false);
    setAvailableTrucksOpen(false);
    setAvailableTrucksActionOpen(false);
    setAvailableTruckDistributionOpen(false);
    setAvailableTruckDistributionInactiveModalOpen(false);
  }

  function closeRecruitingSubsections() {
    setSelectedRecruitingProfile(null);
    setRecruitingCreateModalOpen(false);
    setRecruitingSnapshotModalOpen(false);
    setRecruitingProfileError('');
    setRecruitingActionError('');
    setRecruitingSnapshotError('');
  }

  function toggleIntelliTrackSubsection(sectionName) {
    const sectionMap = {
      current: { isOpen: intelliTrackOpen, setter: setIntelliTrackOpen },
      action: { isOpen: intelliTrackActionOpen, setter: setIntelliTrackActionOpen }
    };
    const target = sectionMap[sectionName];
    if (!target) return;

    const willOpen = !target.isOpen;
    closeIntelliTrackSubsections();
    if (willOpen) target.setter(true);
  }

  function toggleAvailableTruckSubsection(sectionName) {
    const sectionMap = {
      current: { isOpen: availableTrucksCurrentOpen, setter: setAvailableTrucksCurrentOpen },
      analysis: { isOpen: availableTrucksOpen, setter: setAvailableTrucksOpen },
      action: { isOpen: availableTrucksActionOpen, setter: setAvailableTrucksActionOpen },
      distribution: { isOpen: availableTruckDistributionOpen, setter: setAvailableTruckDistributionOpen }
    };
    const target = sectionMap[sectionName];
    if (!target) return;

    const willOpen = !target.isOpen;
    closeAvailableTruckSubsections();

    if (willOpen) {
      target.setter(true);

      if (sectionName === 'distribution' && !availableTruckDistributionData && !availableTruckDistributionLoading) {
        loadAvailableTruckDistributionList();
      }
    }
  }

  function closeMainFeatureSections(except = '') {
    if (except !== 'uploadDigest') {
      setUploadDigestSectionOpen(false);
    }

    if (except !== 'intelliTrack') {
      setIntelliTrackSectionOpen(false);
      closeIntelliTrackSubsections();
    }

    if (except !== 'availableTrucks') {
      setAvailableTrucksSectionOpen(false);
      closeAvailableTruckSubsections();
    }

    if (except !== 'salesAndLeads') {
      setSalesAndLeadsSectionOpen(false);
      closeSalesAndLeadsSubsections();
    }

    if (except !== 'recruiting') {
      setRecruitingSectionOpen(false);
      closeRecruitingSubsections();
    }

    if (except !== 'reports') {
      setReportsSectionOpen(false);
      closeReportSubsections();
    }
  }

  function toggleIntelliTrackSection() {
    const willOpen = !intelliTrackSectionOpen;

    if (willOpen) {
      closeMainFeatureSections('intelliTrack');
    } else {
      closeIntelliTrackSubsections();
    }

    setIntelliTrackSectionOpen(willOpen);
  }

  function toggleAvailableTrucksSection() {
    const willOpen = !availableTrucksSectionOpen;

    if (willOpen) {
      closeMainFeatureSections('availableTrucks');
    } else {
      closeAvailableTruckSubsections();
    }

    setAvailableTrucksSectionOpen(willOpen);
  }

  function toggleUploadDigestSection() {
    const willOpen = !uploadDigestSectionOpen;

    if (willOpen) {
      closeMainFeatureSections('uploadDigest');
    }

    setUploadDigestSectionOpen(willOpen);
  }

  function toggleRecruitingSection() {
    const willOpen = !recruitingSectionOpen;

    if (willOpen) {
      closeMainFeatureSections('recruiting');
      if (!recruitingData && !recruitingLoading) {
        loadRecruitingDashboard();
      }
    } else {
      closeRecruitingSubsections();
    }

    setRecruitingSectionOpen(willOpen);
  }

  function resetAppState() {
    setQuery('');
    setResults([]);
    setSearchedRecords(0);
    setSelected(null);
    setOrderReturnTrailLabel('');
    setOrderDrilldownReturn(null);
    setOrderNotesData(null);
    setOrderNotesLoading(false);
    setOrderNotesError('');
    setOrderNotesTypeFilter('All');
    resetOrderNoteComposer();
    orderNotesRequestRef.current += 1;
    setHasSearched(false);
    setError('');
    setAuthError('');
    setDocumentError('');
    setDriverLookupLoading(false);
    setDriverLookupError('');
    setSortField('');
    setSortDirection('asc');
    setSalesSearchReturnLead(null);
    setIntelliTrackSearchBol('');
    setIntelliTrackSearchResult(null);
    setIntelliTrackSearchError('');
    setIntelliTrackActionError('');
    setIntelliTrackActionMessage('');
    setIntelliTrackPendingBol('');
    setIntelliTrackSuppressedBols([]);
    setUploadDigestSectionOpen(false);
    setIntelliTrackSectionOpen(false);
    setIntelliTrackOpen(false);
    setIntelliTrackActionOpen(false);
    setAvailableTrucksSectionOpen(false);
    setAvailableTrucksCurrentOpen(false);
    setAvailableTrucksOpen(false);
    setAvailableTrucksActionOpen(false);
    setAvailableTruckDistributionOpen(false);
    setAvailableTruckDistributionData(null);
    setAvailableTruckDistributionLoading(false);
    setAvailableTruckDistributionError('');
    setAvailableTruckDistributionCompany('');
    setAvailableTruckDistributionEmail('');
    setAvailableTruckDistributionSubmitting(false);
    setAvailableTruckDistributionMessage('');
    setAvailableTruckDistributionSortField('company');
    setAvailableTruckDistributionSortDirection('asc');
    setAvailableTruckDistributionInactiveModalOpen(false);
    setAvailableTrucksData(null);
    setAvailableTrucksError('');
    setAvailableTruckFormDate(getEasternDateInputValue());
    setAvailableTruckTimeOfDay(getDefaultAvailableTruckTimeOfDay());
    setAvailableTruckRows([createAvailableTruckDraftRow('reset')]);
    setAvailableTruckSubmitting(false);
    setAvailableTruckRepublishingId('');
    setAvailableTruckActionMessage('');
    setAvailableTruckActionError('');
    setAvailableTruckDrilldown(null);
    setReportActionAlerts(null);
    setReportActionAlertsLoading(false);
    setReportActionAlertsError('');
    setOperationalNotesOpenOrderKey('');
    setOperationalNotesOpenOrderError('');
    setDriverTimeOffReport(null);
    setDriverTimeOffError(null);
    setDriverTimeOffModalOpen(false);
    setDriverTimeOffFormOpen(false);
    setDriverTimeOffEditingRecord(null);
    setDriverTimeOffSubmitting(false);
    setDriverTimeOffActionMessage('');
    setDriverTimeOffActionError('');
    setSelectedDriverRoster(null);
    setDriverHistoryModalOpen(false);
    setDriverHistorySnapshot(null);
    setDriverHistoryLoading(false);
    setDriverHistoryError('');
    driverHistoryCacheRef.current.clear();
    orderNotesCacheRef.current.clear();
    orderNotesRequestRef.current += 1;
    setReportsSectionOpen(false);
    setSalesAndLeadsSectionOpen(false);
    setRecruitingSectionOpen(false);
    setRecruitingData(null);
    setRecruitingLoading(false);
    setRecruitingError('');
    setRecruitingStatusFilter('Heads-Up');
    setRecruitingSearch('');
    setSelectedRecruitingProfile(null);
    setRecruitingProfileLoading(false);
    setRecruitingProfileError('');
    setRecruitingActionLoading('');
    setRecruitingActionMessage('');
    setRecruitingActionError('');
    setRecruitingCreateModalOpen(false);
    setRecruitingCandidateDraft(createRecruitingCandidateDraft());
    setRecruitingCandidateCreating(false);
    setRecruitingSnapshotModalOpen(false);
    setRecruitingSnapshotReport(null);
    setRecruitingSnapshotLoading(false);
    setRecruitingSnapshotError('');
    setRecruitingSnapshotView('solo');
    setRecruitingNoteDraft('');
    setRecruitingNoteType('Internal');
    setRecruitingFollowUpDate('');
    setRecruitingStatusDraft('');
    setRecruitingStatusReason('');
    setRecruitingOwnerOverride(false);
    setOpenReportGroups([]);
    setActiveReportPanel('');
    setOpenGrossRevenueQuarters([]);
    setYearlyProjectionReport(null);
    setYearlyProjectionLoading(false);
    setYearlyProjectionError(null);
    setYearlyProjectionModalOpen(false);
    setYearlyProjectionCustomOpen(false);
    setYearlyProjectionCustomDriverCount('');
    setProjectionRevenueDrilldownLoadingTruck('');
    setProjectionRevenueDrilldownError('');
    searchCacheRef.current.clear();
    onThisDayReportCacheRef.current.clear();

    if (pendingSearchControllerRef.current) {
      pendingSearchControllerRef.current.abort();
      pendingSearchControllerRef.current = null;
    }
  }

  async function handleLogin() {
    if (loginLoading) return;

    const token = password.trim();

    if (!token) {
      setAuthError('Enter an access token.');
      return;
    }

    setAuthError('');
    setLoginLoading(true);
    setLoginStatusMessage('Checking access token...');

    const wakeTimer = window.setTimeout(() => {
      setLoginStatusMessage('Waking up Kole Connect. The server may take 30-60 seconds to start after being idle.');
    }, 1200);

    const stillWorkingTimer = window.setTimeout(() => {
      setLoginStatusMessage('Still waking up. Please leave this window open; this is normal after the server has spun down.');
    }, 12000);

    const controller = new AbortController();
    const timeoutTimer = window.setTimeout(() => {
      controller.abort();
    }, 90000);

    try {
      const res = await fetch(`${API}/auth-check`, {
        headers: {
          'X-Lookup-Token': token
        },
        signal: controller.signal
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Access token was not accepted.');
      }

      sessionStorage.setItem('koleLookupToken', token);
      driverHistoryCacheRef.current.clear();
      startupSplashStartedAtRef.current = Date.now();
      setStartupSplashElapsedMs(0);
      setStartupSplashDismissed(userPrefs.skipStartupSplash);
      setStartupSplashExiting(false);
      setStartupSplashVisible(!userPrefs.skipStartupSplash);
      applyDashboardPreferenceDefaults(userPrefs);
      setAccessToken(token);
      setPassword('');
      setLoginStatusMessage('');
    } catch (err) {
      const isAbort = err?.name === 'AbortError';
      setAuthError(isAbort
        ? 'The server did not respond within 90 seconds. Try again in a moment; it may still be waking up.'
        : (err.message || 'Login failed.'));
    } finally {
      window.clearTimeout(wakeTimer);
      window.clearTimeout(stillWorkingTimer);
      window.clearTimeout(timeoutTimer);
      setLoginLoading(false);
    }
  }

  function handleLogout() {
    sessionStorage.removeItem('koleLookupToken');
    setAccessToken('');
    setPassword('');
    setAuthError('');
    setLoginStatusMessage('');
    setLoginLoading(false);
    setStartupSplashVisible(false);
    setStartupSplashExiting(false);
    setStartupSplashDismissed(false);
    setStartupSplashElapsedMs(0);
    salesLeadsPrewarmStartedRef.current = false;
    driverHistoryCacheRef.current.clear();
    orderNotesCacheRef.current.clear();
    orderNotesRequestRef.current += 1;
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
    setOrderReturnTrailLabel('');
    setHasSearched(false);
    setError('');
    setStatusFilter('All');
    setDocumentError('');
    setSortField('');
    setSortDirection('asc');
    setSalesSearchReturnLead(null);
    setDriverLookupError('');
  }

  function clearOrderSearch() {
    setQuery('');
    setResults([]);
    setSearchedRecords(0);
    setSelected(null);
    setOrderReturnTrailLabel('');
    setHasSearched(false);
    setError('');
    setStatusFilter('All');
    setDocumentError('');
    setSortField('');
    setSortDirection('asc');
    setSalesSearchReturnLead(null);
    setDriverLookupError('');
  }

  function returnToCustomerCard() {
    if (!salesSearchReturnLead) return;

    const customerToRestore = salesSearchReturnLead;

    setQuery('');
    setResults([]);
    setSearchedRecords(0);
    setSelected(null);
    setOrderReturnTrailLabel('');
    setHasSearched(false);
    setError('');
    setStatusFilter('All');
    setDocumentError('');
    setSortField('');
    setSortDirection('asc');
    setSalesSearchReturnLead(null);
    setSelectedSalesLead(customerToRestore);
    setCustomerLookupError('');
    setDriverLookupError('');
  }

  async function handleSearch() {
    const q = query.trim();
    if (!q) return;

    const searchKey = `${includeArchives ? 'archives' : 'current'}|${q.toLowerCase()}`;
    const cachedSearch = getClientCacheRecord(searchCacheRef.current, searchKey, SEARCH_RESULT_CACHE_MS);

    setError('');
    setHasSearched(true);
    setSelected(null);
    setOrderReturnTrailLabel('');
    setSelectedView('basic');
    setStatusFilter('All');
    setDocumentError('');
    setSortField('');
    setSortDirection('asc');
    setSalesSearchReturnLead(null);
    setDriverLookupError('');

    if (cachedSearch) {
      if (pendingSearchControllerRef.current) {
        pendingSearchControllerRef.current.abort();
        pendingSearchControllerRef.current = null;
      }

      setLoading(false);
      setResults(cachedSearch.results || []);
      setSearchedRecords(cachedSearch.searchedRecords || 0);
      return;
    }

    if (pendingSearchControllerRef.current) {
      pendingSearchControllerRef.current.abort();
    }

    const controller = new AbortController();
    pendingSearchControllerRef.current = controller;
    setLoading(true);

    try {
      const res = await authedFetch(
        `${API}/search?q=${encodeURIComponent(q)}&includeArchives=${includeArchives}`,
        { signal: controller.signal }
      );
      const data = await res.json();

      if (!data.success) throw new Error(data.error || 'Search failed');

      const cachedPayload = {
        results: data.results || [],
        searchedRecords: data.searchedRecords || 0
      };

      setLimitedClientCacheRecord(searchCacheRef.current, searchKey, cachedPayload, 12);
      setResults(cachedPayload.results);
      setSearchedRecords(cachedPayload.searchedRecords);
    } catch (err) {
      if (err?.name === 'AbortError') return;

      setError(err.message);
      setResults([]);
    } finally {
      if (pendingSearchControllerRef.current === controller) {
        pendingSearchControllerRef.current = null;
      }

      setLoading(false);
    }
  }
  
async function loadOperationsDashboard(options = {}) {
  const { silent = false, forceRefresh = false } = options;

  if (!silent) {
    setOperationsLoading(true);
  }

  setOperationsError('');

  try {
    const operationsParams = new URLSearchParams();
    if (forceRefresh) operationsParams.set('refresh', 'true');

    const operationsQuery = operationsParams.toString();
    const res = await authedFetch(
      `${API}/operations/today${operationsQuery ? `?${operationsQuery}` : ''}`
    );

    const data = await res.json();

    if (!data.success) {
      throw new Error(data.error || 'Unable to load operations dashboard.');
    }

    setOperationsData(data);
    return true;
  } catch (err) {
    setOperationsError(err.message);

    if (!silent) {
      setOperationsData(null);
    }

    return false;
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


async function loadIntelliTrack(options = {}) {
  const { silent = false } = options;

  if (!silent) {
    setIntelliTrackLoading(true);
  }

  setIntelliTrackError('');

  try {
    const res = await authedFetch(`${API}/tracking/intellitrack`);
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Unable to load IntelliTrack.');
    }

    setIntelliTrackData(data);

    const activeBols = new Set(
      (data.records || [])
        .map((record) => String(record?.BOLNumber || '').trim().toUpperCase())
        .filter(Boolean)
    );

    setIntelliTrackSuppressedBols((current) =>
      current.filter((bol) => activeBols.has(bol))
    );
  } catch (err) {
    setIntelliTrackError(err.message || 'Unable to load IntelliTrack.');

    if (!silent) {
      setIntelliTrackData(null);
    }
  } finally {
    if (!silent) {
      setIntelliTrackLoading(false);
    }
  }
}



async function loadAvailableTruckDistributionList(options = {}) {
  const { silent = false } = options;

  if (!silent) {
    setAvailableTruckDistributionLoading(true);
  }

  setAvailableTruckDistributionError('');

  try {
    const res = await authedFetch(`${API}/available-trucks/distribution-list`);
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Unable to load Available Equipment distribution list.');
    }

    setAvailableTruckDistributionData(data);
  } catch (err) {
    setAvailableTruckDistributionError(err.message || 'Unable to load Available Equipment distribution list.');

    if (!silent) {
      setAvailableTruckDistributionData(null);
    }
  } finally {
    if (!silent) {
      setAvailableTruckDistributionLoading(false);
    }
  }
}

function validateAvailableTruckDistributionForm() {
  const company = availableTruckDistributionCompany.trim();
  const email = availableTruckDistributionEmail.trim().toLowerCase();

  if (!company) {
    throw new Error('Company is required before adding a contact.');
  }

  if (!email) {
    throw new Error('Email address is required before adding a contact.');
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Enter a valid email address.');
  }

  const duplicate = [
    ...(availableTruckDistributionData?.rows || []),
    ...(availableTruckDistributionData?.inactiveRows || [])
  ].find((row) => String(row?.email || '').trim().toLowerCase() === email);

  if (duplicate) {
    const statusLabel = duplicate.active === false ? 'inactive/hidden' : 'active';
    throw new Error(`${duplicate.email} is already ${statusLabel} on the distribution list${duplicate.company ? ` under ${duplicate.company}` : ''}.`);
  }

  return { company, email };
}

async function submitAvailableTruckDistributionContact(e) {
  if (e) {
    e.preventDefault();
  }

  setAvailableTruckDistributionSubmitting(true);
  setAvailableTruckDistributionError('');
  setAvailableTruckDistributionMessage('');

  try {
    const payload = validateAvailableTruckDistributionForm();
    const res = await authedFetch(`${API}/available-trucks/distribution-list`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Unable to add distribution-list contact.');
    }

    setAvailableTruckDistributionMessage(data.message || `${payload.company} added to the distribution list.`);
    setAvailableTruckDistributionCompany('');
    setAvailableTruckDistributionEmail('');
    await loadAvailableTruckDistributionList({ silent: true });
  } catch (err) {
    setAvailableTruckDistributionError(err.message || 'Unable to add distribution-list contact.');
  } finally {
    setAvailableTruckDistributionSubmitting(false);
  }
}

function clearAvailableTruckDistributionForm() {
  setAvailableTruckDistributionCompany('');
  setAvailableTruckDistributionEmail('');
  setAvailableTruckDistributionError('');
  setAvailableTruckDistributionMessage('');
}

function toggleAvailableTruckDistributionSort(field) {
  setAvailableTruckDistributionSortField((currentField) => {
    if (currentField === field) {
      setAvailableTruckDistributionSortDirection((currentDirection) => currentDirection === 'asc' ? 'desc' : 'asc');
      return currentField;
    }

    setAvailableTruckDistributionSortDirection('asc');
    return field;
  });
}

function getAvailableTruckDistributionSortIndicator(field) {
  if (availableTruckDistributionSortField !== field) return '↕';
  return availableTruckDistributionSortDirection === 'asc' ? '▲' : '▼';
}

async function loadAvailableTrucks(options = {}) {
  const { silent = false } = options;

  if (!silent) {
    setAvailableTrucksLoading(true);
  }

  setAvailableTrucksError('');

  try {
    const res = await authedFetch(`${API}/available-trucks`);
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Unable to load Available Equipment.');
    }

    setAvailableTrucksData(data);
  } catch (err) {
    setAvailableTrucksError(err.message || 'Unable to load Available Equipment.');

    if (!silent) {
      setAvailableTrucksData(null);
    }
  } finally {
    if (!silent) {
      setAvailableTrucksLoading(false);
    }
  }
}

function updateAvailableTruckRow(rowKey, field, value) {
  setAvailableTruckRows((current) =>
    current.map((row) => {
      if (row.key !== rowKey) return row;

      const clearsRosterSelection =
        row.rosterDriverKey && ['driverName', 'unitNo', 'equipmentType'].includes(field);

      return {
        ...row,
        ...(clearsRosterSelection ? { rosterDriverKey: '' } : {}),
        [field]: value
      };
    })
  );

  setAvailableTruckActionError('');
  setAvailableTruckActionMessage('');
}

function applyAvailableTruckSuggestion(rowKey, suggestion) {
  const suggestedLocation = String(suggestion?.location || '').trim();
  const suggestedTime = String(suggestion?.timeLabel || '').trim();

  if (!suggestedLocation) return;

  setAvailableTruckRows((current) =>
    current.map((row) => {
      if (row.key !== rowKey) return row;

      const currentLocation = String(row.currentLocation || '').trim();
      const currentLocationKey = normalizeAvailableTruckSuggestionKey(currentLocation);
      const suggestedKey = normalizeAvailableTruckSuggestionKey(suggestedLocation);

      const existingSlots = [1, 2, 3, 4]
        .map((rank) => ({
          location: String(row[`proximity${rank}`] || '').trim(),
          timeLabel: String(row[`proximity${rank}Time`] || '').trim()
        }))
        .filter((slot) => slot.location);

      const nextSlots = [];
      const seenKeys = new Set();

      function pushSlot(location, timeLabel) {
        const cleanLocation = String(location || '').trim();
        if (!cleanLocation || nextSlots.length >= 4) return;

        const key = normalizeAvailableTruckSuggestionKey(cleanLocation);
        if (!key || seenKeys.has(key)) return;

        seenKeys.add(key);
        nextSlots.push({
          location: cleanLocation,
          timeLabel: String(timeLabel || '').trim()
        });
      }

      // The entered current city is always the first proximity slot. In the
      // existing VBA-style posting pattern, the truck's actual city is the
      // immediate option, and historical nearby matches fill in after it.
      if (currentLocation) {
        pushSlot(currentLocation, 'Immediate');
      }

      existingSlots.forEach((slot) => {
        const slotKey = normalizeAvailableTruckSuggestionKey(slot.location);
        if (slotKey && slotKey !== currentLocationKey) {
          pushSlot(slot.location, slot.timeLabel);
        }
      });

      if (!suggestion?.isImmediate && suggestedKey && !seenKeys.has(suggestedKey)) {
        pushSlot(suggestedLocation, suggestedTime);
      }

      const nextRow = { ...row };

      for (let rank = 1; rank <= 4; rank += 1) {
        const slot = nextSlots[rank - 1];
        nextRow[`proximity${rank}`] = slot?.location || '';
        nextRow[`proximity${rank}Time`] = slot?.timeLabel || '';
      }

      return nextRow;
    })
  );

  setAvailableTruckActionError('');
  setAvailableTruckActionMessage('');
}

function selectAvailableTruckRosterDriver(rowKey, rosterDriverKey) {
  const selectedOption = availableTruckDriverOptions.find((option) => option.key === rosterDriverKey) || null;

  setAvailableTruckRows((current) =>
    current.map((row) => {
      if (row.key !== rowKey) return row;

      if (!selectedOption) {
        return {
          ...row,
          rosterDriverKey: '',
          driverName: '',
          unitNo: '',
          equipmentType: ''
        };
      }

      return {
        ...row,
        rosterDriverKey: selectedOption.key,
        driverName: selectedOption.driverName,
        unitNo: selectedOption.unitNo,
        equipmentType: selectedOption.equipmentType
      };
    })
  );

  setAvailableTruckActionError('');
  setAvailableTruckActionMessage('');
}

function addAvailableTruckRow() {
  setAvailableTruckRows((current) => {
    if (current.length >= AVAILABLE_TRUCK_MAX_ROWS) return current;
    return [...current, createAvailableTruckDraftRow(current.length + 1)];
  });

  setAvailableTruckActionError('');
}

function removeAvailableTruckRow(rowKey) {
  setAvailableTruckRows((current) => {
    const nextRows = current.filter((row) => row.key !== rowKey);
    return nextRows.length ? nextRows : [createAvailableTruckDraftRow('replacement')];
  });

  setAvailableTruckActionError('');
  setAvailableTruckActionMessage('');
}

function clearAvailableTruckForm() {
  setAvailableTruckFormDate(getEasternDateInputValue());
  setAvailableTruckTimeOfDay(getDefaultAvailableTruckTimeOfDay());
  setAvailableTruckRows([createAvailableTruckDraftRow('clear')]);
  setAvailableTruckActionError('');
  setAvailableTruckActionMessage('');
}

function buildAvailableTruckSubmissionDrivers() {
  return availableTruckRows
    .filter(hasAvailableTruckDraftData)
    .map((row) => ({
      rosterDriverKey: String(row.rosterDriverKey || '').trim(),
      driverName: row.driverName.trim(),
      unitNo: row.unitNo.trim(),
      equipmentType: row.equipmentType.trim(),
      currentLocation: row.currentLocation.trim(),
      proximityStops: [1, 2, 3, 4].map((rank) => ({
        location: String(row[`proximity${rank}`] || '').trim(),
        timeLabel: String(row[`proximity${rank}Time`] || '').trim()
      }))
    }));
}

function validateAvailableTruckFormRows(drivers) {
  if (drivers.length === 0) {
    throw new Error('Add at least one truck before submitting. Blank rows are ignored, but all rows are blank right now.');
  }

  const seenRosterDrivers = new Map();
  const seenUnits = new Map();
  const seenDriverNames = new Map();

  drivers.forEach((driver, index) => {
    const missing = [];
    if (!driver.driverName) missing.push('driver name');
    if (!driver.unitNo) missing.push('unit number');
    if (!driver.equipmentType) missing.push('equipment type');
    if (!driver.currentLocation) missing.push('current location');

    if (missing.length > 0) {
      throw new Error(`Truck ${index + 1} needs ${missing.join(', ')}.`);
    }

    const rowLabel = `Truck ${index + 1}`;
    const rosterKey = String(driver.rosterDriverKey || '').trim();
    const unitKey = String(driver.unitNo || '').trim().toUpperCase();
    const driverKey = String(driver.driverName || '').trim().toLowerCase();

    if (rosterKey) {
      if (seenRosterDrivers.has(rosterKey)) {
        throw new Error(`${rowLabel} duplicates ${seenRosterDrivers.get(rosterKey)}. Each active roster driver can only be posted once.`);
      }
      seenRosterDrivers.set(rosterKey, rowLabel);
    }

    if (unitKey) {
      if (seenUnits.has(unitKey)) {
        throw new Error(`${rowLabel} duplicates unit ${driver.unitNo} from ${seenUnits.get(unitKey)}.`);
      }
      seenUnits.set(unitKey, rowLabel);
    }

    if (driverKey) {
      if (seenDriverNames.has(driverKey)) {
        throw new Error(`${rowLabel} duplicates driver ${driver.driverName} from ${seenDriverNames.get(driverKey)}.`);
      }
      seenDriverNames.set(driverKey, rowLabel);
    }
  });
}

async function submitAvailableTruckForm(e) {
  if (e) {
    e.preventDefault();
  }

  setAvailableTruckSubmitting(true);
  setAvailableTruckActionError('');
  setAvailableTruckActionMessage('');

  try {
    const drivers = buildAvailableTruckSubmissionDrivers();
    validateAvailableTruckFormRows(drivers);

    const res = await authedFetch(`${API}/available-trucks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        dateSent: availableTruckFormDate,
        timeOfDay: availableTruckTimeOfDay,
        drivers
      })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Unable to submit available equipment.');
    }

    setAvailableTruckActionMessage(data.message || `${drivers.length} available truck${drivers.length === 1 ? '' : 's'} submitted.`);
    setAvailableTruckRows([createAvailableTruckDraftRow('submitted')]);
    await loadAvailableTrucks({ silent: true });
  } catch (err) {
    setAvailableTruckActionError(err.message || 'Unable to submit available equipment.');
  } finally {
    setAvailableTruckSubmitting(false);
  }
}

async function republishAvailableTruck(record) {
  const recordId = String(record?.id || '').trim();
  const republishKey = recordId || `${record?.driverName || ''}-${record?.unitNo || ''}`;

  if (!recordId) {
    setAvailableTruckActionError('This available-equipment row is missing its source ID, so it cannot be republished from the dashboard.');
    return;
  }

  setAvailableTruckRepublishingId(republishKey);
  setAvailableTruckActionError('');
  setAvailableTruckActionMessage('');

  try {
    const res = await authedFetch(`${API}/available-trucks/republish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ recordId })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Unable to republish available equipment.');
    }

    setAvailableTruckActionMessage(data.message || `${record?.driverName || 'Available equipment'} queued for republish.`);
    await loadAvailableTrucks({ silent: true });
  } catch (err) {
    setAvailableTruckActionError(err.message || 'Unable to republish available equipment.');
  } finally {
    setAvailableTruckRepublishingId('');
  }
}

function isIntelliTrackBolWaiting(bol) {
  const pendingBol = String(intelliTrackPendingBol || '').trim().toUpperCase();
  const targetBol = String(bol || '').trim().toUpperCase();

  if (!pendingBol || !targetBol || pendingBol !== targetBol) {
    return false;
  }

  const records = intelliTrackData?.records || [];
  return !records.some((record) =>
    String(record?.BOLNumber || '').trim().toUpperCase() === targetBol
  );
}

function handleIntelliTrackBolChange(value) {
  setIntelliTrackSearchBol(value.toUpperCase());
  setIntelliTrackSearchError('');
  setIntelliTrackActionError('');
  setIntelliTrackActionMessage('');
}

async function searchIntelliTrackOrder(e) {
  if (e) {
    e.preventDefault();
  }

  const bol = intelliTrackSearchBol.trim().toUpperCase();

  if (!bol) {
    setIntelliTrackSearchError('Enter a BOL number.');
    return;
  }

  if (isIntelliTrackBolWaiting(bol)) {
    setIntelliTrackSearchError(`${bol} already has a tracking request submitted. Waiting for it to show in Currently Tracking.`);
    return;
  }

  setIntelliTrackSearchLoading(true);
  setIntelliTrackSearchError('');
  setIntelliTrackActionError('');
  setIntelliTrackActionMessage('');
  setIntelliTrackSearchResult(null);

  try {
    const res = await authedFetch(
      `${API}/tracking/intellitrack/order?bol=${encodeURIComponent(bol)}`
    );

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Unable to find that order.');
    }

    setIntelliTrackSearchResult(data.order || null);
  } catch (err) {
    setIntelliTrackSearchError(err.message || 'Unable to find that order.');
  } finally {
    setIntelliTrackSearchLoading(false);
  }
}

function getIntelliTrackButtonState(order) {
  const isTracking = Boolean(order?.EnableTracking || order?.TrackingActive);

  if (isTracking) {
    return {
      enabled: false,
      label: 'Turn Tracking Off',
      disabled: false,
      reason: ''
    };
  }

  if (!order?.CanStartTracking) {
    return {
      enabled: true,
      label: 'Turn Tracking On',
      disabled: true,
      reason: order?.StartBlockedReason || 'This order is not eligible for IntelliTrack.'
    };
  }

  return {
    enabled: true,
    label: 'Turn Tracking On',
    disabled: false,
    reason: ''
  };
}

async function toggleIntelliTrackOrder(order, enabled) {
  if (!order?.id) {
    setIntelliTrackActionError('This order does not have a Bid Listing item ID.');
    return;
  }

  const loadingKey = `${order.id}-${enabled ? 'on' : 'off'}`;

  setIntelliTrackActionLoading(loadingKey);
  setIntelliTrackActionError('');
  setIntelliTrackActionMessage('');

  try {
    const res = await authedFetch(
      `${API}/tracking/intellitrack/order/${encodeURIComponent(order.id)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ enabled })
      }
    );

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Unable to update IntelliTrack.');
    }

    if (enabled) {
      const submittedBol = String(data.order?.BOL || order?.BOL || '').trim().toUpperCase();

      if (submittedBol) {
        setIntelliTrackPendingBol(submittedBol);
      }

      setIntelliTrackSearchBol('');
      setIntelliTrackSearchResult(null);
      setIntelliTrackSearchError('');
      setIntelliTrackActionMessage(
        data.message ||
        (submittedBol
          ? `${submittedBol} tracking request submitted. Waiting for it to show in Currently Tracking.`
          : 'IntelliTrack request submitted. Waiting for it to show in Currently Tracking.')
      );
    } else {
      const stoppedBol = String(
        data.order?.BOL ||
        order?.BOL ||
        order?.BOLNumber ||
        ''
      ).trim().toUpperCase();

      if (stoppedBol) {
        setIntelliTrackSuppressedBols((current) =>
          current.includes(stoppedBol) ? current : [...current, stoppedBol]
        );
      }

      setIntelliTrackSearchBol('');
      setIntelliTrackSearchResult(null);
      setIntelliTrackSearchError('');
      setIntelliTrackPendingBol('');
      setIntelliTrackActionMessage(
        data.message ||
        (stoppedBol
          ? `${stoppedBol} tracking shutoff submitted.`
          : 'IntelliTrack shutoff submitted.')
      );
    }

    if (enabled) {
      await loadIntelliTrack({ silent: true });
    }
  } catch (err) {
    setIntelliTrackActionError(err.message || 'Unable to update IntelliTrack.');
  } finally {
    setIntelliTrackActionLoading('');
  }
}

async function turnOffIntelliTrackRecord(record) {
  const bidListingId = String(record?.BidListingID || '').trim();

  if (!bidListingId) {
    setIntelliTrackActionError('This IntelliTrack row does not have a linked Bid Listing ID.');
    return;
  }

  await toggleIntelliTrackOrder({ id: bidListingId, BOL: record?.BOLNumber }, false);
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


function findBestOrderLookupMatch(records = [], lookupValue = '') {
  const normalized = String(lookupValue || '').trim().toLowerCase();
  const compact = normalized.replace(/\s+/g, '');

  if (!compact) return null;

  const exactBol = records.find((record) => String(record?.BOL || '').trim().toLowerCase().replace(/\s+/g, '') === compact);
  if (exactBol) return exactBol;

  const exactBid = records.find((record) => String(record?.BidID || '').trim().toLowerCase() === normalized);
  if (exactBid) return exactBid;

  return records.length === 1 ? records[0] : null;
}

async function openOrderFromLookupValue(lookupValue, options = {}) {
  const cleanLookup = String(lookupValue || '').trim();
  const {
    view = 'basic',
    returnLabel = '',
    loadingKey = '',
    setActionError = setError,
    includeArchives = true
  } = options;

  if (!cleanLookup) {
    setActionError('This row does not have enough order information to look up.');
    return;
  }

  if (loadingKey) {
    setDocumentLoading(loadingKey);
  }

  setActionError('');
  setLoadingDetail(true);

  try {
    const params = new URLSearchParams({
      q: cleanLookup,
      includeArchives: includeArchives ? 'true' : 'false'
    });

    const res = await authedFetch(`${API}/search?${params.toString()}`);
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.success) {
      throw new Error(data.error || data.message || 'Unable to search for the linked order.');
    }

    const match = findBestOrderLookupMatch(data.results || [], cleanLookup);

    if (!match?.id) {
      throw new Error(`No matching order was found for ${cleanLookup}.`);
    }

    await loadDetails(match.id, view, match.SourceListId || '', { returnLabel });
  } catch (err) {
    setActionError(err.message || 'Unable to open linked order.');
  } finally {
    setLoadingDetail(false);
    if (loadingKey) {
      setDocumentLoading('');
    }
  }
}

function openUploadDigestOrder(record, event) {
  event?.stopPropagation();

  const bol = String(record?.BOLNumber || '').trim();
  const loadingKey = `upload-digest-order-${record?.id || bol}`;

  openOrderFromLookupValue(bol, {
    returnLabel: 'Job Photo Uploads',
    loadingKey,
    setActionError: setUploadDigestActionError
  });
}

async function refreshOperationsAndTracking() {
  const operationsRefresh = loadOperationsDashboard({ forceRefresh: true });

  loadDriverPositions();
  loadUploadDigest(uploadDigestDate);
  loadIntelliTrack();
  loadAvailableTrucks();
  loadAvailableTruckDistributionList({ silent: true });

  const operationsSucceeded = await operationsRefresh;

  if (operationsSucceeded) {
    playDataRefreshCue();
  }
}

function closeDriverRosterModal() {
  setDriverHistoryModalOpen(false);
  setSelectedDriverRoster(null);
  setDriverHistorySnapshot(null);
  setDriverHistoryLoading(false);
  setDriverHistoryError('');
  setOrderDrilldownReturn(null);
}

function getOrderDrilldownReturnLabel(snapshot = orderDrilldownReturn) {
  const order = snapshot?.order;
  if (!order) return '';

  return `Order ${order.BOL || order.BidID || ''}`.trim();
}

function getDriverRosterReturnTrailLabel() {
  if (orderDrilldownReturn) return getOrderDrilldownReturnLabel();
  if (selectedGrossRevenueTruck) return 'Revenue Detail';
  if (grossRevenueModalOpen) return 'Gross Revenue Totals';
  if (activeDriverRosterModalOpen) return 'Active Driver Roster';
  if (inactiveDriverRosterModalOpen) return 'Inactive Drivers';
  if (fleetEquipmentModalOpen) return 'Fleet Equipment';
  return '';
}

function handleDriverRosterReturnTrailClick() {
  if (orderDrilldownReturn) {
    restoreOrderFromDrilldown();
    return;
  }

  closeDriverRosterModal();
}

function getCurrentOrderDrilldownSnapshot(record = selected, view = selectedView) {
  if (!record) return null;

  return {
    order: record,
    view: view || 'basic'
  };
}

function parkOrderDrilldownSnapshot(snapshot) {
  if (!snapshot?.order) return;

  setOrderDrilldownReturn(snapshot);
  setSelected(null);
  setOrderReturnTrailLabel('');
  setDocumentError('');
  setDriverLookupError('');
}

function restoreOrderFromDrilldown() {
  const snapshot = orderDrilldownReturn;
  if (!snapshot?.order) return;

  setDriverHistoryModalOpen(false);
  setSelectedDriverRoster(null);
  setDriverHistorySnapshot(null);
  setDriverHistoryLoading(false);
  setDriverHistoryError('');
  setSelectedSalesLead(null);
  setSalesNoteDraft('');
  setSalesNoteMessage('');
  setSalesNoteError('');
  setSalesLeadSuppressionReason('');
  setSalesLeadSuppressionMessage('');
  setSalesLeadSuppressionError('');
  setSelected(snapshot.order);
  setSelectedView(snapshot.view || 'basic');
  if (snapshot.view === 'notes') {
    loadOrderNotes(snapshot.order);
  }
  setOrderDrilldownReturn(null);
}

function closeDriverPerformanceModal() {
  setDriverHistoryModalOpen(false);
}

async function openDriverPerformanceModal() {
  if (driverHistoryLoading || !selectedDriverRoster?.hasRosterDetails || !selectedDriverRoster?.roster) {
    return;
  }

  const truck = getDriverHistoryTruckFromCard(selectedDriverRoster);

  if (!truck) {
    driverHistoryRequestRef.current += 1;
    setDriverHistorySnapshot(null);
    setDriverHistoryLoading(false);
    setDriverHistoryError('No truck number was available for this driver card.');
    setDriverHistoryModalOpen(true);
    return;
  }

  const cachedSnapshot = getCachedDriverHistorySnapshot(truck);
  if (cachedSnapshot) {
    driverHistoryRequestRef.current += 1;
    setDriverHistorySnapshot(cachedSnapshot.snapshot || null);
    setDriverHistoryError(cachedSnapshot.error || '');
    setDriverHistoryLoading(false);
    setDriverHistoryModalOpen(true);
    return;
  }

  const requestId = driverHistoryRequestRef.current + 1;
  driverHistoryRequestRef.current = requestId;

  setDriverHistoryLoading(true);
  setDriverHistoryError('');
  setDriverHistorySnapshot(null);

  try {
    const res = await authedFetch(`${API}/driver-roster/history?truck=${encodeURIComponent(truck)}`);
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Unable to load driver performance snapshot.');
    }

    cacheDriverHistorySnapshot(truck, data);

    if (driverHistoryRequestRef.current === requestId) {
      setDriverHistorySnapshot(data);
      setDriverHistoryError('');
      setDriverHistoryModalOpen(true);
    }
  } catch (err) {
    if (driverHistoryRequestRef.current === requestId) {
      setDriverHistorySnapshot(null);
      setDriverHistoryError(err.message || 'Unable to load driver performance snapshot.');
      setDriverHistoryModalOpen(true);
    }
  } finally {
    if (driverHistoryRequestRef.current === requestId) {
      setDriverHistoryLoading(false);
    }
  }
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

function getRosterDisplayName(roster = {}) {
  return roster.displayName || roster.tmsName || roster.operatorTeamName || '-';
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
  async function loadDetails(id, view = 'basic', sourceListId = '', options = {}) {
    if (!id) {
      setError('This row does not have a record ID.');
      return;
    }

    const returnLabel = Object.prototype.hasOwnProperty.call(options, 'returnLabel')
      ? options.returnLabel
      : getLiveOrderReturnTrailLabel();

    setOrderReturnTrailLabel(returnLabel || '');
    setSelectedView(view);
    setOrderNotesData(null);
    setOrderNotesLoading(false);
    setOrderNotesError('');
    setOrderNotesTypeFilter('All');
    resetOrderNoteComposer();
    orderNotesRequestRef.current += 1;
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

      if (view === 'notes') {
        loadOrderNotes(data);
      }
    } catch (err) {
      setError(err.message);
      setSelected(null);
      setOrderReturnTrailLabel('');
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
    setOrderReturnTrailLabel('');
    setOrderDrilldownReturn(null);
    setDocumentError('');
    setOrderNotesData(null);
    setOrderNotesLoading(false);
    setOrderNotesError('');
    setOrderNotesTypeFilter('All');
    resetOrderNoteComposer();
    orderNotesRequestRef.current += 1;
    setDriverLookupError('');

    if (permitHistoryOrderReturnLoad) {
      setSelectedPermitHistoryLoad(permitHistoryOrderReturnLoad);
      setPermitHistoryOrderReturnLoad(null);
    }
  }

  function getStatusClass(status) {
    const s = (status || '').toLowerCase();

    if (s === 'won') return 'status won';
    if (s === 'lost') return 'status lost';
    if (s === 'tonu') return 'status tonu';
    if (s === 'quote') return 'status quote';
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

    const raw = String(value).trim();
    const dateOnlyMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T00:00(?::00(?:\.000)?)?(?:Z|[+-]\d{2}:\d{2})?$)/);

    if (dateOnlyMatch) {
      const [, year, month, day] = dateOnlyMatch.map(Number);
      const dateOnly = new Date(Date.UTC(year, month - 1, day));

      return dateOnly.toLocaleDateString('en-US', {
        timeZone: 'UTC',
        month: 'numeric',
        day: 'numeric',
        year: '2-digit'
      });
    }

    const date = new Date(raw);

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
      current.includes(quarterLabel) ? [] : [quarterLabel]
    ));
  }


  async function fetchGrossRevenueReport(selectedYear) {
    const res = await authedFetch(
      `${API}/reports/gross-revenue-totals?year=${encodeURIComponent(selectedYear)}`
    );

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.success) {
      throw new Error(data.error || data.message || 'Unable to load Gross Revenue Totals.');
    }

    return data;
  }

  async function loadGrossRevenueReport() {
    const selectedYear = Number(grossRevenueYear);

    setGrossRevenueLoading(true);
    setGrossRevenueError(null);
    setGrossRevenueReport(null);
    setGrossRevenueModalOpen(false);
    setSelectedGrossRevenueTruck(null);
    setSelectedGrossRevenueMonth(null);

    try {
      const data = await fetchGrossRevenueReport(selectedYear);

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
    setSelectedGrossRevenueMonth(null);
  }

  function closeGrossRevenueTruckModal() {
    setSelectedGrossRevenueTruck(null);
    setSelectedGrossRevenueMonth(null);
  }

  function closeGrossRevenueMonthModal() {
    setSelectedGrossRevenueMonth(null);
  }

  async function loadYearlyRevenueProjectionReport() {
    const selectedYear = Number(yearlyProjectionYear);

    setYearlyProjectionLoading(true);
    setYearlyProjectionError(null);
    setYearlyProjectionReport(null);
    setYearlyProjectionModalOpen(false);
    setYearlyProjectionCustomOpen(false);
    setYearlyProjectionCustomDriverCount('');
    setProjectionRevenueDrilldownLoadingTruck('');
    setProjectionRevenueDrilldownError('');

    try {
      const res = await authedFetch(
        `${API}/reports/yearly-revenue-projection?year=${encodeURIComponent(selectedYear)}`
      );

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || 'Unable to load Yearly Revenue Projection.');
      }

      setYearlyProjectionReport(data);
      setYearlyProjectionModalOpen(true);
    } catch (err) {
      setYearlyProjectionError({
        code: 'REPORT_ERROR',
        message: err.message || 'Unable to load Yearly Revenue Projection.'
      });
    } finally {
      setYearlyProjectionLoading(false);
    }
  }

  function closeYearlyRevenueProjectionModal() {
    setYearlyProjectionModalOpen(false);
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

  async function loadMonthlyOperationsSummaryReport() {
    const selectedMonth = Number(monthlyOpsMonth);
    const selectedYear = Number(monthlyOpsYear);
    const selectedReportLabel = `${getReportMonthName(selectedMonth)} ${selectedYear}`;

    setMonthlyOpsLoading(true);
    setMonthlyOpsError(null);
    setMonthlyOpsReport(null);
    setMonthlyOpsModalOpen(false);
    setSelectedMonthlyOpsDrilldown(null);

    try {
      const res = await authedFetch(
        `${API}/reports/monthly-operations-summary?month=${encodeURIComponent(selectedMonth)}&year=${encodeURIComponent(selectedYear)}`
      );

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        setMonthlyOpsError({
          code: data.error || 'REPORT_ERROR',
          message: data.message || data.error || 'Unable to load Monthly Operations Summary.',
          reportLabel: data.reportLabel || selectedReportLabel,
          unlockLabel: data.unlockLabel || '',
          lockReason: data.lockReason || ''
        });
        return;
      }

      setMonthlyOpsReport(data);
      setMonthlyOpsModalOpen(true);
    } catch (err) {
      setMonthlyOpsError({
        code: 'REPORT_ERROR',
        message: err.message || 'Unable to load Monthly Operations Summary.',
        reportLabel: selectedReportLabel
      });
    } finally {
      setMonthlyOpsLoading(false);
    }
  }

  function closeMonthlyOperationsSummaryModal() {
    setMonthlyOpsModalOpen(false);
    setSelectedMonthlyOpsDrilldown(null);
  }

  function closeMonthlyOperationsDrilldown() {
    setSelectedMonthlyOpsDrilldown(null);
  }


  function updateReportActionAlertCount(alertKey, count) {
    const cleanCount = Math.max(0, Number(count) || 0);

    setReportActionAlerts((current) => {
      const currentAlerts = current?.alerts || {};
      const ordersDueSettlement = {
        reportKey: 'ordersDueSettlement',
        reportLabel: 'Orders Due for Settlement',
        ...(currentAlerts.ordersDueSettlement || {})
      };
      const wonNotRegistered = {
        reportKey: 'wonNotRegistered',
        reportLabel: 'Orders Won and Not Registered',
        ...(currentAlerts.wonNotRegistered || {})
      };
      const permitGovernance = {
        reportKey: 'permitGovernance',
        reportLabel: 'Permit Governance',
        ...(currentAlerts.permitGovernance || {})
      };

      const alerts = { ordersDueSettlement, wonNotRegistered, permitGovernance };

      if (alerts[alertKey]) {
        alerts[alertKey] = {
          ...alerts[alertKey],
          count: cleanCount,
          hasAlert: cleanCount > 0
        };
      }

      const totalAlerts =
        (Number(alerts.ordersDueSettlement.count) || 0) +
        (Number(alerts.wonNotRegistered.count) || 0) +
        (Number(alerts.permitGovernance.count) || 0);

      return {
        ...(current || {}),
        success: true,
        reportType: 'reportActionAlerts',
        alerts,
        totalAlerts
      };
    });
  }

  async function loadReportActionAlerts(options = {}) {
    const silent = options.silent === true;

    if (!silent) {
      setReportActionAlertsLoading(true);
    } else if (!reportActionAlerts) {
      setReportActionAlertsLoading(true);
    }

    setReportActionAlertsError('');

    try {
      const res = await authedFetch(`${API}/reports/action-alerts`);
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || 'Unable to load report action alerts.');
      }

      setReportActionAlerts(data);
    } catch (err) {
      setReportActionAlertsError(err.message || 'Unable to load report action alerts.');
    } finally {
      setReportActionAlertsLoading(false);
    }
  }

  async function loadOrdersDueSettlementReport() {
    if (ordersDueSettlementActionBlocked) {
      setOrdersDueSettlementReport(null);
      setOrdersDueSettlementModalOpen(false);
      setOrdersDueSettlementError({
        code: 'NO_ACTION_ITEMS',
        message: getActionReportClearMessage('Orders Due for Settlement')
      });
      return;
    }

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

      updateReportActionAlertCount('ordersDueSettlement', data.count);

      if ((Number(data.count) || 0) <= 0) {
        setOrdersDueSettlementReport(null);
        setOrdersDueSettlementError({
          code: 'NO_ACTION_ITEMS',
          message: getActionReportClearMessage('Orders Due for Settlement')
        });
        return;
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

  function getDownloadFileNameFromResponse(res, fallbackName) {
    const disposition = res.headers.get('content-disposition') || '';
    const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);

    if (utf8Match?.[1]) {
      try {
        return decodeURIComponent(utf8Match[1].replace(/\"/g, ''));
      } catch {
        return utf8Match[1].replace(/\"/g, '');
      }
    }

    const filenameMatch = disposition.match(/filename=\"?([^\";]+)\"?/i);
    return filenameMatch?.[1] || fallbackName;
  }

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function getSafeFileNamePart(value, fallback = 'export') {
    const clean = String(value || '')
      .replace(/[^0-9A-Za-z]+/g, '_')
      .replace(/^_+|_+$/g, '');

    return clean || fallback;
  }

  function getPdfExportNotice(reportKey) {
    return pdfExportNotice?.reportKey === reportKey ? pdfExportNotice.message : '';
  }

  function clearPdfExportNotice(reportKey = '') {
    setPdfExportNotice((current) => {
      if (!current) return current;
      if (!reportKey || current.reportKey === reportKey) return null;
      return current;
    });
  }

  async function downloadReportPdf({ reportKey, reportName, endpoint, fallbackName, setLoading, setError }) {
    setLoading(true);
    setError('');
    clearPdfExportNotice(reportKey);

    try {
      const res = await authedFetch(endpoint);

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        let message = `Unable to export ${reportName} PDF.`;

        if (errorText) {
          try {
            const parsed = JSON.parse(errorText);
            message = parsed.error || parsed.message || message;
          } catch {
            message = errorText;
          }
        }

        throw new Error(message);
      }

      const blob = await res.blob();
      const fileName = getDownloadFileNameFromResponse(res, fallbackName);

      downloadBlob(blob, fileName);
      setPdfExportNotice({
        reportKey,
        message: `${reportName} PDF exported. Check your Downloads folder for ${fileName}.`
      });
    } catch (err) {
      setError(err.message || `Unable to export ${reportName} PDF.`);
    } finally {
      setLoading(false);
    }
  }

  async function downloadDriverSummaryPdf() {
    if (!reportMonth || !reportYear) {
      setDriverSummaryPdfError('Choose a month and year before exporting the Monthly Driver Summary PDF.');
      return;
    }

    await downloadReportPdf({
      reportKey: 'driverSummary',
      reportName: 'Monthly Driver Summary Report',
      endpoint: `${API}/reports/driver-summary/pdf?month=${encodeURIComponent(reportMonth)}&year=${encodeURIComponent(reportYear)}`,
      fallbackName: `Kole_Driver_Summary_${reportYear}_${String(reportMonth).padStart(2, '0')}.pdf`,
      setLoading: setDriverSummaryPdfLoading,
      setError: setDriverSummaryPdfError
    });
  }

  async function downloadMonthlyOperationsSummaryPdf() {
    if (!monthlyOpsMonth || !monthlyOpsYear) {
      setMonthlyOpsPdfError('Choose a month and year before exporting the Monthly Operations Summary PDF.');
      return;
    }

    await downloadReportPdf({
      reportKey: 'monthlyOperations',
      reportName: 'Monthly Operations Summary',
      endpoint: `${API}/reports/monthly-operations-summary/pdf?month=${encodeURIComponent(monthlyOpsMonth)}&year=${encodeURIComponent(monthlyOpsYear)}`,
      fallbackName: `Kole_Monthly_Operations_Summary_${monthlyOpsYear}_${String(monthlyOpsMonth).padStart(2, '0')}.pdf`,
      setLoading: setMonthlyOpsPdfLoading,
      setError: setMonthlyOpsPdfError
    });
  }

  async function downloadWeeklySettlementPdf() {
    if (!settlementCutoffDate) {
      setWeeklySettlementPdfError('Choose a cutoff date before exporting the Weekly Settlement Report PDF.');
      return;
    }

    await downloadReportPdf({
      reportKey: 'weeklySettlement',
      reportName: 'Weekly Settlement Report',
      endpoint: `${API}/reports/weekly-settlement/pdf?cutoffDate=${encodeURIComponent(settlementCutoffDate)}`,
      fallbackName: `Kole_Weekly_Settlement_${settlementCutoffDate}.pdf`,
      setLoading: setWeeklySettlementPdfLoading,
      setError: setWeeklySettlementPdfError
    });
  }

  async function downloadSalesActivityPdf() {
    await downloadReportPdf({
      reportKey: 'salesActivity',
      reportName: 'Sales Activity Snapshot',
      endpoint: `${API}/reports/sales-activity/pdf?days=${encodeURIComponent(salesActivityLookbackDays)}`,
      fallbackName: `Kole_Sales_Activity_${salesActivityLookbackDays}_days.pdf`,
      setLoading: setSalesActivityPdfLoading,
      setError: setSalesActivityPdfError
    });
  }

  async function downloadDriverTimeOffPdf() {
    if (!driverTimeOffYear) {
      setDriverTimeOffPdfError('Choose a year before exporting the Driver Time Off report PDF.');
      return;
    }

    const params = new URLSearchParams({ year: String(driverTimeOffYear) });
    if (driverTimeOffReportFilter?.type && driverTimeOffReportFilter?.key) {
      params.set('filterType', driverTimeOffReportFilter.type);
      params.set('filterKey', driverTimeOffReportFilter.key);
      params.set('filterLabel', driverTimeOffReportFilter.label || 'Filtered');
    }

    const filterSuffix = driverTimeOffReportFilter?.label
      ? `_${String(driverTimeOffReportFilter.label).replace(/[^0-9A-Za-z]+/g, '_').replace(/^_+|_+$/g, '')}`
      : '';

    await downloadReportPdf({
      reportKey: 'driverTimeOff',
      reportName: driverTimeOffReportFilter?.label
        ? `Driver Time Off Report (${driverTimeOffReportFilter.label})`
        : 'Driver Time Off Report',
      endpoint: `${API}/reports/driver-time-off/pdf?${params.toString()}`,
      fallbackName: `Kole_Driver_Time_Off_${driverTimeOffYear}${filterSuffix}.pdf`,
      setLoading: setDriverTimeOffPdfLoading,
      setError: setDriverTimeOffPdfError
    });
  }


  async function downloadActiveDriverRosterPdf() {
    await downloadReportPdf({
      reportKey: 'activeDriverRoster',
      reportName: 'Active Driver Roster',
      endpoint: `${API}/reports/active-driver-roster/pdf`,
      fallbackName: 'Kole_Active_Driver_Roster.pdf',
      setLoading: setActiveDriverRosterPdfLoading,
      setError: setActiveDriverRosterPdfError
    });
  }

  async function downloadInactiveDriverRosterPdf() {
    await downloadReportPdf({
      reportKey: 'inactiveDriverRoster',
      reportName: 'Inactive Driver Roster',
      endpoint: `${API}/reports/inactive-driver-roster/pdf`,
      fallbackName: 'Kole_Inactive_Driver_Roster.pdf',
      setLoading: setInactiveDriverRosterPdfLoading,
      setError: setInactiveDriverRosterPdfError
    });
  }

  function getFleetEquipmentStatusLabel(status = fleetEquipmentStatus) {
    if (status === 'inactive') return 'Inactive';
    if (status === 'all') return 'All';
    return 'Active';
  }

  async function downloadFleetEquipmentPdf() {
    const status = fleetEquipmentStatus || 'active';

    await downloadReportPdf({
      reportKey: 'fleetEquipment',
      reportName: `${getFleetEquipmentStatusLabel(status)} Fleet Equipment`,
      endpoint: `${API}/reports/fleet-equipment/pdf?status=${encodeURIComponent(status)}`,
      fallbackName: `Kole_Fleet_Equipment_${getFleetEquipmentStatusLabel(status)}.pdf`,
      setLoading: setFleetEquipmentPdfLoading,
      setError: setFleetEquipmentPdfError
    });
  }

  async function downloadSalesSuppressionPdf() {
    await downloadReportPdf({
      reportKey: 'salesSuppression',
      reportName: 'Follow-Up Suppression',
      endpoint: `${API}/reports/sales-leads/suppression/pdf`,
      fallbackName: 'Kole_Lead_Suppression_Report.pdf',
      setLoading: setSalesSuppressionPdfLoading,
      setError: setSalesSuppressionPdfError
    });
  }

  async function downloadOnThisDayPdf() {
    if (!onThisDayDate) {
      setOnThisDayPdfError('Choose a date before exporting On This Day.');
      return;
    }

    const params = new URLSearchParams({
      date: onThisDayDate,
      mode: onThisDayMode || 'exact'
    });

    await downloadReportPdf({
      reportKey: 'onThisDay',
      reportName: 'On This Day',
      endpoint: `${API}/reports/on-this-day/pdf?${params.toString()}`,
      fallbackName: `Kole_On_This_Day_${getSafeFileNamePart(onThisDayDate, 'date')}_${onThisDayMode === 'exact' ? 'Exact' : 'Across_Years'}.pdf`,
      setLoading: setOnThisDayPdfLoading,
      setError: setOnThisDayPdfError
    });
  }

  async function loadActiveDriverRosterReport() {
    setActiveDriverRosterLoading(true);
    setActiveDriverRosterError(null);
    setActiveDriverRosterPdfError('');
    setActiveDriverRosterReport(null);
    setActiveDriverRosterModalOpen(false);
    clearPdfExportNotice('activeDriverRoster');

    try {
      const res = await authedFetch(`${API}/reports/active-driver-roster`);
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || 'Unable to load Active Driver Roster.');
      }

      setActiveDriverRosterReport(data);
      setActiveDriverRosterModalOpen(true);
    } catch (err) {
      setActiveDriverRosterError({
        code: 'REPORT_ERROR',
        message: err.message || 'Unable to load Active Driver Roster.'
      });
    } finally {
      setActiveDriverRosterLoading(false);
    }
  }

  function closeActiveDriverRosterModal() {
    setActiveDriverRosterModalOpen(false);
  }

  async function loadFleetEquipmentReport() {
    setFleetEquipmentLoading(true);
    setFleetEquipmentError(null);
    setFleetEquipmentPdfError('');
    setFleetEquipmentReport(null);
    setFleetEquipmentModalOpen(false);
    clearPdfExportNotice('fleetEquipment');

    try {
      const res = await authedFetch(`${API}/reports/fleet-equipment?status=${encodeURIComponent(fleetEquipmentStatus)}`);
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || 'Unable to load Fleet Equipment report.');
      }

      setFleetEquipmentReport(data);
      setFleetEquipmentModalOpen(true);
    } catch (err) {
      setFleetEquipmentError({
        code: 'REPORT_ERROR',
        message: err.message || 'Unable to load Fleet Equipment report.'
      });
    } finally {
      setFleetEquipmentLoading(false);
    }
  }

  function closeFleetEquipmentModal() {
    setFleetEquipmentModalOpen(false);
  }

  async function loadWonNotRegisteredReport() {
    if (wonNotRegisteredActionBlocked) {
      setWonNotRegisteredReport(null);
      setWonNotRegisteredModalOpen(false);
      setWonNotRegisteredError({
        code: 'NO_ACTION_ITEMS',
        message: getActionReportClearMessage('Orders Won and Not Registered')
      });
      return;
    }

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

      updateReportActionAlertCount('wonNotRegistered', data.count);

      if ((Number(data.count) || 0) <= 0) {
        setWonNotRegisteredReport(null);
        setWonNotRegisteredError({
          code: 'NO_ACTION_ITEMS',
          message: getActionReportClearMessage('Orders Won and Not Registered')
        });
        return;
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

  async function loadPermitGovernanceReport() {
    setPermitGovernanceLoading(true);
    setPermitGovernanceError(null);
    setPermitGovernanceReport(null);
    setPermitGovernanceModalOpen(false);

    try {
      const res = await authedFetch(`${API}/reports/permit-governance`);
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || 'Unable to load Permit Governance report.');
      }

      updateReportActionAlertCount('permitGovernance', data.alertCount ?? data.counts?.ordersNeedingPermits ?? 0);
      setPermitGovernanceReport(data);
      setPermitGovernanceFilter(data.counts?.ordersNeedingPermits > 0 ? 'ordersNeedingPermits' : 'currentlyPermitted');
      setPermitGovernanceModalOpen(true);
    } catch (err) {
      setPermitGovernanceError({
        code: 'REPORT_ERROR',
        message: err.message || 'Unable to load Permit Governance report.'
      });
    } finally {
      setPermitGovernanceLoading(false);
    }
  }

  function closePermitGovernanceModal() {
    setPermitGovernanceModalOpen(false);
    setSelectedPermitHistoryLoad(null);
    setPermitHistoryOrderReturnLoad(null);
  }

  function closePermitHistoryDetailModal() {
    setSelectedPermitHistoryLoad(null);
  }

  async function openPermitReportFolder(row, event) {
    if (event) event.stopPropagation();

    if (row?.PermitFolderWebUrl) {
      await openExternalLink(row.PermitFolderWebUrl);
      return;
    }

    await openPermitFolder({
      BOL: row?.BOL || '',
      Driver: row?.OperatorTeam || row?.Operator || '',
      PermitsEscortFees: row?.PermitEstimate || 1
    });
  }

  async function loadInactiveDriverRosterReport() {
    setInactiveDriverRosterLoading(true);
    setInactiveDriverRosterError(null);
    setInactiveDriverRosterPdfError('');
    setInactiveDriverRosterReport(null);
    setInactiveDriverRosterModalOpen(false);
    clearPdfExportNotice('inactiveDriverRoster');

    try {
      const res = await authedFetch(`${API}/reports/inactive-driver-roster`);
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

  async function loadNoAvailabilityReport() {
    setNoAvailabilityLoading(true);
    setNoAvailabilityError(null);
    setNoAvailabilityPdfError('');
    setNoAvailabilityReport(null);
    setNoAvailabilityModalOpen(false);
    clearPdfExportNotice('noAvailabilityTop');

    try {
      const params = new URLSearchParams({ year: String(noAvailabilityYear || 'all') });
      const res = await authedFetch(`${API}/reports/no-availability?${params.toString()}`);
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || 'Unable to load No Availability report.');
      }

      setNoAvailabilityReport(data);
      setNoAvailabilityModalOpen(true);
    } catch (err) {
      setNoAvailabilityError({
        code: 'REPORT_ERROR',
        message: err.message || 'Unable to load No Availability report.'
      });
    } finally {
      setNoAvailabilityLoading(false);
    }
  }

  function closeNoAvailabilityModal() {
    setNoAvailabilityModalOpen(false);
  }

  async function downloadNoAvailabilityTopPdf() {
    setNoAvailabilityPdfError('');

    const scope = noAvailabilityYear === 'all'
      ? 'All_Years'
      : getSafeFileNamePart(noAvailabilityYear, 'Year');

    await downloadReportPdf({
      reportKey: 'noAvailabilityTop',
      reportName: 'No Availability Top Section',
      endpoint: `${API}/reports/no-availability/pdf?year=${encodeURIComponent(noAvailabilityYear || 'all')}`,
      fallbackName: `Kole_No_Availability_Top_${scope}.pdf`,
      setLoading: setNoAvailabilityPdfLoading,
      setError: setNoAvailabilityPdfError
    });
  }

  function getEmptyOnThisDaySummary() {
    return {
      pickups: 0,
      deliveries: 0,
      ordersWon: 0,
      uploads: 0,
      driversOff: 0,
      noAvailability: 0,
      availableTrucks: 0
    };
  }

  function getEmptyOnThisDayGroup(dateValue = onThisDayDate) {
    const targetDate = dateValue || getEasternDateInputValue();
    return {
      year: String(targetDate).slice(0, 4),
      date: targetDate,
      label: formatDateInputLabel(targetDate),
      summary: getEmptyOnThisDaySummary(),
      pickups: [],
      deliveries: [],
      ordersWon: [],
      uploads: [],
      driversOff: [],
      noAvailability: [],
      availableTrucks: []
    };
  }

  function getOnThisDaySummaryCount(sourceSummary = {}) {
    return Object.keys(getEmptyOnThisDaySummary()).reduce((sum, key) => (
      sum + Number(sourceSummary?.[key] || 0)
    ), 0);
  }

  function buildOnThisDayDisplayReport(sourceReport, requestedMode = 'exact') {
    if (!sourceReport) return null;

    const mode = requestedMode === 'across' ? 'across' : 'exact';

    if (mode === 'across') {
      return {
        ...sourceReport,
        mode: 'across',
        modeLabel: 'Comparison Years',
        count: getOnThisDaySummaryCount(sourceReport.summary || {})
      };
    }

    const targetDate = sourceReport.targetDate || onThisDayDate || getEasternDateInputValue();
    const targetYear = String(targetDate).slice(0, 4);
    const targetGroup = (sourceReport.yearGroups || []).find((group) => String(group.year || '') === targetYear) || getEmptyOnThisDayGroup(targetDate);
    const summary = targetGroup.summary || getEmptyOnThisDaySummary();

    return {
      ...sourceReport,
      reportLabel: `On This Day: ${formatDateInputLabel(targetDate)}`,
      targetLabel: formatDateInputLabel(targetDate),
      mode: 'exact',
      modeLabel: 'Selected Date',
      summary,
      count: getOnThisDaySummaryCount(summary),
      yearsReturned: targetGroup ? 1 : 0,
      yearGroups: [targetGroup]
    };
  }

  async function loadOnThisDayReport(modeOverride = '') {
    if (!onThisDayDate) {
      setOnThisDayError({
        code: 'REPORT_ERROR',
        message: 'Choose a date before previewing On This Day.'
      });
      return;
    }

    const requestedMode = 'exact';
    const normalizedMode = 'exact';
    const exactCacheKey = `${onThisDayDate}|exact`;
    const acrossCacheKey = `${onThisDayDate}|across`;
    const cachedSource = normalizedMode === 'exact'
      ? (
          getClientCacheRecord(onThisDayReportCacheRef.current, exactCacheKey, ON_THIS_DAY_CLIENT_CACHE_MS) ||
          getClientCacheRecord(onThisDayReportCacheRef.current, acrossCacheKey, ON_THIS_DAY_CLIENT_CACHE_MS)
        )
      : getClientCacheRecord(onThisDayReportCacheRef.current, acrossCacheKey, ON_THIS_DAY_CLIENT_CACHE_MS);

    setOnThisDayMode(normalizedMode);
    setOnThisDayError(null);
    setOnThisDayPdfError('');
    clearPdfExportNotice('onThisDay');

    if (cachedSource) {
      setOnThisDayReport(buildOnThisDayDisplayReport(cachedSource, normalizedMode));
      setOnThisDayModalOpen(true);
      return;
    }

    setOnThisDayLoading(true);
    setOnThisDayReport(null);
    setOnThisDayModalOpen(false);

    try {
      const params = new URLSearchParams({
        date: onThisDayDate,
        mode: normalizedMode
      });
      const res = await authedFetch(`${API}/reports/on-this-day?${params.toString()}`);
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || 'Unable to load On This Day.');
      }

      const reportSource = {
        ...data,
        mode: normalizedMode,
        modeLabel: normalizedMode === 'across' ? 'Comparison Years' : 'Selected Date'
      };

      setLimitedClientCacheRecord(
        onThisDayReportCacheRef.current,
        `${onThisDayDate}|${normalizedMode}`,
        reportSource,
        ON_THIS_DAY_CLIENT_CACHE_LIMIT
      );

      setOnThisDayReport(buildOnThisDayDisplayReport(reportSource, normalizedMode));
      setOnThisDayModalOpen(true);
    } catch (err) {
      setOnThisDayError({
        code: 'REPORT_ERROR',
        message: err.message || 'Unable to load On This Day.'
      });
    } finally {
      setOnThisDayLoading(false);
    }
  }

  function loadOnThisDayExactReport() {
    loadOnThisDayReport('exact');
  }

  function closeOnThisDayModal() {
    setOnThisDayModalOpen(false);
  }

  async function loadOperationalNotesReport() {
    setOperationalNotesLoading(true);
    setOperationalNotesError(null);
    setOperationalNotesOpenOrderError('');
    setOperationalNotesOpenOrderKey('');
    setOperationalNotesReport(null);
    setOperationalNotesModalOpen(false);
    setOperationalNotesTypeFilter('Dispatch');

    try {
      const res = await authedFetch(`${API}/reports/order-notes/recent?days=7`);
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || 'Unable to load recent order notes.');
      }

      setOperationalNotesReport(data);
      setOperationalNotesTypeFilter('Dispatch');
      setOperationalNotesModalOpen(true);
    } catch (err) {
      setOperationalNotesError({
        code: 'REPORT_ERROR',
        message: err.message || 'Unable to load recent order notes.'
      });
    } finally {
      setOperationalNotesLoading(false);
    }
  }

  function closeOperationalNotesModal() {
    setOperationalNotesModalOpen(false);
    setOperationalNotesOpenOrderError('');
    setOperationalNotesOpenOrderKey('');
  }

  function getOperationalNoteActionKey(note, index = '') {
    return String(note?.id || note?.KernelID || `${note?.BOLNumber || 'note'}-${note?.CreatedAtLocal || note?.CreatedDate || index}`);
  }

  function normalizeOperationalOrderLookup(value) {
    return String(value || '').trim().toLowerCase();
  }

  function normalizeOperationalBolLookup(value) {
    return normalizeOperationalOrderLookup(value).replace(/\s+/g, '').toUpperCase();
  }

  function findBestOperationalNoteOrderMatch(records = [], note = {}) {
    const targetBol = normalizeOperationalBolLookup(note.BOLNumber);
    const targetBidId = normalizeOperationalOrderLookup(note.BidID);

    if (targetBol && targetBidId) {
      const exactBoth = records.find((record) =>
        normalizeOperationalBolLookup(record.BOL) === targetBol &&
        normalizeOperationalOrderLookup(record.BidID) === targetBidId
      );
      if (exactBoth) return exactBoth;
    }

    if (targetBol) {
      const exactBol = records.find((record) => normalizeOperationalBolLookup(record.BOL) === targetBol);
      if (exactBol) return exactBol;
    }

    if (targetBidId) {
      const exactBid = records.find((record) => normalizeOperationalOrderLookup(record.BidID) === targetBidId);
      if (exactBid) return exactBid;
    }

    return records.length === 1 ? records[0] : null;
  }

  async function openOrderFromOperationalNote(note, index = '') {
    const actionKey = getOperationalNoteActionKey(note, index);
    const bol = String(note?.BOLNumber || '').trim();
    const bidId = String(note?.BidID || '').trim();
    const lookupValue = bol || bidId;

    if (!lookupValue) {
      setOperationalNotesOpenOrderError('This note does not have a BOL number or Bid ID to look up.');
      return;
    }

    setOperationalNotesOpenOrderKey(actionKey);
    setOperationalNotesOpenOrderError('');
    setLoadingDetail(true);

    try {
      const searchParams = new URLSearchParams({
        q: lookupValue,
        includeArchives: 'true'
      });
      const searchRes = await authedFetch(`${API}/search?${searchParams.toString()}`);
      const searchData = await searchRes.json().catch(() => ({}));

      if (!searchRes.ok || !searchData.success) {
        throw new Error(searchData.error || searchData.message || 'Unable to search for the order tied to this note.');
      }

      const match = findBestOperationalNoteOrderMatch(searchData.results || [], note);

      if (!match?.id) {
        throw new Error(`No matching order was found for ${bol || bidId}.`);
      }

      setOrderReturnTrailLabel('Operational Notes');
      setSelectedView('basic');
      setOrderNotesData(null);
      setOrderNotesLoading(false);
      setOrderNotesError('');
      setOrderNotesTypeFilter('All');
      resetOrderNoteComposer();
      orderNotesRequestRef.current += 1;
      setDocumentError('');

      const detailEndpoint = match.SourceListId
        ? `${API}/record/${encodeURIComponent(match.SourceListId)}/${encodeURIComponent(match.id)}`
        : `${API}/record/${encodeURIComponent(match.id)}`;
      const detailRes = await authedFetch(detailEndpoint);
      const detailData = await detailRes.json().catch(() => ({}));

      if (!detailRes.ok || !detailData.success) {
        throw new Error(detailData.error || detailData.message || 'Unable to open the matching order.');
      }

      setSelected(detailData);
    } catch (err) {
      setOperationalNotesOpenOrderError(err.message || 'Unable to open the order for this note.');
    } finally {
      setLoadingDetail(false);
      setOperationalNotesOpenOrderKey('');
    }
  }

  function getDriverTimeOffOptions() {
    return driverTimeOffReport?.activeDriverOptions || operationsData?.driverTimeOff?.activeDriverOptions || [];
  }

  function getDriverTimeOffCurrentRecords() {
    return operationsData?.driverTimeOff?.records || [];
  }

  function getDriverTimeOffRecentlyEndedRecords() {
    return operationsData?.driverTimeOff?.recentlyEndedRecords || [];
  }

  function getDriverTimeOffUpcomingRecords() {
    return operationsData?.driverTimeOff?.upcomingRecords || [];
  }

  function getDriverTimeOffPanelRows(panelFilter = 'current') {
    const currentRows = getDriverTimeOffCurrentRecords().map((record) => ({
      ...record,
      displayBucket: 'current'
    }));

    const currentKeys = new Set(currentRows.map((record) => record.id || `${record.operatorName}-${record.truckNumber}-${record.startDate}-${record.endDate}`));

    if (panelFilter === 'ended') {
      return getDriverTimeOffRecentlyEndedRecords()
        .filter((record) => {
          const key = record.id || `${record.operatorName}-${record.truckNumber}-${record.startDate}-${record.endDate}`;
          return !currentKeys.has(key);
        })
        .map((record) => ({
          ...record,
          displayBucket: 'recently-ended'
        }));
    }

    if (panelFilter === 'starting-soon') {
      return getDriverTimeOffUpcomingRecords().map((record) => ({
        ...record,
        displayBucket: 'starting-soon'
      }));
    }

    return currentRows;
  }

  function getDriverTimeOffEndedLabel(record = {}) {
    if (record.displayBucket !== 'recently-ended') return 'Current';

    const daysAgo = Number(record.daysSinceEnded);
    if (daysAgo === 0) return 'Ended today';
    if (daysAgo === 1) return 'Ended yesterday';
    if (Number.isFinite(daysAgo) && daysAgo > 1) return `Ended ${daysAgo} days ago`;

    return 'Recently ended';
  }

  function getDriverTimeOffStartsLabel(record = {}) {
    const daysUntilStart = Number(record.daysUntilStart);
    if (daysUntilStart === 0) return 'starts today';
    if (daysUntilStart === 1) return 'starts tomorrow';
    if (Number.isFinite(daysUntilStart) && daysUntilStart > 1) return `starts in ${daysUntilStart} days`;
    return 'starts soon';
  }

  function getDriverTimeOffHistoryRows(record = null) {
    if (!record) return [];

    const normalizeHistoryKey = (value) => String(value || '')
      .trim()
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const driverKey = normalizeHistoryKey(record.operatorName);
    const truckKey = normalizeHistoryKey(record.truckNumber);
    const seen = new Set();

    return [
      ...(driverTimeOffReport?.rows || []),
      ...(operationsData?.driverTimeOff?.records || [])
    ]
      .filter((row) => {
        const rowDriverKey = normalizeHistoryKey(row.operatorName);
        const rowTruckKey = normalizeHistoryKey(row.truckNumber);

        return Boolean(
          (driverKey && rowDriverKey === driverKey) ||
          (truckKey && rowTruckKey === truckKey)
        );
      })
      .filter((row) => {
        const uniqueKey = row.id || `${row.operatorName}-${row.truckNumber}-${row.startDate}-${row.endDate}-${row.reason}`;
        if (seen.has(uniqueKey)) return false;
        seen.add(uniqueKey);
        return true;
      })
      .sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')));
  }


  function getDriverTimeOffFilterRowKey(row = {}, type = '') {
    if (type === 'driver') {
      return `${row.operatorName || 'Unknown'}|${row.truckNumber || ''}`;
    }

    if (type === 'month') {
      const date = String(row.reportStartDate || row.startDate || '').slice(0, 7);
      return date || 'Unknown';
    }

    if (type === 'reason') {
      return row.reason || 'Unspecified';
    }

    return '';
  }

  function setDriverTimeOffFilter(type, item = {}) {
    if (!type || !item?.key) return;

    setDriverTimeOffReportFilter({
      type,
      key: String(item.key),
      label: item.label || String(item.key)
    });
    setDriverTimeOffPdfError('');
    clearPdfExportNotice('driverTimeOff');
  }

  function clearDriverTimeOffFilter() {
    setDriverTimeOffReportFilter(null);
    setDriverTimeOffPdfError('');
    clearPdfExportNotice('driverTimeOff');
  }

  function getDriverTimeOffFilteredRows(rows = []) {
    if (!driverTimeOffReportFilter?.type || !driverTimeOffReportFilter?.key) return rows;

    return rows.filter((row) =>
      getDriverTimeOffFilterRowKey(row, driverTimeOffReportFilter.type) === driverTimeOffReportFilter.key
    );
  }

  function getDriverTimeOffMonthLabel(monthKey) {
    if (!/^\d{4}-\d{2}$/.test(String(monthKey || ''))) return 'Unknown';

    const [year, month] = String(monthKey).split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', {
      timeZone: 'UTC',
      month: 'short',
      year: 'numeric'
    });
  }

  function summarizeDriverTimeOffRows(rows = [], type = '') {
    const map = new Map();

    rows.forEach((row) => {
      const key = getDriverTimeOffFilterRowKey(row, type) || 'Unknown';
      const label = type === 'month'
        ? getDriverTimeOffMonthLabel(key)
        : (type === 'driver'
          ? (() => {
              const [name, truck] = String(key).split('|');
              return truck ? `${name} · Truck ${truck}` : name || 'Unknown';
            })()
          : key);
      const current = map.get(key) || { key, label, events: 0, days: 0 };

      current.events += 1;
      current.days += Number(row.reportDays || row.days || 0);
      map.set(key, current);
    });

    return Array.from(map.values()).sort((a, b) => {
      if (type === 'month') return String(a.key).localeCompare(String(b.key));
      return (b.days - a.days) || (b.events - a.events) || String(a.label).localeCompare(String(b.label));
    });
  }

  function buildDriverTimeOffDisplayReport(rows = []) {
    const totalDays = rows.reduce((sum, row) => sum + Number(row.reportDays || row.days || 0), 0);
    const uniqueDrivers = new Set(rows.map((row) => getDriverTimeOffFilterRowKey(row, 'driver')).filter(Boolean));
    const longestEvent = [...rows].sort((a, b) => Number(b.reportDays || b.days || 0) - Number(a.reportDays || a.days || 0))[0] || null;

    return {
      summary: {
        totalEvents: rows.length,
        totalDays,
        uniqueDrivers: uniqueDrivers.size,
        currentDriversOff: rows.filter((row) => row.isCurrent || row.timingStatus === 'Current').length,
        averageDaysPerEvent: rows.length ? Math.round((totalDays / rows.length) * 10) / 10 : 0,
        longestEventDays: longestEvent ? Number(longestEvent.reportDays || longestEvent.days || 0) : 0,
        longestEventDriver: longestEvent?.operatorName || ''
      },
      analytics: {
        byDriver: summarizeDriverTimeOffRows(rows, 'driver'),
        byMonth: summarizeDriverTimeOffRows(rows, 'month'),
        byReason: summarizeDriverTimeOffRows(rows, 'reason')
      }
    };
  }

  function focusDriverTimeOffRecord(record = null) {
    if (!record) return;
    setDriverTimeOffEditingRecord(record);
    setDriverTimeOffDraft(getDriverTimeOffDefaultDraft(record));
    setDriverTimeOffActionError('');
    setDriverTimeOffActionMessage('');
  }

  function getDriverTimeOffDefaultDraft(record = null) {
    if (record) {
      return {
        rosterDriverKey: '',
        recordNumber: record.recordNumber || '',
        operatorName: record.operatorName || '',
        truckNumber: record.truckNumber || '',
        startDate: record.startDate || getEasternDateInputValue(),
        endDate: record.endDate || record.startDate || getEasternDateInputValue(),
        reason: normalizeDriverTimeOffReason(record.reason),
        status: record.status || 'Active'
      };
    }

    const today = getEasternDateInputValue();
    return {
      rosterDriverKey: '',
      operatorName: '',
      truckNumber: '',
      startDate: today,
      endDate: today,
      reason: 'Home Time',
      status: 'Active'
    };
  }

  function openDriverTimeOffForm(record = null) {
    setDriverTimeOffEditingRecord(record);
    setDriverTimeOffDraft(getDriverTimeOffDefaultDraft(record));
    setDriverTimeOffActionMessage('');
    setDriverTimeOffActionError('');
    setDriverTimeOffFormOpen(true);
  }

  function closeDriverTimeOffForm() {
    if (driverTimeOffSubmitting) return;
    setDriverTimeOffFormOpen(false);
    setDriverTimeOffEditingRecord(null);
    setDriverTimeOffActionError('');
  }

  function updateDriverTimeOffDraft(field, value) {
    setDriverTimeOffDraft((current) => ({
      ...current,
      [field]: value
    }));
  }

  function selectDriverTimeOffRosterDriver(rosterDriverKey) {
    const option = getDriverTimeOffOptions().find((entry) => entry.key === rosterDriverKey);
    setDriverTimeOffDraft((current) => ({
      ...current,
      rosterDriverKey,
      operatorName: option?.driverName || current.operatorName,
      truckNumber: option?.unitNo || current.truckNumber
    }));
  }

  async function loadDriverTimeOffReport(options = {}) {
    setDriverTimeOffLoading(true);
    setDriverTimeOffError(null);
    setDriverTimeOffReport(null);
    setDriverTimeOffReportFilter(null);
    setDriverTimeOffPdfError('');
    clearPdfExportNotice('driverTimeOff');
    setDriverTimeOffModalOpen(false);

    try {
      const reportYearToLoad = Number(options.yearOverride || driverTimeOffYear || new Date().getFullYear());
      const params = new URLSearchParams({ year: String(reportYearToLoad) });
      const res = await authedFetch(`${API}/reports/driver-time-off?${params.toString()}`);
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || 'Unable to load Driver Time Off report.');
      }

      setDriverTimeOffReport(data);
      setDriverTimeOffModalOpen(true);
    } catch (err) {
      setDriverTimeOffError({
        code: 'REPORT_ERROR',
        message: err.message || 'Unable to load Driver Time Off report.'
      });
    } finally {
      setDriverTimeOffLoading(false);
    }
  }

  function closeDriverTimeOffModal() {
    setDriverTimeOffModalOpen(false);
  }

  async function openFutureTimeOffQuickReport() {
    const currentYear = String(new Date().getFullYear());
    setDriverTimeOffYear(Number(currentYear));
    await loadDriverTimeOffReport({ yearOverride: currentYear });
  }

  async function submitDriverTimeOff(event) {
    event.preventDefault();
    setDriverTimeOffSubmitting(true);
    setDriverTimeOffActionError('');
    setDriverTimeOffActionMessage('');

    try {
      const isEditing = Boolean(driverTimeOffEditingRecord?.id);
      const url = isEditing
        ? `${API}/driver-time-off/${encodeURIComponent(driverTimeOffEditingRecord.id)}`
        : `${API}/driver-time-off`;
      const res = await authedFetch(url, {
        method: isEditing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...driverTimeOffDraft,
          reason: normalizeDriverTimeOffReason(driverTimeOffDraft.reason)
        })
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || 'Unable to save Driver Time Off.');
      }

      setDriverTimeOffActionMessage(data.message || (isEditing ? 'Driver time off updated.' : 'Driver time off added.'));
      setDriverTimeOffFormOpen(false);
      setDriverTimeOffEditingRecord(null);
      await loadOperationsDashboard({ silent: true, forceRefresh: true });
      if (driverTimeOffReport) {
        await loadDriverTimeOffReport();
      }
    } catch (err) {
      setDriverTimeOffActionError(err.message || 'Unable to save Driver Time Off.');
    } finally {
      setDriverTimeOffSubmitting(false);
    }
  }


  const customerSalesLeadViewOptions = [
    { value: 'all', label: 'Total Customers', summaryKey: 'total', defaultSort: 'name' },
    { value: 'converted', label: 'Converted', summaryKey: 'converted', defaultSort: 'wins' },
    { value: 'unconverted', label: 'Unconverted', summaryKey: 'unconverted', defaultSort: 'quotes' },
    { value: 'followUpDue', label: 'Follow-up Due', summaryKey: 'followUpDue', defaultSort: 'followUp' },
    { value: 'aviation', label: 'Aviation', summaryKey: 'aviation', defaultSort: 'quotes' }
  ];

  const leadSuppressionViewOptions = [
    { value: 'suppressed', label: 'Suppressed / Ignored', summaryKey: 'suppressed', defaultSort: 'name' },
    { value: 'suppressionCandidates', label: 'Can Suppress', summaryKey: 'suppressionCandidates', defaultSort: 'lastQuote' }
  ];

  const salesLeadViewOptions = [
    ...customerSalesLeadViewOptions,
    ...leadSuppressionViewOptions
  ];

  const reportPanelsByGroup = {
    financial: ['grossRevenue', 'yearlyProjection', 'driverSummary', 'weeklySettlement'],
    operational: ['monthlyOperations', 'ordersDueSettlement', 'wonNotRegistered', 'permitGovernance', 'onThisDay', 'operationalNotes', 'noAvailability'],
    driverFleet: ['activeDriverRoster', 'inactiveDriverRoster', 'fleetEquipment', 'driverTimeOff'],
    sales: ['customerBookingTrends', 'salesActivity', 'leadSuppression', 'salesLeads']
  };

  function closeReportSubsections() {
    setOpenReportGroups([]);

    if (!reportPanelsByGroup.sales.includes(activeReportPanel)) {
      setActiveReportPanel('');
    }

    setOpenGrossRevenueQuarters([]);
  }

  function closeSalesAndLeadsSubsections() {
    if (reportPanelsByGroup.sales.includes(activeReportPanel)) {
      setActiveReportPanel('');
    }
  }

  function toggleReportsSection() {
    const willOpen = !reportsSectionOpen;

    if (willOpen) {
      closeMainFeatureSections('reports');
    } else {
      closeReportSubsections();
    }

    setReportsSectionOpen(willOpen);
  }

  function toggleSalesAndLeadsSection() {
    const willOpen = !salesAndLeadsSectionOpen;

    if (willOpen) {
      closeMainFeatureSections('salesAndLeads');
    } else {
      closeSalesAndLeadsSubsections();
    }

    setSalesAndLeadsSectionOpen(willOpen);
  }

  function toggleReportGroup(groupName) {
    const isClosingGroup = openReportGroups.includes(groupName);

    if (isClosingGroup) {
      if ((reportPanelsByGroup[groupName] || []).includes(activeReportPanel)) {
        setActiveReportPanel('');
      }

      if (groupName === 'financial') {
        setOpenGrossRevenueQuarters([]);
      }

      setOpenReportGroups([]);
      return;
    }

    if (!(reportPanelsByGroup[groupName] || []).includes(activeReportPanel)) {
      setActiveReportPanel('');
    }

    if (groupName !== 'financial') {
      setOpenGrossRevenueQuarters([]);
    }

    setOpenReportGroups([groupName]);
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

  function isCustomerSalesLeadView(view) {
    return customerSalesLeadViewOptions.some((option) => option.value === view);
  }

  function isLeadSuppressionView(view) {
    return leadSuppressionViewOptions.some((option) => option.value === view);
  }

  function primeSalesLeadsFollowUpDueView() {
    const followUpView = 'followUpDue';

    setSalesLeadsView(followUpView);
    setSalesLeadsSort(getDefaultSalesLeadSort(followUpView));
    setSelectedSalesLead(null);
    setSalesLeadsError(null);
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

  function formatTrendChange(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return 'N/A';

    const number = Number(value);
    const prefix = number > 0 ? '+' : '';

    return `${prefix}${(number * 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
  }

  function getTrendChangeClass(value) {
    const number = Number(value);
    if (Number.isNaN(number)) return 'neutral';
    if (number > 0) return 'positive';
    if (number < 0) return 'negative';
    return 'neutral';
  }

  function getCustomerTrendBucketLabel(bucket) {
    switch (bucket) {
      case 'growing':
        return 'Growing';
      case 'declining':
        return 'Declining';
      case 'dormant':
        return 'Dormant';
      case 'newReturning':
        return 'New / Returning';
      case 'steady':
        return 'Steady';
      case 'inactive':
        return 'Inactive';
      default:
        return 'All';
    }
  }

  function filterCustomerTrendRows(rows, bucket = 'all') {
    if (bucket === 'all') return rows;
    return rows.filter((row) => row.bucket === bucket);
  }

  function sortCustomerTrendRows(rows, sortMode = 'revenue') {
    const sorted = [...rows];

    sorted.sort((a, b) => {
      if (sortMode === 'customer') {
        return String(a.customer || '').localeCompare(String(b.customer || ''));
      }

      if (sortMode === 'jobs') {
        const diff = Number(b.currentJobs || 0) - Number(a.currentJobs || 0);
        if (diff !== 0) return diff;
      }

      if (sortMode === 'rate') {
        const diff = Number(b.currentRatePerLoadedMile || 0) - Number(a.currentRatePerLoadedMile || 0);
        if (diff !== 0) return diff;
      }

      if (sortMode === 'share') {
        const diff = Number(b.revenueShare || 0) - Number(a.revenueShare || 0);
        if (diff !== 0) return diff;
      }

      if (sortMode === 'yoy') {
        const aValue = a.yoyRevenueChange === null || a.yoyRevenueChange === undefined ? -999 : Number(a.yoyRevenueChange);
        const bValue = b.yoyRevenueChange === null || b.yoyRevenueChange === undefined ? -999 : Number(b.yoyRevenueChange);
        const diff = bValue - aValue;
        if (diff !== 0) return diff;
      }

      const revenueDiff = Number(b.currentRevenue || 0) - Number(a.currentRevenue || 0);
      if (revenueDiff !== 0) return revenueDiff;

      return String(a.customer || '').localeCompare(String(b.customer || ''));
    });

    return sorted;
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

  function isSalesLeadSuppressedByHandling(lead = {}) {
    return normalizeSalesLeadText(lead.FollowUpHandling) === 'suppressed';
  }

  function isSalesLeadStatusSuppressionLocked(lead = {}) {
    const status = normalizeSalesLeadText(lead.Status);
    return status === 'ignore' || status === 'inactive';
  }

  function isSalesLeadSuppressionReportRow(lead = {}) {
    return isSalesLeadSuppressedByHandling(lead) || isSalesLeadStatusSuppressionLocked(lead);
  }

  function canSuppressSalesLead(lead = {}) {
    return Boolean(lead.id) && !isSalesLeadSuppressionReportRow(lead);
  }

  function canUnsuppressSalesLead(lead = {}) {
    return Boolean(lead.id) && isSalesLeadSuppressedByHandling(lead);
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
      return records.filter(isSalesLeadSuppressionReportRow);
    }

    if (normalized === 'suppressioncandidates' || normalized === 'suppression candidates') {
      return records.filter((record) => !isSalesLeadSuppressionReportRow(record));
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

  async function prewarmSalesLeadsReport() {
    if (!isAuthenticated || salesLeadsReport) return;

    try {
      const params = new URLSearchParams({
        view: 'all',
        sort: 'name',
        prewarm: '1'
      });

      const res = await authedFetch(`${API}/reports/sales-leads?${params.toString()}`);
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || 'Unable to prewarm Sales Leads.');
      }

      setSalesLeadsReport((current) => current || {
        ...data,
        view: 'all',
        sort: 'name',
        prewarmed: true
      });
    } catch (err) {
      // This is intentionally quiet. Customer cards can still load on demand.
      console.warn('Sales Leads background prewarm failed.', err);
      salesLeadsPrewarmStartedRef.current = false;
    }
  }

  async function loadSalesLeadsReport(options = {}) {
    const forceRefresh = options?.forceRefresh === true;

    setSalesLeadsLoading(true);
    setSalesLeadsError(null);

    try {
      // Heavy Graph poll happens here only. Filters/sorts are local after this returns.
      const params = new URLSearchParams({ view: 'all', sort: 'name' });
      if (forceRefresh) params.set('forceRefresh', '1');
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

  async function loadCustomerBookingTrendsReport() {
    const selectedMonth = Number(customerTrendMonth);
    const selectedYear = Number(customerTrendYear);
    const selectedReportLabel = `${getReportMonthName(selectedMonth)} ${selectedYear}`;

    setCustomerTrendLoading(true);
    setCustomerTrendError(null);
    setCustomerTrendReport(null);
    setCustomerTrendModalOpen(false);
    setSelectedCustomerTrend(null);

    try {
      const res = await authedFetch(
        `${API}/reports/customer-booking-trends?month=${encodeURIComponent(selectedMonth)}&year=${encodeURIComponent(selectedYear)}`
      );

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        setCustomerTrendError({
          code: data.error || 'REPORT_ERROR',
          message: data.message || data.error || 'Unable to load Customer Booking Trends.',
          reportLabel: data.reportLabel || selectedReportLabel,
          unlockLabel: data.unlockLabel || '',
          lockReason: data.lockReason || ''
        });
        return;
      }

      setCustomerTrendReport(data);
      setCustomerTrendBucket('all');
      setCustomerTrendSort('revenue');
      setCustomerTrendModalOpen(true);
    } catch (err) {
      setCustomerTrendError({
        code: 'REPORT_ERROR',
        message: err.message || 'Unable to load Customer Booking Trends.',
        reportLabel: selectedReportLabel
      });
    } finally {
      setCustomerTrendLoading(false);
    }
  }

  function closeCustomerTrendModal() {
    setCustomerTrendModalOpen(false);
    setSelectedCustomerTrend(null);
  }

  function closeCustomerTrendDetailModal() {
    setSelectedCustomerTrend(null);
  }

  async function openCustomerCardFromTrend(row) {
    const customerName = String(row?.customer || '').trim();

    if (!customerName) return;

    setSelectedCustomerTrend(null);
    await openCustomerCardForName(customerName, '', { returnToOrder: false });
  }

  function normalizeCustomerLookupKey(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function findLocalSalesLeadMatch(customerName, customerCode = '') {
    const records = salesLeadsReport?.records || [];
    const customerKey = normalizeCustomerLookupKey(customerName);
    const codeKey = normalizeSalesLeadText(customerCode);

    if ((!customerKey && !codeKey) || records.length === 0) return null;

    const matches = records
      .map((record) => {
        const recordName = normalizeCustomerLookupKey(record.CompanyName);
        const recordNormalizedName = normalizeCustomerLookupKey(record.NormalizedName);
        const recordCode = normalizeSalesLeadText(record.CustomerCode);
        let score = 0;

        if (codeKey && recordCode === codeKey) score += 1000;
        if (customerKey && recordNormalizedName === customerKey) score += 850;
        if (customerKey && recordName === customerKey) score += 800;
        if (customerKey && recordNormalizedName.startsWith(customerKey)) score += 550;
        if (customerKey && recordName.includes(customerKey)) score += 350;
        if (customerKey && customerKey.includes(recordNormalizedName) && recordNormalizedName) score += 250;

        return { record, score };
      })
      .filter((match) => match.score > 0)
      .sort((a, b) => b.score - a.score || String(a.record.CompanyName || '').localeCompare(String(b.record.CompanyName || '')));

    return matches[0]?.record || null;
  }

  async function openCustomerCardForName(customerName, customerCode = '', options = {}) {
    const cleanName = String(customerName || '').trim();
    const cleanCode = String(customerCode || '').trim();
    const returnSnapshot = options.returnToOrder === false
      ? null
      : options.returnSnapshot || (selected ? getCurrentOrderDrilldownSnapshot(selected, selectedView) : null);

    if (!cleanName && !cleanCode) {
      setCustomerLookupError('This order does not have a customer name or customer code to match.');
      return;
    }

    const localMatch = findLocalSalesLeadMatch(cleanName, cleanCode);
    if (localMatch) {
      if (returnSnapshot) {
        parkOrderDrilldownSnapshot(returnSnapshot);
      }
      openSalesLeadCard(localMatch);
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

      if (returnSnapshot) {
        parkOrderDrilldownSnapshot(returnSnapshot);
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

  function mergeUpdatedSalesLead(updatedLead, nextSummary = null, nextGeneratedAt = '') {
    if (!updatedLead?.id) return;

    setSalesLeadsReport((current) => {
      if (!current?.records) return current;

      const nextRecords = current.records.map((record) => (
        String(record.id) === String(updatedLead.id)
          ? {
              ...record,
              ...updatedLead,
              SalesNotes: updatedLead.SalesNotes || record.SalesNotes,
              SalesNotesCount: updatedLead.SalesNotesCount ?? record.SalesNotesCount,
              RevenueWon: updatedLead.RevenueWon ?? record.RevenueWon,
              YearDetails: updatedLead.YearDetails || record.YearDetails
            }
          : record
      ));

      return {
        ...current,
        generatedAt: nextGeneratedAt || current.generatedAt,
        summary: nextSummary || current.summary,
        records: nextRecords
      };
    });

    setSelectedSalesLead((current) => {
      if (!current || String(current.id) !== String(updatedLead.id)) return current;

      return {
        ...current,
        ...updatedLead,
        SalesNotes: updatedLead.SalesNotes || current.SalesNotes,
        SalesNotesCount: updatedLead.SalesNotesCount ?? current.SalesNotesCount,
        RevenueWon: updatedLead.RevenueWon ?? current.RevenueWon,
        YearDetails: updatedLead.YearDetails || current.YearDetails
      };
    });
  }

  async function updateSelectedSalesLeadSuppression(action) {
    if (!selectedSalesLead?.id) {
      setSalesLeadSuppressionError('This customer card does not have a Sales Leads item id, so suppression cannot be changed here.');
      return;
    }

    const normalizedAction = normalizeSalesLeadText(action);
    const isSuppressing = normalizedAction === 'suppress';
    const reason = salesLeadSuppressionReason.trim();

    if (isSuppressing && !reason) {
      setSalesLeadSuppressionError('Add a suppression reason before suppressing the lead.');
      return;
    }

    setSalesLeadSuppressionSaving(true);
    setSalesLeadSuppressionError('');
    setSalesLeadSuppressionMessage('');

    try {
      const res = await authedFetch(`${API}/sales-leads/${encodeURIComponent(selectedSalesLead.id)}/suppression`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: isSuppressing ? 'suppress' : 'unsuppress',
          reason
        })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || 'Unable to update follow-up suppression.');
      }

      if (data.record) {
        mergeUpdatedSalesLead(data.record, data.summary || null, data.generatedAt || '');
      } else {
        await loadSalesLeadsReport({ forceRefresh: true });
      }

      setSalesLeadSuppressionReason('');
      setSalesLeadSuppressionMessage(data.message || (isSuppressing ? 'Follow-up suppressed.' : 'Follow-up unsuppressed.'));
    } catch (err) {
      setSalesLeadSuppressionError(err.message || 'Unable to update follow-up lead suppression.');
    } finally {
      setSalesLeadSuppressionSaving(false);
    }
  }

  function openSalesLeadCard(lead) {
    setSelectedSalesLead(lead);
    setCustomerLookupError('');
    setSalesNoteDraft('');
    setSalesNoteMessage('');
    setSalesNoteError('');
    setSalesLeadSuppressionReason('');
    setSalesLeadSuppressionMessage('');
    setSalesLeadSuppressionError('');
  }

  function closeSalesLeadModal() {
    setSelectedSalesLead(null);
    setSalesNoteDraft('');
    setSalesNoteMessage('');
    setSalesNoteError('');
    setSalesLeadSuppressionReason('');
    setSalesLeadSuppressionMessage('');
    setSalesLeadSuppressionError('');
    setOrderDrilldownReturn(null);
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

  function getDriverRosterModalTitle(status) {
    const normalizedStatus = String(status || '').trim();
    if (!normalizedStatus) return 'Driver Roster';
    return `${normalizedStatus} Driver Roster`;
  }

  function buildDriverRosterModalPayload(roster, options = {}) {
    if (!roster) return null;

    const displayName = roster.tmsName || roster.operatorTeamName || options.driverName || 'Driver';
    const truck = roster.truck || options.truck || '-';
    const statusLabel = roster.status || options.statusLabel || 'Driver Roster';

    return {
      id: roster.id || '',
      equipmentId: truck,
      driverName: displayName,
      currentCityState: options.currentCityState || statusLabel,
      positionTimeUtc: options.positionTimeUtc || '',
      speed: Number(options.speed || 0),
      isMoving: Boolean(options.isMoving),
      isStale: Boolean(options.isStale),
      hasRosterDetails: true,
      rosterModalTitle: options.rosterModalTitle || 'Driver Roster',
      rosterModalSubtitle: options.rosterModalSubtitle || `${displayName} · Truck ${truck}`,
      roster
    };
  }

  function findLocalDriverRosterMatch(truck) {
    const truckKey = normalizeDriverHistoryTruckKey(truck);
    if (!truckKey) return null;

    const positions = driverPositionsData?.positions || [];
    const positionMatch = positions.find((position) => (
      normalizeDriverHistoryTruckKey(position.equipmentId || position.roster?.truck) === truckKey
    ));

    if (positionMatch?.hasRosterDetails && positionMatch.roster) {
      return positionMatch;
    }

    const reportRows = [
      ...(activeDriverRosterReport?.rows || []),
      ...(inactiveDriverRosterReport?.rows || []),
      ...(fleetEquipmentReport?.rows || [])
    ];

    const rosterMatch = reportRows.find((row) => normalizeDriverHistoryTruckKey(row.truck) === truckKey);
    if (!rosterMatch) return null;

    return buildDriverRosterModalPayload(rosterMatch, {
      truck: rosterMatch.truck,
      statusLabel: rosterMatch.status || 'Driver Roster',
      rosterModalTitle: getDriverRosterModalTitle(rosterMatch.status),
      rosterModalSubtitle: `${rosterMatch.tmsName || rosterMatch.operatorTeamName || 'Driver'} · Truck ${rosterMatch.truck || '-'}`
    });
  }

  async function openDriverRosterFromOrder(record = selected) {
    const truck = String(record?.Truck || record?.truck || '').trim();
    const returnSnapshot = selected ? getCurrentOrderDrilldownSnapshot(selected, selectedView) : null;

    if (!truck) {
      setDriverLookupError('This order does not have a truck number to match.');
      return;
    }

    const localMatch = findLocalDriverRosterMatch(truck);
    if (localMatch) {
      setDriverLookupError('');
      if (returnSnapshot) {
        parkOrderDrilldownSnapshot(returnSnapshot);
      }
      setSelectedDriverRoster(localMatch);
      return;
    }

    setDriverLookupLoading(true);
    setDriverLookupError('');

    try {
      const res = await authedFetch(`${API}/driver-roster/lookup?truck=${encodeURIComponent(truck)}`);
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || 'Unable to find a Driver Roster match.');
      }

      if (!data.roster) {
        throw new Error(`No Driver Roster record matched truck ${truck}.`);
      }

      const payload = buildDriverRosterModalPayload(data.roster, {
        truck,
        statusLabel: data.roster.status || 'Driver Roster',
        rosterModalTitle: getDriverRosterModalTitle(data.roster.status),
        rosterModalSubtitle: `${data.roster.tmsName || data.roster.operatorTeamName || 'Driver'} · Truck ${data.roster.truck || truck}`
      });

      if (returnSnapshot) {
        parkOrderDrilldownSnapshot(returnSnapshot);
      }
      setSelectedDriverRoster(payload);
    } catch (err) {
      setDriverLookupError(err.message || 'Unable to open Driver Roster.');
    } finally {
      setDriverLookupLoading(false);
    }
  }

  function scrollToOperationsSection(sectionKey) {
    const sectionRefs = {
      activeToday: operationsActiveTodayRef,
      loadingToday: operationsLoadingTodayRef,
      deliveringToday: operationsDeliveringTodayRef,
      loadingNext7: operationsLoadingNext7Ref
    };

    if (sectionKey === 'loadingNext7') {
      setOperationsNext7Open(true);
    }

    window.setTimeout(() => {
      const target = sectionRefs[sectionKey]?.current;
      if (!target) return;

      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, sectionKey === 'loadingNext7' ? 50 : 0);
  }

  function OperationsSectionHeading({ children }) {
    return <h3>{children}</h3>;
  }

  function toggleReportPanel(panelName) {
    const isOpeningPanel = activeReportPanel !== panelName;

    if (isOpeningPanel && panelName === 'salesLeads') {
      primeSalesLeadsFollowUpDueView();
    }

    setActiveReportPanel((current) => (current === panelName ? '' : panelName));
  }

  function handleReportGroupClick(event, groupName) {
    event.preventDefault();
    event.stopPropagation();
    toggleReportGroup(groupName);
  }

  function handleReportPanelClick(event, panelName) {
    event.preventDefault();
    event.stopPropagation();
    toggleReportPanel(panelName);
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

  function getLiveOrderReturnTrailLabel() {
    if (permitHistoryOrderReturnLoad || selectedPermitHistoryLoad) return 'Historical Permitted Loads';
    if (operationalNotesModalOpen) return 'Operational Notes';
    if (driverSummaryModalOpen) return 'Monthly Driver Summary';
    if (weeklySettlementModalOpen) return 'Weekly Settlement Report';
    if (grossRevenueModalOpen) return 'Gross Revenue Totals';
    if (ordersDueSettlementModalOpen) return 'Orders Due for Settlement';
    if (wonNotRegisteredModalOpen) return 'Orders Won Not Registered';
    if (permitGovernanceModalOpen) return 'Permit Governance';
    if (onThisDayModalOpen) return 'On This Day';
    if (monthlyOpsModalOpen) return 'Monthly Operations Summary';
    if (customerTrendModalOpen) return 'Customer Booking Trends';
    if (salesSearchReturnLead) return 'Customer Card';
    return '';
  }

  function getOrderReturnTrailLabel() {
    return orderReturnTrailLabel || getLiveOrderReturnTrailLabel();
  }

  function handleOrderReturnTrailClick() {
    if (salesSearchReturnLead) {
      returnToCustomerCard();
      return;
    }

    closeModal();
  }

  function ModalReturnTrail({ label, onClick }) {
    if (!label) return null;

    return (
      <button type="button" className="modal-return-trail" onClick={onClick}>
        ← Back to {label}
      </button>
    );
  }

  function viewTitle() {
    if (selectedView === 'dispatch') return 'Dispatch Info';
    if (selectedView === 'billing') return 'Billing Info';
    if (selectedView === 'documents') return 'Documents';
    if (selectedView === 'notes') return 'Order Notes';
    return 'Basic Load Info';
  }

  function DetailItem({ label, value, valueNode = null, wide = false, className = '', children }) {
    return (
      <div className={`detail-item ${wide ? 'wide' : ''} ${className}`}>
        <span>{label}</span>
        <strong>{valueNode || formatValue(value)}</strong>
        {children}
      </div>
    );
  }

  function SectionTitle({ children }) {
    return <div className="section-title">{children}</div>;
  }

  function DocumentCard({ badge, title, meta, description, buttonText, onClick, disabled, loading }) {
    return (
      <div className={`document-launch-card ${disabled ? 'is-disabled' : ''}`}>
        <div className="document-launch-copy">
          <span className="document-launch-badge">{badge}</span>
          <div>
            <strong>{title}</strong>
            {meta && <small>{meta}</small>}
            {description && <p>{description}</p>}
          </div>
        </div>
        <button
          type="button"
          className="document-launch-button"
          onClick={onClick}
          disabled={disabled || loading}
        >
          {loading ? 'Opening...' : buttonText}
        </button>
      </div>
    );
  }


  function getOrderNotesCacheKey(record) {
    const bol = String(record?.BOL || '').trim().toUpperCase();
    const bidId = String(record?.BidID || '').trim().toLowerCase();
    return [bol, bidId].filter(Boolean).join('|');
  }

  function getOrderNoteTypeClass(noteType) {
    const normalized = String(noteType || 'uncategorized')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-');

    return `order-note-type-pill ${normalized || 'uncategorized'}`;
  }

  function getOrderNoteTimestamp(note) {
    return note?.CreatedAtDisplay || note?.CreatedAtLocal || note?.CreatedDateDisplay || note?.CreatedDate || '-';
  }

  function getOrderNoteFilterKey(value) {
    const clean = String(value || 'Uncategorized').trim();
    return clean || 'Uncategorized';
  }

  function getSortedOrderNoteTypeEntries(countsByType = {}) {
    return Object.entries(countsByType)
      .filter(([type, count]) => getOrderNoteFilterKey(type) && Number(count || 0) > 0)
      .sort(([typeA], [typeB]) => String(typeA).localeCompare(String(typeB), undefined, { sensitivity: 'base' }));
  }


  function getOperationOrderNoteCode(noteType) {
    const normalized = String(noteType || '').trim().toLowerCase();

    if (normalized === 'dispatch') return 'DIS';
    if (normalized === 'paperwork') return 'PWK';
    if (normalized === 'permit' || normalized === 'permits') return 'PER';

    return '';
  }

  function sortOperationOrderNoteCodes(codes = []) {
    const order = new Map([
      ['DIS', 1],
      ['PWK', 2],
      ['PER', 3]
    ]);

    return [...new Set(codes.filter(Boolean))].sort((a, b) => {
      const aOrder = order.get(a) || 99;
      const bOrder = order.get(b) || 99;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return String(a).localeCompare(String(b));
    });
  }

  function recordsReferToSameOrder(a = {}, b = {}) {
    const aBol = String(a.BOL || '').trim().toUpperCase();
    const bBol = String(b.BOL || '').trim().toUpperCase();
    const aBidId = String(a.BidID || '').trim().toLowerCase();
    const bBidId = String(b.BidID || '').trim().toLowerCase();

    return Boolean(
      (aBol && bBol && aBol === bBol) ||
      (aBidId && bBidId && aBidId === bBidId)
    );
  }

  function addOperationNoteCodeToRecord(record = {}, noteType = '') {
    const code = getOperationOrderNoteCode(noteType);
    if (!code) return record;

    const codes = sortOperationOrderNoteCodes([...(record.orderNoteCodes || []), code]);

    return {
      ...record,
      orderNoteCodes: codes,
      hasOperationNotes: codes.length > 0
    };
  }

  function addOperationNoteToOperationsData(currentData, record, noteType) {
    const code = getOperationOrderNoteCode(noteType);
    if (!currentData || !code || !record) return currentData;

    return {
      ...currentData,
      activeToday: (currentData.activeToday || []).map((activeRecord) => (
        recordsReferToSameOrder(activeRecord, record)
          ? addOperationNoteCodeToRecord(activeRecord, noteType)
          : activeRecord
      ))
    };
  }

  function renderOperationNotesPill(record) {
    const codes = sortOperationOrderNoteCodes(record?.orderNoteCodes || []);

    if (codes.length === 0) {
      return <span className="operation-note-empty" aria-label="No dispatch, paperwork, or permit notes">—</span>;
    }

    return (
      <span
        className="operation-note-pill"
        title="Dispatch, paperwork, or permit notes are present for this order"
      >
        {codes.join(', ')}
      </span>
    );
  }

  async function loadOrderNotes(record = selected, options = {}) {
    const { forceRefresh = false } = options;

    if (!record?.BOL && !record?.BidID) {
      setOrderNotesData({ success: true, notes: [], counts: { total: 0, byType: {} } });
      setOrderNotesError('This order does not have a BOL number or Bid ID to match notes against.');
      setOrderNotesLoading(false);
      setOrderNotesTypeFilter('All');
      return;
    }

    const cacheKey = getOrderNotesCacheKey(record);
    const cached = !forceRefresh ? getClientCacheRecord(orderNotesCacheRef.current, cacheKey, ORDER_NOTES_CLIENT_CACHE_MS) : null;

    orderNotesRequestRef.current += 1;
    const requestId = orderNotesRequestRef.current;

    if (cached) {
      setOrderNotesData(cached);
      setOrderNotesError('');
      setOrderNotesLoading(false);
      return;
    }

    setOrderNotesLoading(true);
    setOrderNotesError('');

    try {
      const params = new URLSearchParams();
      if (record.BOL) params.set('bol', record.BOL);
      if (record.BidID) params.set('bidId', record.BidID);
      if (forceRefresh) params.set('refresh', 'true');

      const res = await authedFetch(`${API}/order-notes?${params.toString()}`);
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Unable to load order notes.');
      }

      setLimitedClientCacheRecord(orderNotesCacheRef.current, cacheKey, data, 60);

      if (orderNotesRequestRef.current === requestId) {
        setOrderNotesData(data);
        setOrderNotesError('');
      }
    } catch (err) {
      if (orderNotesRequestRef.current === requestId) {
        setOrderNotesData(null);
        setOrderNotesError(err.message || 'Unable to load order notes.');
      }
    } finally {
      if (orderNotesRequestRef.current === requestId) {
        setOrderNotesLoading(false);
      }
    }
  }

  function openOrderNotesTab() {
    setSelectedView('notes');
    loadOrderNotes(selected);
  }

  function resetOrderNoteComposer() {
    setOrderNoteComposerOpen(false);
    setOrderNoteDraftType('Dispatch');
    setOrderNoteDraftBody('');
    setOrderNoteSaving(false);
    setOrderNoteSaveMessage('');
    setOrderNoteSaveError('');
  }

  function toggleOrderNoteComposer() {
    setOrderNoteSaveMessage('');
    setOrderNoteSaveError('');
    setOrderNoteComposerOpen((open) => !open);
  }

  async function saveOrderNote() {
    const record = selected;
    const noteBody = String(orderNoteDraftBody || '').trim();

    setOrderNoteSaveMessage('');
    setOrderNoteSaveError('');

    if (!record?.BOL && !record?.BidID) {
      setOrderNoteSaveError('This order does not have a BOL number or Bid ID to attach the note to.');
      return;
    }

    if (!noteBody) {
      setOrderNoteSaveError('Enter a note before saving.');
      return;
    }

    if (noteBody.length > ORDER_NOTE_MAX_LENGTH) {
      setOrderNoteSaveError(`Order note is too long. Limit notes to ${ORDER_NOTE_MAX_LENGTH.toLocaleString('en-US')} characters.`);
      return;
    }

    setOrderNoteSaving(true);

    try {
      const res = await authedFetch(`${API}/order-notes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          bol: record.BOL || '',
          bidId: record.BidID || '',
          customerName: record.Customer || '',
          customerNumber: record.CustomerCode || '',
          truckNumber: record.Truck || '',
          operatorTeam: record.TMSName || record.Driver || '',
          noteType: orderNoteDraftType || 'Dispatch',
          noteBody,
          createdBy: 'Kole Connect'
        })
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Unable to save order note.');
      }

      const cacheKey = getOrderNotesCacheKey(record);
      orderNotesCacheRef.current.delete(cacheKey);
      const savedNoteType = data.note?.NoteType || orderNoteDraftType;
      setOperationsData((currentData) => addOperationNoteToOperationsData(currentData, record, savedNoteType));
      setOrderNoteDraftBody('');
      setOrderNoteComposerOpen(false);
      setOrderNoteSaveMessage('Note added.');
      setOrderNotesTypeFilter(getOrderNoteFilterKey(savedNoteType));
      await loadOrderNotes(record, { forceRefresh: true });
    } catch (err) {
      setOrderNoteSaveError(err.message || 'Unable to save order note.');
    } finally {
      setOrderNoteSaving(false);
    }
  }

  function renderOrderNoteComposer() {
    const noteLength = String(orderNoteDraftBody || '').length;

    return (
      <div className="order-note-composer">
        <div className="order-note-composer-header">
          <div>
            <strong>Add order note</strong>
            <span>Saved to the Order Notes list for this BOL / Bid ID.</span>
          </div>
        </div>

        <div className="order-note-composer-grid">
          <label>
            <span>Note Type</span>
            <select
              value={orderNoteDraftType}
              onChange={(e) => setOrderNoteDraftType(e.target.value)}
              disabled={orderNoteSaving}
            >
              {ORDER_NOTE_TYPE_OPTIONS.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </label>

          <label className="order-note-composer-body-field">
            <span>Note Body</span>
            <textarea
              value={orderNoteDraftBody}
              onChange={(e) => setOrderNoteDraftBody(e.target.value)}
              placeholder="Add dispatch, paperwork, permits, billing, or operational context for this order."
              maxLength={ORDER_NOTE_MAX_LENGTH}
              rows={5}
              disabled={orderNoteSaving}
            />
          </label>
        </div>

        <div className="order-note-composer-footer">
          <small>{noteLength.toLocaleString('en-US')} / {ORDER_NOTE_MAX_LENGTH.toLocaleString('en-US')}</small>
          <div>
            <button
              type="button"
              className="view-button order-note-cancel-button"
              onClick={resetOrderNoteComposer}
              disabled={orderNoteSaving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="order-note-save-button"
              onClick={saveOrderNote}
              disabled={orderNoteSaving || !String(orderNoteDraftBody || '').trim()}
            >
              {orderNoteSaving ? 'Saving...' : 'Save Note'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderOrderNoteCard(note, index = 0) {
    const noteType = note.NoteType || 'Uncategorized';
    const noteBody = note.NoteBody || note.Title || '';
    const createdBy = note.CreatedBy || 'Unknown source';
    const timestamp = getOrderNoteTimestamp(note);
    const noteKey = note.id || `${note.KernelID || 'note'}-${note.CreatedAtLocal || note.CreatedDate || note.CreatedAtDisplay || index}`;

    return (
      <article key={noteKey} className="order-note-card">
        <div className="order-note-card-header">
          <div className="order-note-title-stack">
            <span className={getOrderNoteTypeClass(noteType)}>{noteType}</span>
            <span className="order-note-source">{createdBy}</span>
          </div>
          <time className="order-note-timestamp">{timestamp}</time>
        </div>

        <p className="order-note-body">{noteBody || 'No note body entered.'}</p>
      </article>
    );
  }

  function renderOrderNotesView() {
    const notes = orderNotesData?.notes || [];
    const countsByType = orderNotesData?.counts?.byType || {};
    const typeEntries = getSortedOrderNoteTypeEntries(countsByType);
    const hasLooked = Boolean(orderNotesData || orderNotesError || orderNotesLoading);
    const activeFilter = getOrderNoteFilterKey(orderNotesTypeFilter || 'All');
    const filteredNotes = activeFilter === 'All'
      ? notes
      : notes.filter((note) => getOrderNoteFilterKey(note.NoteType) === activeFilter);

    return (
      <div className="order-notes-view">
        <div className="order-notes-toolbar">
          <div>
            <div>
              <strong>{selected?.BOL ? `Order notes for ${selected.BOL}` : 'Order notes'}</strong>
              <small>{selected?.BidID || 'Matched by BOL / Bid ID'}</small>
            </div>
          </div>

          <div className="order-notes-toolbar-actions">
            <button
              type="button"
              className="view-button"
              onClick={() => loadOrderNotes(selected, { forceRefresh: true })}
              disabled={orderNotesLoading || orderNoteSaving}
            >
              {orderNotesLoading ? 'Refreshing...' : 'Refresh'}
            </button>
            <button
              type="button"
              className="order-note-add-button"
              onClick={toggleOrderNoteComposer}
              disabled={orderNoteSaving}
            >
              {orderNoteComposerOpen ? 'Close Add Note' : 'Add Note'}
            </button>
          </div>
        </div>

        {orderNoteComposerOpen && renderOrderNoteComposer()}
        {orderNoteSaveMessage && <div className="order-note-save-message">{orderNoteSaveMessage}</div>}
        {orderNoteSaveError && <div className="msg error order-notes-message">{orderNoteSaveError}</div>}

        {notes.length > 0 && (
          <div className="order-notes-type-summary" aria-label="Filter order notes by type">
            <button
              type="button"
              className={`order-note-type-pill all order-notes-filter-button ${activeFilter === 'All' ? 'is-active' : ''}`}
              onClick={() => setOrderNotesTypeFilter('All')}
            >
              All: {notes.length}
            </button>

            {typeEntries.map(([type, count]) => (
              <button
                key={type}
                type="button"
                className={`${getOrderNoteTypeClass(type)} order-notes-filter-button ${activeFilter === getOrderNoteFilterKey(type) ? 'is-active' : ''}`}
                onClick={() => setOrderNotesTypeFilter(getOrderNoteFilterKey(type))}
              >
                {type}: {count}
              </button>
            ))}
          </div>
        )}

        {orderNotesError && <div className="msg error order-notes-message">{orderNotesError}</div>}

        {orderNotesLoading && (
          <div className="order-notes-empty-state">
            <strong>Loading order notes...</strong>
            <span>Checking the Order Notes list for matching BOL / Bid ID entries.</span>
          </div>
        )}

        {!orderNotesLoading && hasLooked && notes.length === 0 && !orderNotesError && (
          <div className="order-notes-empty-state">
            <strong>No notes found for this order.</strong>
            <span>The connection worked, but this BOL / Bid ID does not have matching notes yet.</span>
          </div>
        )}

        {!orderNotesLoading && notes.length > 0 && filteredNotes.length === 0 && !orderNotesError && (
          <div className="order-notes-empty-state">
            <strong>No {activeFilter} notes for this order.</strong>
            <span>Choose All to bring the full note history back.</span>
          </div>
        )}

        {!orderNotesLoading && filteredNotes.length > 0 && (
          <div className="order-notes-list">
            {filteredNotes.map((note, index) => renderOrderNoteCard(note, index))}
          </div>
        )}
      </div>
    );
  }


  function OperationalNotesPreview() {
    const notes = operationalNotesReport?.notes || [];
    const countsByType = operationalNotesReport?.counts?.byType || {};
    const typeEntries = getSortedOrderNoteTypeEntries(countsByType);
    const activeFilter = operationalNotesTypeFilter || 'Dispatch';
    const filteredNotes = activeFilter === 'All'
      ? notes
      : notes.filter((note) => getOrderNoteFilterKey(note.NoteType) === activeFilter);

    return (
      <div className="order-notes-view operational-notes-report-preview">
        <div className="order-notes-toolbar operational-notes-toolbar">
          <div>
            <div>
              <strong>Order Notes added in the last 7 days</strong>
              <small>{operationalNotesReport?.periodLabel || 'Recent note activity'} · {formatReportNumber(notes.length)} total note(s)</small>
            </div>
          </div>

          <div className="order-notes-toolbar-actions">
            <button
              type="button"
              className="view-button"
              onClick={loadOperationalNotesReport}
              disabled={operationalNotesLoading}
            >
              {operationalNotesLoading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        {notes.length > 0 && (
          <div className="order-notes-type-summary" aria-label="Filter recent order notes by type">
            <button
              type="button"
              className={`order-note-type-pill all order-notes-filter-button ${activeFilter === 'All' ? 'is-active' : ''}`}
              onClick={() => setOperationalNotesTypeFilter('All')}
            >
              All: {notes.length}
            </button>

            {typeEntries.map(([type, count]) => (
              <button
                key={type}
                type="button"
                className={`${getOrderNoteTypeClass(type)} order-notes-filter-button ${activeFilter === getOrderNoteFilterKey(type) ? 'is-active' : ''}`}
                onClick={() => setOperationalNotesTypeFilter(getOrderNoteFilterKey(type))}
              >
                {type}: {count}
              </button>
            ))}
          </div>
        )}

        {operationalNotesOpenOrderError && (
          <div className="msg error operational-notes-open-order-error">{operationalNotesOpenOrderError}</div>
        )}

        {notes.length === 0 && (
          <div className="order-notes-empty-state">
            <strong>No recent notes found.</strong>
            <span>The Order Notes list connected, but nothing was added inside the last 7 days.</span>
          </div>
        )}

        {notes.length > 0 && filteredNotes.length === 0 && (
          <div className="order-notes-empty-state">
            <strong>No {activeFilter} notes in the last 7 days.</strong>
            <span>Choose All or another note type to review the remaining recent notes.</span>
          </div>
        )}

        {filteredNotes.length > 0 && (
          <div className="order-notes-list operational-notes-report-list">
            {filteredNotes.map((note, index) => {
              const noteType = note.NoteType || 'Uncategorized';
              const noteBody = note.NoteBody || note.Title || '';
              const createdBy = note.CreatedBy || 'Unknown source';
              const noteKey = getOperationalNoteActionKey(note, index);

              return (
                <article key={noteKey} className="order-note-card operational-note-report-card">
                  <div className="order-note-card-header">
                    <div className="order-note-title-stack">
                      <span className={getOrderNoteTypeClass(noteType)}>{noteType}</span>
                      <span className="order-note-source">{createdBy}</span>
                    </div>
                    <div className="order-note-timestamp-stack">
                      <time className="order-note-timestamp">{getOrderNoteTimestamp(note)}</time>
                      <button
                        type="button"
                        className="order-note-open-order-button"
                        onClick={() => openOrderFromOperationalNote(note, index)}
                        disabled={operationalNotesOpenOrderKey === noteKey || loadingDetail}
                        title="Open the full order modal for this note"
                      >
                        {operationalNotesOpenOrderKey === noteKey ? 'Opening...' : 'Open order'}
                      </button>
                    </div>
                  </div>

                  <p className="order-note-body">{noteBody || 'No note body entered.'}</p>

                  <div className="order-note-footline">
                    <span>BOL: {note.BOLNumber || '-'}</span>
                    <span>Bid: {note.BidID || '-'}</span>
                    <span>Driver: {note.OperatorTeam || '-'}</span>
                    <span>Truck: {note.TruckNumber || '-'}</span>
                    <span>Customer: {note.CustomerName || note.CustomerNumber || '-'}</span>
                  </div>
                </article>
              );
            })}
          </div>
        )}
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

  function OrderCardField({ label, value, children }) {
    const hasValue = value !== undefined && value !== null && String(value).trim() !== '';

    return (
      <div className="order-card-field">
        <span>{label}</span>
        <strong>{children || (hasValue ? value : '-')}</strong>
      </div>
    );
  }

  function OrderCardRoute({ origin, destination }) {
    return (
      <div className="order-card-route">
        <span>{origin || '-'}</span>
        <b aria-hidden="true">→</b>
        <span>{destination || '-'}</span>
      </div>
    );
  }

  function SearchOrderActionButtons({ record }) {
    return (
      <div className="order-card-actions">
        <button
          type="button"
          className="view-button"
          onClick={(e) => {
            e.stopPropagation();
            loadDetails(record.id, 'basic', record.SourceListId);
          }}
        >
          Basic
        </button>

        {canShowOrderViews(record.Status) && (
          <>
            <button
              type="button"
              className="view-button"
              onClick={(e) => {
                e.stopPropagation();
                loadDetails(record.id, 'dispatch', record.SourceListId);
              }}
            >
              Dispatch
            </button>

            <button
              type="button"
              className="view-button"
              onClick={(e) => {
                e.stopPropagation();
                loadDetails(record.id, 'billing', record.SourceListId);
              }}
            >
              Billing
            </button>

            {record.BOL && (
              <button
                type="button"
                className="view-button"
                onClick={(e) => {
                  e.stopPropagation();
                  loadDetails(record.id, 'documents', record.SourceListId);
                }}
              >
                Documents
              </button>
            )}

            {record.BOL && hasPermitFolder(record) && (
              <button
                type="button"
                className="view-button"
                onClick={(e) => {
                  e.stopPropagation();
                  openPermitFolder(record);
                }}
                disabled={documentLoading === 'permits'}
              >
                {documentLoading === 'permits' ? 'Opening...' : 'Permits'}
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  function SearchOrderCard({ record, index }) {
    const isSelected = selected?.id === record.id && selected?.SourceListId === record.SourceListId;

    return (
      <article
        key={`${record.SourceListId || 'current'}-${record.id || index}`}
        className={`order-card search-order-card ${isSelected ? 'selected-order-card' : ''}`.trim()}
        onClick={() => loadDetails(record.id, 'basic', record.SourceListId)}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            loadDetails(record.id, 'basic', record.SourceListId);
          }
        }}
      >
        <div className="order-card-header">
          <div>
            <span className="order-card-eyebrow">{record.SourceYear || record.SourceList || 'Current'}</span>
            <h4>{record.BOL || record.BidID || 'Order'}</h4>
            <p>{record.Customer || '-'}</p>
          </div>

          <span className={getStatusClass(record.Status)}>
            {record.Status || '-'}
          </span>
        </div>

        <OrderCardRoute origin={record.Origin} destination={record.Destination} />

        <div className="order-card-field-grid">
          <OrderCardField label="Driver" value={record.Driver} />
          <OrderCardField label="Truck" value={record.Truck} />
          <OrderCardField label="Pickup" value={formatDateOnly(record.PickupDate)} />
          <OrderCardField label="Delivery" value={formatDateOnly(record.DeliveryDate)} />
        </div>

        <SearchOrderActionButtons record={record} />
      </article>
    );
  }

  function OperationOrderCard({ record, index, variant }) {
    const showPickupEvidence = variant === 'loadingToday';
    const showDeliveryEvidence = variant === 'deliveringToday';
    const showDeliveryStatus = variant === 'deliveringToday';
    const showNotes = variant === 'activeToday';
    const dateLabel = variant === 'loadingToday' || variant === 'loadingNext7' ? 'Pickup' : 'Delivery';
    const dateValue = variant === 'loadingToday' || variant === 'loadingNext7'
      ? formatDateOnly(record.PickupDate)
      : formatDateOnly(record.DeliveryDate);

    return (
      <article
        key={`${variant}-${record.id || index}`}
        className={`order-card operations-order-card operations-order-card-${variant}`.trim()}
        onClick={() => loadDetails(record.id, 'basic', record.SourceListId)}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            loadDetails(record.id, 'basic', record.SourceListId);
          }
        }}
      >
        <div className="order-card-header">
          <div>
            <span className="order-card-eyebrow">{dateLabel}: {dateValue || '-'}</span>
            <h4>{record.BOL || record.BidID || 'Order'}</h4>
            <p>{record.Customer || record.Company || record.Driver || '-'}</p>
          </div>

          <div className="operations-order-card-signals">
            {showPickupEvidence && (
              <span className="order-card-signal">
                <EvidenceDot hasEvidence={record.hasPickupEvidence} label="Pickup" />
                <small>Pickup</small>
              </span>
            )}
            {showDeliveryEvidence && (
              <span className="order-card-signal">
                <EvidenceDot hasEvidence={record.hasDeliveryEvidence} label="Delivery" />
                <small>Delivery</small>
              </span>
            )}
            {showDeliveryStatus && <OperationStatusPill record={record} />}
            {showNotes && (
              <button
                type="button"
                className="operation-notes-cell-button order-card-notes-button"
                onClick={(event) => {
                  event.stopPropagation();
                  loadDetails(record.id, 'notes', record.SourceListId);
                }}
                title="Open this order's notes"
              >
                <span className="order-card-notes-label">Note(s):</span>
                {renderOperationNotesPill(record)}
              </button>
            )}
          </div>
        </div>

        <OrderCardRoute origin={record.Origin} destination={record.Destination} />

        <div className="order-card-field-grid">
          <OrderCardField label="Driver" value={record.Driver} />
          <OrderCardField label={dateLabel} value={dateValue} />
          <OrderCardField label="Origin" value={record.Origin} />
          <OrderCardField label="Destination" value={record.Destination} />
        </div>
      </article>
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

        <DetailItem label="Driver" value={selected.Driver}>
          <button
            type="button"
            className="view-button driver-card-button"
            onClick={() => openDriverRosterFromOrder(selected)}
            disabled={!selected.Truck || driverLookupLoading}
          >
            {driverLookupLoading ? 'Looking up...' : 'View Driver Card'}
          </button>
          {driverLookupError && <small className="inline-error">{driverLookupError}</small>}
        </DetailItem>
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
        <DetailItem label="Driver" value={selected.Driver}>
          <button
            type="button"
            className="view-button driver-card-button"
            onClick={() => openDriverRosterFromOrder(selected)}
            disabled={!selected.Truck || driverLookupLoading}
          >
            {driverLookupLoading ? 'Looking up...' : 'View Driver Card'}
          </button>
          {driverLookupError && <small className="inline-error">{driverLookupError}</small>}
        </DetailItem>
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
        <DetailItem label="Customer" value={selected.Customer}>
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

        <DetailItem label="TMS Name" value={selected.TMSName || selected.Driver}>
          <button
            type="button"
            className="view-button driver-card-button"
            onClick={() => openDriverRosterFromOrder(selected)}
            disabled={!selected.Truck || driverLookupLoading}
          >
            {driverLookupLoading ? 'Looking up...' : 'View Driver Card'}
          </button>
        </DetailItem>
      </div>
    );
  }

  function DocumentsView() {
    const bolLabel = selected.BOL || 'No BOL number found';
    const driverLabel = selected.TMSName || selected.Driver || '';

    return (
      <div className="detail-grid documents-grid">
        <SectionTitle>Order Documents</SectionTitle>

        <div className="documents-intro">
          <div>
            <strong>{selected.BOL ? `Quick links for ${selected.BOL}` : 'Quick document links'}</strong>
            <span>Open the source file or folder in SharePoint / OneDrive.</span>
          </div>
        </div>

        <DocumentCard
          badge="BOL"
          title="Bill of Lading"
          meta={bolLabel}
          description={selected.BOL ? 'Saved BOL document.' : 'Missing BOL number.'}
          buttonText="Open"
          onClick={openBolDocument}
          disabled={!selected.BOL}
          loading={documentLoading === 'bol'}
        />

        <DocumentCard
          badge="DSP"
          title="Dispatch Sheet"
          meta={bolLabel}
          description={selected.BOL ? 'Dispatch packet for this load.' : 'Missing BOL number.'}
          buttonText="Open"
          onClick={openDispatchSheetDocument}
          disabled={!selected.BOL}
          loading={documentLoading === 'dispatchsheet'}
        />

        <DocumentCard
          badge="IMG"
          title="Load Photos"
          meta={driverLabel ? `${bolLabel} · ${driverLabel}` : bolLabel}
          description={selected.BOL ? 'Driver upload folder.' : 'Missing BOL number.'}
          buttonText="Open folder"
          onClick={openLoadPhotosFolder}
          disabled={!selected.BOL}
          loading={documentLoading === 'loadphotos'}
        />

        {hasPermitFolder(selected) && (
          <DocumentCard
            badge="PER"
            title="Permits"
            meta={selected.Driver ? `${bolLabel} · ${selected.Driver}` : bolLabel}
            description={selected.BOL && selected.Driver ? 'Permit request folder.' : 'Missing BOL or Operator/Team value.'}
            buttonText="Open folder"
            onClick={() => openPermitFolder(selected)}
            disabled={!selected.BOL || !selected.Driver}
            loading={documentLoading === 'permits'}
          />
        )}

        <DocumentCard
          badge="SET"
          title="Final Settle"
          meta={bolLabel}
          description={selected.BOL ? 'Settlement worksheet.' : 'Missing BOL number.'}
          buttonText="Open"
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
    const [currentEasternYear, currentEasternMonth] = getEasternDateInputValue().split('-').map(Number);
    const isCurrentGrossRevenueYear = Number(grossRevenueReport.year) === currentEasternYear;
    const currentMonth = months.find((month) => Number(month.month) === currentEasternMonth) || null;
    const currentMonthRevenue = isCurrentGrossRevenueYear ? Number(monthlyTotals[currentEasternMonth] || 0) : 0;
    const currentMonthLoadCount = isCurrentGrossRevenueYear ? Number(monthlyLoadCounts[currentEasternMonth] || 0) : 0;
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

        <div className={`report-kpi-grid gross-revenue-kpi-grid ${isCurrentGrossRevenueYear ? 'has-current-month' : ''}`}>
          {isCurrentGrossRevenueYear && (
            <div className="report-kpi-card gross-revenue-current-month-card">
              <span>Current Month Revenue</span>
              <strong>{formatReportMoney(currentMonthRevenue)}</strong>
              <small>{currentMonth?.name || 'Current Month'} · {formatReportNumber(currentMonthLoadCount)} load{currentMonthLoadCount === 1 ? '' : 's'}</small>
            </div>
          )}
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
                            {quarter.months.map((month) => {
                              const isCurrentMonth = isCurrentGrossRevenueYear && Number(month.month) === currentEasternMonth;

                              return (
                                <th
                                  key={month.month}
                                  className={isCurrentMonth ? 'gross-revenue-current-month-cell' : ''}
                                >
                                  {month.shortName || month.name}
                                  {isCurrentMonth && <span className="gross-revenue-current-month-label">Current</span>}
                                </th>
                              );
                            })}
                            <th>{quarter.label} Total</th>
                            <th>Year Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="report-total-row">
                            <td></td>
                            <td>Grand Total / Month</td>
                            {quarter.months.map((month) => {
                              const isCurrentMonth = isCurrentGrossRevenueYear && Number(month.month) === currentEasternMonth;

                              return (
                                <td
                                  key={month.month}
                                  className={isCurrentMonth ? 'gross-revenue-current-month-cell' : ''}
                                >
                                  {formatReportMoney(monthlyTotals[month.month])}
                                </td>
                              );
                            })}
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
                                {quarter.months.map((month) => {
                                  const isCurrentMonth = isCurrentGrossRevenueYear && Number(month.month) === currentEasternMonth;

                                  return (
                                    <td
                                      key={`${quarter.label}-${truck.truck}-${month.month}`}
                                      className={isCurrentMonth ? 'gross-revenue-current-month-cell' : ''}
                                    >
                                      {formatReportMoney(truck.monthTotals?.[month.month])}
                                    </td>
                                  );
                                })}
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

  function getTruckMonthLoads(truck, monthNumber) {
    const targetMonth = Number(monthNumber);

    if (!targetMonth || targetMonth < 1 || targetMonth > 12) return [];

    return [...(truck?.loads || [])]
      .filter((load) => getLoadMonthNumber(load.PickupDate) === targetMonth)
      .sort((a, b) => String(a.PickupDate || '').localeCompare(String(b.PickupDate || '')));
  }

  function openGrossRevenueMonthDetail(truck, month) {
    if (!truck || !month) return;

    setSelectedGrossRevenueMonth({
      truck,
      month
    });
  }

  function GrossRevenueMonthLoadModal() {
    if (!grossRevenueReport || !selectedGrossRevenueMonth?.truck || !selectedGrossRevenueMonth?.month) return null;

    const truck = selectedGrossRevenueMonth.truck;
    const month = selectedGrossRevenueMonth.month;
    const monthNumber = Number(month.month);
    const loads = getTruckMonthLoads(truck, monthNumber);
    const monthRevenue = Number(truck.monthTotals?.[monthNumber] || 0);
    const loadCount = getTruckMonthLoadCount(truck, monthNumber);

    return (
      <div className="modal-overlay report-modal-overlay gross-month-load-overlay" onClick={closeGrossRevenueMonthModal}>
        <div className="detail-modal report-modal gross-month-load-modal" onClick={(e) => e.stopPropagation()}>
          <div className="detail-header report-modal-header gross-month-load-header">
            <div>
              <button
                type="button"
                className="gross-driver-card-link gross-month-back-link"
                onClick={closeGrossRevenueMonthModal}
              >
                Back to 12-month view
              </button>
              <h2>{month.name || 'Month'} Loads</h2>
              <p>{truck.operator || 'Driver'} · Truck {truck.truck || '-'} · {grossRevenueReport.year}</p>
            </div>

            <button className="close-button" onClick={closeGrossRevenueMonthModal}>
              Close
            </button>
          </div>

          <div className="modal-body report-modal-body">
            <div className="report-kpi-grid gross-month-load-kpi-grid">
              <div className="report-kpi-card">
                <span>Month Revenue</span>
                <strong>{formatReportMoney(monthRevenue)}</strong>
              </div>
              <div className="report-kpi-card">
                <span>Loads</span>
                <strong>{formatReportNumber(loadCount)}</strong>
              </div>
              <div className="report-kpi-card">
                <span>Source</span>
                <strong>{grossRevenueReport.dataSource || 'Bid Listing'}</strong>
              </div>
            </div>

            {loads.length === 0 ? (
              <div className="report-alert locked">
                <h4>No load rows found for {month.name}.</h4>
                <p>This month has no posted Gross Revenue Totals load rows for this driver yet.</p>
              </div>
            ) : (
              <div className="report-table-wrap">
                <table className="driver-report-table gross-month-load-table">
                  <thead>
                    <tr>
                      <th>BOL</th>
                      <th>Customer</th>
                      <th>Pickup</th>
                      <th>Delivery</th>
                      <th>Route</th>
                      <th>Gross Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loads.map((load, index) => (
                      <tr
                        key={`${load.BOL || load.BidID || load.id || index}-${index}`}
                        className={load.id ? 'report-clickable-row' : ''}
                        onClick={() => openReportLoadDetails(load)}
                        title={load.id ? 'Open full order screen' : ''}
                      >
                        <td>{load.BOL || '-'}</td>
                        <td>{load.Customer || '-'}</td>
                        <td>{load.PickupDateDisplay || formatDateOnly(load.PickupDate)}</td>
                        <td>{formatDateOnly(load.DeliveryDate)}</td>
                        <td>{[load.Origin, load.Destination].filter(Boolean).join(' to ') || '-'}</td>
                        <td>{formatReportMoney(load.GrossRevenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
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
          <div className="detail-header report-modal-header gross-driver-detail-header">
            <div className="gross-driver-detail-title-block">
              <h2>{truck.operator || 'Driver Revenue Detail'}</h2>
              <p>12-Month Revenue Detail · Truck {truck.truck || '-'} · {grossRevenueReport.year}</p>
              <button
                type="button"
                className="gross-driver-card-link"
                onClick={() => openDriverRosterFromGrossRevenueTruck(truck)}
                disabled={!truck.truck || driverLookupLoading}
              >
                {driverLookupLoading ? 'Looking up...' : 'View Driver Card'}
              </button>
            </div>

            <div className="report-modal-actions">
              <button className="close-button" onClick={closeGrossRevenueTruckModal}>
                Close
              </button>
            </div>
          </div>

          <div className="modal-body report-modal-body">
            {driverLookupError && <div className="msg error">{driverLookupError}</div>}
            {truck.isProjectionFallback && (
              <div className="report-alert locked">
                <h4>No posted Gross Revenue Totals row matched this active driver yet.</h4>
                <p>This month-to-month view is still opening from the projection row, with posted months shown as zero until revenue is logged for this truck.</p>
              </div>
            )}

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
                  <button
                    type="button"
                    key={`driver-month-${truck.truck}-${month.month}`}
                    className={`gross-driver-month-card ${revenue === 0 ? 'zero' : ''} ${isCurrentMonth ? 'current-month' : ''}`}
                    onClick={() => openGrossRevenueMonthDetail(truck, month)}
                    title={`View ${month.name} load detail`}
                  >
                    <span>{month.name}</span>
                    {isCurrentMonth && <em>Current Month</em>}
                    <strong>{formatReportMoney(revenue)}</strong>
                    <small>{formatReportNumber(loadCount)} load{loadCount === 1 ? '' : 's'} · View loads</small>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  function getGrossRevenueQuarterForTruck(truck = {}, reportYear) {
    const monthTotals = truck?.monthTotals || {};
    const revenueMonths = Object.entries(monthTotals)
      .map(([month, revenue]) => ({
        month: Number(month),
        revenue: Number(revenue || 0)
      }))
      .filter((month) => month.month >= 1 && month.month <= 12 && month.revenue > 0)
      .sort((a, b) => b.month - a.month);

    if (revenueMonths.length > 0) {
      return `Q${Math.floor((revenueMonths[0].month - 1) / 3) + 1}`;
    }

    return getDefaultGrossRevenueQuarter(reportYear);
  }

  function findGrossRevenueTruckForProjectionRow(report, row = {}) {
    const truckKey = normalizeDriverHistoryTruckKey(row?.truck);
    const operatorKey = normalizeSearchValue(row?.operator || '');
    const trucks = report?.trucks || [];

    if (truckKey) {
      const truckMatch = trucks.find((truck) => normalizeDriverHistoryTruckKey(truck?.truck) === truckKey);
      if (truckMatch) return truckMatch;
    }

    if (operatorKey) {
      return trucks.find((truck) => normalizeSearchValue(truck?.operator || '') === operatorKey) || null;
    }

    return null;
  }

  function buildProjectionFallbackGrossRevenueTruck(row = {}, report = {}) {
    const monthTotals = Object.fromEntries(
      (report.months || []).map((month) => [month.month, 0])
    );
    const monthLoadCounts = Object.fromEntries(
      (report.months || []).map((month) => [month.month, 0])
    );
    const actualRevenue = Number(row.actualRevenue ?? row.ytdRevenue ?? 0);
    const actualLoadCount = Number(row.actualLoadCount || 0);

    return {
      truck: String(row?.truck || '').trim() || 'Unassigned Truck',
      operator: row?.operator || 'Driver Revenue Detail',
      rosterStatus: row?.rosterStatus || 'Active',
      rosterTermDate: row?.rosterTermDate || '',
      monthTotals,
      monthLoadCounts,
      totalGrossRevenue: actualRevenue,
      loadCount: actualLoadCount,
      permitEscortTotal: 0,
      loads: [],
      averageMonthlyRevenue: Number(row.averageMonthlyRevenue || 0),
      averageActiveMonthRevenue: Number(row.averageMonthlyRevenue || 0),
      averageRevenueMonthRevenue: Number(row.averageMonthlyRevenue || 0),
      monthsElapsed: Number(report.totals?.monthsElapsed || 12),
      monthsWithRevenue: actualRevenue > 0 ? 1 : 0,
      isProjectionFallback: true
    };
  }

  async function openGrossRevenueDetailFromProjectionRow(row = {}) {
    const truck = String(row?.truck || '').trim();
    const truckKey = normalizeDriverHistoryTruckKey(truck);
    const selectedYear = Number(yearlyProjectionReport?.year || yearlyProjectionYear);

    if (!truckKey) {
      setProjectionRevenueDrilldownError('This projection row does not have a truck number to match in Gross Revenue Totals.');
      return;
    }

    setProjectionRevenueDrilldownLoadingTruck(truckKey);
    setProjectionRevenueDrilldownError('');
    setGrossRevenueError(null);

    try {
      const report = grossRevenueReport && Number(grossRevenueReport.year) === selectedYear
        ? grossRevenueReport
        : await fetchGrossRevenueReport(selectedYear);
      const grossTruck = findGrossRevenueTruckForProjectionRow(report, row) || buildProjectionFallbackGrossRevenueTruck(row, report);

      setGrossRevenueYear(selectedYear);
      setGrossRevenueReport(report);
      setOpenGrossRevenueQuarters([getGrossRevenueQuarterForTruck(grossTruck, selectedYear)]);
      setSelectedGrossRevenueTruck(grossTruck);
      setYearlyProjectionModalOpen(false);
      setGrossRevenueModalOpen(true);
    } catch (err) {
      setProjectionRevenueDrilldownError(err.message || 'Unable to open the Gross Revenue month detail for this driver.');
    } finally {
      setProjectionRevenueDrilldownLoadingTruck('');
    }
  }

  async function openDriverRosterFromProjectionRow(row = {}) {
    const truck = String(row?.truck || '').trim();
    if (!truck) return;

    const localMatch = findLocalDriverRosterMatch(truck);
    if (localMatch) {
      setDriverLookupError('');
      setSelectedDriverRoster(localMatch);
      return;
    }

    setDriverLookupLoading(true);
    setDriverLookupError('');

    try {
      const res = await authedFetch(`${API}/driver-roster/lookup?truck=${encodeURIComponent(truck)}`);
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success || !data.roster) {
        throw new Error(data.error || data.message || `No Driver Roster record matched truck ${truck}.`);
      }

      const payload = buildDriverRosterModalPayload(data.roster, {
        truck,
        statusLabel: data.roster.status || 'Driver Roster',
        rosterModalTitle: getDriverRosterModalTitle(data.roster.status),
        rosterModalSubtitle: `${data.roster.tmsName || data.roster.operatorTeamName || row.operator || 'Driver'} · Truck ${data.roster.truck || truck}`
      });

      setSelectedDriverRoster(payload);
    } catch (err) {
      setDriverLookupError(err.message || 'Unable to open Driver Roster.');
    } finally {
      setDriverLookupLoading(false);
    }
  }

  function openDriverRosterFromGrossRevenueTruck(truck = selectedGrossRevenueTruck) {
    return openDriverRosterFromProjectionRow({
      truck: truck?.truck,
      operator: truck?.operator
    });
  }

  function YearlyRevenueProjectionPreview() {
    if (!yearlyProjectionReport) return null;

    const summary = yearlyProjectionReport.summary || {};
    const scenarios = yearlyProjectionReport.scenarios || [];
    const driverRows = yearlyProjectionReport.driverRows || [];
    const monthlyTotals = yearlyProjectionReport.monthlyTotals || [];
    const sensitivityRows = yearlyProjectionReport.driverCountSensitivity || [];
    const offTimeAdjustment = yearlyProjectionReport.offTimeAdjustment || {};
    const offTimePeriods = offTimeAdjustment.periods || [];
    const activeDriverCount = Number(summary.activeDriverCount || 0);
    const averageMonthlyRevenuePerActiveDriver = Number(summary.averageMonthlyRevenuePerActiveDriver || 0);
    const projectionLockedRevenue = Number(summary.projectionKnownRevenue ?? summary.projectionLockedRevenue ?? summary.actualRevenueThroughCurrentMonth ?? 0);
    const currentMonthRemainingProjectedRevenueBeforeOffTime = Number(
      summary.currentMonthRemainingProjectedRevenueBeforeOffTime ?? summary.currentMonthRemainingProjectedRevenue ?? 0
    );
    const remainingFullMonthsAfterCurrent = Number(summary.remainingFullMonthsAfterCurrent || 0);
    const sensitivityAppliesToRemainingYear = Boolean(summary.sensitivityAppliesToRemainingYear);

    function getProjectionOpenDriverDaysForDriverCount(period = {}, driverCount = 0) {
      const cleanDriverCount = Math.max(0, Number(driverCount || 0));
      const days = Math.max(0, Number(period.days || 0));
      const baselineDriverDays = cleanDriverCount * days;

      if (baselineDriverDays <= 0) return 0;

      const fixedUnavailableDriverDays = Math.min(
        Math.max(0, Number(period.knownUnavailableDriverDays || period.knownOffDays || 0)),
        baselineDriverDays
      );

      return Math.max(0, baselineDriverDays - fixedUnavailableDriverDays);
    }

    function getCustomYearlyProjectionForDriverCount(driverCount) {
      const cleanDriverCount = Math.max(0, Number(driverCount || 0));

      if (sensitivityAppliesToRemainingYear) {
        const revenuePerDriverDay = Number(summary.revenuePerAvailableDriverDay || 0);
        const futurePeriods = offTimePeriods.filter((period) => period.periodType !== 'elapsedYear');
        const projectedOpenFutureRevenue = futurePeriods.reduce((sum, period) => (
          sum + (revenuePerDriverDay * getProjectionOpenDriverDaysForDriverCount(period, cleanDriverCount))
        ), 0);

        return projectionLockedRevenue + projectedOpenFutureRevenue;
      }

      return averageMonthlyRevenuePerActiveDriver * cleanDriverCount * 12;
    }

    const customDriverCount = Number(yearlyProjectionCustomDriverCount);
    const customScenario = Number.isFinite(customDriverCount) && customDriverCount > 0
      ? {
          label: String(yearlyProjectionCustomName || 'Custom scenario').trim() || 'Custom scenario',
          driverCount: customDriverCount,
          projectedAnnualRevenue: getCustomYearlyProjectionForDriverCount(customDriverCount),
          differenceFromCurrent: getCustomYearlyProjectionForDriverCount(customDriverCount) - Number(summary.projectedAnnualRevenue || 0)
        }
      : null;

    return (
      <div className="driver-report-preview modal-report-preview yearly-projection-preview">
        <div className="yearly-projection-hero">
          <div>
            <span>Projected Annual Revenue</span>
            <strong>{formatReportMoney(summary.projectedAnnualRevenue)}</strong>
            <small>
              {sensitivityAppliesToRemainingYear
                ? `${formatReportMoney(projectionLockedRevenue)} known/dated revenue + ${formatReportMoney(summary.projectedRemainingRevenue)} projected open capacity`
                : `${formatReportMoney(summary.averageMonthlyRevenuePerActiveDriver)} average monthly revenue per active driver × ${formatReportNumber(summary.activeDriverCount)} active driver${Number(summary.activeDriverCount) === 1 ? '' : 's'} × 12`}
            </small>
          </div>
          <div>
            <span>Basis</span>
            <strong>{formatReportNumber(summary.basisMonthCount)} month{Number(summary.basisMonthCount) === 1 ? '' : 's'}</strong>
            <small>{yearlyProjectionReport.basisLabel || 'Completed months are used when available.'}</small>
          </div>
        </div>

        <div className="report-kpi-grid yearly-projection-kpi-grid">
          <div className="report-kpi-card">
            <span>Active Drivers</span>
            <strong>{formatReportNumber(summary.activeDriverCount)}</strong>
          </div>
          <div className="report-kpi-card">
            <span>Known / Dated Revenue</span>
            <strong>{formatReportMoney(summary.basisRevenue)}</strong>
            {Number(summary.basisActualRevenue || 0) > 0 && Number(summary.basisActualRevenue || 0) !== Number(summary.basisRevenue || 0) && (
              <small>{formatReportMoney(summary.actualRevenueThroughCurrentMonth)} through today + {formatReportMoney(summary.futureBookedRevenue)} future booked</small>
            )}
          </div>
          <div className="report-kpi-card">
            <span>Avg Monthly Revenue</span>
            <strong>{formatReportMoney(summary.averageMonthlyRevenue)}</strong>
          </div>
          <div className="report-kpi-card">
            <span>Avg / Driver / Month</span>
            <strong>{formatReportMoney(summary.averageMonthlyRevenuePerActiveDriver)}</strong>
          </div>
          <div className="report-kpi-card">
            <span>Annualized / Driver</span>
            <strong>{formatReportMoney(summary.annualizedRevenuePerActiveDriver)}</strong>
          </div>
        </div>

        {yearlyProjectionReport.basisIncludesProratedCurrentMonth && (summary.currentMonthRevenue > 0 || summary.currentMonthFutureBookedRevenue > 0) && (
          <div className="yearly-projection-note">
            <strong>Current month capacity pace:</strong> {formatReportMoney(summary.currentMonthRevenue)} is dated through day {formatReportNumber(summary.currentMonthElapsedDay)} of {formatReportNumber(summary.currentMonthDays)}.
            {Number(summary.currentMonthFutureBookedRevenue || 0) > 0 && (
              <> {formatReportMoney(summary.currentMonthFutureBookedRevenue)} is already booked for later in {summary.currentMonthName || 'the current month'} and is counted once, not multiplied into the day-1 pace.</>
            )}
            {' '}Open current-month capacity adds {formatReportMoney(summary.currentMonthOpenProjectedRevenue)} after known off-time and committed load-days, for a current-month projection of <strong>{formatReportMoney(summary.currentMonthProjectedRevenue)}</strong>.
            {' '}Driver count sensitivity only changes open future capacity; known/dated revenue stays locked.
          </div>
        )}

       

        {offTimeAdjustment.checked && offTimeAdjustment.warning && (
          <div className="yearly-projection-note">
            <strong>Driver Time Off warning:</strong> {offTimeAdjustment.warning}
          </div>
        )}

        {!yearlyProjectionReport.basisIncludesProratedCurrentMonth && !summary.currentMonthIsBasis && summary.currentPartialMonthRevenue > 0 && (
          <div className="yearly-projection-note">
            <strong>Current month watch:</strong> {formatReportMoney(summary.currentPartialMonthRevenue)} is logged in {summary.currentPartialMonthName || 'the current month'} so far, but it is not part of the projection basis.
          </div>
        )}

        <div className="yearly-projection-grid">
          <section className="yearly-projection-card">
            <h3>Run-rate scenarios</h3>
            <p className="yearly-projection-card-note">Scenarios adjust the open-capacity run rate while keeping known/dated revenue intact.</p>
            <div className="report-table-wrap">
              <table className="driver-report-table yearly-projection-scenario-table">
                <thead>
                  <tr>
                    <th>Scenario</th>
                    <th>Monthly / Driver</th>
                    <th>Projected Annual</th>
                    <th>Annual / Driver</th>
                  </tr>
                </thead>
                <tbody>
                  {scenarios.map((scenario) => (
                    <tr key={scenario.key || scenario.label}>
                      <td>
                        <strong>{scenario.label}</strong>
                        <small>{scenario.note}</small>
                      </td>
                      <td>{formatReportMoney(scenario.averageMonthlyRevenuePerDriver)}</td>
                      <td>{formatReportMoney(scenario.projectedAnnualRevenue)}</td>
                      <td>{formatReportMoney(scenario.annualizedRevenuePerDriver)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="yearly-projection-card">
            <div className="yearly-projection-card-heading-row">
              <div>
                <h3>Driver count sensitivity</h3>
                <p className="yearly-projection-card-note">Driver changes apply from today forward, not retroactively to months already posted.</p>
              </div>
              <button
                type="button"
                className="view-button yearly-projection-custom-toggle"
                onClick={() => setYearlyProjectionCustomOpen((open) => !open)}
              >
                {yearlyProjectionCustomOpen ? 'Hide Custom' : 'Custom Scenario'}
              </button>
            </div>

            {yearlyProjectionCustomOpen && (
              <div className="yearly-projection-custom-box">
                <label>
                  <span>Scenario name</span>
                  <input
                    value={yearlyProjectionCustomName}
                    onChange={(e) => setYearlyProjectionCustomName(e.target.value)}
                    placeholder="Aggressive hiring"
                  />
                </label>
                <label>
                  <span>Active drivers</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={yearlyProjectionCustomDriverCount}
                    onChange={(e) => setYearlyProjectionCustomDriverCount(e.target.value)}
                    placeholder={String(summary.activeDriverCount || '')}
                  />
                </label>
                {customScenario && (
                  <div className="yearly-projection-custom-result">
                    <strong>{customScenario.label}</strong>
                    <span>{formatReportNumber(customScenario.driverCount)} drivers → {formatReportMoney(customScenario.projectedAnnualRevenue)}</span>
                    <small>{formatReportMoney(customScenario.differenceFromCurrent)} vs current projection</small>
                  </div>
                )}
              </div>
            )}

            <div className="report-table-wrap">
              <table className="driver-report-table yearly-projection-sensitivity-table">
                <thead>
                  <tr>
                    <th>Active Drivers</th>
                    <th>Projected Annual</th>
                    <th>Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {sensitivityRows.map((row) => (
                    <tr key={row.driverCount}>
                      <td>{formatReportNumber(row.driverCount)}</td>
                      <td>{formatReportMoney(row.projectedAnnualRevenue)}</td>
                      <td>{formatReportMoney(row.differenceFromCurrent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <section className="yearly-projection-card yearly-projection-monthly-card">
          <h3>Monthly revenue basis</h3>
          <div className="yearly-projection-month-strip">
            {monthlyTotals.map((month) => {
              const isPacedMonth = Boolean(month.isProratedBasisMonth);
              const isFutureBookedOnly = Boolean(!month.isCurrentMonth && !month.isCompletedBasisMonth && Number(month.futureBookedRevenue || 0) > 0);
              const displayedRevenue = month.isCurrentMonth
                ? Number(summary.currentMonthProjectedRevenue ?? month.projectedBasisRevenue ?? 0)
                : (isFutureBookedOnly ? Number(month.futureBookedRevenue || 0) : Number(month.revenue || 0));

              let cardTag = null;
              if (month.isCurrentMonth) cardTag = <em>Capacity</em>;
              else if (isFutureBookedOnly) cardTag = <em>Booked</em>;
              else if (isPacedMonth) cardTag = <em>Paced</em>;
              else if (month.isBasisMonth) cardTag = <em>Basis</em>;

              return (
                <div
                  key={month.month}
                  className={`yearly-projection-month-card ${month.isBasisMonth ? 'basis' : ''} ${month.isCurrentMonth ? 'current' : ''}`}
                >
                  <span>{month.shortName || month.name}</span>
                  {cardTag}
                  {month.isCurrentMonth && !month.isBasisMonth && <em>Current</em>}
                  <strong>{formatReportMoney(displayedRevenue)}</strong>
                  <small>
                    {month.isCurrentMonth
                      ? `${formatReportMoney(month.elapsedRevenue)} through day ${formatReportNumber(month.currentMonthElapsedDay)} · ${formatReportMoney(month.futureBookedRevenue)} future booked · ${formatReportMoney(month.currentMonthOpenProjectedRevenue)} open capacity`
                      : (isFutureBookedOnly
                          ? `${formatReportMoney(month.futureBookedRevenue)} future booked · ${formatReportNumber(month.futureBookedLoadCount)} load${Number(month.futureBookedLoadCount) === 1 ? '' : 's'}`
                          : `${formatReportNumber(month.loadCount)} load${Number(month.loadCount) === 1 ? '' : 's'}`)}
                  </small>
                </div>
              );
            })}
          </div>
        </section>

        <section className="yearly-projection-card">
          <h3>Active driver pace</h3>
          {projectionRevenueDrilldownError && (
            <div className="msg error">{projectionRevenueDrilldownError}</div>
          )}
          <div className="report-table-wrap yearly-projection-driver-table-wrap">
            <table className="driver-report-table yearly-projection-driver-table">
              <thead>
                <tr>
                  <th>Truck</th>
                  <th>Driver</th>
                  <th>Actual Logged</th>
                  <th>Known Revenue</th>
                  <th>Blended Pace</th>
                  <th>Projected Annual</th>
                  <th>Capacity</th>
                  <th>Pace</th>
                </tr>
              </thead>
              <tbody>
                {driverRows.length === 0 ? (
                  <tr>
                    <td colSpan={8}>No active drivers were found for this projection.</td>
                  </tr>
                ) : driverRows.map((row) => {
                  const rowTruckKey = normalizeDriverHistoryTruckKey(row?.truck);
                  const isOpeningGrossRevenueDetail = projectionRevenueDrilldownLoadingTruck === rowTruckKey;

                  return (
                  <tr
                    key={row.truck || row.operator}
                    className={`yearly-projection-driver-row ${isOpeningGrossRevenueDetail ? 'opening-detail' : ''}`}
                    onClick={() => openGrossRevenueDetailFromProjectionRow(row)}
                    title="Open Gross Revenue month detail"
                  >
                    <td>{row.truck || '-'}</td>
                    <td>
                      <strong>{row.operator || '-'}</strong>
                      {row.hasNoRevenue && <small>No revenue in projection year</small>}
                    </td>
                    <td>
                      {formatReportMoney(row.actualRevenue ?? row.ytdRevenue)}
                      {Number(row.actualLoadCount || 0) > 0 && <small>{formatReportNumber(row.actualLoadCount)} logged load{Number(row.actualLoadCount) === 1 ? '' : 's'}</small>}
                    </td>
                    <td>
                      {formatReportMoney(row.knownRevenue ?? row.basisRevenue)}
                      {Number(row.futureBookedRevenue || 0) > 0 && <small>{formatReportMoney(row.futureBookedRevenue)} future booked</small>}
                    </td>
                    <td>
                      {formatReportMoney(row.averageMonthlyRevenue)}
                      {row.usesFleetBaselinePace && <small>Blended with fleet baseline</small>}
                      {Number(row.revenuePerAvailableDriverDay || 0) > 0 && <small>{formatReportMoney(row.revenuePerAvailableDriverDay)} / available day</small>}
                      {row.usesFleetBaselinePace && Number(row.observedRevenuePerAvailableDriverDay || 0) > 0 && (
                        <small>{formatReportMoney(row.observedRevenuePerAvailableDriverDay)} observed</small>
                      )}
                    </td>
                    <td>{formatReportMoney(row.projectedAnnualRevenue)}</td>
                    <td>
                      {formatReportNumber(row.futureOpenDriverDays || 0)} open days
                      <small>
                        {formatReportNumber(row.futureOffDays || 0)} off · {formatReportNumber(row.futureBookedDriverDays || 0)} booked
                      </small>
                    </td>
                    <td>
                      {row.paceLabel || '-'}
                      {row.paceBasisLabel && <small>{row.paceBasisLabel}</small>}
                      {row.usesFleetBaselinePace && <small>{formatReportNumber(row.paceConfidencePercent || 0)}% driver-specific confidence</small>}
                      {isOpeningGrossRevenueDetail && <small>Opening month detail...</small>}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
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


  function SettlementDriverPaySummary({ rows }) {
    const summaryRows = rows || [];

    return (
      <div className="settlement-subsection settlement-driver-pay-summary">
        <div className="settlement-subsection-header">
          <div>
            <h5>Gross / Driver Pay by Driver</h5>
                  </div>
          <span>{formatReportNumber(summaryRows.length)} driver(s)</span>
        </div>

        {summaryRows.length === 0 ? (
          <div className="msg">No driver pay summary is available for this settlement window.</div>
        ) : (
          <div className="report-table-wrap settlement-summary-table-wrap">
            <table className="settlement-driver-summary-table">
              <thead>
                <tr>
                  <th>Driver</th>
                  <th>Truck(s)</th>
                  <th>Orders</th>
                  <th>BOLs</th>
                  <th>Gross Revenue</th>
                  <th>Driver Pay</th>
                  <th>Margin</th>
                </tr>
              </thead>
              <tbody>
                {summaryRows.map((row, index) => (
                  <tr key={`${row.driver || 'driver'}-${row.trucks || 'truck'}-${index}`}>
                    <td>{row.driver || 'Unknown Operator'}</td>
                    <td>{row.trucks || '-'}</td>
                    <td>{formatReportNumber(row.orderCount)}</td>
                    <td>{(row.bols || []).join(', ') || '-'}</td>
                    <td>{formatReportMoney(row.bidTotal)}</td>
                    <td>{formatReportMoney(row.driverPayTotal)}</td>
                    <td>{formatReportMoney(row.margin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  function ActiveDriversNoRevenueCheck({ data }) {
    const rows = data?.main || [];

    if (!data) return null;

    if (!data.sourceAvailable && data.warning) {
      return (
        <div className="report-alert locked settlement-roster-warning">
          <h4>Active driver revenue check skipped.</h4>
          <p>{data.warning}</p>
        </div>
      );
    }

    return (
      <div className="settlement-subsection settlement-no-revenue-check">
        <div className="settlement-subsection-header">
          <div>
            <h5>Active Drivers With No Main-Window Revenue</h5>
                     </div>
          <span>{formatReportNumber(rows.length)} flagged</span>
        </div>

        {data.warning && (
          <div className="settlement-check-warning">{data.warning}</div>
        )}

        {rows.length === 0 ? (
          <div className="msg good-news">Every active roster driver matched main-window settlement revenue.</div>
        ) : (
          <div className="report-table-wrap settlement-summary-table-wrap">
            <table className="settlement-no-revenue-table">
              <thead>
                <tr>
                  <th>Operator / Team</th>
                  <th>TMS Name</th>
                  <th>Truck</th>
                  <th>Driver Type</th>
                  <th>Trailer</th>
                  <th>Start Date</th>
                  <th>Check</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((roster, index) => (
                  <tr key={`${roster.id || roster.truck || roster.tmsName || index}-${index}`}>
                    <td>{roster.operatorTeamName || '-'}</td>
                    <td>{roster.tmsName || '-'}</td>
                    <td>{roster.truck || '-'}</td>
                    <td>{roster.driverType || '-'}</td>
                    <td>{roster.trailerType || '-'}</td>
                    <td>{formatRosterDate(roster.startDate) || '-'}</td>
                    <td>
                      {roster.hasLikelyNextWeekRevenue
                        ? 'No main-window revenue; appears in likely next week.'
                        : 'No main-window revenue found.'}
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


  function OrdersDueSettlementPreview({ report = liveOrdersDueSettlementReport, inline = false } = {}) {
    const rows = report?.rows || [];

    if (!report) return null;

    return (
      <div className={`settlement-report-preview modal-report-preview ${inline ? 'inline-action-report-preview' : ''}`}>
        <div className="driver-report-generated">
          Generated: {report.generatedAt}
        </div>

        <div className="report-kpi-grid orders-due-settlement-kpi-grid">
          <div className="report-kpi-card">
            <span>Orders Due</span>
            <strong>{formatReportNumber(report.count)}</strong>
          </div>
          <div className="report-kpi-card">
            <span>Bid Total</span>
            <strong>{formatReportMoney(report.totals?.bidTotal)}</strong>
          </div>
          <div className="report-kpi-card">
            <span>Driver Pay</span>
            <strong>{formatReportMoney(report.totals?.driverPayTotal)}</strong>
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
          <SettlementDriverPaySummary rows={weeklySettlementReport.driverPaySummary?.main} />
          <ActiveDriversNoRevenueCheck data={weeklySettlementReport.activeDriversWithNoRevenue} />

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


  function WonNotRegisteredPreview({ report = liveWonNotRegisteredReport, inline = false } = {}) {
    const rows = report?.rows || [];

    if (!report) return null;

    return (
      <div className={`driver-report-preview modal-report-preview ${inline ? 'inline-action-report-preview' : ''}`}>
        <div className="driver-report-generated">
          Generated: {report.generatedAt}
        </div>

        <div className="report-kpi-grid won-not-registered-kpi-grid">
          <div className="report-kpi-card">
            <span>Open Orders</span>
            <strong>{formatReportNumber(report.count)}</strong>
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


  function PermitGovernancePreview() {
    if (!permitGovernanceReport) return null;

    const sections = permitGovernanceReport.sections || {};
    const counts = permitGovernanceReport.counts || {};
    const filterDefs = [
      {
        key: 'currentlyPermitted',
        label: 'Currently Permitted',
        count: counts.currentlyPermitted || 0,
        description: 'Permit requested and delivery date today or later.'
      },
      {
        key: 'ordersNeedingPermits',
        label: 'Orders Needing Permits',
        count: counts.ordersNeedingPermits || 0,
        description: 'Permit estimate exists but request has not been filed.'
      },
      {
        key: 'permitFolderNeedsDocs',
        label: 'Permit Docs Pending',
        count: counts.permitFolderNeedsDocs || 0,
        description: 'Folder missing, unaudited, or still has one file or less.'
      },
      {
        key: 'historicalPermittedLoads',
        label: 'Permit History',
        count: counts.historicalPermittedLoads || 0,
        description: 'Delivered loads where a permit request was filed.'
      }
    ];
    const activeFilter = filterDefs.some((item) => item.key === permitGovernanceFilter)
      ? permitGovernanceFilter
      : 'currentlyPermitted';
    const rows = sections[activeFilter] || [];
    const activeLabel = filterDefs.find((item) => item.key === activeFilter)?.label || 'Permit Records';
    const isHistoricalFilter = activeFilter === 'historicalPermittedLoads';

    function getPermitFolderStatus(row) {
      if (!row.PermitsRequested) return 'Not requested';
      if (!row.PermitFolderFound) return 'Folder missing';
      if (row.PermitFolderAuditError) return 'Audit failed';
      if (row.PermitFolderFileCount === null || row.PermitFolderFileCount === undefined) return 'Folder found';
      return `${formatReportNumber(row.PermitFolderFileCount)} file${Number(row.PermitFolderFileCount) === 1 ? '' : 's'}`;
    }

    return (
      <div className="driver-report-preview modal-report-preview permit-governance-preview">
        <div className="driver-report-generated">
          Generated: {permitGovernanceReport.generatedAt}
        </div>

        {permitGovernanceReport.warnings?.length > 0 && (
          <div className="report-alert locked permit-governance-warning">
            <h4>Permit folder audit note</h4>
            {permitGovernanceReport.warnings.map((warning, index) => (
              <p key={`${warning}-${index}`}>{warning}</p>
            ))}
          </div>
        )}

        <div className="permit-governance-card-grid">
          {filterDefs.map((filter) => (
            <button
              key={filter.key}
              type="button"
              className={`permit-governance-filter-card ${activeFilter === filter.key ? 'active' : ''}`}
              onClick={() => setPermitGovernanceFilter(filter.key)}
            >
              <span>{filter.label}</span>
              <strong>{formatReportNumber(filter.count)}</strong>
              <small>{filter.description}</small>
            </button>
          ))}
        </div>

        <div className="driver-report-section permit-governance-section">
          <div className="driver-report-section-header">
            <div>
              <h4>{activeLabel}</h4>
              <p>
                {isHistoricalFilter
                  ? 'Delivered permitted loads from Bid Listing. Click a row for permit details.'
                  : 'Bid Listing records in the selected permit-governance bucket.'}
              </p>
            </div>
            <div className="driver-report-section-total">{formatReportNumber(rows.length)} row(s)</div>
          </div>

          {rows.length === 0 ? (
            <div className="msg good-news">No records match this permit filter right now.</div>
          ) : isHistoricalFilter ? (
            <div className="report-table-wrap permit-governance-table-wrap">
              <table className="driver-report-table permit-governance-table permit-history-table">
                <thead>
                  <tr>
                    <th>BOL</th>
                    <th>Delivery</th>
                    <th>Customer</th>
                    <th>Operator</th>
                    <th>Truck</th>
                    <th>Route</th>
                    <th>Actual Permit Cost</th>
                    <th>Folder</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((load, index) => (
                    <tr
                      key={`${load.BOL || load.BidID || load.id || index}-${index}`}
                      className="report-clickable-row"
                      onClick={() => setSelectedPermitHistoryLoad(load)}
                      title="Open permit history detail"
                    >
                      <td>{load.BOL || '-'}</td>
                      <td>{load.DeliveryDateDisplay || formatDateOnly(load.DeliveryDate)}</td>
                      <td>{load.Customer || '-'}</td>
                      <td>{load.Operator || load.OperatorTeam || '-'}</td>
                      <td>{load.Truck || '-'}</td>
                      <td>{load.Route || [load.OriginST, load.DestST].filter(Boolean).join(' to ') || '-'}</td>
                      <td>{load.HasActualPermitCost ? formatReportMoney(load.ActualPermitCost) : <span className="muted-table-note">Not mapped</span>}</td>
                      <td>
                        {load.PermitFolderFound ? (
                          <button
                            type="button"
                            className="view-button compact-action-button"
                            onClick={(event) => openPermitReportFolder(load, event)}
                          >
                            Open Folder
                          </button>
                        ) : (
                          <span className="muted-table-note">Not found</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="report-table-wrap permit-governance-table-wrap">
              <table className="driver-report-table permit-governance-table">
                <thead>
                  <tr>
                    <th>BOL</th>
                    <th>Operator</th>
                    <th>Truck</th>
                    <th>Customer</th>
                    <th>Pickup</th>
                    <th>Delivery</th>
                    <th>Route</th>
                    <th>Permit Estimate</th>
                    <th>Folder Status</th>
                    <th>Folder</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((load, index) => (
                    <tr
                      key={`${load.BOL || load.BidID || load.id || index}-${index}`}
                      className={load.id ? 'report-clickable-row' : ''}
                      onClick={() => openReportLoadDetails(load)}
                      title={load.id ? 'Open full order screen' : ''}
                    >
                      <td>{load.BOL || '-'}</td>
                      <td>{load.Operator || load.OperatorTeam || '-'}</td>
                      <td>{load.Truck || '-'}</td>
                      <td>{load.Customer || '-'}</td>
                      <td>{load.PickupDateDisplay || formatDateOnly(load.PickupDate)}</td>
                      <td>{load.DeliveryDateDisplay || formatDateOnly(load.DeliveryDate)}</td>
                      <td>{load.Route || [load.OriginST, load.DestST].filter(Boolean).join(' to ') || '-'}</td>
                      <td>{formatReportMoney(load.PermitEstimate)}</td>
                      <td>{getPermitFolderStatus(load)}</td>
                      <td>
                        {load.PermitFolderFound ? (
                          <button
                            type="button"
                            className="view-button compact-action-button"
                            onClick={(event) => openPermitReportFolder(load, event)}
                          >
                            Open Folder
                          </button>
                        ) : (
                          <span className="muted-table-note">Not found</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  }


  function PermitHistoryDetailModal() {
    const load = selectedPermitHistoryLoad;

    if (!load) return null;

    const route = load.Route || [load.OriginST, load.DestST].filter(Boolean).join(' to ') || '-';
    const dimensions = load.DimensionsDisplay || [load.Length, load.Width, load.Height].filter(Boolean).join(' × ') || '-';

    function openFullOrderFromPermitHistory() {
      if (!load?.id) return;

      setPermitHistoryOrderReturnLoad(load);
      setSelectedPermitHistoryLoad(null);
      loadDetails(load.id, 'basic', load.SourceListId || '', { returnLabel: 'Historical Permitted Loads' });
    }

    return (
      <div className="modal-overlay report-modal-overlay permit-history-detail-overlay" onClick={closePermitHistoryDetailModal}>
        <div className="detail-modal permit-history-detail-modal" onClick={(e) => e.stopPropagation()}>
          <div className="detail-header report-modal-header">
            <div>
              <h2>{load.BOL || 'Permit History Detail'}</h2>
              <p>{load.Customer || '-'} · {load.Operator || load.OperatorTeam || '-'} · Delivered {load.DeliveryDateDisplay || formatDateOnly(load.DeliveryDate)}</p>
            </div>

            <button className="close-button" onClick={closePermitHistoryDetailModal}>
              Close
            </button>
          </div>

          <div className="modal-body report-modal-body">
            <div className="permit-history-detail-grid">
              <div className="detail-item">
                <span>Customer</span>
                <strong>{load.Customer || '-'}</strong>
              </div>
              <div className="detail-item">
                <span>Operator / Team</span>
                <strong>{load.Operator || load.OperatorTeam || '-'}</strong>
              </div>
              <div className="detail-item">
                <span>Truck</span>
                <strong>{load.Truck || '-'}</strong>
              </div>
              <div className="detail-item">
                <span>Route</span>
                <strong>{route}</strong>
              </div>

              <div className="detail-item wide">
                <span>Freight Description</span>
                <strong>{load.FreightDescription || '-'}</strong>
              </div>
              <div className="detail-item">
                <span>Dimensions</span>
                <strong>{dimensions}</strong>
              </div>
              <div className="detail-item">
                <span>Actual Permit Cost</span>
                <strong>{load.HasActualPermitCost ? formatReportMoney(load.ActualPermitCost) : '-'}</strong>
                {!load.HasActualPermitCost && (
                  <small>Actual permit cost was not found in the mapped Bid Listing fields.</small>
                )}
              </div>

              <div className="detail-item">
                <span>Permit Estimate</span>
                <strong>{formatReportMoney(load.PermitEstimate)}</strong>
              </div>
              <div className="detail-item">
                <span>Pickup</span>
                <strong>{load.PickupDateDisplay || formatDateOnly(load.PickupDate)}</strong>
              </div>
              <div className="detail-item">
                <span>Delivery</span>
                <strong>{load.DeliveryDateDisplay || formatDateOnly(load.DeliveryDate)}</strong>
              </div>
              <div className="detail-item permit-history-folder-action">
                <span>Permit Folder</span>
                {load.PermitFolderFound ? (
                  <button
                    type="button"
                    className="view-button compact-action-button"
                    onClick={(event) => openPermitReportFolder(load, event)}
                  >
                    Open Permit Folder
                  </button>
                ) : (
                  <strong>Not found</strong>
                )}
              </div>
            </div>

            <div className="permit-history-detail-actions">
              <button
                type="button"
                className="view-button"
                onClick={openFullOrderFromPermitHistory}
                disabled={!load?.id}
              >
                Open Full Order Details
              </button>
              <span>Opens the normal order detail card from Bid Listing.</span>
            </div>
          </div>
        </div>
      </div>
    );
  }


  function DriverRosterReportTable({ rows = [], inactive = false }) {
    return (
      <div className="report-table-wrap">
        <table className={`driver-report-table ${inactive ? 'inactive-driver-roster-table' : 'active-driver-roster-table'}`}>
          <thead>
            <tr>
              <th>Driver / TMS Name</th>
              <th>Truck</th>
              <th>Phone</th>
              <th>Email</th>
              <th>Equipment</th>
              <th>Start Date</th>
              {inactive && <th>Term Date</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((roster, index) => (
              <tr
                key={`${roster.id || roster.truck || roster.tmsName || index}-${index}`}
                className="report-clickable-row"
                onClick={() => openRosterFromReport(roster)}
                title="Open driver roster details"
              >
                <td>{getRosterDisplayName(roster)}</td>
                <td>{roster.truck || '-'}</td>
                <td>{formatPhone(roster.cellPhone1) || '-'}</td>
                <td><EmailLink email={roster.emailAddress1} /></td>
                <td>{[roster.soloOrTeam, roster.trailerType].filter(Boolean).join(' / ') || '-'}</td>
                <td>{formatRosterDate(roster.startDate)}</td>
                {inactive && <td>{formatRosterDate(roster.termDate)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function ActiveDriverRosterPreview() {
    const rows = activeDriverRosterReport?.rows || [];

    if (!activeDriverRosterReport) return null;

    return (
      <div className="driver-report-preview modal-report-preview">
        <div className="driver-report-generated">
          Generated: {activeDriverRosterReport.generatedAt}
        </div>

        <div className="report-kpi-grid driver-roster-kpi-grid">
          <div className="report-kpi-card">
            <span>Active Drivers</span>
            <strong>{formatReportNumber(activeDriverRosterReport.count)}</strong>
          </div>
          <div className="report-kpi-card">
            <span>Source</span>
            <strong>Driver Roster</strong>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="msg">No active drivers were found in the Driver Roster.</div>
        ) : (
          <DriverRosterReportTable rows={rows} />
        )}
      </div>
    );
  }

  function FleetEquipmentPreview() {
    const rows = fleetEquipmentReport?.rows || [];

    if (!fleetEquipmentReport) return null;

    const isAllFleetEquipment = fleetEquipmentReport.status === 'all';
    const scopeLabel = fleetEquipmentReport.status === 'inactive'
      ? 'Inactive'
      : isAllFleetEquipment
        ? 'All'
        : 'Active';

    return (
      <div className="driver-report-preview modal-report-preview">
        <div className="driver-report-generated">
          Generated: {fleetEquipmentReport.generatedAt}
        </div>

        <div className="report-kpi-grid fleet-equipment-kpi-grid">
          <div className="report-kpi-card">
            <span>Report Scope</span>
            <strong>{scopeLabel}</strong>
          </div>
          <div className="report-kpi-card">
            <span>Equipment Rows</span>
            <strong>{formatReportNumber(fleetEquipmentReport.count)}</strong>
          </div>
          {isAllFleetEquipment && (
            <>
              <div className="report-kpi-card">
                <span>Active Drivers</span>
                <strong>{formatReportNumber(fleetEquipmentReport.activeCount)}</strong>
              </div>
              <div className="report-kpi-card">
                <span>Inactive Drivers</span>
                <strong>{formatReportNumber(fleetEquipmentReport.inactiveCount)}</strong>
              </div>
            </>
          )}
          <div className="report-kpi-card">
            <span>Source</span>
            <strong>Driver Roster</strong>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="msg">No fleet equipment rows matched this report scope.</div>
        ) : (
          <div className="report-table-wrap">
            <table className="driver-report-table fleet-equipment-table">
              <thead>
                <tr>
                  <th>Driver / TMS Name</th>
                  <th>Truck</th>
                  {isAllFleetEquipment && <th>Status</th>}
                  <th>Equipment</th>
                  <th>Tractor</th>
                  <th>Trailer</th>
                  <th>Weight / Length</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((roster, index) => (
                  <tr
                    key={`${roster.id || roster.truck || roster.tmsName || index}-${index}`}
                    className="report-clickable-row"
                    onClick={() => openRosterFromReport(roster)}
                    title="Open driver roster details"
                  >
                    <td>{getRosterDisplayName(roster)}</td>
                    <td>{roster.truck || '-'}</td>
                    {isAllFleetEquipment && <td>{roster.statusLabel || roster.status || '-'}</td>}
                    <td>{roster.equipmentLabel || [roster.soloOrTeam, roster.trailerType].filter(Boolean).join(' / ') || '-'}</td>
                    <td>
                      <strong>{[roster.tractorYear, roster.tractorMake].filter(Boolean).join(' ') || '-'}</strong>
                      <small>{[roster.tractorPlate && `Plate ${roster.tractorPlate}`, roster.tractorOwner && `Owner ${roster.tractorOwner}`].filter(Boolean).join(' · ')}</small>
                    </td>
                    <td>
                      <strong>{[roster.trailerUnitNumber && `Unit ${roster.trailerUnitNumber}`, roster.trailerLength && `${roster.trailerLength} ft`, roster.trailerYear, roster.trailerMake].filter(Boolean).join(' · ') || '-'}</strong>
                      <small>{[roster.trailerPlate && `Plate ${roster.trailerPlate}`, roster.trailerOwner && `Owner ${roster.trailerOwner}`].filter(Boolean).join(' · ')}</small>
                    </td>
                    <td>{[roster.registeredWeight && `Reg ${roster.registeredWeight}`, roster.emptyWeight && `Empty ${roster.emptyWeight}`, roster.overallLength && `OAL ${roster.overallLength}`].filter(Boolean).join(' / ') || '-'}</td>
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
          <DriverRosterReportTable rows={rows} inactive />
        )}
      </div>
    );
  }


  function OnThisDayPreview() {
    const groups = onThisDayReport?.yearGroups || [];
    const summary = onThisDayReport?.summary || {};
    const warnings = onThisDayReport?.warnings || [];

    if (!onThisDayReport) return null;

    const isComparisonMode = onThisDayReport?.mode === 'across';
    const isTonuMovement = (row = {}) => String(row.StatusRaw || row.Status || '').trim().toLowerCase() === 'tonu';
    const formatBidAssignment = (value) => String(value || '').trim() || 'Not assigned';
    const formatBidDateValue = (value) => String(value || '').trim() ? formatDateOnly(value) : 'Not set';

    const getSummaryMetricCards = (sourceSummary = {}) => ([
      { key: 'pickups', label: 'Pickups', value: sourceSummary.pickups || 0 },
      { key: 'deliveries', label: 'Deliveries', value: sourceSummary.deliveries || 0 },
      { key: 'bidRecords', label: 'Bid Records', value: sourceSummary.ordersWon || 0 },
      { key: 'uploads', label: 'Job Uploads', value: sourceSummary.uploads || 0 },
      { key: 'driversOff', label: 'Drivers Off', value: sourceSummary.driversOff || 0 },
      { key: 'noAvailability', label: 'No Availability', value: sourceSummary.noAvailability || 0 },
      { key: 'availableTrucks', label: 'Available Posted', value: sourceSummary.availableTrucks || 0 }
    ]);

    const getComparisonYearSubLabel = (group = {}) => {
      const rawLabel = String(group.label || '').trim();
      const year = String(group.year || '').trim();
      if (!rawLabel) return onThisDayReport?.targetLabel || '';
      if (!year) return rawLabel;
      return rawLabel.replace(new RegExp(`,?\s*${year}$`), '').trim() || rawLabel;
    };

    const getGroupSummaryPills = (group = {}) => ([
      { label: 'Pickups', value: group.summary?.pickups || 0, className: 'pickup' },
      { label: 'Deliveries', value: group.summary?.deliveries || 0, className: 'delivery' },
      { label: 'Bid Records', value: group.summary?.ordersWon || 0, className: 'bid' },
      { label: 'Uploads', value: group.summary?.uploads || 0, className: 'upload' },
      { label: 'Drivers Off', value: group.summary?.driversOff || 0, className: 'off' }
    ]);

    function renderMovementRows(rows = [], dateType = 'pickup') {
      if (!rows.length) return <div className="msg">No {dateType === 'pickup' ? 'pickups' : 'deliveries'} found.</div>;

      const hasTonuRows = rows.some(isTonuMovement);

      return (
        <div className="report-table-wrap on-this-day-table-wrap">
          <table className="driver-report-table on-this-day-table">
            <thead>
              <tr>
                <th>BOL</th>
                <th>Customer</th>
                <th>Driver / TMS Name</th>
                <th>Truck</th>
                <th>Origin</th>
                <th>Destination</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const isTonu = isTonuMovement(row);

                return (
                  <tr
                    key={`${dateType}-${row.id || row.BOL || row.BidID || index}-${index}`}
                    className={`${row.id ? 'report-clickable-row' : ''}${isTonu ? ' on-this-day-tonu-row' : ''}`.trim()}
                    onClick={() => row.id && loadDetails(row.id, 'basic', row.SourceListId)}
                    title={row.id ? 'Open full order screen' : ''}
                  >
                    <td>
                      {row.BOL || '-'}
                      {isTonu && <span className="on-this-day-tonu-marker" title="TONU shipment">*</span>}
                    </td>
                    <td>{row.Customer || '-'}</td>
                    <td>{row.Driver || '-'}</td>
                    <td>{row.Truck || '-'}</td>
                    <td>{row.Origin || '-'}</td>
                    <td>{row.Destination || '-'}</td>
                    <td>{dateType === 'pickup' ? row.PickupTime || '-' : row.DeliveryTime || '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {hasTonuRows && <div className="on-this-day-tonu-note">* TONU shipment</div>}
        </div>
      );
    }

    function renderBidRecordRows(rows = []) {
      if (!rows.length) return <div className="msg">No bid listing records were created.</div>;

      return (
        <div className="report-table-wrap on-this-day-table-wrap">
          <table className="driver-report-table on-this-day-table">
            <thead>
              <tr>
                <th>BOL / BidID</th>
                <th>Status</th>
                <th>Customer</th>
                <th>Driver / TMS Name</th>
                <th>Truck</th>
                <th>Pickup</th>
                <th>Delivery</th>
                <th>Quote</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr
                  key={`bid-created-${row.id || row.BOL || row.BidID || index}-${index}`}
                  className={row.id ? 'report-clickable-row' : ''}
                  onClick={() => row.id && loadDetails(row.id, 'basic', row.SourceListId)}
                  title={row.id ? 'Open full order screen' : ''}
                >
                  <td>{row.BOL || row.BidID || '-'}</td>
                  <td><span className={getStatusClass(row.Status)}>{row.Status || '-'}</span></td>
                  <td>{row.Customer || '-'}</td>
                  <td>{formatBidAssignment(row.Driver)}</td>
                  <td>{formatBidAssignment(row.Truck)}</td>
                  <td>{formatBidDateValue(row.PickupDateKey || row.PickupDate)}</td>
                  <td>{formatBidDateValue(row.DeliveryDateKey || row.DeliveryDate)}</td>
                  <td>{formatMoney(row.QuotedTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    function renderUploadRows(rows = []) {
      if (!rows.length) return <div className="msg">No job upload activity found.</div>;

      return (
        <div className="report-table-wrap on-this-day-table-wrap">
          <table className="driver-report-table on-this-day-table">
            <thead>
              <tr>
                <th>BOL</th>
                <th>Driver</th>
                <th>Upload Type</th>
                <th>Uploaded</th>
                <th>Folder</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`upload-${row.id || row.BOLNumber || index}-${index}`}>
                  <td>{row.BOLNumber || '-'}</td>
                  <td>{row.DriverName || '-'}</td>
                  <td>{row.UploadType || '-'}</td>
                  <td>{row.UploadDateDisplay || formatDateOnly(row.UploadDate)}</td>
                  <td>
                    <button
                      type="button"
                      className="table-link-button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openUploadDigestLoadPhotos(row);
                      }}
                      disabled={!row.BOLNumber || documentLoading === `upload-digest-loadphotos-${row.id || row.BOLNumber}`}
                    >
                      {documentLoading === `upload-digest-loadphotos-${row.id || row.BOLNumber}`
                        ? 'Opening...'
                        : `${row.UploadType || 'Open'} Folder`}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    function renderDriversOffRows(rows = []) {
      if (!rows.length) return <div className="msg">No driver time-off records found.</div>;

      return (
        <div className="report-table-wrap on-this-day-table-wrap">
          <table className="driver-report-table on-this-day-table">
            <thead>
              <tr>
                <th>Driver</th>
                <th>Truck</th>
                <th>Start</th>
                <th>End</th>
                <th>Reason</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`off-${row.id || row.recordNumber || index}-${index}`}>
                  <td>{row.operatorName || '-'}</td>
                  <td>{row.truckNumber || '-'}</td>
                  <td>{formatDateOnly(row.startDate)}</td>
                  <td>{formatDateOnly(row.endDate)}</td>
                  <td>{row.reason || '-'}</td>
                  <td>{row.status || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    function renderNoAvailabilityRows(rows = []) {
      if (!rows.length) return <div className="msg">No no-availability records found.</div>;

      return (
        <div className="report-table-wrap on-this-day-table-wrap">
          <table className="driver-report-table on-this-day-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Requestor</th>
                <th>Pickup</th>
                <th>Delivery</th>
                <th>Type</th>
                <th>Miles</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`na-${row.id || row.company || index}-${index}`}>
                  <td>{row.company || '-'}</td>
                  <td>{row.requestor || '-'}</td>
                  <td>{row.pickupLocation || '-'}</td>
                  <td>{row.deliveryLocation || '-'}</td>
                  <td>{row.shipmentType || '-'}</td>
                  <td>{formatReportNumber(row.totalMiles)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    function renderAvailableTruckRows(rows = []) {
      if (!rows.length) return <div className="msg">No available-truck postings found.</div>;

      return (
        <div className="report-table-wrap on-this-day-table-wrap">
          <table className="driver-report-table on-this-day-table">
            <thead>
              <tr>
                <th>Driver</th>
                <th>Truck</th>
                <th>Equipment</th>
                <th>Current Location</th>
                <th>Time of Day</th>
                <th>Proximity</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`avail-${row.id || row.unitNo || index}-${index}`}>
                  <td>{row.driverName || '-'}</td>
                  <td>{row.unitNo || '-'}</td>
                  <td>{row.equipmentType || '-'}</td>
                  <td>{row.currentLocation || '-'}</td>
                  <td>{row.timeOfDay || '-'}</td>
                  <td>{row.proximitySummary || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    return (
      <div className="driver-report-preview modal-report-preview on-this-day-preview">
        {isComparisonMode ? (
          <div className="on-this-day-comparison-kpi-stack">
            {groups.map((group) => (
              <div key={`comparison-kpi-${group.year}`} className="on-this-day-comparison-kpi-row">
                <div className="on-this-day-comparison-year-card">
                  <span>Year</span>
                  <strong>{group.year || '-'}</strong>
                  <small>{getComparisonYearSubLabel(group)}</small>
                </div>
                {getSummaryMetricCards(group.summary).map((card) => (
                  <div key={`${group.year}-${card.key}`} className="report-kpi-card on-this-day-comparison-metric-card">
                    <span>{card.label}</span>
                    <strong>{formatReportNumber(card.value)}</strong>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="report-kpi-grid on-this-day-kpi-grid">
            {getSummaryMetricCards(summary).map((card) => (
              <div key={card.key} className="report-kpi-card">
                <span>{card.label}</span>
                <strong>{formatReportNumber(card.value)}</strong>
              </div>
            ))}
          </div>
        )}

        {warnings.length > 0 && (
          <div className="report-alert locked on-this-day-warning-card">
            <h4>Some sources reported warnings.</h4>
            {warnings.slice(0, 4).map((warning, index) => (
              <p key={`${warning.source || 'source'}-${index}`}><strong>{warning.source || 'Source'}:</strong> {warning.message || 'Unable to load source.'}</p>
            ))}
          </div>
        )}

        {groups.length === 0 ? (
          <div className="msg">No activity was found for this date.</div>
        ) : (
          groups.map((group) => (
            <div key={group.year} className="on-this-day-year-block">
              <div className="driver-report-section-header on-this-day-year-header">
                <div>
                  <h4>{group.label || group.year}</h4>
                  <div className="on-this-day-summary-pills">
                    {getGroupSummaryPills(group).map((pill) => (
                      <span key={`${group.year}-${pill.label}`} className={`on-this-day-summary-pill ${pill.className}`}>
                        <strong>{formatReportNumber(pill.value)}</strong> {pill.label}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="on-this-day-section">
                <h5>Pickups</h5>
                {renderMovementRows(group.pickups, 'pickup')}
              </div>

              <div className="on-this-day-section">
                <h5>Deliveries</h5>
                {renderMovementRows(group.deliveries, 'delivery')}
              </div>

              <div className="on-this-day-section">
                <h5>Bid Listing Records Created</h5>
                {renderBidRecordRows(group.ordersWon)}
              </div>

              <div className="on-this-day-section">
                <h5>Job Upload Activity</h5>
                {renderUploadRows(group.uploads)}
              </div>

              <div className="on-this-day-section">
                <h5>Drivers Off</h5>
                {renderDriversOffRows(group.driversOff)}
              </div>

              <div className="on-this-day-section">
                <h5>No Availability</h5>
                {renderNoAvailabilityRows(group.noAvailability)}
              </div>

              <div className="on-this-day-section">
                <h5>Available Trucks Posted</h5>
                {renderAvailableTruckRows(group.availableTrucks)}
              </div>
            </div>
          ))
        )}
      </div>
    );
  }

  function NoAvailabilityPreview() {
    const rows = noAvailabilityReport?.rows || [];
    const summary = noAvailabilityReport?.summary || {};
    const analytics = noAvailabilityReport?.analytics || {};
    const insights = noAvailabilityReport?.insights || [];
    const yearBreakdown = noAvailabilityReport?.yearBreakdown || [];
    const topCustomers = analytics.topCustomers || [];
    const topCityStates = analytics.topCityStates || [];
    const topMonths = analytics.topMonths || [];
    const topLanes = analytics.topLanes || [];
    const topRequestors = analytics.topRequestors || [];
    const shipmentTypes = analytics.shipmentTypes || [];

    if (!noAvailabilityReport) return null;

    function formatNoAvailabilityPercent(value) {
      return `${formatReportNumber(Number(value || 0) * 100, 1)}%`;
    }

    function renderNoAvailabilityPatternList(title, subtitle, items, getLabel, getMeta, emptyText = 'No pattern data available.') {
      const maxCount = Math.max(1, ...items.map((item) => Number(item.count || 0)));

      return (
        <div className="no-availability-pattern-card">
          <div className="no-availability-pattern-card-header">
            <div>
              <h4>{title}</h4>
              {subtitle && <p>{subtitle}</p>}
            </div>
          </div>

          {items.length === 0 ? (
            <div className="no-availability-empty-pattern">{emptyText}</div>
          ) : (
            <div className="no-availability-pattern-list">
              {items.map((item, index) => {
                const width = Math.max(7, Math.round((Number(item.count || 0) / maxCount) * 100));

                return (
                  <div className="no-availability-pattern-row" key={`${title}-${getLabel(item)}-${index}`}>
                    <div className="no-availability-pattern-rank">#{index + 1}</div>
                    <div className="no-availability-pattern-main">
                      <div className="no-availability-pattern-topline">
                        <strong>{getLabel(item) || '-'}</strong>
                        <span>{formatReportNumber(item.count)} hit(s)</span>
                      </div>
                      <div className="no-availability-pattern-meta">{getMeta(item)}</div>
                      <div className="no-availability-bar-track" aria-hidden="true">
                        <div className="no-availability-bar-fill" style={{ width: `${width}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="driver-report-preview modal-report-preview no-availability-preview">
        <div className="driver-report-generated no-availability-generated-row">
          <span>Generated: {noAvailabilityReport.generatedAt}</span>
          <button
            type="button"
            className="pdf-export-button compact no-availability-export-button"
            onClick={downloadNoAvailabilityTopPdf}
            disabled={noAvailabilityPdfLoading || noAvailabilityLoading}
          >
            {noAvailabilityPdfLoading ? 'Exporting...' : 'Export Top PDF'}
          </button>
        </div>

        {getPdfExportNotice('noAvailabilityTop') && (
          <div className="pdf-export-success no-availability-export-success">{getPdfExportNotice('noAvailabilityTop')}</div>
        )}

        {noAvailabilityPdfError && (
          <div className="msg error pdf-export-error">{noAvailabilityPdfError}</div>
        )}

        <div className="report-kpi-grid no-availability-kpi-grid">
          <div className="report-kpi-card">
            <span>No Availability</span>
            <strong>{formatReportNumber(summary.totalNoAvailability)}</strong>
            <small>{formatReportNumber(summary.uniqueCustomers)} customer(s) · {formatReportNumber(summary.uniqueCityStates)} city/state(s)</small>
          </div>
          <div className="report-kpi-card">
            <span>Top City/State</span>
            <strong>{summary.topCityState || '-'}</strong>
            {summary.topCityStateCount > 0 && (
              <small>{formatReportNumber(summary.topCityStateCount)} endpoint hit(s) · {formatReportNumber(summary.topCityStatePickupCount)} pickup / {formatReportNumber(summary.topCityStateDeliveryCount)} delivery</small>
            )}
          </div>
          <div className="report-kpi-card">
            <span>Top Customer</span>
            <strong>{summary.topCustomer || '-'}</strong>
            {summary.topCustomerCount > 0 && <small>{formatReportNumber(summary.topCustomerCount)} request(s) · {formatNoAvailabilityPercent(summary.topCustomerShare)}</small>}
          </div>
          <div className="report-kpi-card">
            <span>Highest Month</span>
            <strong>{summary.highestMonth || '-'}</strong>
            {summary.highestMonthCount > 0 && <small>{formatReportNumber(summary.highestMonthCount)} request(s) · {formatReportNumber(summary.highestMonthMiles)} mi</small>}
          </div>
          <div className="report-kpi-card">
            <span>Missed Miles</span>
            <strong>{formatReportNumber(summary.totalMissedMiles)}</strong>
            <small>{formatReportNumber(summary.averageMissedMiles)} avg mi / request</small>
          </div>
          <div className="report-kpi-card">
            <span>Most Recent</span>
            <strong>{formatDateOnly(summary.mostRecentSolicitDate)}</strong>
            <small>By solicit date</small>
          </div>
        </div>

        {insights.length > 0 && (
          <div className="driver-report-section no-availability-insight-section">
            <div className="driver-report-section-header">
              <div>
                <h4>Pattern Watch</h4>
                </div>
            </div>

            <div className="no-availability-insight-grid">
              {insights.map((insight, index) => (
                <div className={`no-availability-insight-card ${insight.tone || 'neutral'}`} key={`${insight.title || 'insight'}-${index}`}>
                  <span>{insight.title}</span>
                  <strong>{insight.value || '-'}</strong>
                  <p>{insight.detail}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="no-availability-pattern-grid">
          {renderNoAvailabilityPatternList(
            'Top 5 City/States',
            'Pickup and delivery endpoint appearances combined.',
            topCityStates,
            (item) => item.cityState,
            (item) => `${formatNoAvailabilityPercent(item.percentage)} of endpoint hits · ${formatReportNumber(item.pickupCount)} pickup / ${formatReportNumber(item.deliveryCount)} delivery · ${formatReportNumber(item.uniqueCustomers)} customer(s)`
          )}

          {renderNoAvailabilityPatternList(
            'Top 5 Customers',
            'Customers creating the most uncovered opportunities.',
            topCustomers,
            (item) => item.customer,
            (item) => `${formatNoAvailabilityPercent(item.percentage)} of report · ${formatReportNumber(item.miles)} missed mi`
          )}

          {renderNoAvailabilityPatternList(
            'Highest Months',
            'Months ranked by no availability count.',
            topMonths,
            (item) => item.monthLabel,
            (item) => `${formatNoAvailabilityPercent(item.percentage)} of report · ${formatReportNumber(item.uniqueCustomers)} customer(s) · ${formatReportNumber(item.uniqueCityStates)} city/state(s)`
          )}

          {renderNoAvailabilityPatternList(
            'Repeating Lanes',
            'Origin-to-destination pairs that repeat.',
            topLanes,
            (item) => item.lane,
            (item) => `${formatNoAvailabilityPercent(item.percentage)} of report · ${formatReportNumber(item.miles)} missed mi · ${formatReportNumber(item.uniqueCustomers)} customer(s)`,
            'No repeated pickup/delivery lane was found.'
          )}

          {renderNoAvailabilityPatternList(
            'Requestors',
            'Who is tied to the most no availability records.',
            topRequestors,
            (item) => item.requestor,
            (item) => `${formatNoAvailabilityPercent(item.percentage)} of report · ${formatReportNumber(item.uniqueCustomers)} customer(s)`
          )}

          {renderNoAvailabilityPatternList(
            'Shipment Types',
            'Equipment or shipment categories that show up most often.',
            shipmentTypes,
            (item) => item.shipmentType,
            (item) => `${formatNoAvailabilityPercent(item.percentage)} of report · ${formatReportNumber(item.miles)} missed mi`
          )}
        </div>

        {summary.duplicateRowsRemoved > 0 && (
          <div className="no-availability-note-card">
            Removed {formatReportNumber(summary.duplicateRowsRemoved)} likely duplicate row(s) where the main list and archive list overlapped.
          </div>
        )}

        {noAvailabilityReport.failedLists?.length > 0 && (
          <div className="report-alert error">
            <h4>Some No Availability source lists could not be loaded.</h4>
            {noAvailabilityReport.failedLists.map((entry, index) => (
              <p key={`${entry.sourceLabel || 'source'}-${index}`}>{entry.sourceLabel}: {entry.error}</p>
            ))}
          </div>
        )}

        {yearBreakdown.length > 0 && (
          <div className="driver-report-section no-availability-year-section">
            <div className="driver-report-section-header">
              <div>
                <h4>Year Context</h4>
               
              </div>
            </div>

            <div className="no-availability-year-strip">
              {yearBreakdown.map((entry) => (
                <div key={entry.year}>
                  <span>{entry.year}</span>
                  <strong>{formatReportNumber(entry.count)}</strong>
                  <small>{formatReportNumber(entry.miles)} mi · {formatReportNumber(entry.uniqueCustomers)} customer(s) · {formatReportNumber(entry.uniqueCityStates)} city/state(s)</small>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="driver-report-section no-availability-log-section">
          <div className="driver-report-section-header">
            <div>
              <h4>Raw No Availability Log</h4>
              
            </div>
            <div className="driver-report-section-total">{formatReportNumber(rows.length)} row(s)</div>
          </div>

          {rows.length === 0 ? (
            <div className="msg">No records matched this No Availability report window.</div>
          ) : (
            <div className="report-table-wrap">
              <table className="driver-report-table no-availability-table">
                <thead>
                  <tr>
                    <th>Solicit Date</th>
                    <th>Company</th>
                    <th>Requestor</th>
                    <th>Pickup</th>
                    <th>Delivery</th>
                    <th>Type</th>
                    <th>Miles</th>
                    <th>Year</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={`${row.SourceListId || row.sourceLabel}-${row.id || index}-${index}`}>
                      <td>{formatDateOnly(row.solicitDate)}</td>
                      <td>{row.company || '-'}</td>
                      <td>{row.requestor || '-'}</td>
                      <td>{row.pickupCityState || row.pickupLocation || '-'}</td>
                      <td>{row.deliveryCityState || row.deliveryLocation || '-'}</td>
                      <td>{row.shipmentType || '-'}</td>
                      <td>{formatReportNumber(row.totalMiles)}</td>
                      <td>{row.reportYear || '-'}</td>
                      <td>{row.sourceLabel || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  }


  function DriverTimeOffCurrentPanel() {
    const currentRecords = getDriverTimeOffCurrentRecords();
    const recentlyEndedRecords = getDriverTimeOffRecentlyEndedRecords();
    const upcomingRecords = getDriverTimeOffUpcomingRecords();
    const activePane = driverTimeOffPaneFilter || 'current';
    const records = getDriverTimeOffPanelRows(activePane);
    const warning = operationsData?.driverTimeOff?.warning || '';
    const targetDate = operationsData?.driverTimeOff?.targetDate || getEasternDateInputValue();

    function getDateInputDayDiff(startDate, endDate) {
      const startValue = String(startDate || '').slice(0, 10);
      const endValue = String(endDate || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startValue) || !/^\d{4}-\d{2}-\d{2}$/.test(endValue)) return null;

      const startTime = new Date(`${startValue}T00:00:00Z`).getTime();
      const endTime = new Date(`${endValue}T00:00:00Z`).getTime();
      if (Number.isNaN(startTime) || Number.isNaN(endTime)) return null;

      return Math.round((endTime - startTime) / 86400000);
    }

    function getDriverTimeOffReasonKey(record = {}) {
      const reason = String(record.reason || '').toLowerCase();
      if (record.displayBucket === 'recently-ended') return 'recently-ended';
      if (record.displayBucket === 'starting-soon') return 'starting-soon';
      if (reason.includes('repair')) return 'repairs';
      if (reason.includes('home')) return 'home-time';
      if (reason.includes('suspend')) return 'suspended';
      return 'other';
    }

    function getDriverTimeOffReasonTitle(reasonKey) {
      if (reasonKey === 'home-time') return 'Home Time';
      if (reasonKey === 'repairs') return 'Repairs';
      if (reasonKey === 'suspended') return 'Suspended';
      if (reasonKey === 'recently-ended') return 'Ended Recently';
      if (reasonKey === 'starting-soon') return 'Starting Soon';
      return 'Other Time Off';
    }

    function getDriverTimeOffReturnLabel(record = {}) {
      if (record.displayBucket === 'recently-ended') return getDriverTimeOffEndedLabel(record);
      if (record.displayBucket === 'starting-soon') return getDriverTimeOffStartsLabel(record);

      const endDate = String(record.endDate || record.startDate || '').slice(0, 10);
      const daysUntilReturn = getDateInputDayDiff(targetDate, endDate);

      if (daysUntilReturn === 0) return 'Returns today';
      if (daysUntilReturn === 1) return 'Returns tomorrow';
      if (Number.isFinite(daysUntilReturn) && daysUntilReturn > 1) return `Returns in ${daysUntilReturn} days`;

      return endDate ? `Returns ${formatDateOnly(endDate)}` : 'Return unknown';
    }

    function getDriverTimeOffCardStatusLabel(record = {}) {
      if (record.displayBucket === 'recently-ended') return 'Status';
      if (record.displayBucket === 'starting-soon') return 'Starts';
      return 'Return';
    }

    function chooseDriverTimeOffPane(filterKey) {
      const isSamePane = filterKey === activePane;

      setDriverTimeOffPaneFilter(filterKey);
      setDriverTimeOffAccordionOpen((current) => (isSamePane ? !current : true));
    }

    const panePills = [
      { key: 'current', label: 'Current', value: currentRecords.length, detail: 'off now', tone: currentRecords.length > 0 ? 'current' : 'quiet' },
      { key: 'ended', label: 'Ended', value: recentlyEndedRecords.length, detail: 'last 7 days', tone: recentlyEndedRecords.length > 0 ? 'ended' : 'quiet' },
      { key: 'starting-soon', label: 'Starting Soon', value: upcomingRecords.length, detail: 'next 7 days', tone: upcomingRecords.length > 0 ? 'starting' : 'quiet' }
    ];

    const groupedRecords = activePane === 'starting-soon'
      ? [{ reasonKey: 'starting-soon', title: 'Starting Soon', records }]
      : activePane === 'ended'
        ? [{ reasonKey: 'recently-ended', title: 'Ended Recently', records }]
        : ['home-time', 'repairs', 'suspended', 'other']
            .map((reasonKey) => ({
              reasonKey,
              title: getDriverTimeOffReasonTitle(reasonKey),
              records: records.filter((record) => getDriverTimeOffReasonKey(record) === reasonKey)
            }))
            .filter((group) => group.records.length > 0);

    const emptyMessage = activePane === 'starting-soon'
      ? 'No driver time off is scheduled to start in the next 7 days.'
      : activePane === 'ended'
        ? 'No driver time off ended in the last 7 days.'
        : 'No drivers are currently marked off.';

    return (
      <div className={`driver-time-off-panel driver-time-off-accordion ${driverTimeOffAccordionOpen ? 'is-open' : 'is-closed'}`}>
        <div className="driver-position-header driver-time-off-header driver-time-off-accordion-header">
          <button
            type="button"
            className="driver-time-off-header-main"
            onClick={() => setDriverTimeOffAccordionOpen((current) => !current)}
            aria-expanded={driverTimeOffAccordionOpen}
          >
            <div className="driver-time-off-title-block">
              <h3>Current Driver Time Off</h3>
                </div>
          </button>

          <div className="driver-time-off-pill-lineup" aria-label="Driver time off quick filters">
            {panePills.map((pill) => (
              <button
                key={pill.key}
                type="button"
                className={`driver-time-off-lineup-pill ${pill.tone} ${activePane === pill.key ? 'is-active' : ''}`}
                onClick={() => chooseDriverTimeOffPane(pill.key)}
                title={`${driverTimeOffAccordionOpen && activePane === pill.key ? 'Hide' : 'Show'} ${pill.label.toLowerCase()} driver time off`}
                aria-expanded={driverTimeOffAccordionOpen && activePane === pill.key}
                aria-pressed={activePane === pill.key}
              >
                <span>{pill.label}</span>
                <strong>{formatReportNumber(pill.value)}</strong>
                <small>{pill.detail}</small>
              </button>
            ))}
          </div>

          <button
            type="button"
            className="driver-time-off-accordion-chevron"
            onClick={() => setDriverTimeOffAccordionOpen((current) => !current)}
            aria-label={driverTimeOffAccordionOpen ? 'Collapse Current Driver Time Off' : 'Expand Current Driver Time Off'}
            aria-expanded={driverTimeOffAccordionOpen}
          >
            {driverTimeOffAccordionOpen ? '▲' : '▼'}
          </button>
        </div>

        {driverTimeOffAccordionOpen && (
          <div className="driver-time-off-accordion-body">
            {warning && <div className="msg error">{warning}</div>}

            <div className="driver-time-off-body-toolbar">
              <div>
                <strong>{panePills.find((pill) => pill.key === activePane)?.label || 'Current'} time off</strong>
              </div>

              <div className="driver-time-off-actions">
                {activePane === 'starting-soon' && upcomingRecords.length > 0 && (
                  <button
                    type="button"
                    className="view-button secondary-action-button"
                    onClick={openFutureTimeOffQuickReport}
                    disabled={driverTimeOffLoading}
                    title="Open the Driver Time Off report preview"
                  >
                    {driverTimeOffLoading ? 'Opening...' : 'Preview Report'}
                  </button>
                )}
                <button type="button" className="view-button driver-time-off-main-add-button" onClick={() => openDriverTimeOffForm()}>
                  Add Time Off
                </button>
              </div>
            </div>

            {driverTimeOffActionMessage && <div className="msg success-message">{driverTimeOffActionMessage}</div>}
            {driverTimeOffActionError && <div className="msg error">{driverTimeOffActionError}</div>}

            {records.length === 0 ? (
              <div className="msg driver-time-off-empty-message">{emptyMessage}</div>
            ) : (
              <div className="driver-time-off-board">
                {groupedRecords.map((group) => (
                  <section className={`driver-time-off-group ${group.reasonKey}`} key={group.reasonKey}>
                    <div className="driver-time-off-group-header">
                      <div>
                        <h4>{group.title}</h4>
                        <p>
                          {group.reasonKey === 'starting-soon'
                            ? 'Scheduled to begin soon.'
                            : group.reasonKey === 'recently-ended'
                              ? 'Recently closed records available for quick correction.'
                              : 'Currently marked off.'}
                        </p>
                      </div>
                      <span>{formatReportNumber(group.records.length)}</span>
                    </div>

                    <div className="driver-time-off-card-grid">
                      {group.records.map((record) => {
                        const recentlyEnded = record.displayBucket === 'recently-ended';
                        const startingSoon = record.displayBucket === 'starting-soon';
                        const reasonKey = getDriverTimeOffReasonKey(record);
                        const recordKey = record.id || `${record.operatorName}-${record.truckNumber}-${record.startDate}-${record.endDate}`;

                        return (
                          <button
                            type="button"
                            key={recordKey}
                            className={`driver-time-off-card ${reasonKey} ${recentlyEnded ? 'recently-ended' : ''} ${startingSoon ? 'starting-soon' : ''}`}
                            onClick={() => openDriverTimeOffForm(record)}
                            title="Open this time-off record"
                          >
                            <div className="driver-time-off-card-topline">
                              <div>
                                <strong>{record.operatorName || '-'}</strong>
                                <span>{record.truckNumber ? `Truck ${record.truckNumber}` : 'Truck -'}</span>
                              </div>
                              <span className={`driver-time-off-reason-pill ${reasonKey}`}>
                                {recentlyEnded ? 'Ended' : startingSoon ? 'Starting Soon' : (record.reason || 'Time Off')}
                              </span>
                            </div>

                            <div className="driver-time-off-date-range">
                              <span>Off Window</span>
                              <strong>{formatDateOnly(record.startDate)} → {formatDateOnly(record.endDate || record.startDate)}</strong>
                            </div>

                            <div className="driver-time-off-card-facts">
                              <div>
                                <span>Days</span>
                                <strong>{formatReportNumber(record.days)}</strong>
                              </div>
                              <div>
                                <span>{getDriverTimeOffCardStatusLabel(record)}</span>
                                <strong>{getDriverTimeOffReturnLabel(record)}</strong>
                              </div>
                            </div>

                            <small>Open details / edit</small>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }


  function DriverTimeOffFormModal() {
    if (!driverTimeOffFormOpen) return null;

    const isEditing = Boolean(driverTimeOffEditingRecord?.id);
    const driverOptions = getDriverTimeOffOptions();

    return (
      <div className="modal-overlay" onClick={closeDriverTimeOffForm}>
        <div className="detail-modal driver-time-off-form-modal" onClick={(e) => e.stopPropagation()}>
          <div className="detail-header">
            <div>
              <h2>{isEditing ? 'Edit Driver Time Off' : 'Add Driver Time Off'}</h2>
            </div>
            <button className="close-button" onClick={closeDriverTimeOffForm}>Close</button>
          </div>

          <form className="modal-body driver-time-off-form" onSubmit={submitDriverTimeOff}>
            {driverTimeOffActionError && <div className="msg error">{driverTimeOffActionError}</div>}

            <div className="driver-time-off-form-grid">
              <label>
                <span>Driver</span>
                {driverOptions.length > 0 && !isEditing ? (
                  <select
                    value={driverTimeOffDraft.rosterDriverKey || ''}
                    onChange={(e) => selectDriverTimeOffRosterDriver(e.target.value)}
                    disabled={driverTimeOffSubmitting}
                  >
                    <option value="">Select active driver</option>
                    {driverOptions.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.driverName || option.unitNo || 'Unnamed driver'}{option.unitNo ? ` · ${option.unitNo}` : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={driverTimeOffDraft.operatorName || ''}
                    onChange={(e) => updateDriverTimeOffDraft('operatorName', e.target.value)}
                    placeholder="Driver / team"
                    disabled={driverTimeOffSubmitting}
                  />
                )}
              </label>

              <label>
                <span>Truck Number</span>
                <input
                  value={driverTimeOffDraft.truckNumber || ''}
                  onChange={(e) => updateDriverTimeOffDraft('truckNumber', e.target.value)}
                  placeholder="Truck #"
                  disabled={driverTimeOffSubmitting || Boolean(driverTimeOffDraft.rosterDriverKey)}
                />
              </label>

              <label>
                <span>Start Date</span>
                <input
                  type="date"
                  value={driverTimeOffDraft.startDate || ''}
                  onChange={(e) => updateDriverTimeOffDraft('startDate', e.target.value)}
                  disabled={driverTimeOffSubmitting}
                />
              </label>

              <label>
                <span>End Date</span>
                <input
                  type="date"
                  value={driverTimeOffDraft.endDate || ''}
                  onChange={(e) => updateDriverTimeOffDraft('endDate', e.target.value)}
                  disabled={driverTimeOffSubmitting}
                />
              </label>

              <label>
                <span>Reason</span>
                <select
                  value={normalizeDriverTimeOffReason(driverTimeOffDraft.reason)}
                  onChange={(e) => updateDriverTimeOffDraft('reason', e.target.value)}
                  disabled={driverTimeOffSubmitting}
                >
                  {DRIVER_TIME_OFF_REASON_OPTIONS.map((reason) => (
                    <option key={reason} value={reason}>{reason}</option>
                  ))}
                </select>
              </label>

              <label>
                <span>Status</span>
                <select
                  value={driverTimeOffDraft.status || 'Active'}
                  onChange={(e) => updateDriverTimeOffDraft('status', e.target.value)}
                  disabled={driverTimeOffSubmitting}
                >
                  <option value="Active">Active</option>
                  <option value="Cancelled">Cancelled</option>
                  <option value="Completed">Completed</option>
                </select>
              </label>
            </div>

            <div className="driver-time-off-form-actions">
              <button type="button" className="close-button" onClick={closeDriverTimeOffForm} disabled={driverTimeOffSubmitting}>
                Cancel
              </button>
              <button type="submit" disabled={driverTimeOffSubmitting}>
                {driverTimeOffSubmitting ? 'Saving...' : (isEditing ? 'Update Time Off' : 'Add Time Off')}
              </button>
            </div>

            {isEditing && getDriverTimeOffHistoryRows(driverTimeOffEditingRecord).length > 0 && (
              <div className="driver-time-off-history-card">
                <div className="driver-time-off-history-header">
                  <div>
                    <h3>Driver Time Off History</h3>
                    <p>{driverTimeOffEditingRecord?.operatorName || 'Selected driver'} · {driverTimeOffEditingRecord?.truckNumber ? `Truck ${driverTimeOffEditingRecord.truckNumber}` : 'No truck listed'}</p>
                  </div>
                  <span>{formatReportNumber(getDriverTimeOffHistoryRows(driverTimeOffEditingRecord).length)} record(s)</span>
                </div>
                <div className="report-table-wrap driver-time-off-history-table-wrap">
                  <table className="driver-report-table driver-time-off-history-table">
                    <thead>
                      <tr>
                        <th>Start</th>
                        <th>End</th>
                        <th>Reason</th>
                        <th>Status</th>
                        <th>Days</th>
                      </tr>
                    </thead>
                    <tbody>
                      {getDriverTimeOffHistoryRows(driverTimeOffEditingRecord).map((row, index) => {
                        const isFocusedHistoryRecord = Boolean(
                          driverTimeOffEditingRecord?.id && row.id && driverTimeOffEditingRecord.id === row.id
                        );

                        return (
                          <tr
                            key={`${row.id || row.recordNumber || index}-history-${index}`}
                            className={`driver-time-off-history-row ${isFocusedHistoryRecord ? 'active-history-row' : ''}`}
                            onClick={() => focusDriverTimeOffRecord(row)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                focusDriverTimeOffRecord(row);
                              }
                            }}
                            tabIndex={0}
                            title="Click to load this history record into the edit form"
                          >
                            <td>{formatDateOnly(row.startDate)}</td>
                            <td>{formatDateOnly(row.endDate)}</td>
                            <td>{row.reason || '-'}</td>
                            <td>{row.timingStatus || row.status || '-'}</td>
                            <td>{formatReportNumber(row.reportDays || row.days)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </form>
        </div>
      </div>
    );
  }

  function DriverTimeOffPreview() {
    if (!driverTimeOffReport) return null;
    const rows = driverTimeOffReport.rows || [];
    const visibleRows = getDriverTimeOffFilteredRows(rows);
    const activeFilterLabel = driverTimeOffReportFilter?.label || '';
    const displayReport = driverTimeOffReportFilter
      ? buildDriverTimeOffDisplayReport(visibleRows)
      : {
          summary: driverTimeOffReport.summary || {},
          analytics: driverTimeOffReport.analytics || {}
        };
    const summary = displayReport.summary || {};
    const analytics = displayReport.analytics || {};

    return (
      <div className="driver-report-preview driver-time-off-preview">
        {driverTimeOffReport.warning && <div className="msg error">{driverTimeOffReport.warning}</div>}
        <div className="pdf-export-guidance">PDF export includes the summary cards and analysis sections only, not the full Time Off Log.</div>
        {driverTimeOffReportFilter && (
          <div className="driver-time-off-filter-banner">
            <span>Showing {formatReportNumber(visibleRows.length)} of {formatReportNumber(rows.length)} row(s) for <strong>{activeFilterLabel}</strong>.</span>
            <button type="button" className="view-button compact-action-button" onClick={clearDriverTimeOffFilter}>Clear Filter</button>
          </div>
        )}

        <div className="report-kpi-grid driver-time-off-kpi-grid">
          <div className="report-kpi-card"><span>Events</span><strong>{formatReportNumber(summary.totalEvents)}</strong></div>
          <div className="report-kpi-card"><span>Total Days</span><strong>{formatReportNumber(summary.totalDays)}</strong></div>
          <div className="report-kpi-card"><span>Drivers</span><strong>{formatReportNumber(summary.uniqueDrivers)}</strong></div>
          <div className="report-kpi-card"><span>Current Off</span><strong>{formatReportNumber(summary.currentDriversOff)}</strong></div>
          <div className="report-kpi-card"><span>Avg Days/Event</span><strong>{formatReportNumber(summary.averageDaysPerEvent, 1)}</strong></div>
          <div className="report-kpi-card"><span>Longest</span><strong>{formatReportNumber(summary.longestEventDays)}</strong><small>{summary.longestEventDriver || '-'}</small></div>
        </div>

        <div className="driver-time-off-analysis-grid">
          {renderDriverTimeOffPatternList('By Driver', analytics.byDriver || [], (item) => `${formatReportNumber(item.events)} event(s) · ${formatReportNumber(item.days)} day(s)`, 'driver')}
          {renderDriverTimeOffPatternList('By Month', analytics.byMonth || [], (item) => `${formatReportNumber(item.events)} event(s) · ${formatReportNumber(item.days)} day(s)`, 'month')}
          {renderDriverTimeOffPatternList('By Reason', analytics.byReason || [], (item) => `${formatReportNumber(item.events)} event(s) · ${formatReportNumber(item.days)} day(s)`, 'reason')}
        </div>

        <div className="driver-report-section driver-time-off-log-section">
          <div className="driver-report-section-header">
            <div>
              <h4>Time Off Log</h4>
              <p>Click a row to edit it and view driver time-off history.</p>
            </div>
            <div className="driver-report-section-total">{formatReportNumber(visibleRows.length)} row(s)</div>
          </div>

          {visibleRows.length === 0 ? (
            <div className="msg">No time-off records matched this report year or active filter.</div>
          ) : (
            <div className="report-table-wrap">
              <table className="driver-report-table driver-time-off-report-table">
                <thead>
                  <tr>
                    <th>Driver</th>
                    <th>Truck</th>
                    <th>Start</th>
                    <th>End</th>
                    <th>Reason</th>
                    <th>Status</th>
                    <th>Days</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row, index) => (
                    <tr
                      key={`${row.id || row.recordNumber || index}-${index}`}
                      className="driver-time-off-clickable-row"
                      onClick={() => openDriverTimeOffForm(row)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          openDriverTimeOffForm(row);
                        }
                      }}
                      tabIndex={0}
                      title="Click to edit this time-off record and view driver history"
                    >
                      <td>{row.operatorName || '-'}</td>
                      <td>{row.truckNumber || '-'}</td>
                      <td>{formatDateOnly(row.startDate)}</td>
                      <td>{formatDateOnly(row.endDate)}</td>
                      <td>{row.reason || '-'}</td>
                      <td>{row.timingStatus || row.status || '-'}</td>
                      <td>{formatReportNumber(row.reportDays || row.days)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderDriverTimeOffPatternList(title, rows, detailFn, filterType = '') {
    return (
      <div className="driver-time-off-pattern-card">
        <div className="driver-time-off-pattern-header">
          <strong>{title}</strong>
          <span>{formatReportNumber(rows.length)} item(s)</span>
        </div>
        {rows.length === 0 ? (
          <div className="msg">No records.</div>
        ) : (
          <div className="driver-time-off-pattern-list">
            {rows.map((item) => {
              const isActive = Boolean(
                filterType &&
                driverTimeOffReportFilter?.type === filterType &&
                driverTimeOffReportFilter?.key === String(item.key || '')
              );

              return (
                <button
                  key={item.key || item.label}
                  type="button"
                  className={`driver-time-off-pattern-row ${filterType ? 'clickable-pattern-row' : ''} ${isActive ? 'active-pattern-row' : ''}`}
                  onClick={() => filterType && setDriverTimeOffFilter(filterType, item)}
                  disabled={!filterType}
                  title={filterType ? `Show only ${item.label || item.key || 'this group'}` : undefined}
                >
                  <strong>{item.label || item.key || 'Unknown'}</strong>
                  <span>{detailFn(item)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  function DriverPositionTrackingPanel() {
    const positions = driverPositionsData?.positions || [];

    return (
      <div className={`driver-position-panel ${driverRosterAccordionOpen ? 'is-open' : 'is-closed'}`}>
        <button
          type="button"
          className="driver-position-header driver-position-header-button"
          onClick={() => setDriverRosterAccordionOpen((current) => !current)}
          aria-expanded={driverRosterAccordionOpen}
        >
          <div>
            <h3>Active Driver Roster</h3>
              </div>

          {driverPositionsData?.counts && (
            <div className="driver-position-counts">
              <span className="driver-position-count-pill total">{driverPositionsData.counts.total} active units</span>
              <span className="driver-position-count-pill moving">{driverPositionsData.counts.moving} moving</span>
              <span className="driver-position-count-pill stale">{driverPositionsData.counts.stale} stale</span>
              {driverPositionsData.counts.missingRosterDetails > 0 && (
                <span className="driver-position-count-pill missing">{driverPositionsData.counts.missingRosterDetails} missing roster</span>
              )}
            </div>
          )}

          <span className="driver-position-accordion-chevron" aria-hidden="true">{driverRosterAccordionOpen ? '▲' : '▼'}</span>
        </button>

        {driverRosterAccordionOpen && (
          <div className="driver-position-accordion-body">
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
        )}
      </div>
    );
  }


  function getDriverPerformanceAnalysis(snapshot) {
    const years = snapshot?.years || [];
    const summary = snapshot?.summary || {};
    const activeYears = years.filter((row) => (
      Number(row.revenue || 0) > 0 ||
      Number(row.loadCount || 0) > 0 ||
      Number(row.tonuCount || 0) > 0 ||
      Number(row.timeOff?.totalDays || 0) > 0
    ));

    const bestRevenueYear = activeYears.reduce((best, row) => (
      !best || Number(row.revenue || 0) > Number(best.revenue || 0) ? row : best
    ), null);

    const bestLoadYear = activeYears.reduce((best, row) => (
      !best || Number(row.loadCount || 0) > Number(best.loadCount || 0) ? row : best
    ), null);

    const lastLoadRow = activeYears
      .filter((row) => row.lastLoadDate)
      .sort((a, b) => String(b.lastLoadDate).localeCompare(String(a.lastLoadDate)))[0] || null;

    const currentYear = years[0] || null;
    const priorYear = years.find((row) => currentYear && Number(row.year) === Number(currentYear.year) - 1) || activeYears[1] || null;
    const avgRevenuePerLoad = Number(summary.loadCount || 0) > 0
      ? Number(summary.revenue || 0) / Number(summary.loadCount || 0)
      : 0;
    const timeOffPer100Loads = Number(summary.loadCount || 0) > 0
      ? (Number(summary.timeOffDays || 0) / Number(summary.loadCount || 0)) * 100
      : 0;
    const homeTimeShare = Number(summary.timeOffDays || 0) > 0
      ? Number(summary.homeTimeDays || 0) / Number(summary.timeOffDays || 0)
      : 0;
    const repairShare = Number(summary.timeOffDays || 0) > 0
      ? Number(summary.repairDays || 0) / Number(summary.timeOffDays || 0)
      : 0;

    const insights = [];

    if (activeYears.length > 0) {
      insights.push(`Visible history covers ${formatReportNumber(activeYears.length)} active year${activeYears.length === 1 ? '' : 's'} for this truck.`);
    }

    if (bestRevenueYear) {
      insights.push(`${bestRevenueYear.year} is the strongest visible revenue year at ${formatReportMoney(bestRevenueYear.revenue)}.`);
    }

    if (currentYear && priorYear && Number(priorYear.revenue || 0) > 0) {
      const diff = Number(currentYear.revenue || 0) - Number(priorYear.revenue || 0);
      const pct = Math.abs(diff / Number(priorYear.revenue || 0));
      const direction = diff >= 0 ? 'ahead of' : 'behind';
      insights.push(`${currentYear.year} is currently ${direction} ${priorYear.year} by ${formatReportMoney(Math.abs(diff))} (${formatPercent(pct)}).`);
    }

    if (lastLoadRow?.lastLoadDate) {
      insights.push(`Most recent visible load activity: ${formatRosterDate(lastLoadRow.lastLoadDate)}.`);
    }

    if (Number(summary.timeOffDays || 0) > 0) {
      insights.push(`Time off mix: ${formatPercent(homeTimeShare)} home time and ${formatPercent(repairShare)} repairs.`);
    }

    return {
      activeYears,
      bestRevenueYear,
      bestLoadYear,
      lastLoadRow,
      avgRevenuePerLoad,
      timeOffPer100Loads,
      insights
    };
  }

  function DriverPerformanceSnapshotContent() {
    const years = driverHistorySnapshot?.years || [];
    const warnings = driverHistorySnapshot?.warnings || [];
    const summary = driverHistorySnapshot?.summary || {};
    const analysis = getDriverPerformanceAnalysis(driverHistorySnapshot);
    const activeYears = analysis.activeYears || [];
    const hasSnapshotRows = activeYears.length > 0;
    const maxRevenue = Math.max(...activeYears.map((row) => Number(row.revenue || 0)), 0);

    if (driverHistoryLoading && !driverHistorySnapshot) {
      return (
        <div className="driver-performance-loading-card">
          <div className="driver-snapshot-summary driver-snapshot-summary-wide">
            <div><span>Visible Revenue</span><strong>—</strong></div>
            <div><span>Won Loads</span><strong>—</strong></div>
            <div><span>Avg Revenue / Load</span><strong>—</strong></div>
            <div><span>Time Off Days</span><strong>—</strong></div>
          </div>
          <div className="driver-performance-loading-copy">
            Analyzing revenue, load history, TONU, and inclusive time-off days...
          </div>
        </div>
      );
    }

    if (driverHistoryError) {
      return <div className="msg error">Driver performance unavailable: {driverHistoryError}</div>;
    }

    if (!hasSnapshotRows) {
      return <div className="msg">No revenue or time-off history was found for this truck yet.</div>;
    }

    return (
      <>
        <div className="driver-snapshot-summary driver-snapshot-summary-wide">
          <div>
            <span>Visible Revenue</span>
            <strong>{formatReportMoney(summary.revenue)}</strong>
          </div>
          <div>
            <span>Won Loads</span>
            <strong>{formatReportNumber(summary.loadCount)}</strong>
          </div>
          <div>
            <span>Avg Revenue / Load</span>
            <strong>{formatReportMoney(analysis.avgRevenuePerLoad)}</strong>
          </div>
          <div>
            <span>Time Off Days</span>
            <strong>{formatReportNumber(summary.timeOffDays)}</strong>
          </div>
        </div>

        <div className="driver-performance-analysis-grid">
          <div className="driver-performance-analysis-card highlight">
            <span>Best Revenue Year</span>
            <strong>{analysis.bestRevenueYear?.year || '-'}</strong>
            <small>{analysis.bestRevenueYear ? formatReportMoney(analysis.bestRevenueYear.revenue) : 'No revenue yet'}</small>
          </div>
          <div className="driver-performance-analysis-card">
            <span>Best Load Year</span>
            <strong>{analysis.bestLoadYear?.year || '-'}</strong>
            <small>{analysis.bestLoadYear ? `${formatReportNumber(analysis.bestLoadYear.loadCount)} won load${Number(analysis.bestLoadYear.loadCount) === 1 ? '' : 's'}` : 'No loads yet'}</small>
          </div>
          <div className="driver-performance-analysis-card">
            <span>Time Off Pressure</span>
            <strong>{formatReportNumber(analysis.timeOffPer100Loads)}</strong>
            <small>days per 100 won loads</small>
          </div>
          <div className="driver-performance-analysis-card">
            <span>Last Visible Load</span>
            <strong>{formatRosterDate(analysis.lastLoadRow?.lastLoadDate)}</strong>
            <small>{analysis.lastLoadRow ? `from ${analysis.lastLoadRow.year}` : 'No load date found'}</small>
          </div>
        </div>

        <div className="driver-performance-split-grid">
          <div className="driver-performance-section-card">
            <h4>Revenue Shape</h4>
            <div className="driver-performance-bars">
              {activeYears.map((row) => {
                const revenue = Number(row.revenue || 0);
                const width = maxRevenue > 0 ? Math.max((revenue / maxRevenue) * 100, revenue > 0 ? 6 : 0) : 0;

                return (
                  <div key={`driver-performance-bar-${row.year}`} className="driver-performance-bar-row">
                    <div className="driver-performance-bar-label">
                      <strong>{row.year}</strong>
                      <span>{formatReportMoney(revenue)}</span>
                    </div>
                    <div className="driver-performance-bar-track" aria-hidden="true">
                      <div className="driver-performance-bar-fill" style={{ width: `${width}%` }} />
                    </div>
                    <small>{formatReportNumber(row.loadCount)} loads · {formatReportNumber(row.timeOff?.totalDays)} off days</small>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="driver-performance-section-card">
            <h4>30,000' Read</h4>
            <ul className="driver-performance-insight-list">
              {analysis.insights.map((insight, index) => (
                <li key={`driver-performance-insight-${index}`}>{insight}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="driver-snapshot-table-wrap driver-performance-table-wrap">
          <table className="driver-snapshot-table">
            <thead>
              <tr>
                <th>Year</th>
                <th>Revenue</th>
                <th>Won Loads</th>
                <th>TONU</th>
                <th>Time Off</th>
                <th>Home</th>
                <th>Repairs</th>
                <th>Last Load</th>
              </tr>
            </thead>
            <tbody>
              {years.map((row) => (
                <tr key={`driver-snapshot-${row.year}`}>
                  <td>{row.year}</td>
                  <td>{formatReportMoney(row.revenue)}</td>
                  <td>{formatReportNumber(row.loadCount)}</td>
                  <td>{formatReportNumber(row.tonuCount)}</td>
                  <td>{formatReportNumber(row.timeOff?.totalDays)}</td>
                  <td>{formatReportNumber(row.timeOff?.homeTimeDays)}</td>
                  <td>{formatReportNumber(row.timeOff?.repairDays)}</td>
                  <td>{formatRosterDate(row.lastLoadDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <small className="driver-snapshot-source-note">
          Source: Bid Listing/archive revenue by pickup year and Driver Time Off Log by inclusive calendar days. This is a read-only drilldown; it does not write back to Driver Roster.
        </small>

        {warnings.length > 0 && (
          <div className="driver-snapshot-warning">
            Snapshot loaded with {warnings.length} source warning{warnings.length === 1 ? '' : 's'}.
          </div>
        )}
      </>
    );
  }

  function DriverPerformanceModal() {
    if (!driverHistoryModalOpen || !selectedDriverRoster) return null;

    const roster = selectedDriverRoster.roster || {};
    const displayName = roster.tmsName || selectedDriverRoster.driverName || 'Driver';
    const truck = getDriverHistoryTruckFromCard(selectedDriverRoster) || '-';

    return (
      <div className="modal-overlay report-modal-overlay driver-performance-modal-overlay" onClick={closeDriverPerformanceModal}>
        <div className="detail-modal driver-performance-modal" onClick={(e) => e.stopPropagation()}>
          <div className="detail-header">
            <div>
              <h2>Driver Performance Snapshot</h2>
              <p>{displayName} · Truck {truck}</p>
            </div>

            <button className="close-button" onClick={closeDriverPerformanceModal}>
              Close
            </button>
          </div>

          <div className="modal-body driver-performance-modal-body">
            <DriverPerformanceSnapshotContent />
          </div>
        </div>
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
      <div className="modal-overlay driver-roster-modal-overlay" onClick={closeDriverRosterModal}>
        <div className="detail-modal driver-roster-modal" onClick={(e) => e.stopPropagation()}>
          <div className="detail-header">
            <div>
              <ModalReturnTrail label={getDriverRosterReturnTrailLabel()} onClick={handleDriverRosterReturnTrailClick} />
              <h2>{modalTitle}</h2>
              <p>{modalSubtitle}</p>
            </div>

            <div className="driver-roster-header-actions">
              {hasRoster && (
                <button
                  type="button"
                  className={`view-button driver-performance-button ${driverHistoryLoading ? 'loading' : ''}`}
                  onClick={openDriverPerformanceModal}
                  disabled={driverHistoryLoading}
                >
                  {driverHistoryLoading ? 'Analyzing...' : 'Performance Snapshot'}
                </button>
              )}
              <button className="close-button" onClick={closeDriverRosterModal}>
                Close
              </button>
            </div>
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
                <DetailItem label="Email Address 1" valueNode={<EmailLink email={roster.emailAddress1} />} wide />
                <DetailItem label="Email Address 2" valueNode={<EmailLink email={roster.emailAddress2} />} wide />
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

  function formatAvailableTruckBatchLabel(summary) {
    const pieces = [formatDateInputLabel(summary?.latestBatchDate), summary?.latestBatchTimeOfDay]
      .filter(Boolean);

    return pieces.length ? pieces.join(' · ') : 'Latest batch';
  }

  function formatBucketList(items, emptyLabel = 'No data yet') {
    const buckets = items || [];

    if (buckets.length === 0) return emptyLabel;

    return buckets.map((bucket) => `${bucket.label} (${bucket.count})`).join(', ');
  }

  function formatAvailableTruckLastPosting(record) {
    return [formatDateInputLabel(record?.dateSent), record?.timeOfDay]
      .filter(Boolean)
      .join(' · ') || '-';
  }

  function formatAvailableTruckPosted(record) {
    const timestamp = record?.postedAt || record?.createdAt || record?.modifiedAt || '';

    if (timestamp) {
      const date = new Date(timestamp);

      if (!Number.isNaN(date.getTime())) {
        return date.toLocaleString('en-US', {
          timeZone: 'America/New_York',
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit'
        });
      }
    }

    return formatAvailableTruckLastPosting(record);
  }

  function formatAvailableTruckNextPickup(record) {
    const assignment = record?.nextAssignment;

    if (!assignment) return 'No later pickup found';

    const pickupLabel = formatDateOnly(assignment.pickupDate) || '-';
    const lane = [assignment.origin, assignment.destination].filter(Boolean).join(' → ');
    const bol = assignment.bol || 'Order';

    return [bol, pickupLabel, lane].filter(Boolean).join(' · ');
  }

  function getAvailableTruckGap(record) {
    if (!record?.nextAssignment) return '-';
    return record.nextPickupGapLabel || 'Approx. date-only gap';
  }

  function renderAvailableTruckGap(record) {
    const gap = getAvailableTruckGap(record);

    if (gap === '-') return gap;

    return (
      <span className="available-trucks-gap-value">
        {gap}
        {record?.hasTonuInPickupSpan && <sup className="available-trucks-tonu-marker">*</sup>}
      </span>
    );
  }

  function openAvailableTruckDrilldown(title, subtitle, rows = []) {
    setAvailableTruckDrilldown({
      title,
      subtitle,
      rows: rows || []
    });
  }

  function AvailableTrucksInsightList({ title, items, emptyLabel }) {
    const buckets = items || [];

    return (
      <div className="available-trucks-insight-card">
        <span>{title}</span>
        {buckets.length === 0 ? (
          <strong>{emptyLabel || 'No data yet'}</strong>
        ) : (
          <ol>
            {buckets.map((bucket) => (
              <li key={bucket.key || bucket.label}>
                <strong>{bucket.label}</strong>
                <span>{bucket.count}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    );
  }

  function AvailableTruckProximityList({ stops }) {
    const visibleStops = stops || [];

    if (visibleStops.length === 0) return <span className="available-trucks-muted">No proximity stops listed</span>;

    return (
      <div className="available-trucks-proximity-list">
        {visibleStops.map((stop) => (
          <span key={`${stop.rank}-${stop.location}`}>
            <strong>{stop.location || '-'}</strong>
            {stop.timeLabel && <small>{stop.timeLabel}</small>}
          </span>
        ))}
      </div>
    );
  }

  function AvailableTruckDrilldownModal() {
    if (!availableTruckDrilldown) return null;

    const rows = availableTruckDrilldown.rows || [];
    const hasTonuInSpan = rows.some((record) => record?.hasTonuInPickupSpan);

    return (
      <div className="modal-overlay" onClick={() => setAvailableTruckDrilldown(null)}>
        <div className="detail-modal available-trucks-drilldown-modal" onClick={(e) => e.stopPropagation()}>
          <div className="detail-header">
            <div>
              <h2>{availableTruckDrilldown.title}</h2>
              <p>{availableTruckDrilldown.subtitle || `${rows.length} referenced row${rows.length === 1 ? '' : 's'}`}</p>
            </div>
            <button type="button" className="close-button" onClick={() => setAvailableTruckDrilldown(null)}>
              Close
            </button>
          </div>
          <div className="modal-body available-trucks-drilldown-body">
            {rows.length === 0 ? (
              <div className="intellitrack-empty">
                <strong> No records to display.</strong>
              
              </div>
            ) : (
              <>
                <div className="operations-table-wrap available-trucks-drilldown-table-wrap">
                  <table className="available-trucks-table available-trucks-drilldown-table">
                  <thead>
                    <tr>
                      <th>Driver</th>
                      <th>Unit</th>
                      <th>Posted Available</th>
                      <th>Location</th>
                      <th>First Pickup After Posting</th>
                      <th>Time to Next Pickup</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((record, index) => (
                      <tr key={record.id || `${record.driverName}-${record.unitNo}-${index}`}>
                        <td>
                          <strong>{record.driverName || '-'}</strong>
                          <small>{record.equipmentType || '-'}</small>
                        </td>
                        <td>{record.unitNo || '-'}</td>
                        <td>{formatAvailableTruckPosted(record)}</td>
                        <td>{record.currentLocation || '-'}</td>
                        <td>
                          <strong>{formatAvailableTruckNextPickup(record)}</strong>
                          {record.nextAssignment?.matchType && <small>Matched by {record.nextAssignment.matchType}</small>}
                        </td>
                        <td>{renderAvailableTruckGap(record)}</td>
                      </tr>
                    ))}
                  </tbody>
                  </table>
                </div>
                {hasTonuInSpan && (
                  <p className="available-trucks-tonu-note">
                    <sup>*</sup> A TONU occurred between the availability posting and the first later Won pickup.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  function AvailableTrucksPanel() {
    const records = availableTrucksData?.records || [];
    const recordsWithin24Hours = availableTrucksData?.recordsWithin24Hours || [];
    const assignmentExcludedRecords = availableTrucksData?.assignmentExcludedRecords || [];
    const recentRecords = availableTrucksData?.recentRecords || [];
    const summary = availableTrucksData?.summary || {};
    const insights = availableTrucksData?.insights || {};
    const batchLabel = formatAvailableTruckBatchLabel(summary);
    const attentionItems = (insights.attention || []).filter((item) => !['No availability from the last 24 hours', 'No current unassigned trucks', 'Repost collapsed'].includes(item.label));
    const currentCount = summary.currentRecordCount ?? availableTrucksData?.count ?? records.length;
    const excludedCount = summary.activeFutureAssignmentExclusions || 0;
    const assignmentLookaheadDays = Number(summary.assignmentLookaheadDays ?? availableTrucksData?.assignmentLookaheadDays ?? 2);
    const distributionRows = availableTruckDistributionData?.rows || [];
    const inactiveDistributionRows = availableTruckDistributionData?.inactiveRows || [];
    const sortedDistributionRows = sortAvailableTruckDistributionRowsForDisplay(
      distributionRows,
      availableTruckDistributionSortField,
      availableTruckDistributionSortDirection
    );
    const distributionEmailDraftKey = availableTruckDistributionEmail.trim().toLowerCase();
    const duplicateDistributionDraft = distributionEmailDraftKey
      ? [...distributionRows, ...inactiveDistributionRows].find((row) =>
          String(row?.email || '').trim().toLowerCase() === distributionEmailDraftKey
        )
      : null;
    const showAvailableTrucksStatusPill = !availableTrucksSectionOpen || availableTrucksLoading;
    const showCurrentAvailableEquipmentMarker = availableTrucksSectionOpen && !availableTrucksCurrentOpen && currentCount > 0;

    return (
      <div className="search-card feature-accordion-panel available-trucks-panel">
        <button
          type="button"
          className="feature-section-header-button available-trucks-section-header-button"
          onClick={toggleAvailableTrucksSection}
          aria-expanded={availableTrucksSectionOpen}
        >
          <span className="feature-section-title-block">
            <span className="feature-section-title">Available Equipment</span>
                      </span>
          {showAvailableTrucksStatusPill && (
            <span className={`feature-section-status-pill ${currentCount > 0 ? 'has-items' : 'is-zero'} ${availableTrucksLoading ? 'is-loading' : ''}`}>
              {availableTrucksLoading ? '...' : formatReportNumber(currentCount)}
            </span>
          )}
          <span className="feature-section-chevron">{availableTrucksSectionOpen ? '▲' : '▼'}</span>
        </button>

        {availableTrucksError && <div className="msg error">{availableTrucksError}</div>}
        {availableTruckActionError && <div className="msg error">{availableTruckActionError}</div>}
        {availableTruckActionMessage && <div className="msg success">{availableTruckActionMessage}</div>}

        {availableTrucksSectionOpen && (
          <div className="feature-section-body available-trucks-body">
            <button
              type="button"
              className="available-trucks-summary available-trucks-current-summary"
              onClick={() => toggleAvailableTruckSubsection('current')}
              aria-expanded={availableTrucksCurrentOpen}
            >
              <span className="available-trucks-title-block">
                <span className="available-trucks-title">
                  Currently Available Equipment
                  {showCurrentAvailableEquipmentMarker && (
                    <span
                      className="report-action-alert-marker feature-child-alert-marker"
                      title={`${formatReportNumber(currentCount)} currently available equipment row${currentCount === 1 ? '' : 's'}`}
                      aria-label={`${formatReportNumber(currentCount)} currently available equipment row${currentCount === 1 ? '' : 's'}`}
                    >
                      *
                    </span>
                  )}
                </span>
              </span>
              <span className="available-trucks-chevron">
                {availableTrucksCurrentOpen ? '▲' : '▼'}
              </span>
            </button>

            {availableTrucksCurrentOpen && !availableTrucksError && (
              <div className="available-trucks-current-card">
                <div className="available-trucks-subheader">
                  <div>
                    <h3>Last posting: {batchLabel}</h3>
                    <p>
                      The date shown is the latest posting date from the availability list · Current window: last {availableTrucksData?.currentWindowHours || 24} hours · assignment window: today + next {assignmentLookaheadDays} day{assignmentLookaheadDays === 1 ? '' : 's'} · {excludedCount} hidden by active/near-term assignment
                    </p>
                  </div>

                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => loadAvailableTrucks()}
                    disabled={availableTrucksLoading}
                  >
                    {availableTrucksLoading ? 'Refreshing...' : 'Refresh'}
                  </button>
                </div>

                {availableTrucksLoading && !availableTrucksData && (
                  <div className="msg">Loading available equipment...</div>
                )}

                {availableTrucksData && (
                  <>
                    {records.length === 0 ? (
                      <div className="intellitrack-empty">
                        <strong>No equipment currently available.</strong>
                      </div>
                    ) : (
                      <div className="operations-table-wrap available-trucks-table-wrap">
                        <table className="available-trucks-table">
                          <thead>
                            <tr>
                              <th>Driver</th>
                              <th>Unit</th>
                              <th>Equipment</th>
                              <th>Current Location</th>
                              <th>Advertised Proximity</th>
                              <th>Last Posting</th>
                              <th>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {records.map((record) => (
                              <tr key={record.id || `${record.driverName}-${record.unitNo}-${record.dateSent}-${record.timeOfDay}`}>
                                <td>
                                  <strong>{record.driverName || '-'}</strong>
                                  <small>{record.teamType || '-'}</small>
                                </td>
                                <td>{record.unitNo || '-'}</td>
                                <td>
                                  <strong>{record.equipmentType || '-'}</strong>
                                  <small>{record.equipmentFamily || '-'}</small>
                                </td>
                                <td>{record.currentLocation || '-'}</td>
                                <td><AvailableTruckProximityList stops={record.proximityStops} /></td>
                                <td>
                                  <strong>{formatAvailableTruckLastPosting(record)}</strong>
                                  <small>Last posting date</small>
                                </td>
                                <td className="available-trucks-republish-cell">
                                  <button
                                    type="button"
                                    className="secondary-button compact-action-button available-trucks-republish-button"
                                    onClick={() => republishAvailableTruck(record)}
                                    disabled={availableTruckSubmitting || Boolean(availableTruckRepublishingId)}
                                  >
                                    {availableTruckRepublishingId === (record.id || `${record.driverName || ''}-${record.unitNo || ''}`) ? 'Republishing...' : 'Republish'}
                                  </button>
                                  <small>Queues the next allowed posting window.</small>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            <button
              type="button"
              className="available-trucks-summary"
              onClick={() => toggleAvailableTruckSubsection('analysis')}
              aria-expanded={availableTrucksOpen}
            >
              <span className="available-trucks-title-block">
                <span className="available-trucks-title">Available Equipment Analysis</span>
                </span>
              <span className="available-trucks-chevron">
                {availableTrucksOpen ? '▲' : '▼'}
              </span>
            </button>

            {availableTrucksOpen && !availableTrucksError && (
              <div className="available-trucks-current-card available-trucks-analysis-card">
                <div className="available-trucks-subheader">
                  <div>
                    <h3>Available Equipment Analysis</h3>
                    <p>
                      Pattern window: last {availableTrucksData?.lookbackDays || 30} days · {summary.recentRecordCount || 0} row{summary.recentRecordCount === 1 ? '' : 's'} in the analysis window
                    </p>
                  </div>

                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => loadAvailableTrucks()}
                    disabled={availableTrucksLoading}
                  >
                    {availableTrucksLoading ? 'Refreshing...' : 'Refresh'}
                  </button>
                </div>

                {availableTrucksLoading && !availableTrucksData && (
                  <div className="msg">Loading available-truck analysis...</div>
                )}

                {availableTrucksData && (
                  <>
                    <div className="available-trucks-kpi-grid">
                      <button
                        type="button"
                        className="available-trucks-kpi-button"
                        onClick={() => openAvailableTruckDrilldown('Recent Available Equipment', 'All rows posted in the last 24 hours, before current-availability filtering. First later pickup is shown only as follow-through history.', recordsWithin24Hours)}
                      >
                        <span>Recent rows</span>
                        <strong>{summary.recordsWithin24Hours || 0}</strong>
                        <small>Created in the last 24 hours</small>
                      </button>
                      <button
                        type="button"
                        className="available-trucks-kpi-button"
                        onClick={() => openAvailableTruckDrilldown('Hidden by assignment', `Recent rows hidden because the truck/driver now has an active load or a pickup inside the ${assignmentLookaheadDays}-day lookahead. First later pickup is shown only as follow-through history.`, assignmentExcludedRecords)}
                      >
                        <span>Assignment hidden</span>
                        <strong>{summary.activeFutureAssignmentExclusions || 0}</strong>
                        <small>Active or pickup inside lookahead</small>
                      </button>
                      <div
                        className="available-trucks-kpi-card available-trucks-kpi-static"
                        title="Unique drivers represented in the recent pattern window"
                      >
                        <span>Recent drivers</span>
                        <strong>{summary.uniqueRecentDrivers || 0}</strong>
                        <small>{summary.recentRecordCount || 0} posting row{summary.recentRecordCount === 1 ? '' : 's'} in pattern window</small>
                      </div>
                    </div>

                    {attentionItems.length > 0 && (
                      <div className="available-trucks-attention-list">
                        {attentionItems.map((item, index) => (
                          <div key={`${item.label}-${index}`} className={`available-trucks-attention ${item.level || 'info'}`}>
                            <strong>{item.label}</strong>
                            <span>{item.detail}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="available-trucks-insight-grid">
                      <AvailableTrucksInsightList title="Top current states" items={insights.topCurrentStates} />
                      <AvailableTrucksInsightList title="Top current locations" items={insights.topCurrentLocations} />
                      <AvailableTrucksInsightList title="Top advertised proximity" items={insights.topProximityLocations} />
                      <AvailableTrucksInsightList title="Equipment mix" items={insights.equipmentMix} />
                    </div>
                  </>
                )}
              </div>
            )}

            <button
              type="button"
              className="available-trucks-summary available-trucks-action-summary"
              onClick={() => toggleAvailableTruckSubsection('action')}
              aria-expanded={availableTrucksActionOpen}
            >
              <span className="available-trucks-title-block">
                <span className="available-trucks-title">Add Available Equipment</span>
                           </span>
              <span className="available-trucks-chevron">
                {availableTrucksActionOpen ? '▲' : '▼'}
              </span>
            </button>

            {availableTrucksActionOpen && (
              <div className="available-trucks-action-card">
                <div className="available-trucks-subheader">
                  <div>
                    <h3>Add Available Equipment</h3>
                    <p>
                      Select active drivers from Driver Roster. Driver name, unit number, and equipment type are prefilled so the wide source row stays consistent.
                    </p>
                  </div>
                </div>

                {availableTrucksData?.activeDriverOptionsWarning && (
                  <div className="available-truck-roster-warning">
                    {availableTrucksData.activeDriverOptionsWarning}
                  </div>
                )}

                <form className="available-truck-form" onSubmit={submitAvailableTruckForm}>
                  <div className="available-truck-send-grid">
                    <label>
                      <span>Date Sent</span>
                      <input
                        type="date"
                        value={availableTruckFormDate}
                        onChange={(e) => setAvailableTruckFormDate(e.target.value)}
                        disabled={availableTruckSubmitting}
                      />
                    </label>
                    <label>
                      <span>Time of Day</span>
                      <select
                        value={availableTruckTimeOfDay}
                        onChange={(e) => setAvailableTruckTimeOfDay(e.target.value)}
                        disabled={availableTruckSubmitting}
                      >
                        <option value="AM">AM</option>
                        <option value="PM">PM</option>
                        <option value="Evening">Evening</option>
                      </select>
                    </label>
                  </div>

                  <div className="available-truck-posting-rules">
                    <strong>{availableTruckTimeOfDay} posting rule</strong>
                    <span>AM covers 12:00 AM-11:59 AM. PM covers 12:00 PM-5:00 PM. AM and PM batches send every 30 minutes at the next :30 mark; Evening batches only send at the 7:00 PM scheduled run.</span>
                  </div>

                  <div className="available-truck-form-rows">
                    {availableTruckRows.map((row, index) => (
                      <AvailableTruckFormRow
                        key={row.key}
                        row={row}
                        index={index}
                        canRemove={availableTruckRows.length > 1}
                        submitting={availableTruckSubmitting}
                        driverOptions={availableTruckDriverOptions}
                        selectedRosterDriverKeys={selectedAvailableTruckRosterKeys}
                        suggestionGroup={getAvailableTruckRowSuggestionGroup(row, availableTruckSuggestionIndex)}
                        onSelectDriver={selectAvailableTruckRosterDriver}
                        onUpdate={updateAvailableTruckRow}
                        onApplySuggestion={applyAvailableTruckSuggestion}
                        onRemove={removeAvailableTruckRow}
                      />
                    ))}
                  </div>

                  <div className="available-truck-form-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={addAvailableTruckRow}
                      disabled={availableTruckSubmitting || availableTruckRows.length >= AVAILABLE_TRUCK_MAX_ROWS}
                    >
                      Add Another Truck
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={clearAvailableTruckForm}
                      disabled={availableTruckSubmitting}
                    >
                      Clear
                    </button>
                    <button
                      type="submit"
                      className="primary-action-button"
                      disabled={availableTruckSubmitting}
                    >
                      {availableTruckSubmitting ? 'Submitting...' : 'Submit Available Equipment'}
                    </button>
                    <span>
                      {availableTruckDriverOptions.length} active roster option{availableTruckDriverOptions.length === 1 ? '' : 's'} loaded · {Object.keys(availableTruckSuggestionIndex).length} historical city match{Object.keys(availableTruckSuggestionIndex).length === 1 ? '' : 'es'} loaded · {availableTruckRows.length}/{AVAILABLE_TRUCK_MAX_ROWS} source slots shown · blank rows are ignored.
                    </span>
                  </div>
                </form>
              </div>
            )}

            <button
              type="button"
              className="available-trucks-summary available-trucks-distribution-summary-button"
              onClick={() => {
                setAvailableTruckDistributionError('');
                setAvailableTruckDistributionMessage('');
                toggleAvailableTruckSubsection('distribution');
              }}
              aria-expanded={availableTruckDistributionOpen}
            >
              <span className="available-trucks-title-block">
                <span className="available-trucks-title">Available Equipment Distribution List</span>
                
              </span>
              <span className="available-trucks-chevron available-trucks-chevron-slot" aria-hidden="true">
                {availableTruckDistributionOpen ? '▲' : '▼'}
              </span>
            </button>

            {availableTruckDistributionOpen && (
              <div className="available-trucks-action-card available-truck-distribution-panel">
                <div className="available-trucks-subheader compact">
                  <div>
                    <h3>Available Equipment Distribution List</h3>
                    <p>Active company/email entries receiving Available Equipment mass emails. Add a row here, and the list refreshes immediately after save.</p>
                  </div>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => loadAvailableTruckDistributionList()}
                    disabled={availableTruckDistributionLoading}
                  >
                    {availableTruckDistributionLoading ? 'Refreshing...' : 'Refresh List'}
                  </button>
                </div>

                <div className="available-truck-distribution-summary">
                  <div className="available-truck-distribution-summary-card">
                    <span>Active recipients</span>
                    <strong>{availableTruckDistributionData?.count ?? 0}</strong>
                  </div>
                  <button
                    type="button"
                    className="available-truck-distribution-summary-card available-truck-distribution-summary-button"
                    onClick={() => setAvailableTruckDistributionInactiveModalOpen(true)}
                    disabled={inactiveDistributionRows.length === 0}
                    title={inactiveDistributionRows.length ? 'View inactive/hidden distribution-list entries' : 'No inactive/hidden entries found'}
                  >
                    <span>Inactive hidden</span>
                    <strong>{availableTruckDistributionData?.inactiveCount ?? 0}</strong>
                    <small>{inactiveDistributionRows.length ? 'Click to review' : 'None to show'}</small>
                  </button>
                  <div className="available-truck-distribution-summary-card">
                    <span>Last refreshed</span>
                    <strong>{availableTruckDistributionData?.generatedAt || '-'}</strong>
                  </div>
                </div>

                {availableTruckDistributionData?.sourceWarning && (
                  <div className="available-truck-roster-warning">
                    {availableTruckDistributionData.sourceWarning}
                  </div>
                )}

                <form className="available-truck-distribution-form" onSubmit={submitAvailableTruckDistributionContact}>
                  <label>
                    <span>Company</span>
                    <input
                      value={availableTruckDistributionCompany}
                      onChange={(e) => {
                        setAvailableTruckDistributionCompany(e.target.value);
                        setAvailableTruckDistributionError('');
                        setAvailableTruckDistributionMessage('');
                      }}
                      placeholder="Company name"
                      disabled={availableTruckDistributionSubmitting}
                    />
                  </label>
                  <label>
                    <span>Email</span>
                    <input
                      type="email"
                      value={availableTruckDistributionEmail}
                      onChange={(e) => {
                        setAvailableTruckDistributionEmail(e.target.value);
                        setAvailableTruckDistributionError('');
                        setAvailableTruckDistributionMessage('');
                      }}
                      placeholder="person@example.com"
                      disabled={availableTruckDistributionSubmitting}
                    />
                    {duplicateDistributionDraft && (
                      <small className="available-truck-distribution-duplicate-hint">
                        Already {duplicateDistributionDraft.active === false ? 'inactive/hidden' : 'active'}
                        {duplicateDistributionDraft.company ? ` under ${duplicateDistributionDraft.company}` : ''}.
                      </small>
                    )}
                  </label>
                  <div className="available-truck-distribution-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={clearAvailableTruckDistributionForm}
                      disabled={availableTruckDistributionSubmitting}
                    >
                      Clear
                    </button>
                    <button
                      type="submit"
                      className="primary-action-button"
                      disabled={availableTruckDistributionSubmitting || Boolean(duplicateDistributionDraft)}
                    >
                      {availableTruckDistributionSubmitting ? 'Adding...' : 'Add Contact'}
                    </button>
                  </div>
                </form>

                {availableTruckDistributionMessage && <div className="msg success">{availableTruckDistributionMessage}</div>}
                {availableTruckDistributionError && <div className="msg error">{availableTruckDistributionError}</div>}

                {availableTruckDistributionLoading && !availableTruckDistributionData ? (
                  <div className="msg">Loading distribution list...</div>
                ) : (
                  <div className="report-table-wrap available-truck-distribution-table-wrap">
                    <table className="available-truck-distribution-table">
                      <thead>
                        <tr>
                          <th>
                            <button
                              type="button"
                              className="distribution-sort-header"
                              onClick={() => toggleAvailableTruckDistributionSort('company')}
                            >
                              <span>Company</span>
                              <span className="distribution-sort-indicator">{getAvailableTruckDistributionSortIndicator('company')}</span>
                            </button>
                          </th>
                          <th>
                            <button
                              type="button"
                              className="distribution-sort-header"
                              onClick={() => toggleAvailableTruckDistributionSort('email')}
                            >
                              <span>Email</span>
                              <span className="distribution-sort-indicator">{getAvailableTruckDistributionSortIndicator('email')}</span>
                            </button>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedDistributionRows.length === 0 ? (
                          <tr>
                            <td colSpan="2">No active distribution-list entries found.</td>
                          </tr>
                        ) : (
                          sortedDistributionRows.map((row) => (
                            <tr key={row.id || `${row.company}-${row.email}`}>
                              <td><strong>{row.company || '-'}</strong></td>
                              <td><EmailLink email={row.email} /></td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

          </div>
        )}
        <AvailableTruckDrilldownModal />

        {availableTruckDistributionInactiveModalOpen && (
          <div className="modal-overlay">
            <div className="detail-modal available-truck-distribution-modal">
              <div className="detail-header">
                <div>
                  <h2>Inactive / Hidden Distribution Entries</h2>
                  <p>These contacts are not included in the active Available Equipment email send, but they still exist on the source list.</p>
                </div>
                <button
                  type="button"
                  className="close-button"
                  onClick={() => setAvailableTruckDistributionInactiveModalOpen(false)}
                >
                  Close
                </button>
              </div>
              <div className="modal-body available-truck-distribution-modal-body">
                {inactiveDistributionRows.length === 0 ? (
                  <div className="intellitrack-empty">
                    <strong>No inactive or hidden distribution-list entries found.</strong>
                  </div>
                ) : (
                  <div className="report-table-wrap available-truck-distribution-table-wrap">
                    <table className="available-truck-distribution-table">
                      <thead>
                        <tr>
                          <th>Company</th>
                          <th>Email</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortAvailableTruckDistributionRowsForDisplay(inactiveDistributionRows, 'company', 'asc').map((row) => (
                          <tr key={row.id || `${row.company}-${row.email}`}>
                            <td><strong>{row.company || '-'}</strong></td>
                            <td><EmailLink email={row.email} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  function IntelliTrackPanel() {
    const suppressedBolSet = new Set(intelliTrackSuppressedBols);
    const records = (intelliTrackData?.records || []).filter((record) => {
      const bol = String(record?.BOLNumber || '').trim().toUpperCase();
      return !bol || !suppressedBolSet.has(bol);
    });
    const count = records.length;
    const order = intelliTrackSearchResult;
    const buttonState = getIntelliTrackButtonState(order);
    const orderLoadingKey = order?.id ? `${order.id}-${buttonState.enabled ? 'on' : 'off'}` : '';
    const showIntelliTrackStatusPill = !intelliTrackSectionOpen || intelliTrackLoading;
    const showActiveIntelliTrackMarker = intelliTrackSectionOpen && !intelliTrackOpen && count > 0;

    return (
      <div className="search-card feature-accordion-panel intellitrack-panel">
        <button
          type="button"
          className="feature-section-header-button intellitrack-section-header-button"
          onClick={toggleIntelliTrackSection}
          aria-expanded={intelliTrackSectionOpen}
        >
          <span className="feature-section-title-block">
            <span className="feature-section-title">IntelliTrack</span>
                      </span>
          {showIntelliTrackStatusPill && (
            <span className={`feature-section-status-pill ${count > 0 ? 'has-items' : 'is-zero'} ${intelliTrackLoading ? 'is-loading' : ''}`}>
              {intelliTrackLoading ? '...' : formatReportNumber(count)}
            </span>
          )}
          <span className="feature-section-chevron">{intelliTrackSectionOpen ? '▲' : '▼'}</span>
        </button>

        {intelliTrackError && <div className="msg error">{intelliTrackError}</div>}
        {intelliTrackActionError && <div className="msg error">{intelliTrackActionError}</div>}
        {intelliTrackActionMessage && <div className="msg success">{intelliTrackActionMessage}</div>}

        {intelliTrackSectionOpen && (
          <div className="feature-section-body intellitrack-body">
            <button
              type="button"
              className="intellitrack-summary"
              onClick={() => toggleIntelliTrackSubsection('current')}
              aria-expanded={intelliTrackOpen}
            >
              <span className="intellitrack-title-block">
                <span className="intellitrack-title">
                  Active automatic tracking
                  {showActiveIntelliTrackMarker && (
                    <span
                      className="report-action-alert-marker feature-child-alert-marker"
                      title={`${formatReportNumber(count)} active IntelliTrack order${count === 1 ? '' : 's'}`}
                      aria-label={`${formatReportNumber(count)} active IntelliTrack order${count === 1 ? '' : 's'}`}
                    >
                      *
                    </span>
                  )}
                </span>
                </span>
              <span className="intellitrack-chevron">
                {intelliTrackOpen ? '▲' : '▼'}
              </span>
            </button>

            {intelliTrackOpen && !intelliTrackError && (
              <div className="intellitrack-current-card">
                <div className="intellitrack-subheader">
                  <div>
                    <h3>Currently Tracking</h3>
                  </div>

                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => loadIntelliTrack()}
                    disabled={intelliTrackLoading}
                  >
                    {intelliTrackLoading ? 'Refreshing...' : 'Refresh'}
                  </button>
                </div>

                {records.length === 0 ? (
                  <div className="intellitrack-empty">
                    <strong>No orders are currently being tracked.</strong>
                  </div>
                ) : (
                  <div className="operations-table-wrap intellitrack-table-wrap">
                    <table className="intellitrack-table">
                      <thead>
                        <tr>
                          <th>BOL</th>
                          <th>Customer</th>
                          <th>Driver</th>
                          <th>Unit</th>
                          <th>Route</th>
                          <th>Next Update</th>
                          <th>Action</th>
                        </tr>
                      </thead>

                      <tbody>
                        {records.map((record, i) => {
                          const rowLoadingKey = `${record.BidListingID}-off`;

                          return (
                            <tr
                              key={record.id || `${record.BOLNumber}-${i}`}
                              className={record.BidListingID ? 'report-clickable-row' : ''}
                              onClick={() => record.BidListingID && loadDetails(record.BidListingID, 'basic', '', { returnLabel: 'IntelliTrack' })}
                              title={record.BidListingID ? 'Open full order screen' : ''}
                            >
                              <td>{record.BOLNumber || '-'}</td>
                              <td>{record.Company || '-'}</td>
                              <td>{record.Operator || '-'}</td>
                              <td>{record.TruckNumber || '-'}</td>
                              <td>{record.Origin || '-'} → {record.Destination || '-'}</td>
                              <td>{record.NextUpdateScheduled ? formatTrackingTimestamp(record.NextUpdateScheduled) : '-'}</td>
                              <td>
                                <button
                                  type="button"
                                  className="danger-button compact-action-button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    turnOffIntelliTrackRecord(record);
                                  }}
                                  disabled={!record.BidListingID || intelliTrackActionLoading === rowLoadingKey}
                                >
                                  {intelliTrackActionLoading === rowLoadingKey ? 'Stopping...' : 'Turn Off'}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              className="intellitrack-summary intellitrack-action-summary"
              onClick={() => toggleIntelliTrackSubsection('action')}
              aria-expanded={intelliTrackActionOpen}
            >
              <span className="intellitrack-title-block">
                <span className="intellitrack-title">Start or Stop Tracking</span>
                              </span>
              <span className="intellitrack-chevron">
                {intelliTrackActionOpen ? '▲' : '▼'}
              </span>
            </button>

            {intelliTrackActionOpen && !intelliTrackError && (
              <div className="intellitrack-search-card">
                <form className="intellitrack-search-row" onSubmit={searchIntelliTrackOrder}>
                  <input
                    value={intelliTrackSearchBol}
                    onChange={(e) => handleIntelliTrackBolChange(e.target.value)}
                    placeholder="Search BOL, e.g. D197382"
                    aria-label="Search BOL for IntelliTrack"
                  />
                  <button type="submit" disabled={intelliTrackSearchLoading}>
                    {intelliTrackSearchLoading ? 'Searching...' : 'Find Order'}
                  </button>
                </form>

                {intelliTrackSearchError && <div className="msg error">{intelliTrackSearchError}</div>}
                {intelliTrackPendingBol && (
                  <div className="msg">
                    Waiting for {intelliTrackPendingBol} to show in Currently Tracking. Search is soft-locked for that BOL until it appears.
                  </div>
                )}

                {order && (
                  <div className="intellitrack-order-card">
                    <div className="intellitrack-order-main">
                      <div>
                        <span className="intellitrack-label">BOL</span>
                        <strong>{order.BOL || '-'}</strong>
                      </div>
                      <div>
                        <span className="intellitrack-label">Customer</span>
                        <strong>{order.Customer || '-'}</strong>
                      </div>
                      <div>
                        <span className="intellitrack-label">Status</span>
                        <strong><span className={getStatusClass(order.Status)}>{order.Status || '-'}</span></strong>
                      </div>
                      <div>
                        <span className="intellitrack-label">Tracking</span>
                        <strong>{order.EnableTracking || order.TrackingActive ? 'On' : 'Off'}</strong>
                      </div>
                    </div>

                    <div className="intellitrack-dispatch-grid">
                      <div>
                        <span>Operator / Team</span>
                        <strong>{order.Driver || '-'}</strong>
                      </div>
                      <div>
                        <span>Truck</span>
                        <strong>{order.Truck || '-'}</strong>
                      </div>
                      <div>
                        <span>Route</span>
                        <strong>{order.Origin || '-'} → {order.Destination || '-'}</strong>
                      </div>
                      <div>
                        <span>Pickup</span>
                        <strong>{formatDateTime(order.PickupDate, order.PickupTime, order.PickupAMPM)}</strong>
                      </div>
                      <div>
                        <span>Delivery</span>
                        <strong>{formatDateTime(order.DeliveryDate, order.DeliveryTime, order.DeliveryAMPM)}</strong>
                      </div>
                      <div>
                        <span>Final Settle Sent</span>
                        <strong>{order.FinalSettleSent ? 'Yes' : 'No'}</strong>
                      </div>
                    </div>

                    {buttonState.reason && (
                      <div className="intellitrack-blocked-note">
                        {buttonState.reason}
                      </div>
                    )}

                    <div className="intellitrack-action-row">
                      <button
                        type="button"
                        className="secondary-action-button"
                        onClick={() => loadDetails(order.id, 'basic', order.SourceListId || '', { returnLabel: 'IntelliTrack' })}
                        disabled={!order.id || loadingDetail}
                      >
                        Open Order
                      </button>
                      <button
                        type="button"
                        className={buttonState.enabled ? 'primary-action-button' : 'danger-button'}
                        onClick={() => toggleIntelliTrackOrder(order, buttonState.enabled)}
                        disabled={buttonState.disabled || intelliTrackActionLoading === orderLoadingKey}
                      >
                        {intelliTrackActionLoading === orderLoadingKey
                          ? 'Submitting...'
                          : buttonState.label}
                      </button>
                      <span>
                        {buttonState.enabled
                          ? 'Turns Enable Tracking on in Bid Listing.'
                          : 'Turns Enable Tracking off in Bid Listing.'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }


  function UploadDigestPanel() {
    const records = uploadDigestData?.records || [];
    const count = uploadDigestData?.count ?? records.length;
    const activeDigestDate = uploadDigestData?.targetDate || uploadDigestDate;
    const dateLabel = formatDateInputLabel(activeDigestDate);
    const isUploadDigestToday = isTodayOrFutureDateInput(activeDigestDate);
    const showUploadDigestStatusPill = !uploadDigestSectionOpen || uploadDigestLoading;

    return (
      <div className="search-card feature-accordion-panel upload-digest-panel">
        <button
          type="button"
          className="feature-section-header-button upload-digest-section-header-button"
          onClick={toggleUploadDigestSection}
          aria-expanded={uploadDigestSectionOpen}
        >
          <span className="feature-section-title-block">
            <span className="feature-section-title">Job Photo Uploads</span>
          </span>
          {showUploadDigestStatusPill && (
            <span className={`feature-section-status-pill ${count > 0 ? 'has-items' : 'is-zero'} ${uploadDigestLoading ? 'is-loading' : ''}`}>
              {uploadDigestLoading ? '...' : formatReportNumber(count)}
            </span>
          )}
          <span className="feature-section-chevron">{uploadDigestSectionOpen ? '▲' : '▼'}</span>
        </button>

        {uploadDigestError && <div className="msg error">{uploadDigestError}</div>}
        {uploadDigestActionError && <div className="msg error">{uploadDigestActionError}</div>}

        {uploadDigestSectionOpen && (
          <div className="feature-section-body upload-digest-section-body">
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

              <div
  className="upload-digest-summary upload-digest-summary-static"
  aria-label={`Pickup and Delivery Photos for ${dateLabel}`}
>
  <span className="upload-digest-title">
    Pickup and Delivery Photos for {dateLabel}
  </span>
</div>

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

            {!uploadDigestError && (
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
        )}
      </div>
    );
  }


  function SalesLeadCard({ lead }) {
    const winRate = lead.QuoteCount > 0 ? lead.QuotesWon / lead.QuoteCount : 0;
    const followUpLabel = lead.FollowUpDue
      ? `Due ${formatSalesDate(lead.NextTouchDate)}`
      : isSalesLeadSuppressedByHandling(lead)
        ? 'Suppressed'
        : isSalesLeadStatusSuppressionLocked(lead)
          ? 'Status locked'
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

    const handleOpenCustomerCard = (row) => {
      if (customerLookupLoading) return;
      openCustomerCardForName(row.CompanyName, row.CustomerCode);
    };

    const handleOpenCustomerCardKeyDown = (event, row) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      handleOpenCustomerCard(row);
    };

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
                </tr>
              </thead>
              <tbody>
                {safeRows.map((row, index) => {
                  const customerLabel = formatSalesActivityLabel(row.CompanyName);

                  return (
                    <tr
                      key={`${title}-${row.id || row.CustomerCode || row.CompanyName || index}`}
                      className="sales-activity-click-row"
                      onClick={() => handleOpenCustomerCard(row)}
                      onKeyDown={(event) => handleOpenCustomerCardKeyDown(event, row)}
                      role="button"
                      tabIndex={0}
                      title="Open customer card"
                      aria-label={`Open customer card for ${customerLabel}`}
                    >
                      <td>{customerLabel}</td>
                      <td>{formatSalesActivityLabel(row.CustomerCode)}</td>
                      <td>{formatSalesActivityDate(row.NextTouchDate)}</td>
                      <td>{formatReportNumber(row.QuoteCount)}</td>
                      <td>{formatSalesActivityDate(row.FirstQuoteDate)}</td>
                      <td>{formatSalesActivityDate(row.LastQuoteDate)}</td>
                      <td><span className={getSalesLeadStatusClass(row.Status)}>{row.Status || '-'}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  function SalesActivityNoteList({ title, description, rows, dateField = 'ActivityDate' }) {
    const safeRows = Array.isArray(rows) ? rows : [];

    const handleOpenCustomerCard = (row) => {
      if (customerLookupLoading) return;
      openCustomerCardForName(row.CompanyName, row.CustomerCode);
    };

    const handleOpenCustomerCardKeyDown = (event, row) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      handleOpenCustomerCard(row);
    };

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
            {safeRows.map((row, index) => {
              const customerLabel = row.CompanyName || 'Unknown Customer';

              return (
                <article
                  key={`${title}-${row.id || row.CustomerCode || row.ActivityDate || index}`}
                  className="sales-activity-note-card sales-activity-click-card"
                  onClick={() => handleOpenCustomerCard(row)}
                  onKeyDown={(event) => handleOpenCustomerCardKeyDown(event, row)}
                  role="button"
                  tabIndex={0}
                  title="Open customer card"
                  aria-label={`Open customer card for ${customerLabel}`}
                >
                  <div className="sales-activity-note-card-header">
                    <div>
                      <strong>{customerLabel}</strong>
                      <span>
                        {[row.CustomerCode, formatSalesActivityDate(row[dateField]), row.Author].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                    <span className="sales-activity-open-hint">Click to open card</span>
                  </div>
                  <p>{truncateSalesText(row.Note || row.Title || '-', 260)}</p>
                </article>
              );
            })}
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
      <div className="report-card compact-report-card accordion-inner-card sales-report-card sales-activity-card briefing-report-card">
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
                setSalesActivityPdfError('');
                clearPdfExportNotice('salesActivity');
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

          {!salesActivityReport && (
            <button
              type="button"
              className="pdf-export-button"
              onClick={downloadSalesActivityPdf}
              disabled={salesActivityPdfLoading || salesActivityLoading}
            >
              {salesActivityPdfLoading ? 'Exporting PDF...' : 'Export PDF'}
            </button>
          )}
        </div>

        <div className="pdf-export-guidance">PDF exports download to your default Downloads folder. If your browser asks, use the folder you choose.</div>

        {getPdfExportNotice('salesActivity') && (
          <div className="pdf-export-success">{getPdfExportNotice('salesActivity')}</div>
        )}

        {salesActivityPdfError && (
          <div className="msg error pdf-export-error">{salesActivityPdfError}</div>
        )}

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
            <div className="report-ready-actions">
              <button className="view-button" onClick={() => setSalesActivityModalOpen(true)}>
                Reopen Preview
              </button>
              <button
                type="button"
                className="pdf-export-button compact"
                onClick={downloadSalesActivityPdf}
                disabled={salesActivityPdfLoading}
              >
                {salesActivityPdfLoading ? 'Exporting...' : 'Export PDF'}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }


  function getMonthlyOpsLoadRevenue(load = {}) {
    return Number(load.GrossRevenue ?? load.Revenue ?? load.revenue ?? 0) || 0;
  }

  function sortMonthlyOpsLoadRows(rows = []) {
    return [...(rows || [])].sort((a, b) => (
      String(a.PickupDate || a.pickupDate || '').localeCompare(String(b.PickupDate || b.pickupDate || '')) ||
      String(a.BOL || a.BidID || a.id || '').localeCompare(String(b.BOL || b.BidID || b.id || ''), undefined, { numeric: true })
    ));
  }

  function getMonthlyOpsTopCustomerRow() {
    const customers = monthlyOpsReport?.sections?.customers || [];
    const topCustomer = monthlyOpsReport?.summary?.topCustomer || '';
    return customers.find((row) => normalizeSearchValue(row.customer) === normalizeSearchValue(topCustomer)) || customers[0] || null;
  }

  function getMonthlyOpsTopRouteRow() {
    const routes = monthlyOpsReport?.sections?.routes || [];
    const topRoute = monthlyOpsReport?.summary?.topRoute || '';
    return routes.find((row) => normalizeSearchValue(row.route) === normalizeSearchValue(topRoute)) || routes[0] || null;
  }

  function getMonthlyOpsTopEmptyCityRow() {
    const cities = monthlyOpsReport?.sections?.availability?.topEmptyCities || [];
    const topCity = monthlyOpsReport?.summary?.topEmptyCity || '';
    return cities.find((row) => normalizeSearchValue(row.city) === normalizeSearchValue(topCity)) || cities[0] || null;
  }

  function buildMonthlyOpsDrilldown(kind, sourceRow = null) {
    const report = monthlyOpsReport;
    if (!report) return null;

    const summary = report.summary || {};
    const sections = report.sections || {};
    const availability = sections.availability || {};
    const noAvailability = sections.noAvailability || {};
    const monthLabel = report.reportLabel || `${getReportMonthName(report.month || monthlyOpsMonth)} ${report.year || monthlyOpsYear}`;
    const bookings = sortMonthlyOpsLoadRows(sections.bookings || []);
    const offers = [...(sections.offers || [])].sort((a, b) => (
      String(a.SolicitDate || '').localeCompare(String(b.SolicitDate || '')) ||
      String(a.BidID || a.id || '').localeCompare(String(b.BidID || b.id || ''), undefined, { numeric: true })
    ));

    const topCustomer = sourceRow || getMonthlyOpsTopCustomerRow();
    const topRoute = sourceRow || getMonthlyOpsTopRouteRow();
    const topEmptyCity = sourceRow || getMonthlyOpsTopEmptyCityRow();

    const base = {
      kind,
      monthLabel,
      generatedAt: report.generatedAt || '',
      totalRevenue: summary.grossRevenue || 0
    };

    switch (kind) {
      case 'offers':
        return {
          ...base,
          title: 'Total Offers',
          subtitle: `${formatReportNumber(offers.length)} offer row(s) solicited in ${monthLabel}.`,
          rowType: 'offers',
          rows: offers
        };
      case 'winRate':
        return {
          ...base,
          title: 'Win Rate Detail',
          subtitle: `${formatReportNumber(summary.totalBookings)} booked from ${formatReportNumber(summary.totalOffers)} offer row(s).`,
          rowType: 'offers',
          rows: offers
        };
      case 'bookings':
        return {
          ...base,
          title: 'Bookings',
          subtitle: `${formatReportNumber(bookings.length)} Won/TONU booking row(s) picked up in ${monthLabel}.`,
          rowType: 'loads',
          rows: bookings
        };
      case 'revenue':
        return {
          ...base,
          title: 'Gross Revenue Detail',
          subtitle: `${formatReportMoney(summary.grossRevenue)} across ${formatReportNumber(bookings.length)} booked load row(s).`,
          rowType: 'loads',
          rows: bookings
        };
      case 'loadedRate':
        return {
          ...base,
          title: '$ / Loaded Mile Detail',
          subtitle: `${formatReportMoney(summary.avgLoadedMile)} from ${formatReportNumber(summary.loadedMiles)} loaded miles.`,
          rowType: 'loads',
          rows: bookings
        };
      case 'allMileRate':
        return {
          ...base,
          title: '$ / All Miles Detail',
          subtitle: `${formatReportMoney(summary.avgAllMile)} across ${formatReportNumber(summary.totalMiles)} total miles.`,
          rowType: 'loads',
          rows: bookings
        };
      case 'emptyMiles':
        return {
          ...base,
          title: 'Empty Mile Detail',
          subtitle: `${formatPercent(summary.emptyMilePercent)} empty miles from ${formatReportNumber(summary.emptyMiles)} empty / ${formatReportNumber(summary.totalMiles)} total miles.`,
          rowType: 'loads',
          rows: bookings
        };
      case 'noAvailability':
        return {
          ...base,
          title: 'No Availability Detail',
          subtitle: `${formatReportNumber(noAvailability.rows?.length || 0)} no-availability request row(s) in ${monthLabel}.`,
          rowType: 'noAvailability',
          rows: noAvailability.rows || []
        };
      case 'driverDays':
        return {
          ...base,
          title: 'Driver-Days Listed Detail',
          subtitle: `${formatReportNumber(availability.driverDayRows?.length || 0)} unique driver-day row(s) listed available/empty.`,
          rowType: 'availability',
          rows: availability.driverDayRows || []
        };
      case 'topCustomer':
        return {
          ...base,
          title: topCustomer?.customer ? `Top Customer: ${topCustomer.customer}` : 'Top Customer Detail',
          subtitle: `${formatReportMoney(topCustomer?.revenue || 0)} across ${formatReportNumber(topCustomer?.jobs || 0)} booked load row(s).`,
          rowType: 'loads',
          rows: sortMonthlyOpsLoadRows(topCustomer?.loads || [])
        };
      case 'topRoute':
        return {
          ...base,
          title: topRoute?.route ? `Top Route: ${topRoute.route}` : 'Top Route Detail',
          subtitle: `${formatReportMoney(topRoute?.revenue || 0)} across ${formatReportNumber(topRoute?.jobs || 0)} booked load row(s).`,
          rowType: 'loads',
          rows: sortMonthlyOpsLoadRows(topRoute?.loads || [])
        };
      case 'topEmptyCity':
        return {
          ...base,
          title: topEmptyCity?.city ? `Top Empty City: ${topEmptyCity.city}` : 'Top Empty City Detail',
          subtitle: `${formatReportNumber(topEmptyCity?.driverDays || 0)} driver-day row(s).`,
          rowType: 'availability',
          rows: topEmptyCity?.rows || []
        };
      case 'customer':
        return {
          ...base,
          title: sourceRow?.customer ? `Customer: ${sourceRow.customer}` : 'Customer Detail',
          subtitle: `${formatReportMoney(sourceRow?.revenue || 0)} across ${formatReportNumber(sourceRow?.jobs || 0)} booked load row(s).`,
          rowType: 'loads',
          rows: sortMonthlyOpsLoadRows(sourceRow?.loads || [])
        };
      case 'driver':
        return {
          ...base,
          title: sourceRow?.driver ? `Driver: ${sourceRow.driver}` : 'Driver Detail',
          subtitle: `${formatReportMoney(sourceRow?.revenue || 0)} across ${formatReportNumber(sourceRow?.jobs || 0)} booked load row(s).`,
          rowType: 'loads',
          rows: sortMonthlyOpsLoadRows(sourceRow?.loads || [])
        };
      case 'route':
        return {
          ...base,
          title: sourceRow?.route ? `Route: ${sourceRow.route}` : 'Route Detail',
          subtitle: `${formatReportMoney(sourceRow?.revenue || 0)} across ${formatReportNumber(sourceRow?.jobs || 0)} booked load row(s).`,
          rowType: 'loads',
          rows: sortMonthlyOpsLoadRows(sourceRow?.loads || [])
        };
      case 'emptyCity':
        return {
          ...base,
          title: sourceRow?.city ? `Available Empty City: ${sourceRow.city}` : 'Available Empty City Detail',
          subtitle: `${formatReportNumber(sourceRow?.driverDays || 0)} driver-day row(s).`,
          rowType: 'availability',
          rows: sourceRow?.rows || []
        };
      case 'availableDriver':
        return {
          ...base,
          title: sourceRow?.driver ? `Available Days: ${sourceRow.driver}` : 'Available Days Detail',
          subtitle: `${formatReportNumber(sourceRow?.days || 0)} day(s) listed available/empty.`,
          rowType: 'availability',
          rows: sourceRow?.rows || []
        };
      case 'noAvailabilityCustomer':
        return {
          ...base,
          title: sourceRow?.company ? `No Availability: ${sourceRow.company}` : 'No Availability Customer Detail',
          subtitle: `${formatReportNumber(sourceRow?.requests || 0)} request row(s) across ${formatReportNumber(sourceRow?.daysNoAvail || 0)} day(s).`,
          rowType: 'noAvailability',
          rows: sourceRow?.rows || []
        };
      default:
        return null;
    }
  }

  function openMonthlyOpsDrilldown(kind, sourceRow = null) {
    const drilldown = buildMonthlyOpsDrilldown(kind, sourceRow);
    if (!drilldown) return;
    setSelectedMonthlyOpsDrilldown(drilldown);
  }

  function MonthlyOpsKpiCard({ label, value, detail, onClick }) {
    if (onClick) {
      return (
        <button type="button" className="monthly-ops-kpi-card clickable" onClick={onClick}>
          <span>{label}</span>
          <strong>{value}</strong>
          {detail && <small>{detail}</small>}
        </button>
      );
    }

    return (
      <div className="monthly-ops-kpi-card">
        <span>{label}</span>
        <strong>{value}</strong>
        {detail && <small>{detail}</small>}
      </div>
    );
  }

  function MonthlyOperationsDrilldownModal() {
    const drilldown = selectedMonthlyOpsDrilldown;
    if (!monthlyOpsReport || !drilldown) return null;

    const rows = drilldown.rows || [];
    const loadRevenue = rows.reduce((sum, row) => sum + getMonthlyOpsLoadRevenue(row), 0);

    return (
      <div className="modal-overlay report-modal-overlay monthly-ops-drilldown-overlay" onClick={closeMonthlyOperationsDrilldown}>
        <div className="detail-modal report-modal monthly-ops-drilldown-modal" onClick={(e) => e.stopPropagation()}>
          <div className="detail-header report-modal-header monthly-ops-drilldown-header">
            <div>
              <button
                type="button"
                className="gross-driver-card-link gross-month-back-link"
                onClick={closeMonthlyOperationsDrilldown}
              >
                Back to Monthly Operations Summary
              </button>
              <h2>{drilldown.title}</h2>
              <p>{drilldown.subtitle}</p>
            </div>

            <button className="close-button" onClick={closeMonthlyOperationsDrilldown}>
              Close
            </button>
          </div>

          <div className="modal-body report-modal-body">
            <div className="report-kpi-grid monthly-ops-drilldown-kpi-grid">
              <div className="report-kpi-card">
                <span>Rows</span>
                <strong>{formatReportNumber(rows.length)}</strong>
              </div>
              {(drilldown.rowType === 'loads' || drilldown.rowType === 'offers') && (
                <div className="report-kpi-card">
                  <span>Revenue in Rows</span>
                  <strong>{formatReportMoney(loadRevenue)}</strong>
                </div>
              )}
              <div className="report-kpi-card">
                <span>Month</span>
                <strong>{drilldown.monthLabel}</strong>
              </div>
            </div>

            {rows.length === 0 ? (
              <div className="report-alert locked">
                <h4>No supporting rows found.</h4>
                <p>This KPI did not return any supporting detail rows for the selected month.</p>
              </div>
            ) : (
              <div className="report-table-wrap monthly-ops-drilldown-table-wrap">
                {drilldown.rowType === 'noAvailability' ? (
                  <table className="driver-report-table monthly-ops-drilldown-table no-availability-detail-table">
                    <thead>
                      <tr>
                        <th>Solicit Date</th>
                        <th>Customer</th>
                        <th>Requestor</th>
                        <th>Pickup</th>
                        <th>Delivery</th>
                        <th>Type</th>
                        <th>Miles</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, index) => (
                        <tr key={`${row.id || row.solicitDateKey || index}-${index}`}>
                          <td>{formatDateOnly(row.solicitDateKey || row.solicitDate)}</td>
                          <td>{row.company || '-'}</td>
                          <td>{row.requestor || '-'}</td>
                          <td>{row.pickupLocation || '-'}</td>
                          <td>{row.deliveryLocation || '-'}</td>
                          <td>{row.shipmentType || '-'}</td>
                          <td>{formatReportNumber(row.totalMiles)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : drilldown.rowType === 'availability' ? (
                  <table className="driver-report-table monthly-ops-drilldown-table availability-detail-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Driver</th>
                        <th>Truck</th>
                        <th>Location</th>
                        <th>Equipment</th>
                        <th>Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, index) => (
                        <tr key={`${row.driver || row.city || index}-${row.dateOnly || index}-${index}`}>
                          <td>{formatDateOnly(row.dateOnly)}</td>
                          <td>{row.driver || '-'}</td>
                          <td>{row.unitNo || '-'}</td>
                          <td>{row.currentLocation || row.city || '-'}</td>
                          <td>{row.equipmentType || '-'}</td>
                          <td>{row.timeOfDay || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : drilldown.rowType === 'offers' ? (
                  <table className="driver-report-table monthly-ops-drilldown-table offers-detail-table">
                    <thead>
                      <tr>
                        <th>Bid ID</th>
                        <th>Customer</th>
                        <th>Operator/Team</th>
                        <th>Solicited</th>
                        <th>Pickup</th>
                        <th>Status</th>
                        <th>Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, index) => (
                        <tr key={`${row.BidID || row.id || index}-${index}`}>
                          <td>{row.BidID || '-'}</td>
                          <td>{row.Customer || '-'}</td>
                          <td>{row.Driver || '-'}</td>
                          <td>{formatDateOnly(row.SolicitDate)}</td>
                          <td>{row.PickupDateDisplay || formatDateOnly(row.PickupDate)}</td>
                          <td>{row.Status || '-'}</td>
                          <td>{formatReportMoney(getMonthlyOpsLoadRevenue(row))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <table className="driver-report-table monthly-ops-drilldown-table loads-detail-table">
                    <thead>
                      <tr>
                        <th>BOL</th>
                        <th>Customer</th>
                        <th>Driver</th>
                        <th>Truck</th>
                        <th>Pickup</th>
                        <th>Route</th>
                        <th>Status</th>
                        <th>Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, index) => (
                        <tr key={`${row.BOL || row.BidID || row.id || index}-${index}`}>
                          <td>{row.BOL || '-'}</td>
                          <td>{row.Customer || '-'}</td>
                          <td>{row.Driver || '-'}</td>
                          <td>{row.Truck || '-'}</td>
                          <td>{row.PickupDateDisplay || formatDateOnly(row.PickupDate)}</td>
                          <td>{row.Route || [row.Origin, row.Destination].filter(Boolean).join(' to ') || '-'}</td>
                          <td>{row.Status || '-'}</td>
                          <td>{formatReportMoney(getMonthlyOpsLoadRevenue(row))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  function MonthlyOperationsTable({ title, subtitle, rows = [], columns = [], emptyMessage = 'No rows found.', onRowClick }) {
    return (
      <div className="driver-report-section monthly-ops-section">
        <div className="driver-report-section-header">
          <div>
            <h4>{title}</h4>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <div className="driver-report-section-total">
            {formatReportNumber(rows.length)} shown
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="msg sales-activity-empty">{emptyMessage}</div>
        ) : (
          <div className="report-table-wrap monthly-ops-table-wrap">
            <table>
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column.key}>{column.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr
                    key={row.key || row.id || `${title}-${rowIndex}`}
                    className={onRowClick ? 'report-clickable-row' : ''}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    title={onRowClick ? 'View supporting rows' : ''}
                  >
                    {columns.map((column) => (
                      <td key={column.key}>{column.render ? column.render(row) : row[column.key]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  function MonthlyOperationsSummaryPreview() {
    const report = monthlyOpsReport;
    if (!report) return null;

    const summary = report.summary || {};
    const sections = report.sections || {};
    const availability = sections.availability || {};
    const noAvailability = sections.noAvailability || {};

    return (
      <div className="modal-report-preview monthly-ops-preview">
        <div className="sales-summary-grid monthly-ops-summary-grid">
          <MonthlyOpsKpiCard
            label="Total Offers"
            value={formatReportNumber(summary.totalOffers)}
            detail="View solicited rows"
            onClick={() => openMonthlyOpsDrilldown('offers')}
          />
          <MonthlyOpsKpiCard
            label="Bookings"
            value={formatReportNumber(summary.totalBookings)}
            detail="View booked loads"
            onClick={() => openMonthlyOpsDrilldown('bookings')}
          />
          <MonthlyOpsKpiCard
            label="Win %"
            value={formatPercent(summary.winRate)}
            detail="View offer status mix"
            onClick={() => openMonthlyOpsDrilldown('winRate')}
          />
          <MonthlyOpsKpiCard
            label="Gross Revenue"
            value={formatReportMoney(summary.grossRevenue)}
            detail="View revenue loads"
            onClick={() => openMonthlyOpsDrilldown('revenue')}
          />
          <MonthlyOpsKpiCard
            label="$ / Loaded Mile"
            value={formatReportMoney(summary.avgLoadedMile)}
            detail="View load mileage"
            onClick={() => openMonthlyOpsDrilldown('loadedRate')}
          />
          <MonthlyOpsKpiCard
            label="$ / All Miles"
            value={formatReportMoney(summary.avgAllMile)}
            detail="View all-mile detail"
            onClick={() => openMonthlyOpsDrilldown('allMileRate')}
          />
          <MonthlyOpsKpiCard
            label="Empty Mile %"
            value={formatPercent(summary.emptyMilePercent)}
            detail="View empty-mile loads"
            onClick={() => openMonthlyOpsDrilldown('emptyMiles')}
          />
          <MonthlyOpsKpiCard
            label="No Availability"
            value={formatReportNumber(summary.noAvailabilityCount)}
            detail="View missed requests"
            onClick={() => openMonthlyOpsDrilldown('noAvailability')}
          />
          <MonthlyOpsKpiCard
            label="Driver-Days Listed"
            value={formatReportNumber(summary.driverDaysListed)}
            detail="View available days"
            onClick={() => openMonthlyOpsDrilldown('driverDays')}
          />
          <MonthlyOpsKpiCard
            label="Top Customer"
            value={summary.topCustomer || '-'}
            detail="View customer loads"
            onClick={() => openMonthlyOpsDrilldown('topCustomer')}
          />
          <MonthlyOpsKpiCard
            label="Top Route"
            value={summary.topRoute || '-'}
            detail="View route loads"
            onClick={() => openMonthlyOpsDrilldown('topRoute')}
          />
          <MonthlyOpsKpiCard
            label="Top Empty City"
            value={summary.topEmptyCity || '-'}
            detail="View city driver-days"
            onClick={() => openMonthlyOpsDrilldown('topEmptyCity')}
          />
        </div>

        <div className="customer-trends-meta-card monthly-ops-brief-card">
          <strong>Month story</strong>
          {(report.story || []).map((line, index) => (
            <span key={`story-${index}`}>{line}</span>
          ))}
        </div>

        {(report.sourceWarnings?.length > 0 || report.failedLists?.length > 0) && (
          <div className="customer-trends-meta-card warning">
            <strong>Source health notes</strong>
            {report.sourceWarnings?.map((entry, index) => (
              <span key={`source-warning-${index}`}>{entry.SourceList}: {entry.warning || entry.detail}</span>
            ))}
            {report.failedLists?.map((entry, index) => (
              <span key={`source-failed-${index}`}>{entry.SourceList}: {entry.error}</span>
            ))}
          </div>
        )}

        <MonthlyOperationsTable
          title="Bookings by Customer"
          subtitle="Jobs, revenue, rate, and revenue share for the selected month."
          rows={sections.customers || []}
          columns={[
            { key: 'customer', label: 'Customer' },
            { key: 'jobs', label: 'Jobs', render: (row) => formatReportNumber(row.jobs) },
            { key: 'revenue', label: 'Revenue', render: (row) => formatReportMoney(row.revenue) },
            { key: 'avgLoadedMile', label: '$ / Loaded Mile', render: (row) => formatReportMoney(row.avgLoadedMile) },
            { key: 'revenueShare', label: '% Revenue', render: (row) => formatPercent(row.revenueShare) }
          ]}
          emptyMessage="No customer bookings found for this month."
          onRowClick={(row) => openMonthlyOpsDrilldown('customer', row)}
        />

        <MonthlyOperationsTable
          title="Driver Statistics"
          subtitle="Grouped by operator/team, matching the legacy monthly operations summary behavior."
          rows={sections.drivers || []}
          columns={[
            { key: 'driver', label: 'Driver' },
            { key: 'trucks', label: 'Truck(s)', render: (row) => row.trucks || '-' },
            { key: 'jobs', label: 'Jobs', render: (row) => formatReportNumber(row.jobs) },
            { key: 'emptyMiles', label: 'Empty Miles', render: (row) => formatReportNumber(row.emptyMiles) },
            { key: 'loadedMiles', label: 'Loaded Miles', render: (row) => formatReportNumber(row.loadedMiles) },
            { key: 'revenue', label: 'Gross Revenue', render: (row) => formatReportMoney(row.revenue) },
            { key: 'driverPay', label: 'Net Pay', render: (row) => row.driverPay ? formatReportMoney(row.driverPay) : '-' },
            { key: 'avgAllMile', label: '$ / All Miles', render: (row) => formatReportMoney(row.avgAllMile) }
          ]}
          emptyMessage="No driver statistics found for this month."
          onRowClick={(row) => openMonthlyOpsDrilldown('driver', row)}
        />

        <MonthlyOperationsTable
          title="Top Routes"
          subtitle="Revenue-ranked lanes from Won/TONU booked loads."
          rows={sections.routes || []}
          columns={[
            { key: 'route', label: 'Route' },
            { key: 'jobs', label: 'Jobs', render: (row) => formatReportNumber(row.jobs) },
            { key: 'revenue', label: 'Revenue', render: (row) => formatReportMoney(row.revenue) },
            { key: 'avgAllMile', label: '$ / All Mile', render: (row) => formatReportMoney(row.avgAllMile) },
            { key: 'loadedMiles', label: 'Loaded Miles', render: (row) => formatReportNumber(row.loadedMiles) },
            { key: 'emptyMiles', label: 'Empty Miles', render: (row) => formatReportNumber(row.emptyMiles) }
          ]}
          emptyMessage="No routes found for this month."
          onRowClick={(row) => openMonthlyOpsDrilldown('route', row)}
        />

        <div className="monthly-ops-split-grid">
          <MonthlyOperationsTable
            title="Top Available Empty Cities"
            subtitle={`${formatReportNumber(availability.driverDayCityCount || 0)} distinct driver-day-city row(s).`}
            rows={availability.topEmptyCities || []}
            columns={[
              { key: 'city', label: 'City' },
              { key: 'driverDays', label: 'Driver-Days Listed', render: (row) => formatReportNumber(row.driverDays) }
            ]}
            emptyMessage="No available-empty city rows found for this month."
            onRowClick={(row) => openMonthlyOpsDrilldown('emptyCity', row)}
          />

          <MonthlyOperationsTable
            title="Days Empty / Listed Available"
            subtitle={`${formatReportNumber(availability.totalPostings || 0)} available-truck posting(s) scanned for the month.`}
            rows={availability.driverDays || []}
            columns={[
              { key: 'driver', label: 'Driver' },
              { key: 'days', label: 'Days Empty / Listed', render: (row) => formatReportNumber(row.days) }
            ]}
            emptyMessage="No driver-days listed rows found for this month."
            onRowClick={(row) => openMonthlyOpsDrilldown('availableDriver', row)}
          />
        </div>

        <MonthlyOperationsTable
          title="No Availability — Key Customers"
          subtitle={`${formatReportNumber(noAvailability.totalNoAvailability || 0)} request(s), ${formatReportNumber(noAvailability.uniqueCustomers || 0)} customer(s).`}
          rows={noAvailability.keyCustomers || []}
          columns={[
            { key: 'company', label: 'Customer' },
            { key: 'daysNoAvail', label: 'No Availability Days', render: (row) => formatReportNumber(row.daysNoAvail) },
            { key: 'requests', label: 'Requests', render: (row) => formatReportNumber(row.requests) },
            { key: 'miles', label: 'Missed Miles', render: (row) => formatReportNumber(row.miles) }
          ]}
          emptyMessage="No No Availability rows found for this month."
          onRowClick={(row) => openMonthlyOpsDrilldown('noAvailabilityCustomer', row)}
        />

        <div className="customer-trends-meta-card">
          <strong>Data notes</strong>
          <span>{report.anchorDate || 'Offers by Date Solicited; bookings by Pickup Offer Date'}.</span>
          <span>Bid Listing rows scanned: {formatReportNumber(report.sourceRecordsScanned?.bidListing)} · Available Trucks rows scanned: {formatReportNumber(report.sourceRecordsScanned?.availableTrucks)} · No Availability rows scanned: {formatReportNumber(report.sourceRecordsScanned?.noAvailability)}</span>
        </div>
      </div>
    );
  }

  function MonthlyOperationsSummaryPanel() {
    const hasReport = Boolean(monthlyOpsReport);

    return (
      <div className="report-card compact-report-card accordion-inner-card monthly-ops-card briefing-report-card">
        <div className="report-card-header centered-report-header">
          <div>
            <h3>Monthly Operations Summary</h3>
            {hasReport ? (
              <p>{monthlyOpsReport.reportLabel} · Generated {monthlyOpsReport.generatedAt || ''}</p>
            ) : (
              <p>Month-end debrief for bookings, revenue, driver utilization, availability pressure, top lanes, and no-availability demand.</p>
            )}
          </div>
        </div>

        <div className="report-controls centered-report-controls customer-trends-controls">
          <label>
            <span>Month</span>
            <select
              value={monthlyOpsMonth}
              onChange={(e) => {
                setMonthlyOpsMonth(Number(e.target.value));
                setMonthlyOpsReport(null);
                setMonthlyOpsError(null);
                setMonthlyOpsModalOpen(false);
                setSelectedMonthlyOpsDrilldown(null);
                setMonthlyOpsPdfError('');
                clearPdfExportNotice('monthlyOperations');
              }}
              disabled={monthlyOpsLoading}
            >
              {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                <option key={month} value={month}>{getReportMonthName(month)}</option>
              ))}
            </select>
          </label>

          <label>
            <span>Year</span>
            <select
              value={monthlyOpsYear}
              onChange={(e) => {
                setMonthlyOpsYear(Number(e.target.value));
                setMonthlyOpsReport(null);
                setMonthlyOpsError(null);
                setMonthlyOpsModalOpen(false);
                setSelectedMonthlyOpsDrilldown(null);
                setMonthlyOpsPdfError('');
                clearPdfExportNotice('monthlyOperations');
              }}
              disabled={monthlyOpsLoading}
            >
              {getReportYears().map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </label>

          <button onClick={loadMonthlyOperationsSummaryReport} disabled={monthlyOpsLoading}>
            {monthlyOpsLoading ? 'Loading Summary...' : 'Preview Summary'}
          </button>

          {!hasReport && (
            <button
              type="button"
              className="pdf-export-button"
              onClick={downloadMonthlyOperationsSummaryPdf}
              disabled={monthlyOpsPdfLoading || monthlyOpsLoading}
            >
              {monthlyOpsPdfLoading ? 'Exporting PDF...' : 'Export PDF'}
            </button>
          )}
        </div>

        <p className="customer-trends-lock-note">
          Monthly operations summaries unlock at 8:00 AM Eastern on the 5th of the following month.
        </p>

        <div className="pdf-export-guidance">PDF exports download to your default Downloads folder. If your browser asks, use the folder you choose.</div>

        {getPdfExportNotice('monthlyOperations') && (
          <div className="pdf-export-success">{getPdfExportNotice('monthlyOperations')}</div>
        )}

        {monthlyOpsPdfError && (
          <div className="msg error pdf-export-error">{monthlyOpsPdfError}</div>
        )}

        {monthlyOpsLoading && (
          <div className="sales-report-loading">
            Building the month-end operations picture...
          </div>
        )}

        {monthlyOpsError && (
          <div className={`report-alert ${monthlyOpsError.code === 'REPORT_LOCKED' ? 'locked' : 'error'}`}>
            <h4>
              {monthlyOpsError.code === 'REPORT_LOCKED'
                ? 'This report is not available yet.'
                : 'Monthly Operations Summary could not be loaded.'}
            </h4>
            <p>{monthlyOpsError.message}</p>

            {monthlyOpsError.code === 'REPORT_LOCKED' && (
              <>
                <div className="report-alert-grid">
                  <div>
                    <span>Selected report</span>
                    <strong>{monthlyOpsError.reportLabel}</strong>
                  </div>
                  <div>
                    <span>Available starting</span>
                    <strong>{monthlyOpsError.unlockLabel || '-'}</strong>
                  </div>
                </div>

                {monthlyOpsError.lockReason && <p>{monthlyOpsError.lockReason}</p>}
              </>
            )}
          </div>
        )}

        {hasReport && !monthlyOpsModalOpen && (
          <div className="report-ready-card">
            <div>
              <strong>{monthlyOpsReport.reportLabel || 'Monthly Operations Summary'} is ready.</strong>
              <span> The preview opens in a report window.</span>
            </div>
            <div className="report-ready-actions">
              <button className="view-button" onClick={() => setMonthlyOpsModalOpen(true)}>
                Reopen Preview
              </button>
              <button
                type="button"
                className="pdf-export-button compact"
                onClick={downloadMonthlyOperationsSummaryPdf}
                disabled={monthlyOpsPdfLoading}
              >
                {monthlyOpsPdfLoading ? 'Exporting...' : 'Export PDF'}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  function CustomerBookingTrendsPreview() {
    const report = customerTrendReport;

    if (!report) return null;

    const rows = sortCustomerTrendRows(
      filterCustomerTrendRows(report.rows || [], customerTrendBucket),
      customerTrendSort
    );

    const bucketOptions = [
      { value: 'all', label: 'All' },
      { value: 'growing', label: 'Growing' },
      { value: 'declining', label: 'Declining' },
      { value: 'dormant', label: 'Dormant' },
      { value: 'newReturning', label: 'New / Returning' },
      { value: 'steady', label: 'Steady' }
    ];

    return (
      <div className="modal-report-preview customer-trends-preview">
        <div className="sales-summary-grid customer-trends-summary-grid">
          <div>
            <span>{report.throughYear} Revenue</span>
            <strong>{formatReportMoney(report.summary?.currentRevenue)}</strong>
          </div>
          <div>
            <span>{report.throughYear} Jobs</span>
            <strong>{formatReportNumber(report.summary?.currentJobs)}</strong>
          </div>
          <div>
            <span>$ / Loaded Mile</span>
            <strong>{formatReportMoney(report.summary?.currentRatePerLoadedMile)}</strong>
          </div>
          <div>
            <span>Active Customers</span>
            <strong>{formatReportNumber(report.summary?.activeCustomers)}</strong>
          </div>
          <div>
            <span>Top 10 Share</span>
            <strong>{formatPercent(report.summary?.top10RevenueShare)}</strong>
          </div>
        </div>

        <div className="customer-trends-meta-card">
          <strong>Comparison window:</strong> January through {getReportMonthName(report.throughMonth)} for {report.comparedYears?.join(', ') || 'available years'}.
          <span> Rows are built from Bid Listing plus available archives, not the old PDF attachment.</span>
        </div>

        {report.sourceWarnings?.length > 0 && (
          <div className="customer-trends-meta-card warning">
            <strong>Archive field mismatch handled:</strong> one or more source lists did not accept the optimized field-select request, so the server retried with full fields.
            <span>{report.sourceWarnings.map((entry) => entry.SourceList).join(', ')}</span>
          </div>
        )}

        {report.failedLists?.length > 0 && (
          <div className="report-alert error">
            <h4>Some source lists could not be loaded.</h4>
            {report.failedLists.map((entry, index) => (
              <p key={`${entry.SourceList || 'source'}-${index}`}>{entry.SourceList}: {entry.error}</p>
            ))}
          </div>
        )}

        <div className="sales-summary-grid sales-summary-button-grid customer-trends-filter-grid">
          {bucketOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`sales-summary-button ${customerTrendBucket === option.value ? 'active-sales-summary-button' : ''}`}
              onClick={() => setCustomerTrendBucket(option.value)}
            >
              <span>{option.label}</span>
              <strong>{formatReportNumber(report.bucketCounts?.[option.value] || 0)}</strong>
            </button>
          ))}
        </div>

        <div className="report-controls centered-report-controls customer-trends-toolbar">
          <label>
            <span>Sort</span>
            <select
              value={customerTrendSort}
              onChange={(e) => setCustomerTrendSort(e.target.value)}
            >
              <option value="revenue">Most current-year revenue</option>
              <option value="jobs">Most current-year jobs</option>
              <option value="rate">Highest $ / loaded mile</option>
              <option value="share">Highest revenue share</option>
              <option value="yoy">Largest YoY change</option>
              <option value="customer">Alphabetical</option>
            </select>
          </label>
        </div>

        <div className="driver-report-section customer-trends-section">
          <div className="driver-report-section-header">
            <div>
              <h4>Customer Trend Table</h4>
              <p>Click a customer to see the month-by-month comparison.</p>
            </div>
            <div className="driver-report-section-total">
              {formatReportNumber(rows.length)} shown
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="msg sales-activity-empty">No customers matched this trend filter.</div>
          ) : (
            <div className="report-table-wrap customer-trends-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>{report.throughYear} Revenue</th>
                    <th>{report.throughYear} Jobs</th>
                    <th>$ / Loaded Mile</th>
                    <th>% Revenue</th>
                    <th>{report.throughYear - 1} Revenue</th>
                    <th>YoY</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.customer}
                      className="customer-trend-clickable-row"
                      onClick={() => setSelectedCustomerTrend(row)}
                    >
                      <td>{row.customer || '-'}</td>
                      <td>{formatReportMoney(row.currentRevenue)}</td>
                      <td>{formatReportNumber(row.currentJobs)}</td>
                      <td>{formatReportMoney(row.currentRatePerLoadedMile)}</td>
                      <td>{formatPercent(row.revenueShare)}</td>
                      <td>{formatReportMoney(row.previousRevenue)}</td>
                      <td>
                        <span className={`customer-trend-change ${getTrendChangeClass(row.yoyRevenueChange)}`}>
                          {formatTrendChange(row.yoyRevenueChange)}
                        </span>
                      </td>
                      <td><span className={`customer-trend-pill ${row.bucket}`}>{row.bucketLabel || getCustomerTrendBucketLabel(row.bucket)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  }

  function CustomerBookingTrendsPanel() {
    const hasReport = Boolean(customerTrendReport);

    return (
      <div className="report-card compact-report-card accordion-inner-card sales-report-card customer-trends-card briefing-report-card">
        <div className="report-card-header centered-report-header">
          <div>
            <h3>Customer Booking Trends</h3>
            {hasReport ? (
              <p>
                {customerTrendReport.throughMonthLabel || customerTrendReport.reportLabel} · {formatReportNumber(customerTrendReport.customerCount)} customers · Generated {customerTrendReport.generatedAt || ''}
              </p>
            ) : (
              <p>Compare customer revenue, jobs, rate, share, and YoY movement across every available year.</p>
            )}
          </div>
        </div>

        <div className="report-controls centered-report-controls sales-report-controls customer-trends-controls">
          <label>
            <span>Valid Through Month</span>
            <select
              value={customerTrendMonth}
              onChange={(e) => {
                setCustomerTrendMonth(Number(e.target.value));
                setCustomerTrendReport(null);
                setCustomerTrendError(null);
                setCustomerTrendModalOpen(false);
                setSelectedCustomerTrend(null);
              }}
              disabled={customerTrendLoading}
            >
              {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                <option key={month} value={month}>
                  {getReportMonthName(month)}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Through Year</span>
            <select
              value={customerTrendYear}
              onChange={(e) => {
                setCustomerTrendYear(Number(e.target.value));
                setCustomerTrendReport(null);
                setCustomerTrendError(null);
                setCustomerTrendModalOpen(false);
                setSelectedCustomerTrend(null);
              }}
              disabled={customerTrendLoading}
            >
              {getReportYears().map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>

          <button onClick={loadCustomerBookingTrendsReport} disabled={customerTrendLoading}>
            {customerTrendLoading ? 'Loading Trends...' : 'Preview Trends'}
          </button>
        </div>

        <p className="customer-trends-lock-note">
          Monthly trend windows unlock at 8:00 AM Eastern on the 5th of the following month.
        </p>

        {customerTrendLoading && (
          <div className="sales-report-loading">
            Building customer trend picture...
          </div>
        )}

        {customerTrendError && (
          <div className={`report-alert ${customerTrendError.code === 'REPORT_LOCKED' ? 'locked' : 'error'}`}>
            <h4>
              {customerTrendError.code === 'REPORT_LOCKED'
                ? 'This report is not available yet.'
                : 'Customer Booking Trends could not be loaded.'}
            </h4>
            <p>{customerTrendError.message}</p>

            {customerTrendError.code === 'REPORT_LOCKED' && (
              <>
                <div className="report-alert-grid">
                  <div>
                    <span>Selected report</span>
                    <strong>{customerTrendError.reportLabel}</strong>
                  </div>
                  <div>
                    <span>Available starting</span>
                    <strong>{customerTrendError.unlockLabel || '-'}</strong>
                  </div>
                </div>

                {customerTrendError.lockReason && <p>{customerTrendError.lockReason}</p>}
              </>
            )}
          </div>
        )}

        {hasReport && !customerTrendModalOpen && (
          <div className="report-ready-card">
            <div>
              <strong>{customerTrendReport.reportLabel || 'Customer Booking Trends'} is ready.</strong>
              <span> The preview opens in a report window.</span>
            </div>
            <button className="view-button" onClick={() => setCustomerTrendModalOpen(true)}>
              Reopen Preview
            </button>
          </div>
        )}
      </div>
    );
  }

  function CustomerTrendDetailModal() {
    if (!customerTrendReport || !selectedCustomerTrend) return null;

    const row = selectedCustomerTrend;
    const comparedYears = customerTrendReport.comparedYears || [];
    const currentYear = customerTrendReport.throughYear;
    const monthlyRows = (row.monthlyBreakdown || []).filter((month) => month.inComparisonWindow);

    return (
      <div className="modal-overlay report-modal-overlay nested-report-modal-overlay" onClick={closeCustomerTrendDetailModal}>
        <div className="detail-modal report-modal wide-report-modal customer-trend-detail-modal" onClick={(e) => e.stopPropagation()}>
          <div className="detail-header report-modal-header">
            <div>
              <h2>{row.customer || 'Customer Trend'}</h2>
              <p>{customerTrendReport.throughMonthLabel || customerTrendReport.reportLabel} · {row.bucketLabel || getCustomerTrendBucketLabel(row.bucket)}</p>
            </div>

            <div className="customer-trend-detail-actions">
              <button
                type="button"
                className="view-button"
                onClick={() => openCustomerCardFromTrend(row)}
                disabled={customerLookupLoading}
              >
                {customerLookupLoading ? 'Opening...' : 'Open Customer Card'}
              </button>
              <button className="close-button" onClick={closeCustomerTrendDetailModal}>
                Close
              </button>
            </div>
          </div>

          <div className="modal-body report-modal-body">
            <div className="sales-summary-grid customer-trend-detail-grid">
              <div>
                <span>{currentYear} Revenue</span>
                <strong>{formatReportMoney(row.currentRevenue)}</strong>
              </div>
              <div>
                <span>{currentYear} Jobs</span>
                <strong>{formatReportNumber(row.currentJobs)}</strong>
              </div>
              <div>
                <span>$ / Loaded Mile</span>
                <strong>{formatReportMoney(row.currentRatePerLoadedMile)}</strong>
              </div>
              <div>
                <span>Revenue Share</span>
                <strong>{formatPercent(row.revenueShare)}</strong>
              </div>
              <div>
                <span>YoY Change</span>
                <strong className={`customer-trend-change ${getTrendChangeClass(row.yoyRevenueChange)}`}>
                  {formatTrendChange(row.yoyRevenueChange)}
                </strong>
              </div>
            </div>

            <div className="driver-report-section customer-trend-insights-section">
              <div className="driver-report-section-header">
                <div>
                  <h4>Trend Notes</h4>
                  </div>
              </div>
              <div className="customer-trend-insights-list">
                {(row.insights || []).map((insight, index) => (
                  <div key={`${row.customer}-insight-${index}`} className="customer-trend-insight-card">
                    {insight}
                  </div>
                ))}
              </div>
            </div>

            <div className="driver-report-section customer-trend-year-section">
              <div className="driver-report-section-header">
                <div>
                  <h4>Year Summary</h4>
                  <p>Same-month comparison through {getReportMonthName(customerTrendReport.throughMonth)}.</p>
                </div>
              </div>
              <div className="report-table-wrap customer-trends-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Year</th>
                      <th>Jobs</th>
                      <th>Revenue</th>
                      <th>$ / Loaded Mile</th>
                      <th>Revenue Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(row.yearDetails || []).map((detail) => (
                      <tr key={`${row.customer}-year-${detail.year}`} className={Number(detail.year) === Number(currentYear) ? 'report-total-row' : ''}>
                        <td>{detail.year}</td>
                        <td>{formatReportNumber(detail.jobs)}</td>
                        <td>{formatReportMoney(detail.revenue)}</td>
                        <td>{formatReportMoney(detail.ratePerLoadedMile)}</td>
                        <td>{formatPercent(detail.revenueShare)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="driver-report-section customer-trend-month-section">
              <div className="driver-report-section-header">
                <div>
                  <h4>Monthly Breakdown</h4>
                  <p>Revenue by month, side-by-side across available years.</p>
                </div>
              </div>
              <div className="report-table-wrap customer-trends-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Month</th>
                      {comparedYears.map((year) => (
                        <th key={`${row.customer}-month-head-${year}`}>{year} Revenue</th>
                      ))}
                      <th>{currentYear} Jobs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyRows.map((month) => {
                      const currentDetail = month.years?.[String(currentYear)] || {};

                      return (
                        <tr key={`${row.customer}-month-${month.month}`}>
                          <td>{month.monthName}</td>
                          {comparedYears.map((year) => {
                            const detail = month.years?.[String(year)] || {};
                            return <td key={`${row.customer}-month-${month.month}-${year}`}>{formatReportMoney(detail.revenue)}</td>;
                          })}
                          <td>{formatReportNumber(currentDetail.jobs)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }


  function SalesLeadsReportPanel() {
    const summary = salesLeadsReport?.summary || {};
    const allRecords = salesLeadsReport?.records || [];
    const hasSalesLeadsReport = Boolean(salesLeadsReport);
    const activeReportView = isCustomerSalesLeadView(salesLeadsView) ? salesLeadsView : 'all';
    const activeReportSort = salesLeadsSort;
    const activeViewLabel = getSalesLeadViewLabel(activeReportView);
    const records = sortSalesLeadRecords(
      filterSalesLeadRecords(allRecords, activeReportView),
      activeReportSort
    );
    const summaryButtons = customerSalesLeadViewOptions.map((option) => ({
      ...option,
      count: Number(summary?.[option.summaryKey] || 0)
    }));

    function loadInitialSalesCards() {
      const initialView = 'followUpDue';
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
      <div className="report-card compact-report-card accordion-inner-card sales-report-card briefing-report-card">
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
              Click a summary card to filter the customer cards below. Use the Follow-Up Suppression tab for suppress/unsuppress review work.
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

              <button onClick={() => loadSalesLeadsReport({ forceRefresh: true })} disabled={salesLeadsLoading}>
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


  function LeadSuppressionReportPanel() {
    const summary = salesLeadsReport?.summary || {};
    const allRecords = salesLeadsReport?.records || [];
    const hasSalesLeadsReport = Boolean(salesLeadsReport);
    const activeReportView = isLeadSuppressionView(leadSuppressionView) ? leadSuppressionView : 'suppressed';
    const activeReportSort = leadSuppressionSort;
    const activeViewLabel = getSalesLeadViewLabel(activeReportView);
    const records = sortSalesLeadRecords(
      filterSalesLeadRecords(allRecords, activeReportView),
      activeReportSort
    );
    const summaryButtons = leadSuppressionViewOptions.map((option) => ({
      ...option,
      count: Number(summary?.[option.summaryKey] || 0)
    }));

    function loadInitialSuppressionReport() {
      const initialView = 'suppressed';
      const initialSort = getDefaultSalesLeadSort(initialView);

      setLeadSuppressionView(initialView);
      setLeadSuppressionSort(initialSort);
      loadSalesLeadsReport();
    }

    function changeLeadSuppressionView(nextView) {
      const nextSort = getDefaultSalesLeadSort(nextView);

      setLeadSuppressionView(nextView);
      setLeadSuppressionSort(nextSort);
      setSelectedSalesLead(null);
      setSalesLeadsError(null);
    }

    function changeLeadSuppressionSort(nextSort) {
      setLeadSuppressionSort(nextSort);
      setSelectedSalesLead(null);
      setSalesLeadsError(null);
    }

    return (
      <div className="report-card compact-report-card accordion-inner-card sales-report-card lead-suppression-report-card briefing-report-card">
        <div className="report-card-header centered-report-header">
          <div>
            <h3>Follow-Up Suppression</h3>
            {hasSalesLeadsReport && (
              <p>
                {activeViewLabel} · {formatReportNumber(records.length)} shown · {formatReportNumber(salesLeadsReport.recordsScanned || 0)} scanned · {salesLeadsReport.generatedAt || ''}
              </p>
            )}
          </div>
        </div>

        {!hasSalesLeadsReport && !salesLeadsLoading && (
          <div className="sales-report-start">
            <button onClick={loadInitialSuppressionReport} disabled={salesLeadsLoading}>
              Load Follow-Up Suppression
            </button>
          </div>
        )}

        {salesLeadsLoading && (
          <div className="sales-report-loading">
            Loading follow-up suppression...
          </div>
        )}

        {salesLeadsError && (
          <div className="report-alert error">
            <h4>Follow-up Suppression data could not be loaded.</h4>
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
            <div className="sales-summary-grid sales-summary-button-grid lead-suppression-summary-grid">
              {summaryButtons.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`sales-summary-button ${activeReportView === option.value ? 'active-sales-summary-button' : ''}`}
                  onClick={() => changeLeadSuppressionView(option.value)}
                  disabled={salesLeadsLoading}
                >
                  <span>{option.label}</span>
                  <strong>{formatReportNumber(option.count)}</strong>
                </button>
              ))}
            </div>

            <p className="sales-summary-helper">
              Review suppressed or ignored leads, then open a card to suppress or unsuppress follow-up handling.
            </p>

            <div className="report-controls centered-report-controls sales-report-controls">
              <label>
                <span>Sort</span>
                <select
                  value={activeReportSort}
                  onChange={(e) => changeLeadSuppressionSort(e.target.value)}
                  disabled={salesLeadsLoading}
                >
                  <option value="name">Alphabetical</option>
                  <option value="lastQuote">Recently quoted</option>
                  <option value="followUp">Follow-up due</option>
                  <option value="quotes">Most quotes</option>
                  <option value="wins">Most wins</option>
                  <option value="revenue">Most revenue won</option>
                </select>
              </label>

              <button onClick={() => loadSalesLeadsReport({ forceRefresh: true })} disabled={salesLeadsLoading}>
                {salesLeadsLoading ? 'Refreshing Report...' : 'Refresh Report'}
              </button>

              <button
                type="button"
                className="pdf-export-button"
                onClick={downloadSalesSuppressionPdf}
                disabled={salesSuppressionPdfLoading || salesLeadsLoading}
              >
                {salesSuppressionPdfLoading ? 'Exporting PDF...' : 'Export Suppression PDF'}
              </button>
            </div>

            <div className="pdf-export-guidance">Follow-up suppression exports are PDF only and download to your default Downloads folder.</div>

            {getPdfExportNotice('salesSuppression') && (
              <div className="pdf-export-success">{getPdfExportNotice('salesSuppression')}</div>
            )}

            {salesSuppressionPdfError && (
              <div className="msg error pdf-export-error">{salesSuppressionPdfError}</div>
            )}

            <div className="sales-report-results lead-suppression-results">
              {records.length === 0 ? (
                <div className="msg">No leads matched this suppression view.</div>
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
              <ModalReturnTrail
                label={getOrderDrilldownReturnLabel() || (customerTrendModalOpen ? 'Customer Booking Trends' : '')}
                onClick={orderDrilldownReturn ? restoreOrderFromDrilldown : closeSalesLeadModal}
              />
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

            <div className="driver-report-section sales-suppression-control-section">
              <div className="driver-report-section-header">
                <div>
                  <h4>Follow-up Suppression Control</h4>
                  <p>Suppressing a lead marks FollowUpHandling as Suppressed and records today as the suppression date. Unsuppressing clears that handling so the customer can re-enter follow-up workflows.</p>
                </div>
              </div>

              {canUnsuppressSalesLead(lead) ? (
                <div className="sales-suppression-control-card">
                  <div>
                    <strong>This lead is currently suppressed.</strong>
                    <p>{lead.SuppressionReason || 'No suppression reason was saved.'}</p>
                  </div>
                  <button
                    type="button"
                    className="secondary-action-button"
                    onClick={() => updateSelectedSalesLeadSuppression('unsuppress')}
                    disabled={salesLeadSuppressionSaving}
                  >
                    {salesLeadSuppressionSaving ? 'Updating...' : 'Unsuppress Lead'}
                  </button>
                </div>
              ) : canSuppressSalesLead(lead) ? (
                <div className="sales-suppression-control-card sales-suppression-control-card-column">
                  <label>
                    <span>Suppression Reason</span>
                    <textarea
                      value={salesLeadSuppressionReason}
                      placeholder="Why should this lead be removed from follow-up?"
                      onChange={(e) => {
                        setSalesLeadSuppressionReason(e.target.value);
                        setSalesLeadSuppressionError('');
                        setSalesLeadSuppressionMessage('');
                      }}
                      disabled={salesLeadSuppressionSaving}
                    />
                  </label>
                  <div className="sales-suppression-control-footer">
                    <small>Reason is required. The customer record stays visible in Sales Leads; only automated follow-up handling is suppressed.</small>
                    <button
                      type="button"
                      className="danger-button"
                      onClick={() => updateSelectedSalesLeadSuppression('suppress')}
                      disabled={salesLeadSuppressionSaving || !salesLeadSuppressionReason.trim()}
                    >
                      {salesLeadSuppressionSaving ? 'Suppressing...' : 'Suppress Lead'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="sales-suppression-control-card">
                  <div>
                    <strong>This lead is locked by status.</strong>
                    <p>It appears in the suppression report because its Sales Leads status is {lead.Status || 'not active'}. Change the status in Sales Leads if it should re-enter follow-up.</p>
                  </div>
                </div>
              )}

              {salesLeadSuppressionMessage && <div className="msg sales-note-save-message">{salesLeadSuppressionMessage}</div>}
              {salesLeadSuppressionError && <div className="msg error sales-note-save-message">{salesLeadSuppressionError}</div>}
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


  async function loadRecruitingDashboard(options = {}) {
    if (!options.silent) {
      setRecruitingLoading(true);
    }
    setRecruitingError('');

    try {
      const res = await authedFetch(`${API}/recruiting/dashboard`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Unable to load recruiting dashboard.');
      setRecruitingData(data);
      return true;
    } catch (err) {
      if (!options.silent) setRecruitingError(err.message || 'Unable to load recruiting dashboard.');
      return false;
    } finally {
      if (!options.silent) setRecruitingLoading(false);
    }
  }


  async function loadRecruitingSnapshot(options = {}) {
    setRecruitingSnapshotLoading(true);
    setRecruitingSnapshotError('');

    try {
      const res = await authedFetch(`${API}/recruiting/snapshot?months=12`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Unable to load Recruiting Snapshot.');
      setRecruitingSnapshotReport(data);

      const preferredView = (data.segments || []).find((segment) => segment.key === recruitingSnapshotView && segment.metrics?.loadCount > 0)
        ? recruitingSnapshotView
        : ((data.segments || []).find((segment) => segment.metrics?.loadCount > 0)?.key || 'solo');
      setRecruitingSnapshotView(preferredView);

      if (options.open !== false) setRecruitingSnapshotModalOpen(true);
      return true;
    } catch (err) {
      setRecruitingSnapshotError(err.message || 'Unable to load Recruiting Snapshot.');
      if (options.open !== false) setRecruitingSnapshotModalOpen(true);
      return false;
    } finally {
      setRecruitingSnapshotLoading(false);
    }
  }

  function openRecruitingSnapshot() {
    setRecruitingSnapshotModalOpen(true);
    if (!recruitingSnapshotReport && !recruitingSnapshotLoading) {
      loadRecruitingSnapshot({ open: true });
    }
  }

  function closeRecruitingSnapshotModal() {
    setRecruitingSnapshotModalOpen(false);
    setRecruitingSnapshotError('');
  }

  function printRecruitingSnapshot() {
    const snapshotBody = document.querySelector('.recruiting-snapshot-body');
    const snapshotOverlay = document.querySelector('.recruiting-snapshot-overlay');

    if (snapshotBody) snapshotBody.scrollTop = 0;
    if (snapshotOverlay) snapshotOverlay.scrollTop = 0;

    document.body.classList.add('recruiting-snapshot-printing');

    const clearPrintMode = () => {
      document.body.classList.remove('recruiting-snapshot-printing');
      window.removeEventListener('afterprint', clearPrintMode);
    };

    window.addEventListener('afterprint', clearPrintMode);

    window.setTimeout(() => {
      window.print();
      window.setTimeout(clearPrintMode, 600);
    }, 75);
  }

  async function openRecruitingCandidateProfile(candidateId) {
    if (!candidateId) return;
    setRecruitingProfileLoading(true);
    setRecruitingProfileError('');
    setRecruitingActionError('');
    setRecruitingActionMessage('');

    try {
      const res = await authedFetch(`${API}/recruiting/candidates/${encodeURIComponent(candidateId)}/profile`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Unable to load candidate profile.');
      setSelectedRecruitingProfile(data);
      setRecruitingNoteDraft('');
      setRecruitingNoteType('Internal');
      setRecruitingFollowUpDate(data.candidate?.nextFollowUpDate || '');
      setRecruitingStatusDraft(data.candidate?.status || '');
      setRecruitingStatusReason('');
      setRecruitingStatusPickerOpen(false);
      setRecruitingOwnerOverride(false);
    } catch (err) {
      setRecruitingProfileError(err.message || 'Unable to load candidate profile.');
    } finally {
      setRecruitingProfileLoading(false);
    }
  }

  function closeRecruitingProfileModal() {
    setSelectedRecruitingProfile(null);
    setRecruitingProfileError('');
    setRecruitingActionError('');
    setRecruitingActionMessage('');
    setRecruitingNoteDraft('');
    setRecruitingNoteType('Internal');
    setRecruitingFollowUpDate('');
    setRecruitingStatusDraft('');
    setRecruitingStatusReason('');
    setRecruitingStatusPickerOpen(false);
    setRecruitingOwnerOverride(false);
    setDriverRosterPortModalOpen(false);
    setDriverRosterPortCandidate(null);
    setDriverRosterPortDraft(createRecruitingDriverRosterPortDraft());
    setDriverRosterPortError('');
  }

  function updateRecruitingProfileFromResponse(data) {
    setSelectedRecruitingProfile({
      candidate: data.candidate,
      requirements: data.requirements || [],
      notes: data.notes || [],
      teamMembers: data.teamMembers || []
    });
    setRecruitingFollowUpDate(data.candidate?.nextFollowUpDate || '');
    setRecruitingStatusDraft(data.candidate?.status || '');
    setRecruitingStatusReason('');
    setRecruitingStatusPickerOpen(false);
  }

  async function runRecruitingProfileAction(actionKey, endpoint, options = {}) {
    const candidateId = selectedRecruitingProfile?.candidate?.candidateId;
    if (!candidateId) return;

    setRecruitingActionLoading(actionKey);
    setRecruitingActionError('');
    setRecruitingActionMessage('');

    try {
      const res = await authedFetch(endpoint, {
        method: options.method || 'POST',
        headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
        body: options.body ? JSON.stringify(options.body) : undefined
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Recruiting action failed.');
      updateRecruitingProfileFromResponse(data);
      setRecruitingActionMessage(data.message || 'Recruiting record updated.');
      if (typeof options.onSuccess === 'function') {
        options.onSuccess(data);
      }
      await loadRecruitingDashboard({ silent: true });
    } catch (err) {
      setRecruitingActionError(err.message || 'Recruiting action failed.');
    } finally {
      setRecruitingActionLoading('');
    }
  }

  function openRecruitingDriverRosterPort(candidate = selectedRecruitingProfile?.candidate) {
    if (!candidate) return;

    setDriverRosterPortCandidate(candidate);
    setDriverRosterPortDraft(createRecruitingDriverRosterPortDraft(candidate));
    setDriverRosterPortError('');
    setDriverRosterPortModalOpen(true);
  }

  function closeRecruitingDriverRosterPortModal() {
    if (driverRosterPortSaving) return;

    setDriverRosterPortModalOpen(false);
    setDriverRosterPortCandidate(null);
    setDriverRosterPortDraft(createRecruitingDriverRosterPortDraft());
    setDriverRosterPortError('');
  }

  function updateRecruitingDriverRosterPortDraft(field, value) {
    setDriverRosterPortDraft((draft) => {
      if (field === 'truck') {
        const truck = limitDriverRosterPortUnitValue(value);
        return {
          ...draft,
          truck,
          trailerUnitNumber: getRecruitingDriverRosterPortTrailerUnitNumber(truck)
        };
      }

      if (field === 'trailerUnitNumber') {
        return {
          ...draft,
          trailerUnitNumber: limitDriverRosterPortUnitValue(value)
        };
      }

      if (field === 'driverType') {
        return {
          ...draft,
          driverType: normalizeDriverRosterPortDriverType(value)
        };
      }

      return {
        ...draft,
        [field]: value
      };
    });
    setDriverRosterPortError('');
  }

  async function submitRecruitingDriverRosterPort() {
    const candidateId = driverRosterPortCandidate?.candidateId || selectedRecruitingProfile?.candidate?.candidateId;
    if (!candidateId) return;

    if (!String(driverRosterPortDraft.truck || '').trim()) {
      setDriverRosterPortError('Enter the new driver roster truck number before creating the record.');
      return;
    }

    if (!String(driverRosterPortDraft.tmsName || driverRosterPortDraft.operatorTeamName || '').trim()) {
      setDriverRosterPortError('Enter at least a TMS name or Operator / Team name.');
      return;
    }

    const portPayload = {
      ...driverRosterPortDraft,
      truck: limitDriverRosterPortUnitValue(driverRosterPortDraft.truck),
      trailerUnitNumber: getRecruitingDriverRosterPortTrailerUnitNumber(driverRosterPortDraft.truck),
      driverType: normalizeDriverRosterPortDriverType(driverRosterPortDraft.driverType)
    };

    setDriverRosterPortSaving(true);
    setDriverRosterPortError('');

    try {
      const res = await authedFetch(`${API}/recruiting/candidates/${encodeURIComponent(candidateId)}/driver-roster`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(portPayload)
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Unable to create the Driver Roster record.');

      if (data.candidate) updateRecruitingProfileFromResponse(data);
      setRecruitingActionMessage(data.message || 'Driver Roster record created.');
      setDriverRosterPortModalOpen(false);
      setDriverRosterPortCandidate(null);
      setDriverRosterPortDraft(createRecruitingDriverRosterPortDraft());
      await loadRecruitingDashboard({ silent: true });
    } catch (err) {
      setDriverRosterPortError(err.message || 'Unable to create the Driver Roster record.');
    } finally {
      setDriverRosterPortSaving(false);
    }
  }

  async function startRecruitingQualification() {
    const candidateId = selectedRecruitingProfile?.candidate?.candidateId;
    await runRecruitingProfileAction(
      'startQualification',
      `${API}/recruiting/candidates/${encodeURIComponent(candidateId)}/start-qualification`
    );
  }

  async function markRecruitingCandidateQualified() {
    const candidateId = selectedRecruitingProfile?.candidate?.candidateId;
    await runRecruitingProfileAction(
      'markQualified',
      `${API}/recruiting/candidates/${encodeURIComponent(candidateId)}/mark-qualified`,
      {
        onSuccess: (data) => {
          const candidate = data.candidate || {};
          const handoffStatus = String(candidate.rosterHandoffStatus || '').trim();
          const shouldOpenRosterHandoff =
            candidate.status === 'Qualified' &&
            !String(candidate.linkedDriveRosterTruck || '').trim() &&
            (!handoffStatus || handoffStatus === RECRUITING_ROSTER_HANDOFF_STATUS.PENDING);

          if (shouldOpenRosterHandoff) {
            openRecruitingDriverRosterPort(candidate);
          }
        }
      }
    );
  }

  function selectRecruitingStatusDraft(nextStatus) {
    const cleanStatus = String(nextStatus || '').trim();
    if (!cleanStatus) return;

    setRecruitingStatusDraft(cleanStatus);
    setRecruitingStatusReason('');
    setRecruitingStatusPickerOpen(false);
    setRecruitingActionError('');
    setRecruitingActionMessage('');
  }

  async function saveRecruitingCandidateStatus() {
    const candidateId = selectedRecruitingProfile?.candidate?.candidateId;
    const candidate = selectedRecruitingProfile?.candidate || {};
    const nextStatus = String(recruitingStatusDraft || '').trim();
    if (!candidateId || !nextStatus || nextStatus === candidate.status) return;

    if (RECRUITING_MANUAL_CLOSED_STATUS_OPTIONS.includes(nextStatus)) {
      const candidateName = candidate.displayName || candidate.title || 'this candidate';
      const confirmed = window.confirm(
        `Move ${candidateName} to ${nextStatus}? This closes the candidate and inactivates open qualification rows.`
      );
      if (!confirmed) return;
    }

    const body = { status: nextStatus };
    if (nextStatus === 'Disqualified') {
      body.disqualifiedReason = recruitingStatusReason.trim() || candidate.disqualifiedReason || 'Manually disqualified in Kole Connect';
    }

    await runRecruitingProfileAction(
      'statusChange',
      `${API}/recruiting/candidates/${encodeURIComponent(candidateId)}`,
      {
        method: 'PATCH',
        body
      }
    );
  }

  async function saveRecruitingFollowUp(nextDate = recruitingFollowUpDate) {
    const candidateId = selectedRecruitingProfile?.candidate?.candidateId;
    if (!candidateId) return;

    await runRecruitingProfileAction(
      nextDate ? 'saveFollowUp' : 'clearFollowUp',
      `${API}/recruiting/candidates/${encodeURIComponent(candidateId)}`,
      {
        method: 'PATCH',
        body: { nextFollowUpDate: nextDate || '' }
      }
    );
  }

  function openRecruitingCandidateFolder(candidate) {
    const url = candidate?.folderUrl;
    if (url) {
      openExternalLink(url);
    }
  }

  async function updateRecruitingRequirementResult(requirement, result) {
    if (!requirement?.spId) return;

    const selectedResult = String(result || '');
    const twicWaiverSelected = isRecruitingTwicRequirement(requirement) && isRecruitingTwicWaiverSelection(selectedResult);
    const normalizedResult = twicWaiverSelected ? 'Satisfactory' : selectedResult;
    if (!normalizedResult && recruitingOwnerOverride !== true) return;

    const today = getEasternDateInputValue();
    const isCoreRequirement = RECRUITING_CORE_REQUIREMENT_ORDER.includes(requirement.type);

    if (isCoreRequirement && normalizedResult === 'Unsatisfactory') {
      const candidateName = selectedRecruitingProfile?.candidate?.displayName || selectedRecruitingProfile?.candidate?.title || 'this candidate';
      const confirmed = window.confirm(
        `Marking ${requirement.type} as Unsatisfactory will disqualify ${candidateName}. Continue?`
      );
      if (!confirmed) return;
    }

    const body = normalizedResult
      ? {
          result: normalizedResult,
          status: twicWaiverSelected ? RECRUITING_TWIC_WAIVER_STATUS : normalizedResult === 'Unsatisfactory' ? 'Failed' : 'Complete',
          waived: twicWaiverSelected,
          receivedDate: requirement.receivedDate || today,
          completedDate: today,
          active: false,
          ownerOverride: recruitingOwnerOverride === true,
          ...(isRecruitingTwicRequirement(requirement) ? { required: !twicWaiverSelected } : {})
        }
      : {
          result: '',
          status: requirement.receivedDate ? 'Received' : requirement.requestedDate ? 'Requested' : 'Not Started',
          waived: false,
          completedDate: '',
          active: true,
          ownerOverride: recruitingOwnerOverride === true,
          ...(isRecruitingTwicRequirement(requirement) ? { required: true } : {})
        };

    await runRecruitingProfileAction(
      `requirement-${requirement.spId}`,
      `${API}/recruiting/requirements/${encodeURIComponent(requirement.spId)}`,
      {
        method: 'PATCH',
        body
      }
    );
  }

  async function addRecruitingCandidateNote() {
    const candidateId = selectedRecruitingProfile?.candidate?.candidateId;
    if (!candidateId || !recruitingNoteDraft.trim()) return;

    await runRecruitingProfileAction(
      'addNote',
      `${API}/recruiting/candidates/${encodeURIComponent(candidateId)}/notes`,
      {
        method: 'POST',
        body: {
          noteType: recruitingNoteType,
          noteBody: recruitingNoteDraft
        }
      }
    );

    setRecruitingNoteDraft('');
    setRecruitingNoteType('Internal');
  }

  function updateRecruitingCandidateDraft(field, value) {
    setRecruitingCandidateDraft((draft) => {
      const nextDraft = {
        ...draft,
        [field]: value
      };

      if (field === 'firstName' || field === 'lastName') {
        nextDraft.displayName = getRecruitingCandidateDisplayName(nextDraft.firstName, nextDraft.lastName);
      }

      return nextDraft;
    });
  }

  async function createRecruitingCandidate() {
    setRecruitingCandidateCreating(true);
    setRecruitingActionError('');
    setRecruitingActionMessage('');

    try {
      const displayName = getRecruitingCandidateDisplayName(
        recruitingCandidateDraft.firstName,
        recruitingCandidateDraft.lastName
      );
      const candidatePayload = {
        ...recruitingCandidateDraft,
        displayName,
        DisplayName: displayName
      };

      const res = await authedFetch(`${API}/recruiting/candidates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(candidatePayload)
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Unable to add candidate.');

      setRecruitingActionMessage(data.message || 'Candidate added.');
      setRecruitingCreateModalOpen(false);
      setRecruitingCandidateDraft(createRecruitingCandidateDraft());
      await loadRecruitingDashboard({ silent: true });
      if (data.candidate?.candidateId) {
        await openRecruitingCandidateProfile(data.candidate.candidateId);
      }
    } catch (err) {
      setRecruitingActionError(err.message || 'Unable to add candidate.');
    } finally {
      setRecruitingCandidateCreating(false);
    }
  }


  function RecruitingSnapshotModal() {
    if (!recruitingSnapshotModalOpen) return null;

    const report = recruitingSnapshotReport || null;
    const segments = report?.segments || [];
    const selectedSegment = segments.find((segment) => segment.key === recruitingSnapshotView) || segments[0] || null;
    const allDriversSegment = segments.find((segment) => segment.key === 'all') || selectedSegment || null;
    const metrics = selectedSegment?.metrics || {};
    const sample = selectedSegment?.sample || {};
    const allDriverMetrics = allDriversSegment?.metrics || metrics;
    const unknownLoads = Number(report?.unknownSegment?.metrics?.loadCount || 0);
    const localLoadedMileMax = Number(report?.window?.localLoadedMileMax || sample.localLoadedMileMax || 300);
    const allDriverAllMileRate = Number(allDriverMetrics.revenuePerAllMile || 0);
    const allDriverShareMileRate = Number(allDriverMetrics.driverSharePerAllMile || allDriverAllMileRate * 0.8);

    const renderSnapshotMetric = (label, value, detail) => (
      <div className="recruiting-snapshot-metric-card">
        <span>{label}</span>
        <strong>{value}</strong>
        {detail && <small>{detail}</small>}
      </div>
    );

    const renderSegmentMoney = (segment, field) => formatReportMoney(segment?.metrics?.[field] || 0);
    const renderSegmentNumber = (segment, field, digits = 0) => formatReportNumber(segment?.metrics?.[field] || 0, digits);

    return (
      <div className="modal-overlay recruiting-snapshot-overlay" role="presentation" onClick={closeRecruitingSnapshotModal}>
        <div className="detail-modal recruiting-snapshot-modal" role="dialog" aria-modal="true" aria-labelledby="recruiting-snapshot-title" onClick={(e) => e.stopPropagation()}>
          <div className="detail-header recruiting-snapshot-header">
            <div>
              <h2 id="recruiting-snapshot-title">Recruiting Snapshot</h2>
              <p>{report?.window?.label || 'Rolling 12 full months'}</p>
            </div>
            <div className="recruiting-snapshot-header-actions">
              <button type="button" className="secondary-button recruiting-snapshot-print-button" onClick={printRecruitingSnapshot} disabled={!report}>Print / PDF</button>
              <button type="button" className="secondary-button" onClick={() => loadRecruitingSnapshot({ open: true })} disabled={recruitingSnapshotLoading}>
                {recruitingSnapshotLoading ? 'Refreshing...' : 'Refresh Snapshot'}
              </button>
              <button type="button" className="close-button" onClick={closeRecruitingSnapshotModal}>Close</button>
            </div>
          </div>

          <div className="modal-body recruiting-snapshot-body">
            {recruitingSnapshotLoading && !report && <div className="msg">Building recruiting snapshot...</div>}

            {recruitingSnapshotError && (
              <div className="report-alert error">
                <h4>Snapshot could not be loaded.</h4>
                <p>{recruitingSnapshotError}</p>
              </div>
            )}

            {report && (
              <>
                <div className="recruiting-snapshot-intro recruiting-snapshot-meta-strip">
                  <span>{report.generatedAt || '-'} · {formatReportNumber(report.counts?.usableLoads || 0)} won loads analyzed · locals ≤ {formatReportNumber(localLoadedMileMax)} loaded mi excluded from rate math</span>
                </div>

                <div className="recruiting-snapshot-tabs" role="tablist" aria-label="Recruiting snapshot views">
                  {segments.map((segment) => (
                    <button
                      key={segment.key}
                      type="button"
                      className={segment.key === selectedSegment?.key ? 'active' : ''}
                      onClick={() => setRecruitingSnapshotView(segment.key)}
                    >
                      <strong>{segment.label}</strong>
                      <span>{formatReportNumber(segment.metrics?.loadCount || 0)} loads · {formatReportNumber(segment.metrics?.trucks || 0)} trucks</span>
                    </button>
                  ))}
                </div>

                {selectedSegment && (
                  <>
                    <div className="recruiting-snapshot-talk-track">
                      <span>Phone talk-track</span>
                      <p>{selectedSegment.talkTrack}</p>
                    </div>

                    <div className="recruiting-snapshot-metric-grid">
                      {renderSnapshotMetric('Avg Active Month Gross', formatReportMoney(metrics.averageMonthlyGross), `${formatReportNumber(sample.activeTruckMonths || 0)} active truck-month samples · locals included`)}
                      {renderSnapshotMetric('Avg Contractor Net Pay', formatReportMoney(metrics.averageMonthlyDriverPay), sample.driverPayTruckMonths ? `${formatReportNumber(sample.driverPayTruckMonths)} contractor settlement truck-month samples` : 'No contractor settlement pay samples in this view')}
                      {renderSnapshotMetric('Median Active Month', formatReportMoney(metrics.medianMonthlyGross), 'Middle truck-month, less skewed by outliers')}
                      {renderSnapshotMetric('Top Quartile Month', formatReportMoney(metrics.topQuartileMonthlyGross), '75th percentile active truck-month')}
                      {renderSnapshotMetric('Loads / Active Month', formatReportNumber(metrics.averageLoadsPerActiveMonth, 1), `${formatReportNumber(sample.loads || 0)} total loads · ${formatReportNumber(metrics.linehaulLoadCount || 0)} linehaul`)}
                      {renderSnapshotMetric('$ / All Miles', formatReportMoney(allDriverAllMileRate), `All drivers · linehaul only · ${formatReportNumber(allDriverMetrics.linehaulTotalMiles || 0)} total miles`)}
                      {renderSnapshotMetric('Driver Share $ / Mile', formatReportMoney(allDriverShareMileRate), '80% of all-driver all-mile linehaul rate')}
                      {renderSnapshotMetric('Median Deadhead', `${formatReportNumber(metrics.medianDeadhead || 0)} mi`, `Linehaul only · ${formatPercent(metrics.deadheadUnder150Percent)} at 150 mi or less`)}
                      {renderSnapshotMetric('75th % Deadhead', `${formatReportNumber(metrics.p75Deadhead || 0)} mi`, `Linehaul only · ${formatPercent(metrics.deadheadOver300Percent)} at 300 mi or more`)}
                      
                    </div>
                  </>
                )}

                <section className="recruiting-snapshot-section">
                  <div className="recruiting-section-card-header">
                    <div>
                      <h3>Solo / Team Comparison</h3>
                      <p>Gross includes local/day-work. Rate figures are linehaul only. Contractor net pay excludes company trucks.</p>
                    </div>
                  </div>

                  <div className="report-table-wrap recruiting-snapshot-table-wrap">
                    <table className="recruiting-snapshot-table">
                      <thead>
                        <tr>
                          <th>View</th>
                          <th>Trucks</th>
                          <th>Loads</th>
                          <th>Linehaul</th>
                          <th>Avg Mo Gross</th>
                          <th>All $/Mi</th>
                          <th>Driver Share $/Mi</th>
                          <th>Median DH</th>
                          <th>Loads/Mo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {segments.map((segment) => (
                          <tr key={segment.key}>
                            <td><strong>{segment.label}</strong></td>
                            <td>{formatReportNumber(segment.metrics?.trucks || 0)}</td>
                            <td>{formatReportNumber(segment.metrics?.loadCount || 0)}</td>
                            <td>{formatReportNumber(segment.metrics?.linehaulLoadCount || 0)}</td>
                            <td>{renderSegmentMoney(segment, 'averageMonthlyGross')}</td>
                            <td>{renderSegmentMoney(segment, 'revenuePerAllMile')}</td>
                            <td>{renderSegmentMoney(segment, 'driverSharePerAllMile')}</td>
                            <td>{renderSegmentNumber(segment, 'medianDeadhead')} mi</td>
                            <td>{renderSegmentNumber(segment, 'averageLoadsPerActiveMonth', 1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>


                <div className="recruiting-snapshot-disclaimer">
                  <strong>Recruiting use only.</strong>
                  <span>{report.window?.note || 'Historical performance is not a guarantee. Results vary by availability, lane acceptance, equipment, repairs, home time, and market conditions.'}</span>
                  
                  {unknownLoads > 0 && <span>{formatReportNumber(unknownLoads)} loads are visible in the unclassified bucket because Solo/Team could not be matched from Driver Roster.</span>}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  function RecruitingCreateCandidateModal() {
    if (!recruitingCreateModalOpen) return null;

    return (
      <div className="modal-overlay" role="presentation">
        <div className="detail-modal recruiting-create-modal" role="dialog" aria-modal="true" aria-labelledby="recruiting-create-title">
          <div className="detail-header">
            <div>
              <h2 id="recruiting-create-title">Add Recruiting Candidate</h2>
              <p>Creates the Applied candidate row. Starting qualification stays a separate action.</p>
            </div>
            <button type="button" className="close-button" onClick={() => setRecruitingCreateModalOpen(false)}>Close</button>
          </div>

          <div className="modal-body recruiting-create-body">
            <div className="recruiting-form-grid">
              <label>
                <span>First Name</span>
                <input value={recruitingCandidateDraft.firstName} onChange={(e) => updateRecruitingCandidateDraft('firstName', e.target.value)} />
              </label>
              <label>
                <span>Last Name</span>
                <input value={recruitingCandidateDraft.lastName} onChange={(e) => updateRecruitingCandidateDraft('lastName', e.target.value)} />
              </label>
              <label>
                <span>Candidate Type</span>
                <select value={recruitingCandidateDraft.candidateType} onChange={(e) => updateRecruitingCandidateDraft('candidateType', e.target.value)}>
                  {RECRUITING_CANDIDATE_TYPE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <label>
                <span>TeamID</span>
                <input value={recruitingCandidateDraft.teamId} onChange={(e) => updateRecruitingCandidateDraft('teamId', e.target.value)} placeholder="Optional" />
              </label>
              <label>
                <span>Primary Phone</span>
                <input value={recruitingCandidateDraft.primaryPhone} onChange={(e) => updateRecruitingCandidateDraft('primaryPhone', e.target.value)} />
              </label>
              <label>
                <span>Email</span>
                <input value={recruitingCandidateDraft.email} onChange={(e) => updateRecruitingCandidateDraft('email', e.target.value)} />
              </label>
              <label className="wide-field">
                <span>Street Address</span>
                <input value={recruitingCandidateDraft.homeStreet} onChange={(e) => updateRecruitingCandidateDraft('homeStreet', e.target.value)} />
              </label>
              <label>
                <span>City</span>
                <input value={recruitingCandidateDraft.homeCity} onChange={(e) => updateRecruitingCandidateDraft('homeCity', e.target.value)} />
              </label>
              <label>
                <span>State</span>
                <input value={recruitingCandidateDraft.homeState} onChange={(e) => updateRecruitingCandidateDraft('homeState', e.target.value)} maxLength={2} />
              </label>
              <label>
                <span>Zip</span>
                <input value={recruitingCandidateDraft.homeZip} onChange={(e) => updateRecruitingCandidateDraft('homeZip', e.target.value)} />
              </label>
              <label>
                <span>Application Date</span>
                <input type="date" value={recruitingCandidateDraft.applicationDate} onChange={(e) => updateRecruitingCandidateDraft('applicationDate', e.target.value)} />
              </label>
              <label>
                <span>Source</span>
                <select value={recruitingCandidateDraft.source} onChange={(e) => updateRecruitingCandidateDraft('source', e.target.value)}>
                  {RECRUITING_SOURCE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <label>
                <span>Relationship</span>
                <select value={recruitingCandidateDraft.relationshipType} onChange={(e) => updateRecruitingCandidateDraft('relationshipType', e.target.value)}>
                  {RECRUITING_RELATIONSHIP_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
            </div>

            <div className="recruiting-checkbox-row">
              <label><input type="checkbox" checked={recruitingCandidateDraft.ownsTruck} onChange={(e) => updateRecruitingCandidateDraft('ownsTruck', e.target.checked)} /> Owns truck</label>
              <label><input type="checkbox" checked={recruitingCandidateDraft.ownsTrailer} onChange={(e) => updateRecruitingCandidateDraft('ownsTrailer', e.target.checked)} /> Owns trailer</label>
            </div>

            {recruitingActionError && <div className="msg error">{recruitingActionError}</div>}

            <div className="recruiting-modal-actions">
              <button type="button" className="secondary-button" onClick={() => setRecruitingCreateModalOpen(false)}>Cancel</button>
              <button type="button" onClick={createRecruitingCandidate} disabled={recruitingCandidateCreating}>
                {recruitingCandidateCreating ? 'Adding...' : 'Add Candidate'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function RecruitingDriverRosterPortModal() {
    if (!driverRosterPortModalOpen) return null;

    const candidate = driverRosterPortCandidate || selectedRecruitingProfile?.candidate || {};
    const candidateName = candidate.displayName || candidate.title || 'Qualified driver';
    const draft = driverRosterPortDraft || createRecruitingDriverRosterPortDraft(candidate);

    const renderPortInput = (field, label, options = {}) => (
      <label className={options.wide ? 'wide' : ''}>
        <span>{label}</span>
        <input
          type={options.type || 'text'}
          value={draft[field] || ''}
          onChange={(e) => updateRecruitingDriverRosterPortDraft(field, options.uppercase ? e.target.value.toUpperCase() : e.target.value)}
          placeholder={options.placeholder || ''}
          disabled={driverRosterPortSaving || options.disabled}
          readOnly={options.readOnly}
          maxLength={options.maxLength}
          required={options.required}
        />
      </label>
    );

    const renderPortSelect = (field, label, options = []) => (
      <label>
        <span>{label}</span>
        <select
          value={draft[field] || ''}
          onChange={(e) => updateRecruitingDriverRosterPortDraft(field, e.target.value)}
          disabled={driverRosterPortSaving}
        >
          {options.map((option) => (
            <option key={option} value={option}>{option || 'Blank'}</option>
          ))}
        </select>
      </label>
    );

    return (
      <div className="modal-overlay driver-roster-port-overlay" role="presentation">
        <div className="detail-modal driver-roster-port-modal" role="dialog" aria-modal="true" aria-labelledby="driver-roster-port-title">
          <div className="detail-header driver-roster-port-header">
            <div>
              <h2 id="driver-roster-port-title">Create Driver Roster Record</h2>
              <p>{candidateName} · {candidate.candidateId || 'Qualified candidate'} · prefilled from Recruiting</p>
            </div>
            <button type="button" className="close-button" onClick={closeRecruitingDriverRosterPortModal} disabled={driverRosterPortSaving}>Close</button>
          </div>

          <div className="modal-body driver-roster-port-body">
            <div className="driver-roster-port-intro">
              <strong>Port recruiting info into Driver Roster</strong>
              <span>Candidate contact info is prefilled. Add additional operational pieces: truck, BOL prefix, roster status, equipment, plates, VINs, weights, and dimensions.</span>
            </div>

            {driverRosterPortError && <div className="msg error">{driverRosterPortError}</div>}

            <section className="driver-roster-port-section">
              <h3>Driver / Contact</h3>
              <div className="driver-roster-port-grid">
                {renderPortInput('tmsName', 'TMS Name', { required: true })}
                {renderPortInput('operatorTeamName', 'Operator / Team Name', { required: true })}
                {renderPortInput('truck', 'Truck Number', { required: true, placeholder: '4-digit truck # or unit', maxLength: DRIVER_ROSTER_PORT_UNIT_MAX_LENGTH })}
                {renderPortInput('pin', 'Driver PIN')}
                {renderPortInput('cellPhone1', 'Cell Phone 1')}
                {renderPortInput('cellPhone2', 'Cell Phone 2')}
                {renderPortInput('emailAddress1', 'Email Address 1', { wide: true })}
                {renderPortInput('emailAddress2', 'Email Address 2', { wide: true })}
              </div>
            </section>

            <section className="driver-roster-port-section">
              <h3>Roster Setup</h3>
              <div className="driver-roster-port-grid">
                {renderPortSelect('status', 'Status', DRIVER_ROSTER_PORT_STATUS_OPTIONS)}
                {renderPortSelect('driverType', 'Driver Type', DRIVER_ROSTER_PORT_DRIVER_TYPE_OPTIONS)}
                {renderPortSelect('soloOrTeam', 'Solo / Team', DRIVER_ROSTER_PORT_SOLO_TEAM_OPTIONS)}
                {renderPortInput('startDate', 'Start Date', { type: 'date' })}
                {renderPortInput('bolLetterPrefix', 'BOL Letter Prefix', { uppercase: true, placeholder: 'A, B, C...' })}
                {renderPortSelect('trailerType', 'Trailer Type', DRIVER_ROSTER_PORT_TRAILER_TYPE_OPTIONS)}
                {renderPortInput('registeredWeight', 'Registered Weight')}
              </div>
            </section>

            <section className="driver-roster-port-section">
              <h3>Tractor</h3>
              <div className="driver-roster-port-grid">
                {renderPortInput('tractorMake', 'Make')}
                {renderPortInput('tractorYear', 'Year')}
                {renderPortInput('tractorPlate', 'Plate')}
                {renderPortInput('tractorRegisteredState', 'Registered State', { uppercase: true })}
                {renderPortInput('tractorVin', 'VIN', { uppercase: true, wide: true })}
                {renderPortInput('tractorOwner', 'Owner', { wide: true })}
                {renderPortInput('tractorAxles', 'Axles')}
              </div>
            </section>

            <section className="driver-roster-port-section">
              <h3>Trailer</h3>
              <div className="driver-roster-port-grid">
                {renderPortInput('trailerUnitNumber', 'Trailer Unit', { readOnly: true, maxLength: DRIVER_ROSTER_PORT_UNIT_MAX_LENGTH })}
                {renderPortInput('trailerLength', 'Length')}
                {renderPortInput('trailerMake', 'Make')}
                {renderPortInput('trailerYear', 'Year')}
                {renderPortInput('trailerPlate', 'Plate')}
                {renderPortInput('trailerRegisteredState', 'Registered State', { uppercase: true })}
                {renderPortInput('trailerVin', 'VIN', { uppercase: true, wide: true })}
                {renderPortInput('trailerOwner', 'Owner', { wide: true })}
                {renderPortInput('trailerAxles', 'Axles')}
              </div>
            </section>

            <section className="driver-roster-port-section">
              <h3>Weight / Dimensions</h3>
              <div className="driver-roster-port-grid">
                {renderPortInput('emptyWeight', 'Empty Weight')}
                {renderPortInput('steerAxleWeight', 'Steer Axle Weight')}
                {renderPortInput('overallLength', 'Overall Length')}
                {renderPortInput('lowestDeckHeight', 'Lowest Deck Height')}
                {renderPortInput('spacing1to2', 'Spacing 1 to 2')}
                {renderPortInput('spacing2to3', 'Spacing 2 to 3')}
                {renderPortInput('spacing3to4', 'Spacing 3 to 4')}
                {renderPortInput('spacing4to5', 'Spacing 4 to 5')}
              </div>
            </section>

            <div className="driver-roster-port-actions">
              <button type="button" className="secondary-button" onClick={closeRecruitingDriverRosterPortModal} disabled={driverRosterPortSaving}>Cancel</button>
              <button
                type="button"
                onClick={submitRecruitingDriverRosterPort}
                disabled={driverRosterPortSaving || !String(draft.truck || '').trim() || !String(draft.tmsName || draft.operatorTeamName || '').trim()}
              >
                {driverRosterPortSaving ? 'Creating...' : 'Create Driver Roster Record'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function RecruitingProfileModal() {
    if (!selectedRecruitingProfile) return null;

    const candidate = selectedRecruitingProfile.candidate || {};
    const requirements = [...(selectedRecruitingProfile.requirements || [])]
      .sort((a, b) => getRequirementSortIndex(a.type) - getRequirementSortIndex(b.type));
    const notes = selectedRecruitingProfile.notes || [];
    const teamMembers = selectedRecruitingProfile.teamMembers || [];
    const candidateClosed = isRecruitingCandidateClosed(candidate);
    const canStartQualification = ['Prospect', 'Applied'].includes(candidate.status);
    const canMarkQualified = candidate.status === 'Ready to Qualify';
    const canUseOwnerOverride = candidate.status && candidate.status !== 'Qualified';
    const checklistOverrideActive = canUseOwnerOverride && recruitingOwnerOverride;
    const candidateFolderActive = Boolean(candidate.folderPath) && (
      candidate.folderActive === true ||
      (candidate.folderActive === undefined && RECRUITING_HEADS_UP_STATUSES.includes(candidate.status))
    );
    const candidateFolderClosedCopy = candidate.status === 'Qualified'
      ? 'Recruiting folder closed. Driver documents should now live with the driver record.'
      : 'Recruiting folder no longer active for this candidate.';
    const rosterHandoffStatus = String(candidate.rosterHandoffStatus || '').trim();
    const linkedDriverRosterTruck = String(candidate.linkedDriveRosterTruck || '').trim();
    const hasLinkedDriverRosterTruck = Boolean(linkedDriverRosterTruck);
    const canCreatePendingDriverRosterRecord = candidate.status === 'Qualified'
      && rosterHandoffStatus === RECRUITING_ROSTER_HANDOFF_STATUS.PENDING
      && !hasLinkedDriverRosterTruck;
    const canUseAdminDriverRosterAction = candidate.status === 'Qualified'
      && !canCreatePendingDriverRosterRecord
      && !hasLinkedDriverRosterTruck;

    return (
      <div className="modal-overlay" role="presentation">
        <div className="detail-modal recruiting-profile-modal" role="dialog" aria-modal="true" aria-labelledby="recruiting-profile-title">
          <div className="detail-header recruiting-profile-header">
            <div>
              <h2 id="recruiting-profile-title">{candidate.displayName || candidate.title || 'Candidate'}</h2>
              <p>{candidate.candidateId} · {candidate.type || 'Unknown'}{candidate.teamId ? ` · ${candidate.teamId}` : ''}</p>
            </div>
            <button type="button" className="close-button" onClick={closeRecruitingProfileModal}>Close</button>
          </div>

          <div className="modal-body recruiting-profile-body">
            {recruitingActionMessage && <div className="msg success-message">{recruitingActionMessage}</div>}
            {recruitingActionError && <div className="msg error">{recruitingActionError}</div>}

            <section className="recruiting-profile-summary-card">
              <div className="recruiting-profile-title-block">
                <div className="recruiting-status-picker-wrap">
                  <button
                    type="button"
                    className={`${getRecruitingStatusClass(candidate.status)} recruiting-status-pill-button`}
                    onClick={() => setRecruitingStatusPickerOpen((open) => !open)}
                    disabled={Boolean(recruitingActionLoading)}
                    aria-expanded={recruitingStatusPickerOpen}
                    title="Change candidate status"
                  >
                    <span>{candidate.status || 'Unknown'}</span>
                    <span className="recruiting-status-pill-caret" aria-hidden="true">▾</span>
                  </button>

                  {recruitingStatusPickerOpen && (
                    <div className="recruiting-status-picker-menu" role="listbox" aria-label="Candidate status options">
                      {candidate.status && !RECRUITING_MANUAL_STATUS_OPTIONS.includes(candidate.status) && (
                        <button type="button" className="current" disabled>
                          {candidate.status} · current
                        </button>
                      )}
                      {RECRUITING_MANUAL_STATUS_OPTIONS.map((option) => (
                        <button
                          key={option}
                          type="button"
                          className={option === (recruitingStatusDraft || candidate.status) ? 'selected' : ''}
                          onClick={() => selectRecruitingStatusDraft(option)}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <h3>{candidate.title || candidate.displayName}</h3>
                <p>{candidate.email || 'No email'} · {formatPhone(candidate.primaryPhone)}</p>
              </div>
              <div className="recruiting-profile-actions">
                {canStartQualification && (
                  <button type="button" onClick={startRecruitingQualification} disabled={Boolean(recruitingActionLoading)}>
                    {recruitingActionLoading === 'startQualification' ? 'Starting...' : 'Start Qualification'}
                  </button>
                )}
                {canMarkQualified && (
                  <button type="button" onClick={markRecruitingCandidateQualified} disabled={Boolean(recruitingActionLoading)}>
                    {recruitingActionLoading === 'markQualified' ? 'Marking...' : 'Mark Qualified'}
                  </button>
                )}
                {canCreatePendingDriverRosterRecord && (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => openRecruitingDriverRosterPort(candidate)}
                    disabled={Boolean(recruitingActionLoading) || driverRosterPortSaving}
                  >
                    Create Driver Roster Record
                  </button>
                )}
                {hasLinkedDriverRosterTruck && candidate.status === 'Qualified' && (
                  <span className="recruiting-roster-link-pill" title="Recruiting candidate is linked to Driver Roster">
                    Driver Roster: {linkedDriverRosterTruck}
                  </span>
                )}
                {canUseAdminDriverRosterAction && (
                  <details className="recruiting-admin-actions">
                    <summary>Admin Actions</summary>
                    <div>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => openRecruitingDriverRosterPort(candidate)}
                        disabled={Boolean(recruitingActionLoading) || driverRosterPortSaving}
                      >
                        Create Driver Roster Record
                      </button>
                      <small>Use only for a go-forward candidate who still needs a roster row. Historical qualified records should usually stay untouched.</small>
                    </div>
                  </details>
                )}
                {recruitingStatusDraft && recruitingStatusDraft !== candidate.status && (
                  <div className="recruiting-status-save-strip">
                    <span>Change to <strong>{recruitingStatusDraft}</strong></span>
                    {recruitingStatusDraft === 'Disqualified' && (
                      <input
                        value={recruitingStatusReason}
                        onChange={(e) => setRecruitingStatusReason(e.target.value)}
                        placeholder="DQ reason / quick note"
                        disabled={Boolean(recruitingActionLoading)}
                      />
                    )}
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={saveRecruitingCandidateStatus}
                      disabled={Boolean(recruitingActionLoading) || !recruitingStatusDraft || recruitingStatusDraft === candidate.status}
                    >
                      {recruitingActionLoading === 'statusChange' ? 'Saving...' : 'Save Status'}
                    </button>
                  </div>
                )}
              </div>
            </section>

            <section className="recruiting-profile-grid">
              <div className="recruiting-info-card">
                <h3>Overview</h3>
                <dl>
                  <div><dt>Application</dt><dd>{formatDateOnly(candidate.applicationDate)}</dd></div>
                  <div><dt>Last Contact</dt><dd>{formatDateOnly(candidate.lastContactDate)}</dd></div>
                  <div><dt>Next Follow-Up</dt><dd>{formatDateOnly(candidate.nextFollowUpDate)}</dd></div>
                  <div><dt>Source</dt><dd>{candidate.source || '-'}</dd></div>
                  <div><dt>Relationship</dt><dd>{candidate.relationshipType || '-'}</dd></div>
                  <div><dt>Equipment</dt><dd>{candidate.ownsTruck ? 'Owns truck' : 'No truck'} · {candidate.ownsTrailer ? 'Owns trailer' : 'No trailer'}</dd></div>
                  {candidate.status === 'Qualified' && (
                    <div><dt>Driver Roster</dt><dd>{hasLinkedDriverRosterTruck ? linkedDriverRosterTruck : (rosterHandoffStatus || 'Historical / outside recruiting')}</dd></div>
                  )}
                  <div className="recruiting-folder-row"><dt>Folder</dt><dd>{candidate.folderPath ? (
                    candidateFolderActive ? (
                      <button
                        type="button"
                        className="secondary-button recruiting-folder-button"
                        onClick={() => openRecruitingCandidateFolder(candidate)}
                        disabled={!candidate.folderUrl}
                        title={candidate.folderPath}
                      >
                        Open Candidate Folder
                      </button>
                    ) : (
                      <span className="recruiting-folder-inactive-note">{candidateFolderClosedCopy}</span>
                    )
                  ) : '-'}</dd></div>
                </dl>
                <div className="recruiting-followup-control">
                  <label>
                    <span>Follow-Up Date</span>
                    <input
                      type="date"
                      value={recruitingFollowUpDate}
                      onChange={(e) => setRecruitingFollowUpDate(e.target.value)}
                      disabled={candidateClosed || Boolean(recruitingActionLoading)}
                    />
                  </label>
                  <div className="recruiting-followup-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => saveRecruitingFollowUp(recruitingFollowUpDate)}
                      disabled={candidateClosed || !recruitingFollowUpDate || Boolean(recruitingActionLoading)}
                    >
                      {recruitingActionLoading === 'saveFollowUp' ? 'Saving...' : 'Set Follow-Up'}
                    </button>
                    {candidate.nextFollowUpDate && (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => saveRecruitingFollowUp('')}
                        disabled={candidateClosed || Boolean(recruitingActionLoading)}
                      >
                        {recruitingActionLoading === 'clearFollowUp' ? 'Clearing...' : 'Clear'}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="recruiting-info-card">
                <h3>Address</h3>
                <p>{candidate.homeStreet || '-'}</p>
                <p>{[candidate.homeCity, candidate.homeState, candidate.homeZip].filter(Boolean).join(', ') || '-'}</p>
              </div>
            </section>

            <section className="recruiting-section-card">
              <div className="recruiting-section-card-header">
                <div>
                  <h3>Qualification Checklist</h3>
                  <p>{candidate.status === 'Qualified' ? 'Qualified candidates are closed.' : checklistOverrideActive ? 'Override is enabled. Blank can reopen a mistaken result.' : 'Update final requirement outcomes here.'}</p>
                </div>
                {canUseOwnerOverride && (
                  <label className="recruiting-owner-override-toggle">
                    <input
                      type="checkbox"
                      checked={recruitingOwnerOverride}
                      onChange={(e) => setRecruitingOwnerOverride(e.target.checked)}
                    />
                    <span>Override</span>
                  </label>
                )}
              </div>

              <div className="recruiting-requirements-list">
                {requirements.length === 0 ? (
                  <div className="msg">No qualification requirements have been created yet.</div>
                ) : requirements.map((requirement) => {
                  const rowLocked = candidate.status === 'Qualified' || ((candidateClosed || requirement.active === false) && !checklistOverrideActive);
                  const dateLabel = formatDateOnly(requirement.completedDate || requirement.receivedDate || requirement.requestedDate);
                  const resultLabel = getRecruitingRequirementResultLabel(requirement);
                  const requirementSelectValue = isRecruitingTwicRequirement(requirement) && requirement.result === 'Satisfactory' && (requirement.status === RECRUITING_TWIC_WAIVER_STATUS || requirement.required === false)
                    ? RECRUITING_TWIC_WAIVER_RESULT_OPTION
                    : requirement.result || '';
                  const resultOptions = isRecruitingTwicRequirement(requirement)
                    ? [...RECRUITING_REQUIREMENT_RESULT_OPTIONS, RECRUITING_TWIC_WAIVER_RESULT_OPTION]
                    : RECRUITING_REQUIREMENT_RESULT_OPTIONS;

                  return (
                    <div key={requirement.spId} className={`recruiting-requirement-row ${rowLocked ? 'locked' : ''}`.trim()}>
                      <div className="recruiting-requirement-main">
                        <strong>{requirement.type}</strong>
                        {dateLabel && <small>{dateLabel}</small>}
                      </div>
                      <div className="recruiting-requirement-result-control">
                        {rowLocked ? (
                          <span className={getRecruitingStatusClass(resultLabel)}>{resultLabel}</span>
                        ) : (
                          <select
                            value={requirementSelectValue}
                            onChange={(e) => updateRecruitingRequirementResult(requirement, e.target.value)}
                            disabled={Boolean(recruitingActionLoading)}
                            aria-label={`Set result for ${requirement.type}`}
                          >
                            <option value="" disabled={!checklistOverrideActive}>{checklistOverrideActive ? 'No Result / Reopen' : 'Set result...'}</option>
                            {resultOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {teamMembers.length > 0 && (
              <section className="recruiting-section-card">
                <h3>Team</h3>
                <div className="recruiting-team-list">
                  {teamMembers.map((member) => (
                    <button key={member.candidateId} type="button" onClick={() => openRecruitingCandidateProfile(member.candidateId)}>
                      <span>{member.displayName || member.title}</span>
                      <span className={getRecruitingStatusClass(member.status)}>{member.status}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section className="recruiting-section-card">
              <div className="recruiting-section-card-header">
                <div>
                  <h3>Timeline Notes</h3>
                  <p>{notes.length} note{notes.length === 1 ? '' : 's'}</p>
                </div>
              </div>

              <div className="recruiting-note-composer">
                <select value={recruitingNoteType} onChange={(e) => setRecruitingNoteType(e.target.value)}>
                  {RECRUITING_NOTE_TYPE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
                <textarea
                  value={recruitingNoteDraft}
                  onChange={(e) => setRecruitingNoteDraft(e.target.value)}
                  placeholder="Add a recruiting note..."
                  rows={3}
                />
                <button type="button" onClick={addRecruitingCandidateNote} disabled={!recruitingNoteDraft.trim() || Boolean(recruitingActionLoading)}>
                  {recruitingActionLoading === 'addNote' ? 'Saving...' : 'Add Note'}
                </button>
              </div>

              <div className="recruiting-notes-list">
                {notes.length === 0 ? (
                  <div className="msg">No candidate notes yet.</div>
                ) : notes.map((note) => (
                  <article key={note.spId || note.noteId} className="recruiting-note-card">
                    <header>
                      <strong>{note.noteType || 'Note'}</strong>
                      <span>{formatDateOnly(note.noteDate)}</span>
                    </header>
                    <p>{note.noteBody}</p>
                    <small>{note.source || 'Source unknown'} · {note.createdByText || 'Unknown'}</small>
                  </article>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    );
  }

  function RecruitingPanel() {
    const summary = recruitingData?.summary || {};
    const sourceCandidates = recruitingData?.candidates || [];
    const sourceCandidateIds = new Set(sourceCandidates.map((candidate) => candidate.candidateId).filter(Boolean));
    const openRequirementCandidateIds = new Set(
      (recruitingData?.openRequirements || [])
        .map((requirement) => requirement.candidateId)
        .filter((candidateId) => candidateId && sourceCandidateIds.has(candidateId))
    );
    const openRequirementLineCount = (recruitingData?.openRequirements || [])
      .filter((requirement) => requirement.candidateId && sourceCandidateIds.has(requirement.candidateId))
      .length;
    const today = getEasternDateInputValue();
    const isFollowUpDueCandidate = (candidate) =>
      Boolean(candidate.nextFollowUpDate) &&
      candidate.nextFollowUpDate <= today &&
      !RECRUITING_CLOSED_STATUSES.includes(candidate.status);
    const matchesRecruitingView = (candidate) => {
      if (recruitingStatusFilter === 'Heads-Up') return RECRUITING_HEADS_UP_STATUSES.includes(candidate.status);
      if (recruitingStatusFilter === 'All') return true;
      if (recruitingStatusFilter === 'Follow-Up Due') return isFollowUpDueCandidate(candidate);
      if (recruitingStatusFilter === 'Open QR Lines') return openRequirementCandidateIds.has(candidate.candidateId);
      return candidate.status === recruitingStatusFilter;
    };
    const filteredCandidates = sourceCandidates.filter((candidate) => {
      const searchText = recruitingSearch.trim().toLowerCase();
      const searchMatch = !searchText || [
        candidate.displayName,
        candidate.title,
        candidate.candidateId,
        candidate.email,
        candidate.primaryPhone,
        candidate.teamId
      ].some((value) => String(value || '').toLowerCase().includes(searchText));
      return matchesRecruitingView(candidate) && searchMatch;
    });
    const previewCandidates = filteredCandidates.slice(0, RECRUITING_PREVIEW_ROW_LIMIT);
    const hiddenPreviewCount = Math.max(filteredCandidates.length - previewCandidates.length, 0);
    const alertCount = Number(summary.readyToQualify || 0) + Number(summary.followUpDue || 0);
    const showRecruitingPill = !recruitingSectionOpen || recruitingLoading;
    const setRecruitingTileView = (view) => {
      setRecruitingStatusFilter(view);
      setRecruitingSearch('');
    };

    return (
      <div className="search-card feature-accordion-panel recruiting-panel">
        <button
          type="button"
          className="feature-section-header-button recruiting-section-header-button"
          onClick={toggleRecruitingSection}
          aria-expanded={recruitingSectionOpen}
        >
          <span className="feature-section-title-block">
            <span className="feature-section-title">Recruiting</span>
          </span>
          {showRecruitingPill && (
            <span className={`feature-section-status-pill ${alertCount > 0 ? 'has-items' : 'is-zero'} ${recruitingLoading ? 'is-loading' : ''}`}>
              {recruitingLoading ? '...' : formatReportNumber(alertCount)}
            </span>
          )}
          <span className="feature-section-chevron">{recruitingSectionOpen ? '▲' : '▼'}</span>
        </button>

        {recruitingError && <div className="msg error">{recruitingError}</div>}
        {recruitingActionMessage && !selectedRecruitingProfile && <div className="msg success-message">{recruitingActionMessage}</div>}
        {recruitingActionError && !selectedRecruitingProfile && <div className="msg error">{recruitingActionError}</div>}
        {recruitingProfileError && <div className="msg error">{recruitingProfileError}</div>}

        {recruitingSectionOpen && (
          <div className="feature-section-body recruiting-body">
            <div className="recruiting-toolbar">
              <div>
                <h3>Recruiting Pipeline</h3>
                <p>{recruitingData?.generatedAt || 'Pipeline snapshot'}</p>
              </div>
              <div className="recruiting-toolbar-actions">
                <button type="button" className="secondary-button" onClick={() => loadRecruitingDashboard()} disabled={recruitingLoading}>
                  {recruitingLoading ? 'Refreshing...' : 'Refresh'}
                </button>
                <button type="button" className="secondary-button recruiting-snapshot-button" onClick={openRecruitingSnapshot} disabled={recruitingSnapshotLoading}>
                  {recruitingSnapshotLoading ? 'Loading Snapshot...' : 'Recruiting Snapshot'}
                </button>
                <button type="button" onClick={() => setRecruitingCreateModalOpen(true)}>Add Candidate</button>
              </div>
            </div>

            <div className="recruiting-kpi-grid" aria-label="Recruiting quick filters">
              <button type="button" className={`recruiting-kpi-card ${recruitingStatusFilter === 'Applied' ? 'active' : ''}`} onClick={() => setRecruitingTileView('Applied')}>
                <strong>{formatReportNumber(summary.applied || 0)}</strong><span>Applied</span>
              </button>
              <button type="button" className={`recruiting-kpi-card ${recruitingStatusFilter === 'Active Qualification' ? 'active' : ''}`} onClick={() => setRecruitingTileView('Active Qualification')}>
                <strong>{formatReportNumber(summary.activeQualification || 0)}</strong><span>Active Qualification</span>
              </button>
              <button type="button" className={`recruiting-kpi-card ${recruitingStatusFilter === 'Ready to Qualify' ? 'active' : ''}`} onClick={() => setRecruitingTileView('Ready to Qualify')}>
                <strong>{formatReportNumber(summary.readyToQualify || 0)}</strong><span>Ready to Qualify</span>
              </button>
              <button type="button" className={`recruiting-kpi-card ${recruitingStatusFilter === 'Follow-Up Due' ? 'active' : ''}`} onClick={() => setRecruitingTileView('Follow-Up Due')}>
                <strong>{formatReportNumber(summary.followUpDue || 0)}</strong><span>Follow-Up Due</span>
              </button>
              <button
                type="button"
                className={`recruiting-kpi-card ${recruitingStatusFilter === 'Open QR Lines' ? 'active' : ''}`}
                onClick={() => setRecruitingTileView('Open QR Lines')}
                title={`${formatReportNumber(openRequirementLineCount)} open QR line${openRequirementLineCount === 1 ? '' : 's'} across ${formatReportNumber(openRequirementCandidateIds.size)} candidate${openRequirementCandidateIds.size === 1 ? '' : 's'}`}
              >
                <strong>{formatReportNumber(openRequirementCandidateIds.size)}</strong><span>Open QR</span>
              </button>
            </div>

            <div className="recruiting-filters">
              <input
                value={recruitingSearch}
                onChange={(e) => setRecruitingSearch(e.target.value)}
                placeholder="Search candidates, email, phone, TeamID..."
              />
              <select value={recruitingStatusFilter} onChange={(e) => setRecruitingStatusFilter(e.target.value)}>
                {RECRUITING_CANDIDATE_STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </div>

            {recruitingLoading && !recruitingData ? (
              <div className="msg">Loading recruiting pipeline...</div>
            ) : filteredCandidates.length === 0 ? (
              <div className="msg">No recruiting candidates match this view.</div>
            ) : (
              <div className="recruiting-table-wrap">
                <table className="recruiting-candidate-table">
                  <thead>
                    <tr>
                      <th>Candidate</th>
                      <th>Status</th>
                      <th>Type</th>
                      <th>Contact</th>
                      <th>Application</th>
                      <th>Follow-Up</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewCandidates.map((candidate) => (
                      <tr key={candidate.candidateId || candidate.spId} onClick={() => openRecruitingCandidateProfile(candidate.candidateId)}>
                        <td>
                          <strong>{candidate.displayName || candidate.title}</strong>
                          <small>{candidate.candidateId}{candidate.teamId ? ` · ${candidate.teamId}` : ''}</small>
                        </td>
                        <td><span className={getRecruitingStatusClass(candidate.status)}>{candidate.status}</span></td>
                        <td>{candidate.type || '-'}</td>
                        <td>{candidate.email || formatPhone(candidate.primaryPhone)}</td>
                        <td>{formatDateOnly(candidate.applicationDate)}</td>
                        <td>{formatDateOnly(candidate.nextFollowUpDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {hiddenPreviewCount > 0 && (
                  <div className="recruiting-preview-limit-note">
                    Showing first {formatReportNumber(previewCandidates.length)} of {formatReportNumber(filteredCandidates.length)}. Use search or the status filter to narrow this view.
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  function SalesAndLeadsPanel() {
    const isCustomerTrendsOpen = activeReportPanel === 'customerBookingTrends';
    const isSalesActivityOpen = activeReportPanel === 'salesActivity';
    const isLeadSuppressionOpen = activeReportPanel === 'leadSuppression';
    const isSalesLeadsOpen = activeReportPanel === 'salesLeads';

    const salesLeadsFollowUpDueCount = Number(salesLeadsReport?.summary?.followUpDue || 0);
    const salesActivityOverdueFollowUpsCount = Number(salesActivityReport?.summary?.overdueFollowUps || 0);
    const salesAndLeadsPillCount = salesLeadsFollowUpDueCount || salesActivityOverdueFollowUpsCount;
    const salesAndLeadsPillLabel = salesLeadsFollowUpDueCount
      ? `follow-up${salesLeadsFollowUpDueCount === 1 ? '' : 's'} due`
      : 'overdue';
    const showSalesAndLeadsPill = !salesAndLeadsSectionOpen && salesAndLeadsPillCount > 0;
    const showCustomerCardsFollowUpMarker = salesAndLeadsSectionOpen && !isSalesLeadsOpen && salesLeadsFollowUpDueCount > 0;

    return (
      <div className="search-card feature-accordion-panel sales-and-leads-panel">
        <button
          type="button"
          className="feature-section-header-button sales-and-leads-section-header-button"
          onClick={toggleSalesAndLeadsSection}
          aria-expanded={salesAndLeadsSectionOpen}
        >
          <span className="feature-section-title-block">
            <span className="feature-section-title">Sales and Leads</span>
             </span>
          {showSalesAndLeadsPill && (
            <span className="feature-section-status-pill sales-and-leads-status-pill has-items">
              {formatReportNumber(salesAndLeadsPillCount)}
            </span>
          )}
          <span className="feature-section-chevron">{salesAndLeadsSectionOpen ? '▲' : '▼'}</span>
        </button>

        {salesAndLeadsSectionOpen && (
          <div className="feature-section-body sales-and-leads-body reports-accordion-list">
            <div className={`report-accordion ${isCustomerTrendsOpen ? 'open' : ''}`}>
              <button
                type="button"
                className="report-accordion-button"
                onClick={(e) => handleReportPanelClick(e, 'customerBookingTrends')}
              >
                <span>Customer Booking Trends</span>
                <span className="report-accordion-icon">{isCustomerTrendsOpen ? '▼' : '▶'}</span>
              </button>

              {isCustomerTrendsOpen && (
                <div className="report-accordion-body">
                  <CustomerBookingTrendsPanel />
                </div>
              )}
            </div>

            <div className={`report-accordion ${isSalesActivityOpen ? 'open' : ''}`}>
              <button
                type="button"
                className="report-accordion-button"
                onClick={(e) => handleReportPanelClick(e, 'salesActivity')}
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

            <div className={`report-accordion ${isLeadSuppressionOpen ? 'open' : ''}`}>
              <button
                type="button"
                className="report-accordion-button"
                onClick={(e) => handleReportPanelClick(e, 'leadSuppression')}
              >
                <span>Follow-Up Suppression</span>
                <span className="report-accordion-icon">{isLeadSuppressionOpen ? '▼' : '▶'}</span>
              </button>

              {isLeadSuppressionOpen && (
                <div className="report-accordion-body">
                  <LeadSuppressionReportPanel />
                </div>
              )}
            </div>

            <div className={`report-accordion ${isSalesLeadsOpen ? 'open' : ''}`}>
              <button
                type="button"
                className="report-accordion-button"
                onClick={(e) => handleReportPanelClick(e, 'salesLeads')}
              >
                <span>
                  Customer Cards
                  {showCustomerCardsFollowUpMarker && (
                    <span
                      className="report-action-alert-marker sales-follow-up-alert-marker"
                      title={`${formatReportNumber(salesLeadsFollowUpDueCount)} customer${salesLeadsFollowUpDueCount === 1 ? '' : 's'} with follow-ups due`}
                      aria-label={`${formatReportNumber(salesLeadsFollowUpDueCount)} customer${salesLeadsFollowUpDueCount === 1 ? '' : 's'} with follow-ups due`}
                    >
                      *
                    </span>
                  )}
                </span>
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
    );
  }

  function DriverSummaryReport() {
    const monthOptions = Array.from({ length: 12 }, (_, index) => index + 1);
    const isGrossRevenueOpen = activeReportPanel === 'grossRevenue';
    const isYearlyProjectionOpen = activeReportPanel === 'yearlyProjection';
    const isDriverSummaryOpen = activeReportPanel === 'driverSummary';
    const isMonthlyOperationsOpen = activeReportPanel === 'monthlyOperations';
    const isOrdersDueSettlementOpen = activeReportPanel === 'ordersDueSettlement';
    const isWeeklySettlementOpen = activeReportPanel === 'weeklySettlement';
    const isWonNotRegisteredOpen = activeReportPanel === 'wonNotRegistered';
    const isPermitGovernanceOpen = activeReportPanel === 'permitGovernance';
    const isOnThisDayOpen = activeReportPanel === 'onThisDay';
    const isOperationalNotesOpen = activeReportPanel === 'operationalNotes';
    const isActiveDriverRosterOpen = activeReportPanel === 'activeDriverRoster';
    const isInactiveDriverRosterOpen = activeReportPanel === 'inactiveDriverRoster';
    const isFleetEquipmentOpen = activeReportPanel === 'fleetEquipment';
    const isDriverTimeOffOpen = activeReportPanel === 'driverTimeOff';
    const isNoAvailabilityOpen = activeReportPanel === 'noAvailability';
    const isCustomerTrendsOpen = activeReportPanel === 'customerBookingTrends';
    const isSalesActivityOpen = activeReportPanel === 'salesActivity';
    const isLeadSuppressionOpen = activeReportPanel === 'leadSuppression';
    const isSalesLeadsOpen = activeReportPanel === 'salesLeads';
    const isFinancialReportsOpen = isReportGroupOpen('financial');
    const isOperationalReportsOpen = isReportGroupOpen('operational');
    const isDriverFleetReportsOpen = isReportGroupOpen('driverFleet');

    return (
      <div className="search-card feature-accordion-panel reports-panel">
        <button
          type="button"
          className="feature-section-header-button reports-section-header-button"
          onClick={toggleReportsSection}
          aria-expanded={reportsSectionOpen}
        >
          <span className="feature-section-title-block">
            <span className="feature-section-title">Reports</span>
            
          </span>
          {!reportsSectionOpen && (
            <span
              className={`feature-section-status-pill report-alert-status-pill ${
                reportActionAlertCounts.total > 0 ? 'has-alerts' : 'is-zero'
              } ${reportActionAlertsLoading ? 'is-loading' : ''} ${reportActionAlertsError ? 'is-error' : ''}`}
              title={reportActionAlertSummary}
            >
              {reportActionAlertsLoading && !reportActionAlerts
                ? '...'
                : reportActionAlertCounts.total > 0
                  ? formatReportNumber(reportActionAlertCounts.total)
                  : '0'}
            </span>
          )}
          <span className="feature-section-chevron">{reportsSectionOpen ? '▲' : '▼'}</span>
        </button>

        {reportsSectionOpen && (
          <div className="feature-section-body reports-accordion-list">
          <div className={`report-group-accordion ${isFinancialReportsOpen ? 'open' : ''}`}>
            <button
              type="button"
              className="report-group-button"
              onClick={(e) => handleReportGroupClick(e, 'financial')}
            >
              <div>
                <strong>Financial Reports</strong>
              </div>
              <span className="report-accordion-icon">{isFinancialReportsOpen ? '▼' : '▶'}</span>
            </button>

            {isFinancialReportsOpen && (
              <div className="report-group-body">
          <div className={`report-accordion ${isGrossRevenueOpen ? 'open' : ''}`}>
            <button
              type="button"
              className="report-accordion-button"
              onClick={(e) => handleReportPanelClick(e, 'grossRevenue')}
            >
              <span>Gross Revenue Totals</span>
              <span className="report-accordion-icon">{isGrossRevenueOpen ? '▼' : '▶'}</span>
            </button>

            {isGrossRevenueOpen && (
              <div className="report-accordion-body">
                <div className="report-card compact-report-card accordion-inner-card briefing-report-card">
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

          {!userPrefs.hideYearlyProjection && (
          <div className={`report-accordion ${isYearlyProjectionOpen ? 'open' : ''}`}>
            <button
              type="button"
              className="report-accordion-button"
              onClick={(e) => handleReportPanelClick(e, 'yearlyProjection')}
            >
              <span>Yearly Revenue Projection</span>
              <span className="report-accordion-icon">{isYearlyProjectionOpen ? '▼' : '▶'}</span>
            </button>

            {isYearlyProjectionOpen && (
              <div className="report-accordion-body">
                <div className="report-card compact-report-card accordion-inner-card briefing-report-card">
                  <div className="report-card-header centered-report-header">
                    <div>
                      <h3>Yearly Revenue Projection</h3>
                      <p>Uses active driver count and average monthly revenue per active driver to estimate annual run rate.</p>
                    </div>
                  </div>

                  <div className="report-controls centered-report-controls">
                    <label>
                      <span>Year</span>
                      <select
                        value={yearlyProjectionYear}
                        onChange={(e) => {
                          setYearlyProjectionYear(Number(e.target.value));
                          setYearlyProjectionReport(null);
                          setYearlyProjectionError(null);
                          setYearlyProjectionModalOpen(false);
                          setProjectionRevenueDrilldownError('');
                        }}
                      >
                        {getReportYears().map((year) => (
                          <option key={year} value={year}>
                            {year}
                          </option>
                        ))}
                      </select>
                    </label>

                    <button onClick={loadYearlyRevenueProjectionReport} disabled={yearlyProjectionLoading}>
                      {yearlyProjectionLoading ? 'Loading Projection...' : 'Preview Report'}
                    </button>
                  </div>

                  {yearlyProjectionReport && !yearlyProjectionModalOpen && (
                    <div className="report-ready-card">
                      <div>
                        <strong>{yearlyProjectionReport.reportLabel} is ready.</strong>
                        <span> The preview opens in a report window.</span>
                      </div>
                      <button className="view-button" onClick={() => setYearlyProjectionModalOpen(true)}>
                        Reopen Preview
                      </button>
                    </div>
                  )}

                  {yearlyProjectionError && (
                    <div className="report-alert error">
                      <h4>Projection could not be loaded.</h4>
                      <p>{yearlyProjectionError.message}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          )}

          <div className={`report-accordion ${isDriverSummaryOpen ? 'open' : ''}`}>
            <button
              type="button"
              className="report-accordion-button"
              onClick={(e) => handleReportPanelClick(e, 'driverSummary')}
            >
              <span>Monthly Driver Summary Report</span>
              <span className="report-accordion-icon">{isDriverSummaryOpen ? '▼' : '▶'}</span>
            </button>

            {isDriverSummaryOpen && (
              <div className="report-accordion-body">
                <div className="report-card compact-report-card accordion-inner-card briefing-report-card">
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
                          setDriverSummaryPdfError('');
                          clearPdfExportNotice('driverSummary');
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
                          setDriverSummaryPdfError('');
                          clearPdfExportNotice('driverSummary');
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

                    {!driverSummaryReport && (
                      <button
                        type="button"
                        className="pdf-export-button"
                        onClick={downloadDriverSummaryPdf}
                        disabled={driverSummaryPdfLoading || driverSummaryLoading}
                      >
                        {driverSummaryPdfLoading ? 'Exporting PDF...' : 'Export PDF'}
                      </button>
                    )}
                  </div>

                  <div className="pdf-export-guidance">PDF exports download to your default Downloads folder. If your browser asks, use the folder you choose.</div>

                  {getPdfExportNotice('driverSummary') && (
                    <div className="pdf-export-success">{getPdfExportNotice('driverSummary')}</div>
                  )}

                  {driverSummaryPdfError && (
                    <div className="msg error pdf-export-error">{driverSummaryPdfError}</div>
                  )}

                  {driverSummaryReport && !driverSummaryModalOpen && (
                    <div className="report-ready-card">
                      <div>
                        <strong>{driverSummaryReport.reportLabel} is ready.</strong>
                        <span> The preview opens in a report window.</span>
                      </div>
                      <div className="report-ready-actions">
                        <button className="view-button" onClick={() => setDriverSummaryModalOpen(true)}>
                          Reopen Preview
                        </button>
                        <button
                          type="button"
                          className="pdf-export-button compact"
                          onClick={downloadDriverSummaryPdf}
                          disabled={driverSummaryPdfLoading}
                        >
                          {driverSummaryPdfLoading ? 'Exporting...' : 'Export PDF'}
                        </button>
                      </div>
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

          {!userPrefs.hideWeeklySettlementReport && (
          <div className={`report-accordion ${isWeeklySettlementOpen ? 'open' : ''}`}>
            <button
              type="button"
              className="report-accordion-button"
              onClick={(e) => handleReportPanelClick(e, 'weeklySettlement')}
            >
              <span>Weekly Settlement Report</span>
              <span className="report-accordion-icon">{isWeeklySettlementOpen ? '▼' : '▶'}</span>
            </button>

            {isWeeklySettlementOpen && (
              <div className="report-accordion-body">
                <div className="report-card compact-report-card settlement-report-card accordion-inner-card briefing-report-card">
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
                          setWeeklySettlementPdfError('');
                          clearPdfExportNotice('weeklySettlement');
                        }}
                      />
                      <small>Pick the Thursday cutoff date, then preview the report.</small>
                    </label>

                    <button onClick={loadWeeklySettlementReport} disabled={weeklySettlementLoading}>
                      {weeklySettlementLoading ? 'Loading Report...' : 'Preview Report'}
                    </button>

                    {!weeklySettlementReport && (
                      <button
                        type="button"
                        className="pdf-export-button"
                        onClick={downloadWeeklySettlementPdf}
                        disabled={weeklySettlementPdfLoading || weeklySettlementLoading}
                      >
                        {weeklySettlementPdfLoading ? 'Exporting PDF...' : 'Export PDF'}
                      </button>
                    )}
                  </div>

                  <div className="pdf-export-guidance">PDF exports download to your default Downloads folder. If your browser asks, use the folder you choose.</div>

                  {getPdfExportNotice('weeklySettlement') && (
                    <div className="pdf-export-success">{getPdfExportNotice('weeklySettlement')}</div>
                  )}

                  {weeklySettlementPdfError && (
                    <div className="msg error pdf-export-error">{weeklySettlementPdfError}</div>
                  )}

                  {weeklySettlementReport && !weeklySettlementModalOpen && (
                    <div className="report-ready-card">
                      <div>
                        <strong>{weeklySettlementReport.reportLabel} is ready.</strong>
                        <span> The preview opens in a report window.</span>
                      </div>
                      <div className="report-ready-actions">
                        <button className="view-button" onClick={() => setWeeklySettlementModalOpen(true)}>
                          Reopen Preview
                        </button>
                        <button
                          type="button"
                          className="pdf-export-button compact"
                          onClick={downloadWeeklySettlementPdf}
                          disabled={weeklySettlementPdfLoading}
                        >
                          {weeklySettlementPdfLoading ? 'Exporting...' : 'Export PDF'}
                        </button>
                      </div>
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
          )}
              </div>
            )}
          </div>


          <div className={`report-group-accordion ${isOperationalReportsOpen ? 'open' : ''}`}>
            <button
              type="button"
              className="report-group-button"
              onClick={(e) => handleReportGroupClick(e, 'operational')}
            >
              <div>
                <strong>Operational Reports</strong>
              </div>
              <span className="report-group-button-actions">
                {!isOperationalReportsOpen && (
                  <span
                    className={`report-group-alert-pill ${reportActionAlertCounts.total > 0 ? 'has-alerts' : 'is-zero'}`}
                    title={reportActionAlertSummary}
                  >
                    {reportActionAlertCounts.total > 0
                      ? `${formatReportNumber(reportActionAlertCounts.total)} ${reportActionAlertCounts.total === 1 ? 'alert' : 'alerts'}`
                      : 'clear'}
                  </span>
                )}
                <span className="report-accordion-icon">{isOperationalReportsOpen ? '▼' : '▶'}</span>
              </span>
            </button>

            {isOperationalReportsOpen && (
              <div className="report-group-body">
          <div className={`report-accordion ${isMonthlyOperationsOpen ? 'open' : ''}`}>
            <button
              type="button"
              className="report-accordion-button"
              onClick={(e) => handleReportPanelClick(e, 'monthlyOperations')}
            >
              <span>Monthly Operations Summary</span>
              <span className="report-accordion-icon">{isMonthlyOperationsOpen ? '▼' : '▶'}</span>
            </button>

            {isMonthlyOperationsOpen && (
              <div className="report-accordion-body">
                <MonthlyOperationsSummaryPanel />
              </div>
            )}
          </div>

          <div className={`report-accordion ${isOrdersDueSettlementOpen ? 'open' : ''}`}>
            <button
              type="button"
              className="report-accordion-button"
              onClick={(e) => handleReportPanelClick(e, 'ordersDueSettlement')}
            >
              <span>
                Orders Due for Settlement
                {!isOrdersDueSettlementOpen && reportActionAlertCounts.ordersDueSettlement > 0 && (
                  <span
                    className="report-action-alert-marker"
                    title={`${formatReportNumber(reportActionAlertCounts.ordersDueSettlement)} order${reportActionAlertCounts.ordersDueSettlement === 1 ? '' : 's'} due for settlement`}
                    aria-label={`${formatReportNumber(reportActionAlertCounts.ordersDueSettlement)} order${reportActionAlertCounts.ordersDueSettlement === 1 ? '' : 's'} due for settlement`}
                  >
                    *
                  </span>
                )}
              </span>
              <span className="report-accordion-icon">{isOrdersDueSettlementOpen ? '▼' : '▶'}</span>
            </button>

            {isOrdersDueSettlementOpen && (
              <div className="report-accordion-body">
                <div className="report-card compact-report-card accordion-inner-card briefing-report-card">
                  <div className="report-card-header centered-report-header">
                    <div>
                      <h3>Orders Due for Settlement</h3>
                      <p>Completed or ready-to-close orders that still need settlement review.</p>
                    </div>
                  </div>

                  {ordersDueSettlementActionBlocked ? (
                    <div className="report-alert locked action-report-clear-warning">
                      <h4>No settlement action items right now.</h4>
                      <p>{getActionReportClearMessage('Orders Due for Settlement')}</p>
                    </div>
                  ) : liveOrdersDueSettlementReport ? (
                    <>
                      <div className="inline-action-report-toolbar">
                        <span>Live from the Operations Reports ticker.</span>
                        <button
                          type="button"
                          className="view-button"
                          onClick={() => loadReportActionAlerts({ silent: false })}
                          disabled={reportActionAlertsLoading}
                        >
                          {reportActionAlertsLoading ? 'Refreshing...' : 'Refresh'}
                        </button>
                      </div>
                      <OrdersDueSettlementPreview report={liveOrdersDueSettlementReport} inline />
                    </>
                  ) : reportActionAlertsError ? (
                    <div className="report-alert error">
                      <h4>Report ticker could not be loaded.</h4>
                      <p>{reportActionAlertsError}</p>
                    </div>
                  ) : (
                    <div className="report-controls centered-report-controls">
                      <button onClick={() => loadReportActionAlerts({ silent: false })} disabled={reportActionAlertsLoading}>
                        {reportActionAlertsLoading ? 'Checking...' : 'Load Live Rows'}
                      </button>
                    </div>
                  )}

                  {ordersDueSettlementError && !ordersDueSettlementActionBlocked && (
                    <div className={`report-alert ${ordersDueSettlementError.code === 'NO_ACTION_ITEMS' ? 'locked' : 'error'}`}>
                      <h4>{ordersDueSettlementError.code === 'NO_ACTION_ITEMS' ? 'Report not needed.' : 'Report could not be loaded.'}</h4>
                      <p>{ordersDueSettlementError.message}</p>
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
              onClick={(e) => handleReportPanelClick(e, 'wonNotRegistered')}
            >
              <span>
                Orders Won and Not Registered
                {!isWonNotRegisteredOpen && reportActionAlertCounts.wonNotRegistered > 0 && (
                  <span
                    className="report-action-alert-marker"
                    title={`${formatReportNumber(reportActionAlertCounts.wonNotRegistered)} won order${reportActionAlertCounts.wonNotRegistered === 1 ? '' : 's'} not registered`}
                    aria-label={`${formatReportNumber(reportActionAlertCounts.wonNotRegistered)} won order${reportActionAlertCounts.wonNotRegistered === 1 ? '' : 's'} not registered`}
                  >
                    *
                  </span>
                )}
              </span>
              <span className="report-accordion-icon">{isWonNotRegisteredOpen ? '▼' : '▶'}</span>
            </button>

            {isWonNotRegisteredOpen && (
              <div className="report-accordion-body">
                <div className="report-card compact-report-card accordion-inner-card briefing-report-card">
                  <div className="report-card-header centered-report-header">
                    <div>
                      <h3>Orders Won and Not Registered</h3>
                      <p>Won loads that still need TMS registration or follow-through.</p>
                    </div>
                  </div>

                  {wonNotRegisteredActionBlocked ? (
                    <div className="report-alert locked action-report-clear-warning">
                      <h4>No unregistered won orders right now.</h4>
                      <p>{getActionReportClearMessage('Orders Won and Not Registered')}</p>
                    </div>
                  ) : liveWonNotRegisteredReport ? (
                    <>
                      <div className="inline-action-report-toolbar">
                        <span>Live from the Operations Reports ticker.</span>
                        <button
                          type="button"
                          className="view-button"
                          onClick={() => loadReportActionAlerts({ silent: false })}
                          disabled={reportActionAlertsLoading}
                        >
                          {reportActionAlertsLoading ? 'Refreshing...' : 'Refresh'}
                        </button>
                      </div>
                      <WonNotRegisteredPreview report={liveWonNotRegisteredReport} inline />
                    </>
                  ) : reportActionAlertsError ? (
                    <div className="report-alert error">
                      <h4>Report ticker could not be loaded.</h4>
                      <p>{reportActionAlertsError}</p>
                    </div>
                  ) : (
                    <div className="report-controls centered-report-controls">
                      <button onClick={() => loadReportActionAlerts({ silent: false })} disabled={reportActionAlertsLoading}>
                        {reportActionAlertsLoading ? 'Checking...' : 'Load Live Rows'}
                      </button>
                    </div>
                  )}

                  {wonNotRegisteredError && !wonNotRegisteredActionBlocked && (
                    <div className={`report-alert ${wonNotRegisteredError.code === 'NO_ACTION_ITEMS' ? 'locked' : 'error'}`}>
                      <h4>{wonNotRegisteredError.code === 'NO_ACTION_ITEMS' ? 'Report not needed.' : 'Report could not be loaded.'}</h4>
                      <p>{wonNotRegisteredError.message}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>


          <div className={`report-accordion ${isPermitGovernanceOpen ? 'open' : ''}`}>
            <button
              type="button"
              className="report-accordion-button"
              onClick={(e) => handleReportPanelClick(e, 'permitGovernance')}
            >
              <span>
                Permit Governance
                {!isPermitGovernanceOpen && reportActionAlertCounts.permitGovernance > 0 && (
                  <span
                    className="report-action-alert-marker"
                    title={`${formatReportNumber(reportActionAlertCounts.permitGovernance)} order${reportActionAlertCounts.permitGovernance === 1 ? '' : 's'} needing permit requests`}
                    aria-label={`${formatReportNumber(reportActionAlertCounts.permitGovernance)} order${reportActionAlertCounts.permitGovernance === 1 ? '' : 's'} needing permit requests`}
                  >
                    *
                  </span>
                )}
              </span>
              <span className="report-accordion-icon">{isPermitGovernanceOpen ? '▼' : '▶'}</span>
            </button>

            {isPermitGovernanceOpen && (
              <div className="report-accordion-body">
                <div className="report-card compact-report-card accordion-inner-card permit-governance-card briefing-report-card">
                  <div className="report-card-header centered-report-header">
                    <div>
                      <h3>Permit Governance</h3>
                      <p>Current/future Bid Listing loads with permit requests, permit estimates, and permit folder status.</p>
                    </div>
                  </div>

                  <div className="report-controls centered-report-controls">
                    <button onClick={loadPermitGovernanceReport} disabled={permitGovernanceLoading}>
                      {permitGovernanceLoading ? 'Loading Report...' : 'Preview Report'}
                    </button>
                  </div>

                  {permitGovernanceReport && !permitGovernanceModalOpen && (
                    <div className="report-ready-card">
                      <div>
                        <strong>{permitGovernanceReport.reportLabel} is ready.</strong>
                        <span> The preview opens in a report window.</span>
                      </div>
                      <button className="view-button" onClick={() => setPermitGovernanceModalOpen(true)}>
                        Reopen Preview
                      </button>
                    </div>
                  )}

                  {permitGovernanceError && (
                    <div className="report-alert error">
                      <h4>Report could not be loaded.</h4>
                      <p>{permitGovernanceError.message}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>



          {!userPrefs.hideOnThisDay && (
          <div className={`report-accordion ${isOnThisDayOpen ? 'open' : ''}`}>
            <button
              type="button"
              className="report-accordion-button"
              onClick={(e) => handleReportPanelClick(e, 'onThisDay')}
            >
              <span>On This Day</span>
              <span className="report-accordion-icon">{isOnThisDayOpen ? '▼' : '▶'}</span>
            </button>

            {isOnThisDayOpen && (
              <div className="report-accordion-body">
                <div className="report-card compact-report-card accordion-inner-card on-this-day-card briefing-report-card">
                  <div className="report-card-header centered-report-header">
                    <div>
                      <h3>On This Day</h3>
                      <p>Daily operational history: Won/TONU pickups and deliveries, bid records created, uploads, drivers off, no availability, and available trucks posted.</p>
                    </div>
                  </div>

                  <div className="report-controls centered-report-controls">
                    <label>
                      <span>Report Date</span>
                      <input
                        type="date"
                        value={onThisDayDate}
                        onChange={(e) => {
                          setOnThisDayDate(e.target.value);
                          setOnThisDayMode('exact');
                          setOnThisDayReport(null);
                          setOnThisDayError(null);
                          setOnThisDayPdfError('');
                          setOnThisDayModalOpen(false);
                          clearPdfExportNotice('onThisDay');
                        }}
                        disabled={onThisDayLoading}
                      />
                    </label>

                    <button onClick={() => loadOnThisDayReport('exact')} disabled={onThisDayLoading}>
                      {onThisDayLoading ? 'Loading Report...' : 'Preview Report'}
                    </button>
                    {!onThisDayReport && (
                      <button
                        type="button"
                        className="pdf-export-button compact"
                        onClick={downloadOnThisDayPdf}
                        disabled={onThisDayPdfLoading || onThisDayLoading}
                      >
                        {onThisDayPdfLoading ? 'Exporting PDF...' : 'Export PDF'}
                      </button>
                    )}
                  </div>

            

                  {getPdfExportNotice('onThisDay') && !onThisDayModalOpen && (
                    <div className="pdf-export-success">{getPdfExportNotice('onThisDay')}</div>
                  )}

                  {onThisDayPdfError && !onThisDayModalOpen && (
                    <div className="msg error pdf-export-error">{onThisDayPdfError}</div>
                  )}

                  {onThisDayReport && !onThisDayModalOpen && (
                    <div className="report-ready-card">
                      <div>
                        <strong>{onThisDayReport.reportLabel} is ready.</strong>
                        <span> The preview opens in a report window.</span>
                      </div>
                      <div className="report-ready-actions">
                        <button className="view-button" onClick={() => setOnThisDayModalOpen(true)}>
                          Reopen Preview
                        </button>
                        <button
                          type="button"
                          className="pdf-export-button compact"
                          onClick={downloadOnThisDayPdf}
                          disabled={onThisDayPdfLoading || onThisDayLoading}
                        >
                          {onThisDayPdfLoading ? 'Exporting...' : 'Export PDF'}
                        </button>
                      </div>
                    </div>
                  )}

                  {onThisDayError && (
                    <div className="report-alert error">
                      <h4>Report could not be loaded.</h4>
                      <p>{onThisDayError.message}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>


          )}

          <div className={`report-accordion ${isOperationalNotesOpen ? 'open' : ''}`}>
            <button
              type="button"
              className="report-accordion-button"
              onClick={(e) => handleReportPanelClick(e, 'operationalNotes')}
            >
              <span>Order Notes — Last 7 Days</span>
              <span className="report-accordion-icon">{isOperationalNotesOpen ? '▼' : '▶'}</span>
            </button>

            {isOperationalNotesOpen && (
              <div className="report-accordion-body">
                <div className="report-card compact-report-card accordion-inner-card briefing-report-card operational-notes-report-card-shell">
                  <div className="report-card-header centered-report-header">
                    <div>
                      <h3>Order Notes — Last 7 Days</h3>
                      <p>Recent Dispatch, Paperwork, Permits, Billing, Operations, and System notes across all orders.</p>
                    </div>
                  </div>

                  <div className="report-controls centered-report-controls">
                    <button onClick={loadOperationalNotesReport} disabled={operationalNotesLoading}>
                      {operationalNotesLoading ? 'Loading Notes...' : 'Preview Report'}
                    </button>
                  </div>

                  {operationalNotesReport && !operationalNotesModalOpen && (
                    <div className="report-ready-card">
                      <div>
                        <strong>{operationalNotesReport.reportLabel || 'Recent Order Notes'} is ready.</strong>
                              </div>
                      <button className="view-button" onClick={() => {
                        setOperationalNotesTypeFilter('Dispatch');
                        setOperationalNotesModalOpen(true);
                      }}>
                        Reopen Preview
                      </button>
                    </div>
                  )}

                  {operationalNotesError && (
                    <div className="report-alert error">
                      <h4>Report could not be loaded.</h4>
                      <p>{operationalNotesError.message}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className={`report-accordion ${isNoAvailabilityOpen ? 'open' : ''}`}>
            <button
              type="button"
              className="report-accordion-button"
              onClick={(e) => handleReportPanelClick(e, 'noAvailability')}
            >
              <span>No Availability</span>
              <span className="report-accordion-icon">{isNoAvailabilityOpen ? '▼' : '▶'}</span>
            </button>

            {isNoAvailabilityOpen && (
              <div className="report-accordion-body">
                <div className="report-card compact-report-card accordion-inner-card no-availability-card briefing-report-card">
                  <div className="report-card-header centered-report-header">
                    <div>
                      <h3>No Availability</h3>
                      <p>Spot patterns in uncovered opportunities by city/state, customer, month, lane, requestor, and shipment type.</p>
                    </div>
                  </div>

                  <div className="report-controls centered-report-controls">
                    <label>
                      <span>Report Year</span>
                      <select
                        value={noAvailabilityYear}
                        onChange={(e) => {
                          setNoAvailabilityYear(e.target.value);
                          setNoAvailabilityReport(null);
                          setNoAvailabilityError(null);
                          setNoAvailabilityModalOpen(false);
                          clearPdfExportNotice('noAvailabilityTop');
                        }}
                        disabled={noAvailabilityLoading}
                      >
                        <option value="all">All Years</option>
                        {getReportYears().map((year) => (
                          <option key={year} value={year}>{year}</option>
                        ))}
                      </select>
                    </label>

                    <button onClick={loadNoAvailabilityReport} disabled={noAvailabilityLoading}>
                      {noAvailabilityLoading ? 'Loading Report...' : 'Preview Report'}
                    </button>
                  </div>

                  {noAvailabilityReport && !noAvailabilityModalOpen && (
                    <div className="report-ready-card">
                      <div>
                        <strong>{noAvailabilityReport.reportLabel} is ready.</strong>
                        <span> The preview opens in a report window.</span>
                      </div>
                      <div className="report-ready-actions">
                        <button className="view-button" onClick={() => setNoAvailabilityModalOpen(true)}>
                          Reopen Preview
                        </button>
                        <button
                          type="button"
                          className="pdf-export-button compact"
                          onClick={downloadNoAvailabilityTopPdf}
                          disabled={noAvailabilityPdfLoading || noAvailabilityLoading}
                        >
                          {noAvailabilityPdfLoading ? 'Exporting...' : 'Export Top PDF'}
                        </button>
                      </div>
                    </div>
                  )}

                  {getPdfExportNotice('noAvailabilityTop') && !noAvailabilityModalOpen && (
                    <div className="pdf-export-success">{getPdfExportNotice('noAvailabilityTop')}</div>
                  )}

                  {noAvailabilityPdfError && !noAvailabilityModalOpen && (
                    <div className="msg error pdf-export-error">{noAvailabilityPdfError}</div>
                  )}

                  {noAvailabilityError && (
                    <div className="report-alert error">
                      <h4>Report could not be loaded.</h4>
                      <p>{noAvailabilityError.message}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
              </div>
            )}
          </div>


          <div className={`report-group-accordion ${isDriverFleetReportsOpen ? 'open' : ''}`}>
            <button
              type="button"
              className="report-group-button"
              onClick={(e) => handleReportGroupClick(e, 'driverFleet')}
            >
              <div>
                <strong>Driver / Fleet Reports</strong>
              </div>
              <span className="report-accordion-icon">{isDriverFleetReportsOpen ? '▼' : '▶'}</span>
            </button>

            {isDriverFleetReportsOpen && (
              <div className="report-group-body">

                <div className={`report-accordion ${isActiveDriverRosterOpen ? 'open' : ''}`}>
                  <button
                    type="button"
                    className="report-accordion-button"
                    onClick={(e) => handleReportPanelClick(e, 'activeDriverRoster')}
                  >
                    <span>Active Driver Roster</span>
                    <span className="report-accordion-icon">{isActiveDriverRosterOpen ? '▼' : '▶'}</span>
                  </button>

                  {isActiveDriverRosterOpen && (
                    <div className="report-accordion-body">
                      <div className="report-card compact-report-card accordion-inner-card briefing-report-card">
                        <div className="report-card-header centered-report-header">
                          <div>
                            <h3>Active Driver Roster</h3>
                            <p>Active roster drivers with quick contact and equipment context.</p>
                          </div>
                        </div>

                        <div className="report-controls centered-report-controls">
                          <button onClick={loadActiveDriverRosterReport} disabled={activeDriverRosterLoading}>
                            {activeDriverRosterLoading ? 'Loading Report...' : 'Preview Report'}
                          </button>
                          {!activeDriverRosterReport && (
                            <button
                              type="button"
                              className="pdf-export-button"
                              onClick={downloadActiveDriverRosterPdf}
                              disabled={activeDriverRosterPdfLoading || activeDriverRosterLoading}
                            >
                              {activeDriverRosterPdfLoading ? 'Exporting PDF...' : 'Export PDF'}
                            </button>
                          )}
                        </div>

                        <div className="pdf-export-guidance">PDF exports download to your default Downloads folder. If your browser asks, use the folder you choose.</div>

                        {getPdfExportNotice('activeDriverRoster') && !activeDriverRosterModalOpen && (
                          <div className="pdf-export-success">{getPdfExportNotice('activeDriverRoster')}</div>
                        )}

                        {activeDriverRosterPdfError && !activeDriverRosterModalOpen && (
                          <div className="msg error pdf-export-error">{activeDriverRosterPdfError}</div>
                        )}

                        {activeDriverRosterReport && !activeDriverRosterModalOpen && (
                          <div className="report-ready-card">
                            <div>
                              <strong>{activeDriverRosterReport.reportLabel} is ready.</strong>
                              <span> The preview opens in a report window.</span>
                            </div>
                            <div className="report-ready-actions">
                              <button className="view-button" onClick={() => setActiveDriverRosterModalOpen(true)}>
                                Reopen Preview
                              </button>
                              <button
                                type="button"
                                className="pdf-export-button compact"
                                onClick={downloadActiveDriverRosterPdf}
                                disabled={activeDriverRosterPdfLoading}
                              >
                                {activeDriverRosterPdfLoading ? 'Exporting...' : 'Export PDF'}
                              </button>
                            </div>
                          </div>
                        )}

                        {activeDriverRosterError && (
                          <div className="report-alert error">
                            <h4>Report could not be loaded.</h4>
                            <p>{activeDriverRosterError.message}</p>
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
                    onClick={(e) => handleReportPanelClick(e, 'inactiveDriverRoster')}
                  >
                    <span>Inactive Driver Roster</span>
                    <span className="report-accordion-icon">{isInactiveDriverRosterOpen ? '▼' : '▶'}</span>
                  </button>

                  {isInactiveDriverRosterOpen && (
                    <div className="report-accordion-body">
                      <div className="report-card compact-report-card accordion-inner-card briefing-report-card">
                        <div className="report-card-header centered-report-header">
                          <div>
                            <h3>Inactive Driver Roster</h3>
                            <p>Termed/inactive roster records for lookup and cleanup.</p>
                          </div>
                        </div>

                        <div className="report-controls centered-report-controls">
                          <button onClick={loadInactiveDriverRosterReport} disabled={inactiveDriverRosterLoading}>
                            {inactiveDriverRosterLoading ? 'Loading Report...' : 'Preview Report'}
                          </button>
                          {!inactiveDriverRosterReport && (
                            <button
                              type="button"
                              className="pdf-export-button"
                              onClick={downloadInactiveDriverRosterPdf}
                              disabled={inactiveDriverRosterPdfLoading || inactiveDriverRosterLoading}
                            >
                              {inactiveDriverRosterPdfLoading ? 'Exporting PDF...' : 'Export PDF'}
                            </button>
                          )}
                        </div>

                        <div className="pdf-export-guidance">PDF exports download to your default Downloads folder. If your browser asks, use the folder you choose.</div>

                        {getPdfExportNotice('inactiveDriverRoster') && !inactiveDriverRosterModalOpen && (
                          <div className="pdf-export-success">{getPdfExportNotice('inactiveDriverRoster')}</div>
                        )}

                        {inactiveDriverRosterPdfError && !inactiveDriverRosterModalOpen && (
                          <div className="msg error pdf-export-error">{inactiveDriverRosterPdfError}</div>
                        )}

                        {inactiveDriverRosterReport && !inactiveDriverRosterModalOpen && (
                          <div className="report-ready-card">
                            <div>
                              <strong>{inactiveDriverRosterReport.reportLabel} is ready.</strong>
                              <span> The preview opens in a report window.</span>
                            </div>
                            <div className="report-ready-actions">
                              <button className="view-button" onClick={() => setInactiveDriverRosterModalOpen(true)}>
                                Reopen Preview
                              </button>
                              <button
                                type="button"
                                className="pdf-export-button compact"
                                onClick={downloadInactiveDriverRosterPdf}
                                disabled={inactiveDriverRosterPdfLoading}
                              >
                                {inactiveDriverRosterPdfLoading ? 'Exporting...' : 'Export PDF'}
                              </button>
                            </div>
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


                <div className={`report-accordion ${isFleetEquipmentOpen ? 'open' : ''}`}>
                  <button
                    type="button"
                    className="report-accordion-button"
                    onClick={(e) => handleReportPanelClick(e, 'fleetEquipment')}
                  >
                    <span>Fleet Equipment</span>
                    <span className="report-accordion-icon">{isFleetEquipmentOpen ? '▼' : '▶'}</span>
                  </button>

                  {isFleetEquipmentOpen && (
                    <div className="report-accordion-body">
                      <div className="report-card compact-report-card accordion-inner-card briefing-report-card">
                        <div className="report-card-header centered-report-header">
                          <div>
                            <h3>Fleet Equipment</h3>
                            <p>Driver Roster equipment view with active/inactive scope.</p>
                          </div>
                        </div>

                        <div className="report-controls centered-report-controls">
                          <label>
                            <span>Roster Scope</span>
                            <select
                              value={fleetEquipmentStatus}
                              onChange={(e) => {
                                setFleetEquipmentStatus(e.target.value);
                                setFleetEquipmentReport(null);
                                setFleetEquipmentError(null);
                                setFleetEquipmentModalOpen(false);
                                setFleetEquipmentPdfError('');
                                clearPdfExportNotice('fleetEquipment');
                              }}
                              disabled={fleetEquipmentLoading}
                            >
                              <option value="active">Active</option>
                              <option value="inactive">Inactive</option>
                              <option value="all">All</option>
                            </select>
                          </label>

                          <button onClick={loadFleetEquipmentReport} disabled={fleetEquipmentLoading}>
                            {fleetEquipmentLoading ? 'Loading Report...' : 'Preview Report'}
                          </button>
                          {!fleetEquipmentReport && (
                            <button
                              type="button"
                              className="pdf-export-button"
                              onClick={downloadFleetEquipmentPdf}
                              disabled={fleetEquipmentPdfLoading || fleetEquipmentLoading}
                            >
                              {fleetEquipmentPdfLoading ? 'Exporting PDF...' : 'Export PDF'}
                            </button>
                          )}
                        </div>

                        <div className="pdf-export-guidance">PDF exports download to your default Downloads folder. If your browser asks, use the folder you choose.</div>

                        {getPdfExportNotice('fleetEquipment') && !fleetEquipmentModalOpen && (
                          <div className="pdf-export-success">{getPdfExportNotice('fleetEquipment')}</div>
                        )}

                        {fleetEquipmentPdfError && !fleetEquipmentModalOpen && (
                          <div className="msg error pdf-export-error">{fleetEquipmentPdfError}</div>
                        )}

                        {fleetEquipmentReport && !fleetEquipmentModalOpen && (
                          <div className="report-ready-card">
                            <div>
                              <strong>{fleetEquipmentReport.reportLabel} is ready.</strong>
                              <span> The preview opens in a report window.</span>
                            </div>
                            <div className="report-ready-actions">
                              <button className="view-button" onClick={() => setFleetEquipmentModalOpen(true)}>
                                Reopen Preview
                              </button>
                              <button
                                type="button"
                                className="pdf-export-button compact"
                                onClick={downloadFleetEquipmentPdf}
                                disabled={fleetEquipmentPdfLoading}
                              >
                                {fleetEquipmentPdfLoading ? 'Exporting...' : 'Export PDF'}
                              </button>
                            </div>
                          </div>
                        )}

                        {fleetEquipmentError && (
                          <div className="report-alert error">
                            <h4>Report could not be loaded.</h4>
                            <p>{fleetEquipmentError.message}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>


                <div className={`report-accordion ${isDriverTimeOffOpen ? 'open' : ''}`}>
                  <button
                    type="button"
                    className="report-accordion-button"
                    onClick={(e) => handleReportPanelClick(e, 'driverTimeOff')}
                  >
                    <span>Driver Time Off</span>
                    <span className="report-accordion-icon">{isDriverTimeOffOpen ? '▼' : '▶'}</span>
                  </button>

                  {isDriverTimeOffOpen && (
                    <div className="report-accordion-body">
                      <div className="report-card compact-report-card accordion-inner-card driver-time-off-card briefing-report-card">
                        <div className="report-card-header centered-report-header">
                          <div>
                            <h3>Driver Time Off</h3>
                            <p>Current time-off visibility plus year-by-year analysis.</p>
                          </div>
                        </div>

                        <div className="report-controls centered-report-controls">
                          <label>
                            <span>Report Year</span>
                            <select
                              value={driverTimeOffYear}
                              onChange={(e) => {
                                setDriverTimeOffYear(Number(e.target.value));
                                setDriverTimeOffReport(null);
                                setDriverTimeOffError(null);
                                setDriverTimeOffPdfError('');
                                clearPdfExportNotice('driverTimeOff');
                                setDriverTimeOffModalOpen(false);
                              }}
                              disabled={driverTimeOffLoading}
                            >
                              {getReportYears().map((year) => (
                                <option key={year} value={year}>{year}</option>
                              ))}
                            </select>
                          </label>

                          <button onClick={loadDriverTimeOffReport} disabled={driverTimeOffLoading}>
                            {driverTimeOffLoading ? 'Loading Report...' : 'Preview Report'}
                          </button>
                          {!driverTimeOffReport && (
                            <button
                              type="button"
                              className="pdf-export-button"
                              onClick={downloadDriverTimeOffPdf}
                              disabled={driverTimeOffPdfLoading || driverTimeOffLoading}
                            >
                              {driverTimeOffPdfLoading ? 'Exporting PDF...' : 'Export PDF'}
                            </button>
                          )}
                          <button type="button" className="view-button" onClick={() => openDriverTimeOffForm()}>
                            Add Time Off
                          </button>
                        </div>

                        <div className="pdf-export-guidance">PDF exports download to your default Downloads folder. If your browser asks, use the folder you choose.</div>

                        {getPdfExportNotice('driverTimeOff') && !driverTimeOffModalOpen && (
                          <div className="pdf-export-success">{getPdfExportNotice('driverTimeOff')}</div>
                        )}

                        {driverTimeOffPdfError && !driverTimeOffModalOpen && (
                          <div className="msg error pdf-export-error">{driverTimeOffPdfError}</div>
                        )}

                        {driverTimeOffReport && !driverTimeOffModalOpen && (
                          <div className="report-ready-card">
                            <div>
                              <strong>{driverTimeOffReport.reportLabel} is ready.</strong>
                              <span> The preview opens in a report window.</span>
                            </div>
                            <div className="report-ready-actions">
                              <button className="view-button" onClick={() => setDriverTimeOffModalOpen(true)}>
                                Reopen Preview
                              </button>
                              <button
                                type="button"
                                className="pdf-export-button compact"
                                onClick={downloadDriverTimeOffPdf}
                                disabled={driverTimeOffPdfLoading}
                              >
                                {driverTimeOffPdfLoading ? 'Exporting...' : 'Export PDF'}
                              </button>
                            </div>
                          </div>
                        )}

                        {driverTimeOffActionMessage && <div className="msg success-message">{driverTimeOffActionMessage}</div>}

                        {driverTimeOffError && (
                          <div className="report-alert error">
                            <h4>Report could not be loaded.</h4>
                            <p>{driverTimeOffError.message}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

              </div>
            )}
          </div>
          </div>
        )}
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <>
      {renderPreferencesModal()}
      <div className="container">
        <header className="app-header app-header-branded">
  <div className="brand-stack">
    <img
  src={koleLogo}
  alt="Kole Trucking"
  className="brand-logo-large"
  style={{ width: '520px' }}
/>

    <KoleBrandTitle subtitle="Enter your Kole Connect access token to continue." />
  </div>

  <div className="header-actions login-header-actions">
    <ThemeToggleButton />
    <PreferencesButton />
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
                setLoginStatusMessage('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !loginLoading) handleLogin();
              }}
              placeholder="Access token"
              autoFocus
              disabled={loginLoading}
              aria-busy={loginLoading}
            />

            <button
              onClick={handleLogin}
              disabled={!password.trim() || loginLoading}
            >
              {loginLoading ? 'Connecting...' : 'Log In'}
            </button>
          </div>

          {loginLoading && (
            <div className="login-status-card" role="status" aria-live="polite">
              <span className="login-spinner" aria-hidden="true" />
              <div>
                <strong>{loginStatusMessage || 'Connecting to Kole Connect...'}</strong>
                 </div>
            </div>
          )}

          {authError && <div className="msg error">{authError}</div>}

          <div className="msg">
            All Information Contained Within is Property of Kole Trucking LLC
          </div>
        </div>
      </div>
      </>
    );
  }

  return (
    <>
      {renderPreferencesModal()}
      {RecruitingProfileModal()}
      {RecruitingSnapshotModal()}
      {RecruitingDriverRosterPortModal()}
      {RecruitingCreateCandidateModal()}

      {startupSplashVisible && (
        <KoleStartupSplash
          exiting={startupSplashExiting}
          operationsData={operationsData}
          operationsError={operationsError}
          uploadDigestData={uploadDigestData}
          uploadDigestError={uploadDigestError}
          reportActionAlerts={reportActionAlerts}
          reportActionAlertsError={reportActionAlertsError}
          fakeProgressMs={startupSplashElapsedMs}
          onSkip={beginStartupSplashClose}
        />
      )}

      <div className="container">
        <header className="app-header app-header-branded">
  <div className="brand-stack">
    <img
  src={koleLogo}
  alt="Kole Trucking"
  className="brand-logo-large"
  style={{ width: '520px' }}
/>

    <KoleBrandTitle
      animate={brandRevealActive}
      revealKey={brandRevealKey}
      subtitle="Search orders, BOLs, customers, drivers, and inspect dispatch or billing data."
    />
  </div>

  <div className="header-actions">
    <ThemeToggleButton />
    <PreferencesButton />
    <button type="button" className="close-button header-logoff" onClick={handleLogout}>
      Log Off
    </button>
  </div>
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
  {!userPrefs.hideOperationsToday && (
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
          <button type="button" className="operations-card operations-card-button" onClick={() => scrollToOperationsSection('activeToday')}>
            <span>Active Today</span>
            <strong>{operationsData.counts.activeToday}</strong>
          </button>

          <button type="button" className="operations-card operations-card-button" onClick={() => scrollToOperationsSection('loadingToday')}>
            <span>Loading Today</span>
            <strong>{operationsData.counts.loadingToday}</strong>
          </button>

          <button type="button" className="operations-card operations-card-button" onClick={() => scrollToOperationsSection('deliveringToday')}>
            <span>Delivering Today</span>
            <strong>{operationsData.counts.deliveringToday}</strong>
          </button>

          <button type="button" className="operations-card operations-card-button" onClick={() => scrollToOperationsSection('loadingNext7')}>
            <span>Loading Next 7 Days</span>
            <strong>{operationsData.counts.loadingNext7}</strong>
          </button>
        </div>

        <DriverTimeOffCurrentPanel />

        <DriverPositionTrackingPanel />

        <div id="operations-active-today" ref={operationsActiveTodayRef} className="operations-detail-section">
          <OperationsSectionHeading>Active Today</OperationsSectionHeading>

          {operationsData.activeToday.length === 0 ? (
            <div className="msg">No active shipments today.</div>
          ) : userPrefs.orderCardView ? (
            <div className="order-card-grid operations-order-card-grid">
              {operationsData.activeToday.map((r, i) => (
                <OperationOrderCard key={`active-card-${r.id || i}`} record={r} index={i} variant="activeToday" />
              ))}
            </div>
          ) : (
            <div className="operations-table-wrap">
              <table className="operations-active-today-table">
                <thead>
                  <tr>
                    <th>BOL</th>
                    <th>Driver</th>
                    <th>Origin</th>
                    <th>Destination</th>
                    <th>Delivery</th>
                    <th className="operation-notes-column">Notes</th>
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
                      <td className="operation-notes-cell">
                        <button
                          type="button"
                          className="operation-notes-cell-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            loadDetails(r.id, 'notes', r.SourceListId);
                          }}
                          title="Open this order's notes"
                        >
                          {renderOperationNotesPill(r)}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div id="operations-loading-today" ref={operationsLoadingTodayRef} className="operations-detail-section">
          <OperationsSectionHeading>Loading Today</OperationsSectionHeading>

          {operationsData.loadingToday.length === 0 ? (
            <div className="msg">No loads scheduled to load today.</div>
          ) : userPrefs.orderCardView ? (
            <div className="order-card-grid operations-order-card-grid">
              {operationsData.loadingToday.map((r, i) => (
                <OperationOrderCard key={`loading-card-${r.id || i}`} record={r} index={i} variant="loadingToday" />
              ))}
            </div>
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

        <div id="operations-delivering-today" ref={operationsDeliveringTodayRef} className="operations-detail-section">
          <OperationsSectionHeading>Delivering Today</OperationsSectionHeading>

          {operationsData.deliveringToday.length === 0 ? (
            <div className="msg">No deliveries scheduled today.</div>
          ) : userPrefs.orderCardView ? (
            <div className="order-card-grid operations-order-card-grid">
              {operationsData.deliveringToday.map((r, i) => (
                <OperationOrderCard key={`delivering-card-${r.id || i}`} record={r} index={i} variant="deliveringToday" />
              ))}
            </div>
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

        <div id="operations-loading-next-7" ref={operationsLoadingNext7Ref} className="operations-detail-section">
          <OperationsSectionHeading>
            <button
              type="button"
              className="operations-next7-heading-button"
              onClick={() => setOperationsNext7Open((open) => !open)}
              aria-expanded={operationsNext7Open}
            >
              <span>Loading Next 7 Days</span>
              <span className="operations-next7-heading-state">{operationsNext7Open ? 'Hide' : 'Show'}</span>
            </button>
          </OperationsSectionHeading>

          {operationsNext7Open && (
            operationsData.loadingNext7.length === 0 ? (
              <div className="msg">No upcoming loads in the next 7 days.</div>
            ) : userPrefs.orderCardView ? (
              <div className="order-card-grid operations-order-card-grid">
                {operationsData.loadingNext7.map((r, i) => (
                  <OperationOrderCard key={`next7-card-${r.id || i}`} record={r} index={i} variant="loadingNext7" />
                ))}
              </div>
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
            )
          )}
        </div>
      </>
    )}
  </div>
  )}

  {!userPrefs.hideUploadDigest && <UploadDigestPanel />}

  {!userPrefs.hideIntelliTrack && IntelliTrackPanel()}

  {!userPrefs.hideAvailableTrucks && AvailableTrucksPanel()}

  {!userPrefs.hideRecruiting && RecruitingPanel()}

  {!userPrefs.hideSalesAndLeads && <SalesAndLeadsPanel />}

  <DriverSummaryReport />
  </>
)}
      </div>

      <div className={`results-panel ${userPrefs.orderCardView ? 'order-card-results-panel' : ''}`.trim()}>
        {sortedResults.length > 0 && (
          userPrefs.orderCardView ? (
            <div className="order-card-grid search-order-card-grid">
              {sortedResults.map((r, i) => (
                <SearchOrderCard key={`${r.SourceListId || 'current'}-${r.id || i}`} record={r} index={i} />
              ))}
            </div>
          ) : (
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
          )
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
      <GrossRevenueMonthLoadModal />

      {yearlyProjectionModalOpen && yearlyProjectionReport && (
        <div className="modal-overlay report-modal-overlay" onClick={closeYearlyRevenueProjectionModal}>
          <div className="detail-modal report-modal wide-report-modal yearly-projection-modal" onClick={(e) => e.stopPropagation()}>
            <div className="detail-header report-modal-header">
              <div>
                <h2>{yearlyProjectionReport.reportLabel || 'Yearly Revenue Projection'}</h2>
                <p>{yearlyProjectionReport.anchorDate || ''} · Generated {yearlyProjectionReport.generatedAt || ''}</p>
              </div>

              <button className="close-button" onClick={closeYearlyRevenueProjectionModal}>
                Close
              </button>
            </div>

            <div className="modal-body report-modal-body">
              <YearlyRevenueProjectionPreview />
            </div>
          </div>
        </div>
      )}

      {monthlyOpsModalOpen && monthlyOpsReport && (
        <div className="modal-overlay report-modal-overlay" onClick={closeMonthlyOperationsSummaryModal}>
          <div className="detail-modal report-modal wide-report-modal monthly-ops-modal" onClick={(e) => e.stopPropagation()}>
            <div className="detail-header report-modal-header">
              <div>
                <h2>{monthlyOpsReport.reportLabel || 'Monthly Operations Summary'}</h2>
                <p>{monthlyOpsReport.anchorDate || ''} · Generated {monthlyOpsReport.generatedAt || ''}</p>
              </div>

              <div className="report-modal-actions">
                <button
                  type="button"
                  className="pdf-export-button"
                  onClick={downloadMonthlyOperationsSummaryPdf}
                  disabled={monthlyOpsPdfLoading}
                >
                  {monthlyOpsPdfLoading ? 'Exporting PDF...' : 'Export PDF'}
                </button>
                <button className="close-button" onClick={closeMonthlyOperationsSummaryModal}>
                  Close
                </button>
              </div>
            </div>

            <div className="modal-body report-modal-body">
              {getPdfExportNotice('monthlyOperations') && (
                <div className="pdf-export-success">{getPdfExportNotice('monthlyOperations')}</div>
              )}
              {monthlyOpsPdfError && (
                <div className="msg error pdf-export-error">{monthlyOpsPdfError}</div>
              )}
              <MonthlyOperationsSummaryPreview />
            </div>
          </div>
        </div>
      )}

      {monthlyOpsModalOpen && monthlyOpsReport && selectedMonthlyOpsDrilldown && <MonthlyOperationsDrilldownModal />}

      {driverSummaryModalOpen && driverSummaryReport && (
        <div className="modal-overlay report-modal-overlay" onClick={closeDriverSummaryModal}>
          <div className="detail-modal report-modal" onClick={(e) => e.stopPropagation()}>
            <div className="detail-header report-modal-header">
              <div>
                <h2>{driverSummaryReport.reportLabel} Driver Summary Report</h2>
           
              </div>

              <div className="report-modal-actions">
                <button
                  type="button"
                  className="pdf-export-button"
                  onClick={downloadDriverSummaryPdf}
                  disabled={driverSummaryPdfLoading}
                >
                  {driverSummaryPdfLoading ? 'Exporting PDF...' : 'Export PDF'}
                </button>
                <button className="close-button" onClick={closeDriverSummaryModal}>
                  Close
                </button>
              </div>
            </div>

            <div className="modal-body report-modal-body">
              {getPdfExportNotice('driverSummary') && (
                <div className="pdf-export-success">{getPdfExportNotice('driverSummary')}</div>
              )}
              {driverSummaryPdfError && (
                <div className="msg error pdf-export-error">{driverSummaryPdfError}</div>
              )}
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

              <div className="report-modal-actions">
                <button
                  type="button"
                  className="pdf-export-button"
                  onClick={downloadWeeklySettlementPdf}
                  disabled={weeklySettlementPdfLoading}
                >
                  {weeklySettlementPdfLoading ? 'Exporting PDF...' : 'Export PDF'}
                </button>
                <button className="close-button" onClick={closeWeeklySettlementModal}>
                  Close
                </button>
              </div>
            </div>

            <div className="modal-body report-modal-body">
              {getPdfExportNotice('weeklySettlement') && (
                <div className="pdf-export-success">{getPdfExportNotice('weeklySettlement')}</div>
              )}
              {weeklySettlementPdfError && (
                <div className="msg error pdf-export-error">{weeklySettlementPdfError}</div>
              )}
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


      {permitGovernanceModalOpen && permitGovernanceReport && (
        <div className="modal-overlay report-modal-overlay" onClick={closePermitGovernanceModal}>
          <div className="detail-modal report-modal wide-report-modal permit-governance-modal" onClick={(e) => e.stopPropagation()}>
            <div className="detail-header report-modal-header">
              <div>
                <h2>{permitGovernanceReport.reportLabel || 'Permit Governance'}</h2>
                <p>
                  {formatReportNumber(permitGovernanceReport.counts?.totalPermitGovernanceRows || permitGovernanceReport.count || 0)} active/open row(s)
                  {' · '}
                  {formatReportNumber(permitGovernanceReport.counts?.historicalPermittedLoads || 0)} historical row(s)
                  {' · Generated '}
                  {permitGovernanceReport.generatedAt || ''}
                </p>
              </div>

              <button className="close-button" onClick={closePermitGovernanceModal}>
                Close
              </button>
            </div>

            <div className="modal-body report-modal-body">
              <PermitGovernancePreview />
            </div>
          </div>
        </div>
      )}

      <PermitHistoryDetailModal />


      {activeDriverRosterModalOpen && activeDriverRosterReport && (
        <div className="modal-overlay report-modal-overlay" onClick={closeActiveDriverRosterModal}>
          <div className="detail-modal report-modal wide-report-modal" onClick={(e) => e.stopPropagation()}>
            <div className="detail-header report-modal-header">
              <div>
                <h2>{activeDriverRosterReport.reportLabel || 'Active Driver Roster'}</h2>
                <p>{formatReportNumber(activeDriverRosterReport.count)} active driver(s) · Generated {activeDriverRosterReport.generatedAt || ''}</p>
              </div>

              <div className="report-modal-actions">
                <button
                  type="button"
                  className="pdf-export-button"
                  onClick={downloadActiveDriverRosterPdf}
                  disabled={activeDriverRosterPdfLoading}
                >
                  {activeDriverRosterPdfLoading ? 'Exporting PDF...' : 'Export PDF'}
                </button>
                <button className="close-button" onClick={closeActiveDriverRosterModal}>
                  Close
                </button>
              </div>
            </div>

            <div className="modal-body report-modal-body">
              {getPdfExportNotice('activeDriverRoster') && (
                <div className="pdf-export-success">{getPdfExportNotice('activeDriverRoster')}</div>
              )}
              {activeDriverRosterPdfError && (
                <div className="msg error pdf-export-error">{activeDriverRosterPdfError}</div>
              )}
              <ActiveDriverRosterPreview />
            </div>
          </div>
        </div>
      )}

      {inactiveDriverRosterModalOpen && inactiveDriverRosterReport && (
        <div className="modal-overlay report-modal-overlay" onClick={closeInactiveDriverRosterModal}>
          <div className="detail-modal report-modal wide-report-modal" onClick={(e) => e.stopPropagation()}>
            <div className="detail-header report-modal-header">
              <div>
                <h2>{inactiveDriverRosterReport.reportLabel || 'Inactive Driver Roster'}</h2>
                <p>{formatReportNumber(inactiveDriverRosterReport.count)} inactive driver(s) · Generated {inactiveDriverRosterReport.generatedAt || ''}</p>
              </div>

              <div className="report-modal-actions">
                <button
                  type="button"
                  className="pdf-export-button"
                  onClick={downloadInactiveDriverRosterPdf}
                  disabled={inactiveDriverRosterPdfLoading}
                >
                  {inactiveDriverRosterPdfLoading ? 'Exporting PDF...' : 'Export PDF'}
                </button>
                <button className="close-button" onClick={closeInactiveDriverRosterModal}>
                  Close
                </button>
              </div>
            </div>

            <div className="modal-body report-modal-body">
              {getPdfExportNotice('inactiveDriverRoster') && (
                <div className="pdf-export-success">{getPdfExportNotice('inactiveDriverRoster')}</div>
              )}
              {inactiveDriverRosterPdfError && (
                <div className="msg error pdf-export-error">{inactiveDriverRosterPdfError}</div>
              )}
              <InactiveDriverRosterPreview />
            </div>
          </div>
        </div>
      )}

      {fleetEquipmentModalOpen && fleetEquipmentReport && (
        <div className="modal-overlay report-modal-overlay" onClick={closeFleetEquipmentModal}>
          <div className="detail-modal report-modal wide-report-modal" onClick={(e) => e.stopPropagation()}>
            <div className="detail-header report-modal-header">
              <div>
                <h2>{fleetEquipmentReport.reportLabel || 'Fleet Equipment'}</h2>
                <p>{formatReportNumber(fleetEquipmentReport.count)} equipment row(s) · Generated {fleetEquipmentReport.generatedAt || ''}</p>
              </div>

              <div className="report-modal-actions">
                <button
                  type="button"
                  className="pdf-export-button"
                  onClick={downloadFleetEquipmentPdf}
                  disabled={fleetEquipmentPdfLoading}
                >
                  {fleetEquipmentPdfLoading ? 'Exporting PDF...' : 'Export PDF'}
                </button>
                <button className="close-button" onClick={closeFleetEquipmentModal}>
                  Close
                </button>
              </div>
            </div>

            <div className="modal-body report-modal-body">
              {getPdfExportNotice('fleetEquipment') && (
                <div className="pdf-export-success">{getPdfExportNotice('fleetEquipment')}</div>
              )}
              {fleetEquipmentPdfError && (
                <div className="msg error pdf-export-error">{fleetEquipmentPdfError}</div>
              )}
              <FleetEquipmentPreview />
            </div>
          </div>
        </div>
      )}


      {onThisDayModalOpen && onThisDayReport && (
        <div className="modal-overlay report-modal-overlay" onClick={closeOnThisDayModal}>
          <div className="detail-modal report-modal wide-report-modal on-this-day-modal" onClick={(e) => e.stopPropagation()}>
            <div className="detail-header report-modal-header">
              <div>
                <h2>{onThisDayReport.reportLabel || 'On This Day'}</h2>
                <p>{onThisDayReport.modeLabel || '-'} · {formatReportNumber(onThisDayReport.count)} activity item(s) · Generated {onThisDayReport.generatedAt || ''}</p>
              </div>

              <div className="report-modal-actions">
                <button
                  type="button"
                  className="pdf-export-button"
                  onClick={downloadOnThisDayPdf}
                  disabled={onThisDayPdfLoading || onThisDayLoading}
                >
                  {onThisDayPdfLoading ? 'Exporting PDF...' : 'Export PDF'}
                </button>
                <button className="close-button" onClick={closeOnThisDayModal}>
                  Close
                </button>
              </div>
            </div>

            <div className="modal-body report-modal-body">
              {getPdfExportNotice('onThisDay') && (
                <div className="pdf-export-success">{getPdfExportNotice('onThisDay')}</div>
              )}
              {onThisDayPdfError && (
                <div className="msg error pdf-export-error">{onThisDayPdfError}</div>
              )}
              <OnThisDayPreview />
            </div>
          </div>
        </div>
      )}

      {driverTimeOffModalOpen && driverTimeOffReport && (
        <div className="modal-overlay report-modal-overlay" onClick={closeDriverTimeOffModal}>
          <div className="detail-modal report-modal wide-report-modal driver-time-off-modal" onClick={(e) => e.stopPropagation()}>
            <div className="detail-header report-modal-header">
              <div>
                <h2>{driverTimeOffReport.reportLabel || 'Driver Time Off'}</h2>
                <p>{formatReportNumber(driverTimeOffReport.count)} record(s) · Generated {driverTimeOffReport.generatedAt || ''}</p>
              </div>
              <div className="report-modal-actions">
                <button
                  type="button"
                  className="pdf-export-button"
                  onClick={downloadDriverTimeOffPdf}
                  disabled={driverTimeOffPdfLoading}
                >
                  {driverTimeOffPdfLoading ? 'Exporting PDF...' : 'Export PDF'}
                </button>
                <button className="close-button" onClick={closeDriverTimeOffModal}>Close</button>
              </div>
            </div>
            <div className="modal-body report-modal-body">
              {getPdfExportNotice('driverTimeOff') && (
                <div className="pdf-export-success">{getPdfExportNotice('driverTimeOff')}</div>
              )}
              {driverTimeOffPdfError && (
                <div className="msg error pdf-export-error">{driverTimeOffPdfError}</div>
              )}
              <DriverTimeOffPreview />
            </div>
          </div>
        </div>
      )}


      {operationalNotesModalOpen && operationalNotesReport && (
        <div className="modal-overlay report-modal-overlay" onClick={closeOperationalNotesModal}>
          <div className="detail-modal report-modal wide-report-modal operational-notes-modal" onClick={(e) => e.stopPropagation()}>
            <div className="detail-header report-modal-header">
              <div>
                <h2>{operationalNotesReport.reportLabel || 'Order Notes — Last 7 Days'}</h2>
                <p>{formatReportNumber(operationalNotesReport.count)} note(s) · Generated {operationalNotesReport.generatedAt || ''}</p>
              </div>

              <button className="close-button" onClick={closeOperationalNotesModal}>
                Close
              </button>
            </div>

            <div className="modal-body report-modal-body">
              <OperationalNotesPreview />
            </div>
          </div>
        </div>
      )}

      {noAvailabilityModalOpen && noAvailabilityReport && (
        <div className="modal-overlay report-modal-overlay" onClick={closeNoAvailabilityModal}>
          <div className="detail-modal report-modal wide-report-modal no-availability-modal" onClick={(e) => e.stopPropagation()}>
            <div className="detail-header report-modal-header">
              <div>
                <h2>{noAvailabilityReport.reportLabel || 'No Availability'}</h2>
                <p>{noAvailabilityReport.anchorDate || 'Solicit Date'} · {formatReportNumber(noAvailabilityReport.count)} record(s)</p>
              </div>

              <button className="close-button" onClick={closeNoAvailabilityModal}>
                Close
              </button>
            </div>

            <div className="modal-body report-modal-body">
              <NoAvailabilityPreview />
            </div>
          </div>
        </div>
      )}

      {customerTrendModalOpen && customerTrendReport && (
        <div className="modal-overlay report-modal-overlay" onClick={closeCustomerTrendModal}>
          <div className="detail-modal report-modal wide-report-modal customer-trends-modal" onClick={(e) => e.stopPropagation()}>
            <div className="detail-header report-modal-header">
              <div>
                <h2>{customerTrendReport.reportLabel || 'Customer Booking Trends'}</h2>
                <p>{customerTrendReport.comparedYears?.join(', ') || 'Available years'} · Generated {customerTrendReport.generatedAt || ''}</p>
              </div>

              <button className="close-button" onClick={closeCustomerTrendModal}>
                Close
              </button>
            </div>

            <div className="modal-body report-modal-body">
              <CustomerBookingTrendsPreview />
            </div>
          </div>
        </div>
      )}

      <CustomerTrendDetailModal />

      {salesActivityModalOpen && salesActivityReport && (
        <div className="modal-overlay report-modal-overlay" onClick={closeSalesActivityModal}>
          <div className="detail-modal report-modal wide-report-modal sales-activity-modal" onClick={(e) => e.stopPropagation()}>
            <div className="detail-header report-modal-header">
              <div>
                <h2>Sales Activity Snapshot</h2>
                <p>{salesActivityReport.activityPeriodLabel || '-'} · Due window {salesActivityReport.duePeriodLabel || '-'}</p>
              </div>

              <div className="report-modal-actions">
                <button
                  type="button"
                  className="pdf-export-button"
                  onClick={downloadSalesActivityPdf}
                  disabled={salesActivityPdfLoading}
                >
                  {salesActivityPdfLoading ? 'Exporting PDF...' : 'Export PDF'}
                </button>
                <button className="close-button" onClick={closeSalesActivityModal}>
                  Close
                </button>
              </div>
            </div>

            <div className="modal-body report-modal-body">
              {getPdfExportNotice('salesActivity') && (
                <div className="pdf-export-success">{getPdfExportNotice('salesActivity')}</div>
              )}
              {salesActivityPdfError && (
                <div className="msg error pdf-export-error">{salesActivityPdfError}</div>
              )}
              <SalesActivitySnapshotPreview />
            </div>
          </div>
        </div>
      )}

      {DriverTimeOffFormModal()}
      <DriverRosterModal />
      <DriverPerformanceModal />
      {SalesLeadProfileModal()}

      {selected && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="detail-modal order-detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="detail-header">
              <div>
                <ModalReturnTrail label={getOrderReturnTrailLabel()} onClick={handleOrderReturnTrailClick} />
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

              <button
                className={selectedView === 'notes' ? 'active-tab' : ''}
                onClick={openOrderNotesTab}
              >
                Notes
              </button>
            </div>

            <div className="modal-body">
              {selectedView === 'basic' && <BasicView />}
              {selectedView === 'dispatch' && <DispatchView />}
              {selectedView === 'billing' && <BillingView />}
              {selectedView === 'documents' && <DocumentsView />}
              {selectedView === 'notes' && renderOrderNotesView()}
            </div>
          </div>
        </div>
      )}
      </div>
    </>
  );
}