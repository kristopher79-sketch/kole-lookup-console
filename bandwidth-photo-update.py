from pathlib import Path

root = Path('C:/Projects/PhotoReferenceLibrary')
updates = {}

def replace(path, old, new):
    current = updates.get(path, path.read_text(encoding='utf-8'))
    assert current.count(old) == 1, f'Expected unique source in {path.name}'
    updates[path] = current.replace(old, new)

path = root / 'src/components/LibraryImage.tsx'
replace(path, 'import { useEffect, useState }', 'import { useEffect, useRef, useState }')
replace(path, '  const [failed, setFailed] = useState(false);', '''  const [failed, setFailed] = useState(false);
  const placeholderRef = useRef<HTMLSpanElement>(null);''')
replace(path, '''    galleryService.loadImage(source, controller.signal).then(setResolvedSource).catch((error) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setFailed(true);
    });
    return () => controller.abort();
  }, [source]);''', '''    let observer: IntersectionObserver | undefined;
    let started = false;
    const load = () => {
      if (started || controller.signal.aborted) return;
      started = true;
      observer?.disconnect();
      galleryService.loadImage(source, controller.signal).then((url) => {
        if (!controller.signal.aborted) setResolvedSource(url);
      }).catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    };
    // Native img loading cannot defer the authenticated fetch that creates its
    // blob URL. Start that fetch near the viewport, with eager lightboxes intact.
    if (loading === "eager" || source.startsWith("data:") ||
        typeof IntersectionObserver === "undefined" || !placeholderRef.current) load();
    else {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) load();
      }, { rootMargin: "240px" });
      observer.observe(placeholderRef.current);
    }
    return () => { observer?.disconnect(); controller.abort(); };
  }, [source, loading]);''')
replace(path, '<span className={`library-image-state loading', '<span ref={placeholderRef} className={`library-image-state loading')

path = root / 'src/services/microsoftGalleryService.ts'
replace(path, '''  private async acquireImageSlot(signal?: AbortSignal) {
    if (this.activeImageRequests''', '''  private async acquireImageSlot(signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException("The image request was cancelled.", "AbortError");
    if (this.activeImageRequests''')
replace(path, '''    try {
      let response: Response;
      try {
        response = await fetch(absoluteUrl,''', '''    try {
      // A preceding queued request may already have populated the private cache.
      if (signal?.aborted) throw new DOMException("The image request was cancelled.", "AbortError");
      const queuedCached = this.imageCache.get(absoluteUrl);
      if (queuedCached) return queuedCached;
      let response: Response;
      try {
        response = await fetch(absoluteUrl,''')

path = root / 'backend/photo-library-service.cjs'
replace(path, '''    const id = registerPhotoReference(configuration, shipment, item, stage, photoKey, hidden);
    const capturedAt''', '''    const id = registerPhotoReference(configuration, shipment, item, stage, photoKey, hidden);
    const revision = cleanText(item.eTag) || cleanText(item.lastModifiedDateTime);
    const version = revision ? `?v=${crypto.createHash('sha256').update(revision).digest('hex').slice(0, 24)}` : '';
    const capturedAt''')
replace(path, '''      thumbnailUrl: `/api/photo-library/photos/${encodeURIComponent(id)}/thumbnail`,
      fullUrl: `/api/photo-library/photos/${encodeURIComponent(id)}/content`,''', '''      thumbnailUrl: `/api/photo-library/photos/${encodeURIComponent(id)}/thumbnail${version}`,
      fullUrl: `/api/photo-library/photos/${encodeURIComponent(id)}/content${version}`,''')

for path, content in updates.items():
    original = path.read_bytes()
    newline = '\r\n' if b'\r\n' in original else '\n'
    path.write_bytes(content.replace('\n', newline).encode('utf-8'))
print('Updated Photo Reference Library image loading, queue reuse, and revision URLs (3 source files).')
