import { useEffect, useEffectEvent, useState } from 'react';
import './CompanyPortalAccess.css';

export default function CompanyPortalAccess({ leadId, companyName, apiBase, authedFetch }) {
  const [access, setAccess] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [credential, setCredential] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const endpoint = `${apiBase}/sales-leads/${encodeURIComponent(leadId)}/portal-access`;

  const fetchAccess = useEffectEvent((signal) => authedFetch(endpoint, { signal }));
  useEffect(() => {
    const controller = new AbortController();
    async function loadAccess() {
      try {
        const response = await fetchAccess(controller.signal);
        const payload = await response.json();
        if (!response.ok || payload.success === false) throw new Error(payload.error || 'Unable to load portal access.');
        if (!controller.signal.aborted) setAccess(payload);
      } catch (err) {
        if (!controller.signal.aborted) setError(err.message || 'Unable to load portal access.');
      }
    }
    loadAccess();
    return () => controller.abort();
  }, [leadId]);

  async function issuePassword() {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    setCredential(null);
    try {
      const response = await authedFetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reset: access?.enabled === true && confirmReset })
      });
      const payload = await response.json();
      if (!response.ok || payload.success === false) throw new Error(payload.error || 'Unable to issue company portal access.');
      setAccess({ ...access, enabled: payload.enabled, customerCode: payload.customerCode });
      setCredential(payload.password ? payload : null);
      setMessage(payload.message || 'Company access is ready.');
      setConfirmReset(false);
    } catch (err) {
      setError(err.message || 'Unable to issue company portal access.');
    } finally { setBusy(false); }
  }

  const invitation = credential ? `KOLE Customer Portal\n\n${companyName || 'Your company'} can view current and future booked shipments and open active tracking.\n\nPortal: ${credential.portalUrl}\nCompany code: ${credential.customerCode}\nCompany password: ${credential.password}\n\nThis password is shared by your company. Please share it only with authorized colleagues.\n\nYour shipment-specific tracking email links continue to work directly.\nQuestions? Contact dispatch@koletrucking.com.` : '';

  async function copyInvitation() {
    try { await navigator.clipboard.writeText(invitation); setMessage('Invitation copied. It is ready to share with the customer.'); }
    catch { setMessage('Select and copy the invitation below.'); }
  }

  return <section className="company-portal-access" aria-labelledby="company-portal-access-title">
    <div className="company-portal-access-heading"><div><h3 id="company-portal-access-title">Customer Portal access</h3><p>One company password opens its current and future booked shipments.</p></div>{access && <span>{access.enabled ? 'Password issued' : 'Not yet invited'}</span>}</div>
    {access && <p>Company code: <strong>{access.customerCode || 'Missing'}</strong></p>}
    {error && <div className="msg error" role="alert">{error}</div>}
    {message && <div className="msg" role="status">{message}</div>}
    {!access && !error && <p role="status">Checking company access…</p>}
    {access?.enabled && <label className="company-portal-reset"><input type="checkbox" checked={confirmReset} onChange={(event) => setConfirmReset(event.target.checked)} disabled={busy} /><span>Replace the shared company password and end its existing portal sessions.</span></label>}
    {access && <button type="button" className="secondary-action-button" onClick={issuePassword} disabled={busy || !access.customerCode || (access.enabled && !confirmReset)}>{busy ? 'Issuing access…' : access.enabled ? 'Reset company password' : 'Generate company password'}</button>}
    {credential && <div className="company-portal-invitation"><p>Copy this invitation before closing. The password is displayed once.</p><textarea aria-label="Company portal invitation" value={invitation} readOnly rows={12} spellCheck={false} /><button type="button" className="secondary-action-button" onClick={copyInvitation}>Copy invitation</button></div>}
  </section>;
}
