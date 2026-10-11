/*
 * funcode / nuweb seating-plan: férőhely + eladások árkategóriánként és szintenként
 *
 * Használat: nyisd meg az eseményt (pl. https://ln.funcode.hu/events/173976), add meg az
 * access code-ot ha kell, majd másold be a DevTools Console-ba. Markdown riportot ír ki
 * (és ha lehet, vágólapra is teszi).
 *
 * Also runs as a bookmarklet: `node build-bookmarklet.mjs` writes dist/bookmarklet.html.
 * Either way the result shows in an on-page panel with a copy button.
 *
 * Adatforrások (a térkép canvas, DOM-ból nem olvasható):
 *  - GET /events/{id}  (Inertia partial: X-Inertia-Partial-Data: tickets,price_bands)
 *        -> árkategóriák neve + ára (tickets[].items[].pricing[].total_price)
 *  - GET /events/{id}/seating-plan/availability?force_refresh=1&with_areas=1
 *        -> szektorlista (price_bands[].areas[])
 *  - GET /events/{id}/seating-plan/availability?area_id={a}&delta=2000-01-01 00:00:00
 *        -> régi "delta" időbélyeggel a szektor ÖSSZES székét visszaadja, az eladottakat is:
 *             current_stock == 0                                  => ELADVA (vagy épp kosárban)
 *             current_stock > 0 && is_available_for_user          => kattintható / megvehető
 *             current_stock > 0 && !is_available_for_user         => zárolt (hold, nem eladott)
 *           és minden széknél ott az aktuális price_band_id.
 *
 * Olyan széket, amelyhez az eseményen nincs árkategória rendelve (pl. 101/104/109/112 "S" sora),
 * az API nem ad vissza – ezek nincsenek árusításban, és nem számítanak férőhelynek.
 *
 * "Megnyitott" szektor = van benne legalább 1 kattintható szék (a teljesen zárolt 300-as
 * szint így kimarad). A százalékok ezekre a szektorokra vonatkoznak.
 */
