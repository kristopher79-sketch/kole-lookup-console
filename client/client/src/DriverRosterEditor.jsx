import { useEffect, useRef, useState } from 'react';

export default function DriverRosterEditor({ itemId, api, authedFetch, onSaved, onCancel, onStateChange }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [requiresReload, setRequiresReload] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const callbacks = useRef(null);
  const savingRef = useRef(false);
  const formRef = useRef(null);
  const baseline = data?.values || {};
  const changes = Object.fromEntries((data?.fields || [])
    .filter((field) => !field.disabledReason && draft[field.key] !== baseline[field.key])
    .map((field) => [field.key, draft[field.key]]));
  const dirty = Object.keys(changes).length > 0;

  useEffect(() => {
    callbacks.current = { authedFetch, onSaved, onStateChange };
  }, [authedFetch, onSaved, onStateChange]);

  useEffect(() => {
    onStateChange({ dirty, saving });
  }, [dirty, saving, onStateChange]);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError('');
      setRequiresReload(false);
      try {
        const res = await callbacks.current.authedFetch(`${api}/driver-roster/${encodeURIComponent(itemId)}/edit`, { signal: controller.signal });
        const result = await res.json().catch(() => ({}));
        if (!res.ok || !result.success || !result.etag || !Array.isArray(result.fields)) throw new Error(result.error || 'Unable to load this driver for editing.');
        const values = Object.fromEntries(result.fields.map((field) => [field.key,
          field.kind === 'date' ? String(result.values?.[field.key] ?? '').slice(0, 10) : String(result.values?.[field.key] ?? '')
        ]));
        if (!controller.signal.aborted) { setData({ ...result, values }); setDraft(values); }
      } catch (err) {
        if (!controller.signal.aborted) { setData(null); setError(err.message || 'Unable to load this driver.'); }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [api, itemId, reloadKey]);

  useEffect(() => {
    if (data && !loading) formRef.current?.querySelector('input:not(:disabled), select:not(:disabled)')?.focus();
  }, [data, loading]);

  function reload() {
    if (savingRef.current) return;
    if (dirty && !window.confirm('Reload the latest driver record and discard your unsaved edits?')) return;
    setReloadKey((key) => key + 1);
  }

  async function save(event) {
    event.preventDefault();
    if (!dirty || loading || savingRef.current || requiresReload) return;
    savingRef.current = true;
    callbacks.current.onStateChange({ dirty, saving: true });
    setSaving(true);
    setError('');
    try {
      const res = await callbacks.current.authedFetch(`${api}/driver-roster/${encodeURIComponent(itemId)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ etag: data.etag, changes })
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result.success || !result.roster) {
        setRequiresReload(result.requiresReload === true || res.status >= 500 || (res.ok && !result.roster));
        setError(result.error || 'Unable to confirm this save. Reload the driver before trying again.');
        return;
      }
      callbacks.current.onSaved(result);
    } catch {
      setRequiresReload(true);
      setError('The save outcome could not be confirmed. Reload the driver to check the saved values before trying again.');
    } finally {
      savingRef.current = false;
      callbacks.current.onStateChange({ dirty, saving: false });
      setSaving(false);
    }
  }

  const groups = [...new Set((data?.fields || []).map((field) => field.group))];
  return (
    <form className="driver-roster-edit-form" ref={formRef} onSubmit={save} aria-busy={loading || saving}>
      <div className="driver-roster-edit-intro">
        <h3>Edit Driver</h3>
        <p>Save changes to this Driver Roster record. Status and termination are managed with the card’s Terminate Driver action.</p>
      </div>
      {loading ? <div className="msg" role="status">Loading the latest driver record and field choices…</div> : data && groups.map((group) => (
        <fieldset key={group} className="driver-roster-edit-section" disabled={saving}>
          <legend>{group}</legend>
          <div className="driver-roster-edit-grid">
            {data.fields.filter((field) => field.group === group).map((field) => {
              const id = `driver-roster-edit-${field.key}`;
              const value = draft[field.key] ?? '';
              const inputProps = {
                id, value, disabled: Boolean(field.disabledReason), required: field.required,
                'aria-describedby': field.disabledReason ? `${id}-hint` : undefined,
                onChange: (event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))
              };
              return (
                <label key={field.key} className="driver-roster-edit-field" htmlFor={id}>
                  <span>{field.label}{field.required ? ' *' : ''}</span>
                  {field.choices ? (
                    <select {...inputProps}>
                      <option value="">Not set</option>
                      {value && !field.choices.includes(value) && <option value={value} disabled>{value} (current)</option>}
                      {field.choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
                    </select>
                  ) : (
                    <input {...inputProps} type={['date', 'email'].includes(field.kind) ? field.kind : 'text'}
                      inputMode={['number', 'integer', 'year'].includes(field.kind) ? 'decimal' : undefined}
                      maxLength={field.maxLength} />
                  )}
                  {field.disabledReason && <small id={`${id}-hint`}>{field.disabledReason}</small>}
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
      {error && <div className="msg error" role="alert">{error}</div>}
      <div className="driver-roster-edit-actions">
        <span role="status" aria-live="polite">{saving ? 'Saving driver…' : dirty ? 'Unsaved changes' : data && !loading ? 'No unsaved changes' : ''}</span>
        <button type="button" className="secondary-button" onClick={onCancel} disabled={saving}>Cancel</button>
        {(requiresReload || (!data && !loading)) && <button type="button" className="secondary-button" onClick={reload} disabled={saving}>Reload latest</button>}
        <button type="submit" className="view-button" disabled={!data || loading || saving || !dirty || requiresReload}>{saving ? 'Saving…' : 'Save Driver'}</button>
      </div>
    </form>
  );
}
