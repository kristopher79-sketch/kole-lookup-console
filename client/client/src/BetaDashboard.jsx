import { useRef, useState } from 'react';
import { getOperationsSummaryDetail } from './operationsSummary';

const OPERATION_SLICES = [
  { key: 'activeToday', label: 'Active Today', empty: 'No active shipments today.' },
  { key: 'loadingToday', label: 'Loading Today', empty: 'No loads scheduled to load today.' },
  { key: 'deliveringToday', label: 'Delivering Today', empty: 'No deliveries scheduled today.' },
  { key: 'loadingNext7', label: 'Upcoming Loads', empty: 'No upcoming loads in the next 7 days.' }
];

// Keep the shared search visible if a customer lookup is refined with another search.
function SalesWorkspace({ searchActive, searching, search, sales }) {
  const [showSearch, setShowSearch] = useState(Boolean(searchActive));
  if (searchActive && !showSearch) setShowSearch(true);
  if (!searchActive && !searching && showSearch) setShowSearch(false);
  return showSearch ? search : sales;
}

// Presentation only: App owns data, calculations, refreshes, and record interactions.
export default function BetaDashboard({
  enabled, children, searching, operationsHidden,
  operationsData, operationsLoading, operationsError, refreshing, onRefresh,
  currentTimeOffCount, onOpenTimeOff, roster, timeOff, onOpenRecord, renderRecord, quickActions, formatSummaryDate,
  photosHidden, photoCount, photoDateLabel, photos,
  trackingHidden, trackingCount, tracking,
  equipmentHidden, equipmentCount, equipment,
  recruitingHidden, recruitingCount, recruiting,
  salesHidden, salesCount, sales, salesSearchActive,
  reportsCount, reportsSummary, reports
}) {
  const [selectedModule, setSelectedModule] = useState('operations');
  const [workspace, setWorkspace] = useState('roster');
  const [expandedSummary, setExpandedSummary] = useState('');
  const workspaceRef = useRef(null);
  const moduleHeadingRef = useRef(null);
  const activeModule = (selectedModule === 'photos' && !photosHidden)
    || (selectedModule === 'tracking' && !trackingHidden)
    || (selectedModule === 'equipment' && !equipmentHidden)
    || (selectedModule === 'recruiting' && !recruitingHidden)
    || (selectedModule === 'sales' && !salesHidden)
    || selectedModule === 'reports' ? selectedModule : 'operations';
  const moduleTitle = activeModule === 'photos' ? 'Job Photo Uploads'
    : activeModule === 'tracking' ? 'IntelliTrack'
    : activeModule === 'equipment' ? 'Available Equipment'
    : activeModule === 'recruiting' ? 'Recruiting'
    : activeModule === 'sales' ? 'Sales & Leads'
    : activeModule === 'reports' ? 'Reports' : 'Operations';
  const selectedSlice = OPERATION_SLICES.find((slice) => slice.key === workspace);
  const showOperations = activeModule === 'operations' && !operationsHidden;

  function anchorViewToTop(targetRef) {
    // Wait for the new view to mount, then focus without letting its size
    // determine the scroll position (especially the tall Operations workspace).
    requestAnimationFrame(() => {
      targetRef.current?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    });
  }

  function openModule(event, key) {
    event.preventDefault();
    setSelectedModule(key);
    anchorViewToTop(moduleHeadingRef);
  }

  function openWorkspace(key) {
    setWorkspace(key);
    if (key === 'timeOff') onOpenTimeOff();
    anchorViewToTop(workspaceRef);
  }

  if (!enabled) return <>{children}</>;

  return (
    <div className={`beta-dashboard${activeModule !== 'operations' ? ' beta-dashboard-feature' : ''}${showOperations ? ' beta-dashboard-aligned-workspace' : ''}`}>
      <div className="beta-dashboard-sidebar">
        {activeModule === 'operations' && (<section className="beta-dashboard-quick-actions" aria-labelledby="beta-quick-actions-title">
          <h2 id="beta-quick-actions-title" className="beta-dashboard-box-title">Quick Actions</h2>
          <div className="beta-dashboard-quick-action-buttons">
            <button type="button" aria-pressed={workspace === 'search'} onClick={() => openWorkspace('search')}>
              Search
            </button>
            {quickActions}
            <button type="button" disabled={operationsHidden || !operationsData?.driverTimeOff}
              aria-pressed={workspace === 'timeOff'} onClick={() => openWorkspace('timeOff')}>
              <span>Time Off</span>
              <span className="beta-dashboard-nav-count" title="Drivers currently off">{currentTimeOffCount ?? '—'}</span>
            </button>
          </div>
        </section>)}
      <nav className="beta-dashboard-nav" aria-label="Dashboard modules">
        <h2 className="beta-dashboard-box-title">Dashboard</h2>
        <a href="#beta-module-title" aria-current={activeModule === 'operations' ? 'page' : undefined}
          onClick={(event) => openModule(event, 'operations')}>Operations (Home)</a>
        {!photosHidden && (
          <a href="#beta-module-title" aria-current={activeModule === 'photos' ? 'page' : undefined}
            onClick={(event) => openModule(event, 'photos')}>
            <span>Job Photo Uploads</span>
            <span className="beta-dashboard-nav-count" title={`Upload records for ${photoDateLabel}`}>{photoCount}</span>
          </a>
        )}
        {!trackingHidden && (
          <a href="#beta-module-title" aria-current={activeModule === 'tracking' ? 'page' : undefined}
            onClick={(event) => openModule(event, 'tracking')}>
            <span>IntelliTrack</span>
            <span className="beta-dashboard-nav-count" title="Active tracking orders">{trackingCount}</span>
          </a>
        )}
        {!equipmentHidden && (
          <a href="#beta-module-title" aria-current={activeModule === 'equipment' ? 'page' : undefined}
            onClick={(event) => openModule(event, 'equipment')}>
            <span>Available Equipment</span>
            <span className="beta-dashboard-nav-count" title="Currently available equipment">{equipmentCount}</span>
          </a>
        )}
        {!recruitingHidden && (
          <a href="#beta-module-title" aria-current={activeModule === 'recruiting' ? 'page' : undefined}
            onClick={(event) => openModule(event, 'recruiting')}>
            <span>Recruiting</span>
            <span className="beta-dashboard-nav-count" title="Ready to qualify plus follow-up due">{recruitingCount}</span>
          </a>
        )}
        {!salesHidden && (
          <a href="#beta-module-title" aria-current={activeModule === 'sales' ? 'page' : undefined}
            onClick={(event) => openModule(event, 'sales')}>
            <span>Sales &amp; Leads</span>
            <span className="beta-dashboard-nav-count" title="Customer follow-ups due or overdue">{salesCount}</span>
          </a>
        )}
        <a href="#beta-module-title" aria-current={activeModule === 'reports' ? 'page' : undefined}
          onClick={(event) => openModule(event, 'reports')}>
          <span>Reports</span>
          <span className="beta-dashboard-nav-count" title={reportsSummary}>{reportsCount}</span>
        </a>
      </nav>
      </div>

      <main id="beta-module-title" ref={moduleHeadingRef} aria-label={moduleTitle} className="beta-dashboard-main" tabIndex={-1}>
        <div className="beta-dashboard-prelude">
        {showOperations && (operationsData?.generatedAt || operationsLoading) && (
          <p className="beta-dashboard-generated-at" role="status">
            {operationsLoading
              ? (operationsData ? 'Refreshing operations…' : 'Loading operations…')
              : `Generated: ${operationsData.generatedAt}`}
          </p>
        )}
        {activeModule !== 'operations' && (
          <section className="beta-dashboard-workspace beta-dashboard-feature-workspace" aria-labelledby="beta-module-title">
            {activeModule === 'photos' ? photos : activeModule === 'tracking' ? tracking
              : activeModule === 'equipment' ? equipment : activeModule === 'recruiting' ? recruiting
              : activeModule === 'sales' ? <SalesWorkspace searchActive={salesSearchActive} searching={searching} search={children} sales={sales} />
              : reports}
          </section>
        )}
        {activeModule === 'operations' && !searching && operationsHidden && <p className="beta-dashboard-notice">Operations is hidden in Preferences. Turn off “Hide Operations Today” to show the roster and summaries.</p>}
        {showOperations && (
            <div className="beta-dashboard-notice" role="status">
              {operationsError && <p className="msg error">{operationsError}{operationsData ? ' Showing the last available operations data.' : ''}</p>}
              {!operationsData && !operationsLoading && !operationsError && <p>Operations data is unavailable. Refresh Operations to try again.</p>}
            </div>
        )}
        </div>
        <div className="beta-dashboard-content">
        {activeModule === 'operations' && (<aside className="beta-dashboard-rail" aria-labelledby="beta-rail-title">
        <h2 id="beta-rail-title" className="beta-dashboard-box-title">Operations Overview</h2>
        {operationsHidden ? <p>Operations is hidden in Preferences.</p>
          : OPERATION_SLICES.map((slice) => {
            const records = operationsData?.[slice.key] || [];
            const expanded = expandedSummary === slice.key;
            return (
              <section className="beta-dashboard-rail-card" key={slice.key}>
                <h3>
                  <button type="button" aria-expanded={expanded} aria-controls={`beta-rail-${slice.key}`}
                    onClick={() => setExpandedSummary(expanded ? '' : slice.key)}>
                    <span>{slice.label}</span>
                    <span className="beta-dashboard-nav-count">{operationsData?.counts?.[slice.key] ?? '—'}</span>
                    <span aria-hidden="true">{expanded ? '−' : '+'}</span>
                  </button>
                </h3>
                {expanded && (
                  <div id={`beta-rail-${slice.key}`}>
                    {!operationsData ? <p>{operationsLoading ? 'Loading operations...' : 'Operations unavailable. Use Refresh Operations to retry.'}</p> : (
                      <>
                        <button className="beta-dashboard-view-all" type="button" onClick={() => openWorkspace(slice.key)}>View all {slice.label.toLowerCase()}</button>
                        <div className="beta-dashboard-rail-records">
                          {records.length === 0 ? <p>{slice.empty}</p> : records.map((record, index) => {
                            const timeOrStatus = getOperationsSummaryDetail(record, slice.key, operationsData);
                            const detail = slice.key === 'loadingNext7'
                              ? `${record.PickupDate ? formatSummaryDate(record.PickupDate) : 'Date not set'} · ${timeOrStatus}`
                              : timeOrStatus;
                            return (
                            <button type="button" className="beta-dashboard-rail-record" key={`${record.SourceListId || 'current'}-${record.id || index}`}
                              onClick={() => onOpenRecord(record)}>
                              <strong>{record.BOL || record.BidID || 'Order'}{detail ? ` - ${detail}` : ''}</strong>
                              <span>{record.Driver || 'Driver unavailable'}</span>
                              <small>{record.Origin || 'Origin unavailable'} → {record.Destination || 'Destination unavailable'}</small>
                            </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </section>
            );
          })}
      </aside>)}
        {(showOperations || (activeModule === 'operations' && workspace === 'search')) && (
            <section className="beta-dashboard-workspace" aria-labelledby="beta-workspace-title">
              <div className="beta-dashboard-heading">
                <h2 id="beta-workspace-title" ref={workspaceRef} tabIndex={-1}>
                  {selectedSlice?.label || (workspace === 'timeOff' ? 'Driver Time Off' : workspace === 'search' ? 'Search Orders' : '')}
                </h2>
                {workspace !== 'roster' && <button type="button" onClick={() => openWorkspace('roster')}>Back to Active Driver Roster</button>}
              </div>
              {workspace === 'roster' && roster}
              {workspace === 'search' && children}
              {workspace === 'timeOff' && timeOff}
              {selectedSlice && operationsData && (
                <>
                  <p>{(operationsData[selectedSlice.key] || []).length} record(s)</p>
                  {(operationsData[selectedSlice.key] || []).length === 0
                    ? <p>{selectedSlice.empty}</p>
                    : <div className="order-card-grid beta-dashboard-order-grid">
                        {operationsData[selectedSlice.key].map((record, index) => renderRecord(record, index, selectedSlice.key))}
                      </div>}
                </>
              )}
            </section>
        )}
        </div>
      </main>


    </div>
  );
}