(async ({ concurrency = 4, delayMs = 150 } = {}) => {
  const ui = reportPanel();
  try {
    const md = await buildReport();
    await ui.done(md);
    return md;
  } catch (e) {
    ui.fail(e);
    throw e;
  }

  async function buildReport() {
    const ev = location.pathname.match(/events\/(\d+)/)?.[1];
    if (!ev) throw new Error('Nem eseményoldal (/events/{id})');
    const XHR = { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' };
    const getJSON = async (url, headers = XHR) => {
      const r = await fetch(url, { headers, credentials: 'include' });
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return r.json();
    };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const fmt = (n) => n.toLocaleString('hu-HU');
    const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1).replace('.', ',') : '0') + '%';

    // 1) árak (Inertia lazy prop)
    const page = JSON.parse(document.querySelector('[data-page]')?.dataset.page || '{}');
    const prices = new Map(); // price_band_id -> [ár...]
    const bandNames = new Map();
    try {
      const inr = await getJSON(`/events/${ev}`, {
        'X-Inertia': 'true', 'X-Inertia-Version': page.version || '',
        'X-Inertia-Partial-Data': 'tickets,price_bands', 'X-Inertia-Partial-Component': page.component || '',
        'X-Requested-With': 'XMLHttpRequest',
      });
      for (const g of inr.props?.tickets || [])
        for (const it of g.items || []) {
          const p = (it.pricing || []).map((x) => x.total_price ?? x.display_total).filter((x) => x != null);
          if (it.price_band_id && p.length) prices.set(it.price_band_id, [...(prices.get(it.price_band_id) || []), ...p]);
        }
      for (const b of inr.props?.price_bands || []) bandNames.set(b.id, b.name);
    } catch (e) { ui.warn(`Árak lekérése nem sikerült: ${e.message}`); }

    // 2) szektorlista
    const ov = await getJSON(`/events/${ev}/seating-plan/availability?force_refresh=1&with_areas=1`);
    const areas = new Map();
    for (const b of ov.price_bands || []) {
      if (!bandNames.has(b.id)) bandNames.set(b.id, b.name);
      for (const a of b.areas || []) areas.set(a.id, { id: a.id, name: a.name });
    }

    // 3) szektoronként minden szék (delta trükk)
    const DELTA = encodeURIComponent('2000-01-01 00:00:00');
    const seats = [];
    const queue = [...areas.values()];
    let done = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (queue.length) {
        const a = queue.shift();
        // On failure, drain the queue so the other workers stop sending requests.
        const j = await getJSON(`/events/${ev}/seating-plan/availability?force_refresh=0&area_id=${a.id}&delta=${DELTA}`)
          .catch((e) => { queue.length = 0; throw e; });
        for (const s of j.seats || []) {
          const state = s.current_stock <= 0 ? (s.active_reservations_count > 0 && !s.sold_count ? 'basket' : 'sold')
            : s.is_available_for_user ? 'available' : 'held';
          seats.push({ area: a.name, band: s.price_band_id, state });
        }
        if ((j.unallocated || []).length || (j.table_seats || []).length)
          ui.warn(`${a.name}: állójegyes/asztalos hely is van, ezt a script nem számolja`);
        ui.progress(++done, areas.size);
        await sleep(delayMs);
      }
    }));

    // 4) aggregálás
    const agg = (keyFn, list) => {
      const m = new Map();
      for (const s of list) {
        const k = keyFn(s);
        const x = m.get(k) || { total: 0, sold: 0, basket: 0, available: 0, held: 0 };
        x.total++; x[s.state]++; m.set(k, x);
      }
      return m;
    };
    const byArea = agg((s) => s.area, seats);
    // Megnyitott = volt már árusításban: van kattintható, eladott vagy kosárban lévő széke.
    // (Egy telt szektorban available = 0, de sold > 0 – ez megnyitott. A sosem nyitott
    //  szektorban minden szék zárolt: sold = 0 és available = 0.)
    const openAreas = new Set([...byArea].filter(([, v]) => v.available + v.sold + v.basket > 0).map(([k]) => k));
    const soldOutAreas = [...byArea].filter(([k, v]) => openAreas.has(k) && v.available === 0).map(([k]) => k)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const open = seats.filter((s) => openAreas.has(s.area));
    const T = agg(() => 'all', open).get('all') || { total: 0, sold: 0, basket: 0, available: 0, held: 0 };

    const priceTxt = (id) => {
      const p = prices.get(id);
      if (!p) return 'ár n/a';
      const lo = Math.min(...p), hi = Math.max(...p);
      return lo === hi ? `${fmt(lo)} Ft` : `${fmt(lo)}–${fmt(hi)} Ft`;
    };
    const bands = [...agg((s) => s.band, open)]
      .map(([id, v]) => ({ id, name: (bandNames.get(id) || `#${id}`).replace(/\s+/g, ' ').trim(), price: Math.max(...(prices.get(id) || [0])), ...v }))
      .sort((a, b) => b.price - a.price || a.name.localeCompare(b.name));

    const levelOf = (name) => (/^\d/.test(name) ? `${name[0]}xx` : name);
    const levelLabel = (l) => (l === '0xx' ? 'Floor (0xx)' : l);
    const levelsAll = agg((s) => levelOf(s.area), seats);
    const levelsOpen = agg((s) => levelOf(s.area), open);

    const line = (label, v) => `* ${label}: ${fmt(v.total)} / ${fmt(v.sold)} eladva (${pct(v.sold, v.total)})`;
    const md = [
      `## Összegzés`,
      ``,
      `${fmt(T.total)} férőhely van jelenleg megnyitva, ebből ${fmt(T.sold)}-at adtak el, ami ${pct(T.sold, T.total)}-os kihasználtság.`,
      ``,
      `(Még megvehető: ${fmt(T.available)} · zárolt/hold: ${fmt(T.held)}${T.basket ? ` · kosárban: ${fmt(T.basket)}` : ''} · adatok: ${new Date(ov.latest_availability_timestamp.replace(' ', 'T') + 'Z').toLocaleString('hu-HU', { timeZone: 'Europe/Budapest' })})`,
      ...(soldOutAreas.length ? [``, `Telt szektorok (nincs már megvehető hely): ${soldOutAreas.join(', ')}`] : []),
      ``,
      `### Az árkategóriák az alábbi módon alakulnak:`,
      ``,
      ...bands.map((b) => line(`${b.name} – ${priceTxt(b.id)}`, b)),
      ``,
      `### Emeletek`,
      ``,
      ...[...levelsAll.keys()].sort().map((l) => {
        const v = levelsOpen.get(l);
        return v ? line(levelLabel(l), v) : `* ${levelLabel(l)}: nincs megnyitva (${fmt(levelsAll.get(l).total)} szék, mind zárolt)`;
      }),
    ].join('\n');

    console.log(md);
    window.__seatReport = { md, seats, bands, byArea: Object.fromEntries(byArea), total: T };
    return md;
  }

  // Fixed panel for status, warnings and the result. Styles go through CSSOM (el.style), which a
  // strict page CSP does not block, unlike a <style> tag; the shadow root keeps page CSS out.
  // Text is only ever set via textContent/value, so names from the API cannot inject markup.
  function reportPanel() {
    const ID = 'seat-report-panel';
    document.getElementById(ID)?.remove();
    const c = matchMedia('(prefers-color-scheme: dark)').matches
      ? { bg: '#1e1e1e', fg: '#eeeeee', muted: '#b0b0b0', border: '#454545', field: '#141414', accent: '#4c8dff', error: '#ff8a80', warn: '#ffcc80' }
      : { bg: '#ffffff', fg: '#1a1a1a', muted: '#555555', border: '#c8c8c8', field: '#f6f6f6', accent: '#1a56db', error: '#b3261e', warn: '#7a4a00' };
    const el = (tag, style, text) => {
      const n = document.createElement(tag);
      Object.assign(n.style, style);
      if (text != null) n.textContent = text;
      return n;
    };
    const button = (label, primary) => {
      const b = el('button', {
        font: 'inherit', padding: '6px 12px', minHeight: '32px', borderRadius: '6px', cursor: 'pointer',
        border: `1px solid ${primary ? c.accent : c.border}`, background: primary ? c.accent : 'transparent', color: primary ? '#fff' : c.fg,
      }, label);
      b.type = 'button';
      return b;
    };

    const host = el('div', { all: 'initial' });
    host.id = ID;
    const box = el('div', {
      position: 'fixed', top: '16px', right: '16px', zIndex: '2147483647', boxSizing: 'border-box',
      width: 'min(560px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 32px)',
      display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px',
      background: c.bg, color: c.fg, border: `1px solid ${c.border}`, borderRadius: '8px',
      boxShadow: '0 8px 24px rgba(0,0,0,.3)', font: '14px/1.4 system-ui, sans-serif',
    });
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Ülőhely-riport');
    const head = el('div', { display: 'flex', alignItems: 'center', gap: '8px' });
    const close = button('✕');
    close.setAttribute('aria-label', 'Bezárás');
    close.onclick = () => host.remove();
    head.append(el('strong', { flex: '1' }, 'Ülőhely-riport'), close);
    const status = el('div', { color: c.muted }, 'Adatok lekérése…');
    status.setAttribute('aria-live', 'polite');
    const warnings = el('div', { color: c.warn, whiteSpace: 'pre-line', display: 'none', maxHeight: '6em', overflowY: 'auto' });
    const text = el('textarea', {
      display: 'none', flex: '1', minHeight: '240px', resize: 'vertical', boxSizing: 'border-box', width: '100%',
      padding: '8px', font: '12px/1.45 ui-monospace, Consolas, monospace',
      background: c.field, color: c.fg, border: `1px solid ${c.border}`, borderRadius: '6px',
    });
    text.readOnly = true;
    text.setAttribute('aria-label', 'Markdown riport');
    const copyButton = button('Markdown másolása', true);
    copyButton.style.display = 'none';
    copyButton.style.alignSelf = 'flex-start';
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape') host.remove(); });
    box.append(head, status, warnings, text, copyButton);
    host.attachShadow({ mode: 'open' }).append(box);
    document.body.append(host);

    // navigator.clipboard needs a focused page (fails from the DevTools Console) and, in some
    // browsers, a recent click; copy() is the Console-only fallback.
    const toClipboard = async (md) => {
      try { await navigator.clipboard.writeText(md); return true; } catch (_) { /* fall through */ }
      try { copy(md); return true; } catch (_) { return false; }
    };
    // Workers still in flight after a failure must not overwrite the error message.
    let failed = false;

    return {
      progress(done, total) { if (!failed) status.textContent = `Szektorok lekérése: ${done} / ${total}…`; },
      warn(msg) {
        console.warn(msg);
        warnings.style.display = '';
        warnings.textContent += `${warnings.textContent ? '\n' : ''}⚠ ${msg}`;
      },
      async done(md) {
        text.value = md;
        text.style.display = copyButton.style.display = '';
        copyButton.onclick = async () => {
          const ok = await toClipboard(md);
          status.textContent = ok ? 'A Markdown a vágólapon.' : 'A másolás nem sikerült: jelöld ki a szöveget, és Ctrl+C.';
          if (!ok) text.select();
        };
        status.textContent = (await toClipboard(md)) ? 'Kész, a Markdown a vágólapon.' : 'Kész. Másolás a gombbal.';
        copyButton.focus();
      },
      fail(e) {
        failed = true;
        status.textContent = `Hiba: ${e.message}`;
        status.style.color = c.error;
      },
    };
  }
})();
