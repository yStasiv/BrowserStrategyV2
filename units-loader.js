// Fetch units.json and expose as window.INITIAL_UNITS.
// After loading, call window.__bs_start() if present so the page can begin.
(async function(){
  try {
    const resp = await fetch('/units.json', { cache: 'no-cache' });
    if (!resp.ok) {
      console.error('Failed to load units.json:', resp.status, resp.statusText);
      return;
    }
    const data = await resp.json();
    window.INITIAL_UNITS = data;
    // notify page that units are ready
    if (typeof window.__bs_start === 'function') {
      try { window.__bs_start(); } catch (e) { console.error('start callback failed', e); }
    } else {
      // dispatch an event as a fallback
      document.dispatchEvent(new CustomEvent('units:loaded'));
    }
  } catch (err) {
    console.error('Error loading units.json', err);
  }
})();
