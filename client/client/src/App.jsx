import { useState } from 'react';
import './App.css';

const API = 'https://kole-lookup-console.onrender.com';

export default function App() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searchedRecords, setSearchedRecords] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasSearched, setHasSearched] = useState(false);

  async function handleSearch() {
    const q = query.trim();

    if (!q) return;

    setLoading(true);
    setError('');
    setHasSearched(true);

    try {
      const res = await fetch(`${API}/search?q=${encodeURIComponent(q)}`);
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

  function getStatusClass(status) {
    const s = (status || '').toLowerCase();

    if (s === 'won') return 'status won';
    if (s === 'lost') return 'status lost';
    if (s === 'tonu') return 'status tonu';
    if (s === 'can') return 'status cancelled';

    return 'status';
  }

  return (
    <div className="container">

      <h1>Kole Lookup Console</h1>

      <div className="search-bar">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Search BOL, Customer, Driver, Truck..."
        />
        <button onClick={handleSearch} disabled={loading}>
          {loading ? 'Searching...' : 'Search'}
        </button>
      </div>

      {hasSearched && !loading && !error && (
        <div className="summary">
          {results.length} results from {searchedRecords} records
        </div>
      )}

      {loading && <div className="msg">Searching...</div>}
      {error && <div className="msg error">{error}</div>}
      {hasSearched && !loading && results.length === 0 && (
        <div className="msg">No results found</div>
      )}

      {results.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>BOL</th>
              <th>Customer</th>
              <th>Origin</th>
              <th>Destination</th>
              <th>Driver</th>
              <th>Truck</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i}>
                <td>{r.BOL}</td>
                <td>{r.Customer}</td>
                <td>{r.Origin}</td>
                <td>{r.Destination}</td>
                <td>{r.Driver}</td>
                <td>{r.Truck}</td>
                <td>
                  <span className={getStatusClass(r.Status)}>
                    {r.Status || '-'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

    </div>
  );
}