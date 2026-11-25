const crypto = require('node:crypto');
const { promisify } = require('node:util');
const express = require('express');
const jwt = require('jsonwebtoken');

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'kole_portal_session';
const SESSION_SECONDS = 12 * 60 * 60;
const HASH_OPTIONS = { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 };
const PROJECTED_LIST_ID = '02b4f614-0930-4ec5-89d9-a1b82fa8d826';
const ROSTER_LIST_ID = '6aee935c-eb38-45e7-ae1e-22257cac9721';
const TIME_OFF_LIST_ID = '31997011-f019-489f-9967-6499956e5731';
const PORTAL_ORIGIN = 'https://kole-tracking-portal.netlify.app';
const ORDER_FIELDS = 'CustomerCode,Company,Status,BOLNumber_x0028_Won_x0029_,Shipment_x0020_Origin,Shipment_x0020_Destination,Pickup_x0020_Offer_x0020_Date,Expected_x0020_Delivery_x0020_Da,Processed,FinalSettleSent,EnableTracking,Truck_x0020_Number,Operator_x002f_Team,TMSName';
const ACCOUNT_FIELDS = 'CompanyName,CustomerCode,PortalPassword';
const DUMMY_HASH = `scrypt$131072$8$1$${'00'.repeat(16)}$${'00'.repeat(32)}`;
let hashWork = Promise.resolve();
let queuedHashes = 0;

function portalError(message, statusCode = 503, code = 'portal_unavailable') {
  return Object.assign(new Error(message), { statusCode, code, safeForClient: true });
}

function text(value) {
  if (value && typeof value === 'object') return text(value.Value ?? value.value ?? value.Label ?? '');
  return String(value ?? '').trim();
}

function key(value) { return text(value).toUpperCase(); }
function yes(value) { return value === true || value === 1 || /^(true|yes|1)$/i.test(text(value)); }
function fingerprint(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function truckKey(value) { return key(value).replace(/^0+(?=\d)/, ''); }

// Schedule fields are business dates, including SharePoint midnight-UTC values.
function businessDate(value) {
  const raw = text(value);
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\s.*)?$/);
  const date = iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : us
    ? `${us[3].length === 2 ? '20' : ''}${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}` : '';
  const parsed = new Date(`${date}T00:00:00Z`);
  return date && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date && date < '2099-01-01' ? date : '';
}

function addDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

function easternClock(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).map(part => [part.type, part.value]));
  return { today: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

async function runHash(password, salt) {
  if (queuedHashes >= 8) throw portalError('Please wait a moment before trying again.', 429, 'portal_busy');
  queuedHashes++;
  const work = hashWork.then(() => scrypt(password, salt, 32, HASH_OPTIONS));
  hashWork = work.catch(() => {});
  try { return await work; } finally { queuedHashes--; }
}

async function hashPortalPassword(password) {
  if (typeof password !== 'string' || password.length < 16 || password.length > 128) {
    throw portalError('A generated company password is required.', 400, 'portal_password_invalid');
  }
  const salt = crypto.randomBytes(16);
  const hash = await runHash(password, salt);
  return `scrypt$131072$8$1$${salt.toString('hex')}$${hash.toString('hex')}`;
}

async function verifyPortalPassword(password, stored) {
  const match = String(stored || '').match(/^scrypt\$131072\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{64})$/);
  const validInput = typeof password === 'string' && password.length >= 1 && password.length <= 128;
  const dummy = DUMMY_HASH.split('$');
  const actual = await runHash(validInput ? password : '', Buffer.from(match?.[1] || dummy[4], 'hex'));
  const expected = Buffer.from(match?.[2] || dummy[5], 'hex');
  return Boolean(match && validInput && crypto.timingSafeEqual(actual, expected));
}

function createPortalSession(account, secret) {
  return jwt.sign({
    type: 'kole-customer-portal', accountId: text(account.id),
    credential: fingerprint(account.passwordHash), customer: fingerprint(key(account.customerCode))
  }, secret, { algorithm: 'HS256', expiresIn: SESSION_SECONDS, issuer: 'kole', audience: 'customer-portal' });
}

