import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { buildDeliveryPhotoPdf, prepareDeliveryPhotoPage } from './delivery-photo-pdf';

function deliveryPhotoUrl(endpoint, orderQuery, photoId, size) {
  return `${endpoint}/${encodeURIComponent(photoId)}/${size}?${orderQuery}`;
}

function DeliveryPhotoThumbnail({ photo, url, authedFetch, checked, busy, onChange }) {
  const tileRef = useRef(null);
  const [visible, setVisible] = useState(false);
  const [preview, setPreview] = useState(null);
  const fetchPhoto = useEffectEvent((signal) => authedFetch(url, { signal }));

  useEffect(() => {
    if (visible) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(tileRef.current);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    let objectUrl;

    async function loadPreview() {
      try {
        const response = await fetchPhoto(controller.signal);
        if (!response.ok) throw new Error('Preview unavailable.');
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setPreview({ url: objectUrl });
      } catch {
        if (!controller.signal.aborted) setPreview({ url: '' });
      }
    }

    void loadPreview();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [visible, url]);

  return (
    <label className="delivery-photo-tile" ref={tileRef}>
      <span className="delivery-photo-preview">
        {preview?.url
          ? <img src={preview.url} alt="" onError={() => setPreview({ url: '' })} />
          : <span>{preview ? 'Preview unavailable' : 'Loading preview...'}</span>}
      </span>
      <span className="delivery-photo-caption">
        <input type="checkbox" aria-label={photo.name} checked={checked} disabled={busy} onChange={onChange} />
        <span title={photo.name}>{photo.name}</span>
      </span>
    </label>
  );
}

export default function DeliveryPhotoPackage({ photos, endpoint, orderQuery, authedFetch, onDownload }) {
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const exportRef = useRef(null);
  const selection = photos.filter((photo) => selectedIds.has(photo.id));
  const busy = progress !== null;

  useEffect(() => () => exportRef.current?.abort(), []);

  function togglePhoto(photoId) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
    setError('');
  }

  async function downloadPackage() {
    if (!selection.length || exportRef.current) return;
    const controller = new AbortController();
    exportRef.current = controller;
    setError('');
    setProgress(0);
    let currentPhoto;

    try {
      const pages = [];
      for (const photo of selection) {
        currentPhoto = photo;
        setProgress(pages.length + 1);
        const url = deliveryPhotoUrl(endpoint, orderQuery, photo.id, 'content');
        const response = await authedFetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error('Photo unavailable.');
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        pages.push(await prepareDeliveryPhotoPage(blob));
        if (controller.signal.aborted) return;
      }
      currentPhoto = null;
      onDownload(buildDeliveryPhotoPdf(pages));
    } catch {
      if (!controller.signal.aborted) {
        setError(currentPhoto
          ? `Could not package ${currentPhoto.name}. Try again or deselect that photo.`
          : 'Could not create the PDF. Try again.');
      }
    } finally {
      exportRef.current = null;
      if (!controller.signal.aborted) setProgress(null);
    }
  }

  return (
    <section className="load-paperwork-panel delivery-photo-package" aria-label="Delivery photos">
      <div className="load-paperwork-heading-row">
        <div>
          <strong>Select delivery photos</strong>
          <span role="status">{selection.length} of {photos.length} selected</span>
        </div>
        <div className="load-paperwork-heading-actions">
          <button
            type="button"
            className="document-launch-button"
            disabled={busy}
            onClick={() => {
              setSelectedIds(new Set(selection.length === photos.length ? [] : photos.map((photo) => photo.id)));
              setError('');
            }}
          >
            {selection.length === photos.length ? 'Clear selection' : 'Select all'}
          </button>
          <button type="button" className="view-button" disabled={busy || !selection.length} onClick={downloadPackage}>
            Download PDF
          </button>
        </div>
      </div>
      {busy && <div className="load-paperwork-state" role="status">Preparing photo {progress} of {selection.length}...</div>}
      {error && <div className="load-paperwork-state is-error" role="alert">{error}</div>}
      <div className="delivery-photo-grid">
        {photos.map((photo) => (
          <DeliveryPhotoThumbnail
            key={photo.id}
            photo={photo}
            url={deliveryPhotoUrl(endpoint, orderQuery, photo.id, 'thumbnail')}
            authedFetch={authedFetch}
            checked={selectedIds.has(photo.id)}
            busy={busy}
            onChange={() => togglePhoto(photo.id)}
          />
        ))}
      </div>
    </section>
  );
}
