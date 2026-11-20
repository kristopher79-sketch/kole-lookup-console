const PAGE_MARGIN = 24;
const PDF_IMAGE_DPI = 200;

export async function prepareDeliveryPhotoPage(image) {
  const bitmap = await createImageBitmap(image);
  const canvas = document.createElement('canvas');
  try {
    const [pageWidth, pageHeight] = bitmap.width > bitmap.height ? [792, 612] : [612, 792];
    const scale = Math.min(
      (pageWidth - PAGE_MARGIN * 2) / bitmap.width,
      (pageHeight - PAGE_MARGIN * 2) / bitmap.height
    );
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    const resize = Math.min(1, scale * PDF_IMAGE_DPI / 72);
    canvas.width = Math.max(1, Math.round(bitmap.width * resize));
    canvas.height = Math.max(1, Math.round(bitmap.height * resize));
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const jpeg = await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob?.type === 'image/jpeg') resolve(blob);
        else reject(new Error('The photo could not be converted to JPEG.'));
      }, 'image/jpeg', 0.92);
    });
    return { jpeg, pageWidth, pageHeight, width, height, pixelsWide: canvas.width, pixelsHigh: canvas.height };
  } finally {
    bitmap.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}

// Each page has one JPEG XObject. Offsets and stream lengths are PDF byte counts.
export function buildDeliveryPhotoPdf(pages) {
  const encoder = new TextEncoder();
  const parts = [];
  const offsets = [0];
  let byteLength = 0;

  function append(value) {
    const part = typeof value === 'string' ? encoder.encode(value) : value;
    parts.push(part);
    byteLength += part instanceof Blob ? part.size : part.byteLength;
  }

  function writeObject(id, ...contents) {
    offsets[id] = byteLength;
    append(`${id} 0 obj\n`);
    contents.forEach(append);
    append('\nendobj\n');
  }

  append('%PDF-1.4\n');
  append(new Uint8Array([37, 226, 227, 207, 211, 10]));
  writeObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
  const pageRefs = pages.map((_, index) => `${3 + index * 3} 0 R`);
  writeObject(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pageRefs.join(' ')}] >>`);

  pages.forEach(({ jpeg, pageWidth, pageHeight, width, height, pixelsWide, pixelsHigh }, index) => {
    const pageId = 3 + index * 3;
    const imageId = pageId + 1;
    const contentId = pageId + 2;
    const x = (pageWidth - width) / 2;
    const y = (pageHeight - height) / 2;
    const matrix = [width, 0, 0, height, x, y].map((value) => value.toFixed(4)).join(' ');
    const content = encoder.encode(`q\n${matrix} cm\n/Photo Do\nQ\n`);

    writeObject(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] ` +
      `/Resources << /XObject << /Photo ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    writeObject(imageId, `<< /Type /XObject /Subtype /Image /Width ${pixelsWide} /Height ${pixelsHigh} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.size} >>\nstream\n`, jpeg, '\nendstream');
    writeObject(contentId, `<< /Length ${content.byteLength} >>\nstream\n`, content, 'endstream');
  });

  const xref = byteLength;
  append(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  offsets.slice(1).forEach((offset) => append(`${String(offset).padStart(10, '0')} 00000 n \n`));
  append(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}