function verifyPortalSession(token, secret) {
  const session = jwt.verify(token, secret, { algorithms: ['HS256'], issuer: 'kole', audience: 'customer-portal' });
  if (session.type !== 'kole-customer-portal' || !/^\d+$/.test(session.accountId || '') || !session.credential || !session.customer) {
    throw portalError('Please sign in to your company account.', 401, 'portal_session_required');
  }
  return session;
}

function sessionMatchesAccount(session, account) {
  return Boolean(account?.passwordHash && key(account.customerCode) &&
    session.accountId === text(account.id) && session.credential === fingerprint(account.passwordHash) &&
    session.customer === fingerprint(key(account.customerCode)));
}

function serializePortalCookie(token, secure, maxAge = SESSION_SECONDS) {
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/api/v1/portal; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function readPortalCookie(header) {
  const pair = String(header || '').split(';').map(value => value.trim()).find(value => value.startsWith(`${COOKIE}=`));
  try { return pair ? decodeURIComponent(pair.slice(COOKIE.length + 1)) : ''; } catch { return ''; }
}

function cleanAccount(item) {
  return { id: text(item?.id), name: text(item?.fields?.CompanyName), customerCode: text(item?.fields?.CustomerCode),
    passwordHash: text(item?.fields?.PortalPassword), etag: item?.eTag || item?.fields?.['@odata.etag'] || '' };
}

function belongsToAccount(item, account) {
  return Boolean(key(account?.customerCode) && key(item?.fields?.CustomerCode) === key(account.customerCode));
}

function isOpenOrder(item, evidence = {}, bolCounts = new Map()) {
  const f = item?.fields || {};
  const bol = key(f.BOLNumber_x0028_Won_x0029_);
  return key(f.Status) === 'WON' && !yes(f.Processed) && !yes(f.FinalSettleSent) &&
    !(bol && bolCounts.get(bol) === 1 && evidence.deliveryEvidenceBols?.has(bol));
}

function countBols(items) {
  const counts = new Map();
  for (const item of items) {
    const bol = key(item.fields?.BOLNumber_x0028_Won_x0029_);
    if (bol && key(item.fields?.Status) === 'WON') counts.set(bol, (counts.get(bol) || 0) + 1);
  }
  return counts;
}

function findOrderTracking(item, records) {
  const bol = key(item.fields?.BOLNumber_x0028_Won_x0029_);
  return records.find(record => text(record.bidListingId) === text(item.id) && bol && key(record.bolNumber) === bol &&
    !record.disableTracking && record.passkey) || null;
}

function buildPortalShipments({ items, account, trackingRecords = [], evidence = {} }) {
  const bolCounts = countBols(items);
  return items.filter(item => belongsToAccount(item, account) && isOpenOrder(item, evidence, bolCounts)).map(item => {
    const f = item.fields;
    const tracking = findOrderTracking(item, trackingRecords);
    const bol = text(f.BOLNumber_x0028_Won_x0029_);
    const trackingRequested = !tracking && yes(f.EnableTracking);
    return {
      id: text(item.id), bolNumber: bol, origin: text(f.Shipment_x0020_Origin), destination: text(f.Shipment_x0020_Destination),
      pickupDate: businessDate(f.Pickup_x0020_Offer_x0020_Date), deliveryDate: businessDate(f.Expected_x0020_Delivery_x0020_Da),
      status: tracking ? 'Tracking active' : trackingRequested ? 'Tracking requested' : 'Booked',
      trackingAvailable: Boolean(tracking), trackingRequested, canRequestTracking: Boolean(bol && !tracking && !trackingRequested)
    };
  }).sort((a, b) => (a.pickupDate || '9999').localeCompare(b.pickupDate || '9999') || a.bolNumber.localeCompare(b.bolNumber));
}

function equipmentFamily(value) {
  const name = key(value).replace(/[\s-]+/g, '');
  if (name.includes('CONESTOGA')) return 'Conestoga';
  if (name.includes('STEPDECK')) return 'Step Deck';
  if (name.includes('RGN')) return 'RGN';
  if (name.includes('FLATBED')) return 'Flatbed';
  if (name.includes('POWERONLY')) return 'Power Only';
  if (name.includes('DRYVAN')) return 'Dry Van';
  return '';
}

function sameOperator(truck, operator, roster) {
  return Boolean((truckKey(truck) && truckKey(truck) === truckKey(roster.Trucks)) ||
    (key(operator) && [key(roster.Operator_x002f_TeamName), key(roster.TMSName)].includes(key(operator))));
}

function isCapacityEligible(candidate, roster, orders, timeOff, evidence, today) {
  if (key(roster.Status) !== 'ACTIVE' || key(roster.SoloorTeam) !== 'SOLO' || !equipmentFamily(roster.TrailerType)) return false;
  if (/new vision/i.test(text(roster.Operator_x002f_TeamName)) || truckKey(roster.Trucks) === '5550') return false;
  const bookingHorizon = addDays(candidate.date, 7);
  const timeOffHorizon = addDays(bookingHorizon, 2);
  const isFutureProjection = candidate.kind === 'Projected' && candidate.date > today;
  const bolCounts = countBols(orders);
  for (const order of orders) {
    const f = order.fields || {};
    if (!sameOperator(f.Truck_x0020_Number, f.Operator_x002f_Team || f.TMSName, roster) || !isOpenOrder(order, evidence, bolCounts)) continue;
    const pickup = businessDate(f.Pickup_x0020_Offer_x0020_Date);
    const delivery = businessDate(f.Expected_x0020_Delivery_x0020_Da);
    if (!pickup || !delivery || delivery < pickup) return false;
    if (pickup >= candidate.date && pickup <= bookingHorizon) return false;
    if (pickup < candidate.date && delivery > candidate.date) return false;
    // Future projections may rely on scheduled completion, but a load already
    // overdue today needs confirmation. Today's availability still requires an empty unit.
    if (delivery <= candidate.date && (!isFutureProjection || delivery < today)) return false;
  }
  for (const item of timeOff) {
    const f = item.fields || {};
    if (/^(cancelled|canceled|inactive)$/i.test(text(f.Status)) || !sameOperator(f.TruckNumber, f.OperatorName, roster)) continue;
    const start = businessDate(f.StartDate);
    const end = businessDate(f.EndDate);
    if (!start || !end || end < start) return false;
    if (start <= timeOffHorizon && end >= candidate.date) return false;
  }
  return true;
}

function buildPortalCapacity({ projected = [], current = [], roster = [], orders = [], timeOff = [], evidence = {}, now = new Date() }) {
  const { today, hour } = easternClock(now);
  const result = { success: true, open: hour >= 6 && hour < 18, asOf: '', opportunities: [],
    message: 'Availability is subject to dispatch confirmation.' };
  if (!result.open) return { ...result, message: 'Equipment availability is published from 6:00 AM to 6:00 PM Eastern.' };
  const fresh = item => {
    const timestamp = Date.parse(item.createdDateTime || item.fields?.Created || '');
    return Number.isFinite(timestamp) && timestamp <= now.getTime() && now.getTime() - timestamp <= 24 * 60 * 60 * 1000;
  };
  const latest = projected.filter(fresh).sort((a, b) => Date.parse(b.createdDateTime || b.fields.Created) - Date.parse(a.createdDateTime || a.fields.Created))[0];
  const run = text(latest?.fields?.RunDateandTime);
  const candidates = [];
  for (const item of current.filter(fresh)) {
    const f = item.fields || {};
    if (businessDate(f.DateSent) !== today) continue;
    candidates.push({ truck: f.UnitNo, operator: f.DriverName, date: today, location: text(f.CurrentLocation), kind: 'Current', publishedAt: item.createdDateTime || f.Created });
  }
  if (run) for (const item of projected.filter(fresh)) {
    const f = item.fields || {};
    if (text(f.RunDateandTime) !== run) continue;
    candidates.push({ truck: f.Equipment, operator: f.Operator, date: businessDate(f.ProjectedEmpty), location: text(f.Location), kind: 'Projected', publishedAt: item.createdDateTime || f.Created });
  }
  for (const item of timeOff) {
    const f = item.fields || {};
    const start = businessDate(f.StartDate);
    const end = businessDate(f.EndDate);
    if (/^(cancelled|canceled|inactive)$/i.test(text(f.Status)) || !start || !end || end < start) continue;
    // KOLE Connect includes EndDate in time off; the first available day follows it.
    candidates.push({ truck: f.TruckNumber, operator: f.OperatorName, date: addDays(end, 1), location: text(f.LaunchingPoint),
      kind: 'Projected', publishedAt: now.toISOString() });
  }
  const seenTrucks = new Set();
  const seenPublic = new Set();
  for (const candidate of candidates.sort((a, b) => a.kind.localeCompare(b.kind) || Date.parse(b.publishedAt) - Date.parse(a.publishedAt))) {
    if (!candidate.date || candidate.date < today || candidate.date > addDays(today, 7) || !candidate.location || /unverified|unknown|not available/i.test(candidate.location)) continue;
    const matches = roster.filter(item => sameOperator(candidate.truck, candidate.operator, item.fields || {}));
    if (matches.length !== 1) continue;
    const driver = matches[0].fields;
    const unit = truckKey(driver.Trucks);
    if (!unit || seenTrucks.has(unit) || !isCapacityEligible(candidate, driver, orders, timeOff, evidence, today)) continue;
    seenTrucks.add(unit);
    const equipment = equipmentFamily(driver.TrailerType);
    const publicKey = [candidate.date, key(candidate.location), equipment, candidate.kind].join('|');
    if (seenPublic.has(publicKey)) continue;
    seenPublic.add(publicKey);
    result.opportunities.push({ date: candidate.date, location: candidate.location, equipment, kind: candidate.kind });
    if (!result.asOf || candidate.publishedAt > result.asOf) result.asOf = candidate.publishedAt;
  }
  if (!result.asOf && latest) result.asOf = latest.createdDateTime || latest.fields.Created;
  result.opportunities.sort((a, b) => a.date.localeCompare(b.date) || a.location.localeCompare(b.location) || a.equipment.localeCompare(b.equipment));
  return result;
}

function createCustomerPortalRoutes(app, deps) {
  const router = express.Router();
  const attempts = new Map();
  let capacityCache = null;
  let capacityPromise = null;
  let capacityCacheVersion = 0;
  const clearCapacityCache = () => {
    capacityCacheVersion++;
    capacityCache = null;
    capacityPromise = null;
  };
  const accountUrl = id => `https://graph.microsoft.com/v1.0/sites/${deps.getSiteId()}/lists/${encodeURIComponent(deps.getSalesLeadsListId())}/items/${encodeURIComponent(id)}`;
  const getAccount = async (token, id) => {
    if (!/^\d+$/.test(text(id))) throw portalError('Please sign in again.', 401, 'portal_session_required');
    try { return cleanAccount(await deps.graphGet(token, `${accountUrl(id)}?$select=id,eTag&$expand=fields($select=${ACCOUNT_FIELDS})`)); }
    catch (error) {
      if (/itemNotFound|not found/i.test(String(error.message))) return null;
      throw error;
    }
  };
  const loadOrders = async token => {
    const source = await deps.getCurrentBidListingSource(token);
    if (!source) throw portalError('Shipment information is temporarily unavailable.');
    const [items, evidence, trackingRecords] = await Promise.all([
      deps.getAllListItemsWithFields(token, source.listId, ORDER_FIELDS), deps.getUploadEvidenceSets(token), deps.getCustomerTrackingRecords(token)
    ]);
    return { items, evidence, trackingRecords, source };
  };
  const isSecure = req => process.env.NODE_ENV === 'production' || text(req.headers['x-forwarded-proto']).toLowerCase() === 'https';
  const clearCookie = (req, res) => res.setHeader('Set-Cookie', serializePortalCookie('', isSecure(req), 0));
  const publicAccount = account => ({ name: account.name });
  const fail = (res, error) => res.status(error.safeForClient ? error.statusCode : 503).json({ success: false,
    code: error.safeForClient ? error.code : 'portal_unavailable', error: error.safeForClient ? error.message : 'The customer portal is temporarily unavailable. Please try again.' });
  const wrap = handler => async (req, res) => { try { await handler(req, res); } catch (error) { fail(res, error); } };
  function allowedOrigin(req, res, next) {
    const allowed = new Set([PORTAL_ORIGIN, 'http://localhost:5174', 'http://127.0.0.1:5174', ...text(process.env.KOLE_PORTAL_ALLOWED_ORIGINS).split(',').map(value => value.trim()).filter(Boolean)]);
    if (req.headers.origin && !allowed.has(req.headers.origin)) return fail(res, portalError('This request is not allowed.', 403, 'portal_origin_invalid'));
    if (!req.headers.origin && req.headers['sec-fetch-site'] === 'cross-site') return fail(res, portalError('This request is not allowed.', 403, 'portal_origin_invalid'));
    if (!req.is('application/json')) return fail(res, portalError('A JSON request is required.', 415, 'portal_request_invalid'));
    next();
  }
  function rateLimit(req, res, next) {
    const now = Date.now();
    for (const [id, state] of attempts) if (state.until <= now) attempts.delete(id);
    const id = fingerprint(`${req.socket?.remoteAddress || req.ip || ''}`);
    const state = attempts.get(id) || { count: 0, until: now + 15 * 60 * 1000 };
    if (state.count >= 15 || (!attempts.has(id) && attempts.size >= 2000)) {
      res.setHeader('Retry-After', '900');
      return fail(res, portalError('Too many sign-in attempts. Please try again later.', 429, 'portal_rate_limited'));
    }
    state.count++;
    attempts.set(id, state);
    next();
  }
  async function requireSession(req, res, next) {
    try {
      const token = readPortalCookie(req.headers.cookie);
      if (!token) throw portalError('Sign in to view your company’s shipments.', 401, 'portal_session_required');
      let session;
      try { session = verifyPortalSession(token, deps.getSessionSecret()); }
      catch { throw portalError('Your session has ended. Please sign in again.', 401, 'portal_session_required'); }
      const graphToken = await deps.getGraphToken();
      const account = await getAccount(graphToken, session.accountId);
      if (!sessionMatchesAccount(session, account)) throw portalError('Your session has ended. Please sign in again.', 401, 'portal_session_required');
      req.customerPortal = { graphToken, account };
      next();
    } catch (error) {
      if (error.statusCode === 401) clearCookie(req, res);
      fail(res, error);
    }
  }
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  router.post('/session', allowedOrigin, rateLimit, wrap(async (req, res) => {
    const customerCode = typeof req.body?.customerCode === 'string' ? req.body.customerCode.trim() : '';
    const password = req.body?.password;
    if (!customerCode || customerCode.length > 100 || /[\u0000-\u001f]/.test(customerCode) || typeof password !== 'string' || password.length > 128) {
      throw portalError('Check your company code and password.', 401, 'portal_login_invalid');
    }
    const graphToken = await deps.getGraphToken();
    const items = await deps.getAllListItemsWithFields(graphToken, deps.getSalesLeadsListId(), ACCOUNT_FIELDS);
    const matches = items.map(cleanAccount).filter(account => key(account.customerCode) === key(customerCode));
    const account = matches.length === 1 ? matches[0] : null;
    const valid = await verifyPortalPassword(password, account?.passwordHash);
    if (!account || !valid) {
      clearCookie(req, res);
      throw portalError('Check your company code and password.', 401, 'portal_login_invalid');
    }
    res.setHeader('Set-Cookie', serializePortalCookie(createPortalSession(account, deps.getSessionSecret()), isSecure(req)));
    res.json({ success: true, company: publicAccount(account) });
  }));
  router.get('/session', requireSession, (req, res) => res.json({ success: true, company: publicAccount(req.customerPortal.account) }));
  router.post('/logout', allowedOrigin, (req, res) => { clearCookie(req, res); res.json({ success: true }); });
  router.get('/shipments', requireSession, wrap(async (req, res) => {
    const source = await loadOrders(req.customerPortal.graphToken);
    res.json({ success: true, company: publicAccount(req.customerPortal.account), generatedAt: new Date().toISOString(),
      shipments: buildPortalShipments({ ...source, account: req.customerPortal.account }) });
  }));
  router.get('/shipments/:id/tracking', requireSession, wrap(async (req, res) => {
    if (!/^\d+$/.test(req.params.id)) throw portalError('This shipment is not available.', 404, 'portal_shipment_unavailable');
    const source = await loadOrders(req.customerPortal.graphToken);
    const item = source.items.find(order => text(order.id) === req.params.id && belongsToAccount(order, req.customerPortal.account));
    if (!item || !isOpenOrder(item, source.evidence, countBols(source.items))) throw portalError('This shipment is not available.', 404, 'portal_shipment_unavailable');
    const tracking = findOrderTracking(item, source.trackingRecords);
    if (!tracking) throw portalError('Tracking has not started for this shipment.', 404, 'portal_tracking_unavailable');
    res.json(await deps.buildCustomerTrackingSnapshot(req.customerPortal.graphToken, tracking));
  }));
  router.post('/shipments/:id/tracking-request', allowedOrigin, requireSession, wrap(async (req, res) => {
    if (!/^\d+$/.test(req.params.id)) throw portalError('This shipment is not available.', 404, 'portal_shipment_unavailable');
    const { graphToken, account } = req.customerPortal;
    const data = await loadOrders(graphToken);
    const owned = data.items.find(item => text(item.id) === req.params.id && belongsToAccount(item, account));
    if (!owned || !isOpenOrder(owned, data.evidence, countBols(data.items))) {
      throw portalError('This shipment is not available.', 404, 'portal_shipment_unavailable');
    }
    const itemUrl = `https://graph.microsoft.com/v1.0/sites/${deps.getSiteId()}/lists/${encodeURIComponent(data.source.listId)}/items/${req.params.id}`;
    // Re-read immediately before changing the flag: ownership, completion, and ETag
    // can change while the customer is looking at their dashboard.
    const item = await deps.graphGet(graphToken, `${itemUrl}?$select=id,eTag&$expand=fields($select=${ORDER_FIELDS})`);
    if (!belongsToAccount(item, account) || !isOpenOrder(item, data.evidence, countBols(data.items))) {
      throw portalError('This shipment is not available.', 404, 'portal_shipment_unavailable');
    }
    if (!text(item.fields.BOLNumber_x0028_Won_x0029_)) throw portalError('Dispatch must assign a shipment reference before tracking can be requested.', 409, 'portal_reference_pending');
    const active = Boolean(findOrderTracking(item, data.trackingRecords));
    if (!active && !yes(item.fields.EnableTracking)) {
      const etag = item.eTag || item.fields['@odata.etag'];
      if (!etag) throw portalError('Refresh this shipment before requesting tracking.', 409, 'portal_order_changed');
      try { await deps.setIntelliTrackEnabled(graphToken, data.source.listId, item.id, true, etag); }
      catch (error) {
        if (error.graphStatus === 412) throw portalError('The shipment changed. Refresh its status before requesting tracking again.', 409, 'portal_order_changed');
        throw error;
      }
    }
    res.json({ success: true, trackingAvailable: active, trackingRequested: !active,
      message: active ? 'Tracking is already active. Refresh to open it.' : 'Tracking requested. Dispatch will finish setting it up.' });
  }));
  router.get('/capacity', wrap(async (req, res) => {
    const { hour } = easternClock();
    if (hour < 6 || hour >= 18) return res.json(buildPortalCapacity({}));
    if (capacityCache && Date.now() - capacityCache.at < 60000) return res.json(capacityCache.payload);
    if (!capacityPromise) {
      const cacheVersion = capacityCacheVersion;
      const pending = (async () => {
        const token = await deps.getGraphToken();
        const source = await deps.getCurrentBidListingSource(token);
        if (!source) throw portalError('Equipment availability is temporarily unavailable.');
        const [projected, current, roster, orders, timeOff, evidence] = await Promise.all([
          deps.getAllListItemsWithFields(token, process.env.PROJECT_EQUIPMENT_AVAILABILITY_LIST_ID || PROJECTED_LIST_ID, 'ProjectedEmpty,Location,Operator,Equipment,RunDateandTime'),
          deps.getAllListItemsWithFields(token, deps.getAvailableTrucksListId(), 'DateSent,DriverName,UnitNo,CurrentLocation'),
          deps.getAllListItemsWithFields(token, deps.getRosterListId() || ROSTER_LIST_ID, 'Operator_x002f_TeamName,TMSName,Trucks,Status,TrailerType,SoloorTeam'),
          deps.getAllListItemsWithFields(token, source.listId, ORDER_FIELDS),
          deps.getAllListItemsWithFields(token, deps.getTimeOffListId() || TIME_OFF_LIST_ID, 'TruckNumber,OperatorName,StartDate,EndDate,Status,LaunchingPoint'),
          deps.getUploadEvidenceSets(token)
        ]);
        const payload = buildPortalCapacity({ projected, current, roster, orders, timeOff, evidence });
        if (cacheVersion === capacityCacheVersion) capacityCache = { at: Date.now(), payload };
        return payload;
      })().finally(() => { if (capacityPromise === pending) capacityPromise = null; });
      capacityPromise = pending;
    }
    res.json(await capacityPromise);
  }));
  app.use('/api/v1/portal', router);

  // Existing internal lookup authentication protects credential provisioning.
  // Only this deliberate office action can issue or rotate company access.
  app.get('/sales-leads/:id/portal-access', deps.requireLookupAccess, wrap(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const account = await getAccount(await deps.getGraphToken(), req.params.id);
    if (!account) throw portalError('Customer not found.', 404, 'portal_account_missing');
    res.json({ success: true, companyName: account.name, customerCode: account.customerCode, enabled: Boolean(account.passwordHash) });
  }));
  app.post('/sales-leads/:id/portal-access', deps.requireLookupAccess, wrap(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const token = await deps.getGraphToken();
    const account = await getAccount(token, req.params.id);
    if (!account || !account.customerCode) throw portalError('This customer needs a customer code before portal access can be issued.', 400, 'portal_customer_code_missing');
    if (account.passwordHash && req.body?.reset !== true) return res.json({ success: true, enabled: true, created: false,
      customerCode: account.customerCode, message: 'A company password has already been issued. It has not been changed.' });
    const allAccounts = await deps.getAllListItemsWithFields(token, deps.getSalesLeadsListId(), 'CustomerCode');
    if (allAccounts.filter(item => key(item.fields?.CustomerCode) === key(account.customerCode)).length !== 1) {
      throw portalError('The customer code must identify exactly one company.', 409, 'portal_customer_code_ambiguous');
    }
    const columns = await deps.getListColumns(token, deps.getSalesLeadsListId());
    const column = columns.find(value => value.name === 'PortalPassword');
    if (!column?.text || column.readOnly || (column.text.maxLength && column.text.maxLength < 128)) {
      throw portalError('Add PortalPassword as an editable Text field in Sales Leads before issuing access.', 503, 'portal_password_field_missing');
    }
    if (!account.etag) throw portalError('Refresh the company record before issuing access.', 409, 'portal_account_changed');
    const password = crypto.randomBytes(18).toString('base64url');
    const passwordHash = await hashPortalPassword(password);
    try { await deps.graphPatch(token, `${accountUrl(account.id)}/fields`, { PortalPassword: passwordHash }, { 'If-Match': account.etag }); }
    catch (error) {
      if (error.graphStatus === 412) throw portalError('The company record changed. Refresh before issuing access.', 409, 'portal_account_changed');
      throw error;
    }
    deps.clearSalesLeadsCache?.();
    res.json({ success: true, enabled: true, created: true, customerCode: account.customerCode, password,
      portalUrl: `${PORTAL_ORIGIN}/shipments`, message: 'Copy this password now. It is displayed once.' });
  }));
  return { clearCapacityCache };
}

module.exports = { businessDate, easternClock, hashPortalPassword, verifyPortalPassword, createPortalSession,
  verifyPortalSession, sessionMatchesAccount, serializePortalCookie, belongsToAccount, buildPortalShipments,
  buildPortalCapacity, createCustomerPortalRoutes };
