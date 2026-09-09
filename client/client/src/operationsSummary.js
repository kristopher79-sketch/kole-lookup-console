// Use the server's Eastern-date slices so labels share the displayed snapshot's
// date boundary, even if that snapshot is stale or viewed across midnight.
export function getOperationsSummaryDetail(record, slice, data) {
  if (slice === 'activeToday') {
    if (!record.id || !Array.isArray(data?.loadingToday) || !Array.isArray(data?.deliveringToday)) return '';
    const matches = (row) => String(row.id) === String(record.id)
      && row.SourceListId === record.SourceListId;
    const loading = data.loadingToday.some(matches);
    const delivering = data.deliveringToday.some(matches);
    if (loading && delivering) return 'Same Day';
    if (loading) return 'Loading';
    if (delivering) return 'Delivering';
    return 'In Transit';
  }

  const prefix = slice === 'deliveringToday' ? 'Delivery'
    : slice === 'loadingToday' || slice === 'loadingNext7' ? 'Pickup' : '';
  if (!prefix) return '';
  const time = String(record[`${prefix}Time`] ?? '').trim();
  if (!time) return 'Time not set';
  const ampm = String(record[`${prefix}AMPM`] ?? '').trim();
  // Some source entries already include AM/PM in their free-text time field.
  return ampm && !/\b[ap]\.?m\.?\b/i.test(time) ? `${time} ${ampm}` : time;
}
