'use strict';

/* =============================================================================
  app.js — Estudiantes inscritos (TSV → DataTables) v4.0
  -----------------------------------------------------------------------------
  ✅ Carga TSV (Google Sheets publicado)
  ✅ Búsqueda NO sensible a tildes
  ✅ Filtros específicos: Estado (B) y Edad (E)
  ✅ Opciones de filtros se actualizan con lo visible (dependientes)
  ✅ Oculta columna A si está vacía en TODOS los registros
  ✅ Descargar CSV:
      - pregunta desde qué fecha (YYYY-MM-DD)
      - aplica filtros actuales
      - filtra por AC >= fecha
      - ordena por AC desc
      - exporta A y C..Z
============================================================================= */

const TSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQQO-CBQoN1QZ4GFExJWmPz6YNLO6rhaIsWBv-Whlu9okpZRpcxfUtLYeAMKaiNOQJrrf3Vcwhk32kZ/pub?gid=2130299316&single=true&output=tsv';

let dataTable = null;

let HEADERS = [];
let HEADER_INDEX = {};

const UI = {
  searchInput: 'customSearch',
  btnAsc: 'btnOrderSheetAsc',
  btnDesc: 'btnOrderSheetDesc',
  btnClearSearch: 'btnClearSearch',
  btnClearFilters: 'btnClearFilters',
  btnDownloadCsv: 'btnDownloadCsv',
  filterEstado: 'filterEstado',
  filterEdad: 'filterEdad',
  status: 'statusMessage',
  total: 'totalRegistros',
};

document.addEventListener('DOMContentLoaded', () => {
  initDrawer();
  setupAccentInsensitiveSearch();

  const searchInput = document.getElementById(UI.searchInput);
  const btnAsc = document.getElementById(UI.btnAsc);
  const btnDesc = document.getElementById(UI.btnDesc);
  const btnClearSearch = document.getElementById(UI.btnClearSearch);
  const btnClearFilters = document.getElementById(UI.btnClearFilters);
  const btnDownloadCsv = document.getElementById(UI.btnDownloadCsv);
  const selEstado = document.getElementById(UI.filterEstado);
  const selEdad = document.getElementById(UI.filterEdad);

  // Search (debounced)
  if (searchInput) {
    const debouncedSearch = debounce((value) => {
      if (!dataTable) return;
      dataTable.search(String(value || '')).draw();
      refreshSelectOptions();
    }, 120);

    searchInput.addEventListener('input', () => {
      debouncedSearch(searchInput.value || '');
    });
  }

  // Clear search
  if (btnClearSearch) {
    btnClearSearch.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      if (dataTable) dataTable.search('').draw();
      refreshSelectOptions();
      setStatus('Búsqueda limpia ✅');
    });
  }

  // Clear Estado/Edad
  if (btnClearFilters) {
    btnClearFilters.addEventListener('click', () => {
      if (!dataTable) return;

      if (selEstado) selEstado.value = '';
      if (selEdad) selEdad.value = '';

      dataTable.column(colLetterToDtIndex('B')).search('', true, false);
      dataTable.column(colLetterToDtIndex('E')).search('', true, false);

      dataTable.draw();
      refreshSelectOptions();
      setStatus('Filtros limpios ✅');
    });
  }

  // Orden del Sheet (↑/↓) por __sheet_order__
  if (btnAsc) btnAsc.addEventListener('click', () => dataTable && dataTable.order([[0, 'asc']]).draw());
  if (btnDesc) btnDesc.addEventListener('click', () => dataTable && dataTable.order([[0, 'desc']]).draw());

  // Filtros Estado/Edad
  if (selEstado) {
    selEstado.addEventListener('change', () => {
      if (!dataTable) return;
      applyExactColumnFilter(colLetterToDtIndex('B'), selEstado.value);
      refreshSelectOptions();
    });
  }

  if (selEdad) {
    selEdad.addEventListener('change', () => {
      if (!dataTable) return;
      applyExactColumnFilter(colLetterToDtIndex('E'), selEdad.value);
      refreshSelectOptions();
    });
  }

  // Descargar CSV (con pregunta de fecha)
  if (btnDownloadCsv) {
    btnDownloadCsv.addEventListener('click', () => {
      if (!dataTable) return;
      downloadCsvFiltered();
    });
  }

  // Cargar datos
  cargarDatosDesdeTSV();
});

/* =========================
   Helpers: Column letters -> DataTables index
   DataTables col 0 = __sheet_order__
   Sheet A => DT 1, B => DT 2, ... Z => DT 26, AA => DT 27, AB => 28, AC => 29
========================= */
function colLetterToDtIndex(letter) {
  return colLetterToNumber(letter);
}

function colLetterToNumber(letter) {
  const s = String(letter || '').toUpperCase().trim();
  let num = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 65 || code > 90) continue; // A-Z
    num = num * 26 + (code - 64);
  }
  return num;
}

/* =========================
   Accent-insensitive search
========================= */
function normalizeText(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function setupAccentInsensitiveSearch() {
  if (!window.jQuery || !jQuery.fn || !jQuery.fn.dataTable) return;
  const dt = jQuery.fn.dataTable;
  dt.ext.type.search.string = function (data) {
    return normalizeText(data);
  };
}

/* =========================
   Carga + parse TSV
========================= */
async function cargarDatosDesdeTSV() {
  setStatus('Cargando datos de estudiantes…');

  try {
    const url = withCacheBuster(TSV_URL);
    const res = await fetch(url, { method: 'GET', cache: 'no-store' });
    if (!res.ok) throw new Error('Error HTTP ' + res.status);

    const text = await res.text();
    const parsed = parseTSV(text);

    if (!parsed.headers.length) throw new Error('Encabezados vacíos o TSV inválido');

    construirTabla(parsed.headers, parsed.data);
    actualizarTotal(parsed.data.length);

    setStatus('Datos cargados correctamente.');
  } catch (err) {
    console.error('Error cargando datos:', err);
    setStatus('Error cargando datos. Revisa la URL TSV o los permisos del archivo.');
  }
}

function parseTSV(text) {
  const clean = String(text || '').trim();
  if (!clean) return { headers: [], data: [] };

  const rawRows = clean
    .split(/\r?\n/)
    .map((row) => row.split('\t'));

  if (!rawRows.length) return { headers: [], data: [] };

  const maxCols = rawRows.reduce((max, row) => Math.max(max, row.length), 0);

  const rows = rawRows.map((row) => {
    const r = row.slice(0, maxCols);
    while (r.length < maxCols) r.push('');
    return r;
  });

  const headersOriginal = rows[0].map((h) => String(h ?? '').trim());
  const headers = ['__sheet_order__', ...headersOriginal];

  const data = rows
    .slice(1)
    .filter((row) => row.some((cell) => String(cell ?? '').trim() !== ''))
    .map((row, idx) => [idx, ...row]);

  return { headers, data };
}

/* =========================
   DataTable
========================= */
function construirTabla(headers, data) {
  HEADERS = headers.slice();
  HEADER_INDEX = buildHeaderIndex(headers);

  // Detectar si columna A está vacía en TODOS los registros
  const colA = colLetterToDtIndex('A'); // 1
  const isAEmptyEverywhere = data.every(row => String(row[colA] ?? '').trim() === '');

  // Render thead
  const thead = document.querySelector('#tablaEstudiantes thead');
  if (thead) {
    thead.innerHTML = '';
    const headRow = document.createElement('tr');
    headers.forEach((h) => {
      const th = document.createElement('th');
      th.textContent = h || '';
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
  }

  // Destruir anterior
  if (dataTable) {
    try { dataTable.destroy(true); } catch (e) { console.warn(e); }
    dataTable = null;
  }

  dataTable = $('#tablaEstudiantes').DataTable({
    data,
    columns: headers.map((h) => ({ title: h || '' })),

    columnDefs: [
      { targets: 0, visible: false, searchable: false },     // __sheet_order__
      { targets: colA, visible: !isAEmptyEverywhere },       // A oculto si vacío total
    ],

    pageLength: 25,
    deferRender: true,
    processing: true,
    order: [[0, 'asc']],
    autoWidth: false,
    stateSave: false,

    language: {
      url: 'https://cdn.datatables.net/plug-ins/1.13.8/i18n/es-ES.json'
    },

    initComplete: function () {
      wireRowClick();

      refreshSelectOptions();
      dataTable.on('draw.dt', () => refreshSelectOptions());
    }
  });
}

/* =========================
   Filtros Estado/Edad (exactos)
========================= */
function applyExactColumnFilter(colIdx, rawValue) {
  if (!dataTable) return;
  const value = String(rawValue ?? '');

  if (!value) {
    dataTable.column(colIdx).search('', true, false).draw();
    return;
  }

  const safe = escapeRegex(value);
  dataTable.column(colIdx).search(`^${safe}$`, true, false).draw();
}

function refreshSelectOptions() {
  if (!dataTable) return;

  const selEstado = document.getElementById(UI.filterEstado);
  const selEdad = document.getElementById(UI.filterEdad);

  const colB = colLetterToDtIndex('B'); // Estado
  const colE = colLetterToDtIndex('E'); // Edad

  const currentEstado = selEstado ? selEstado.value : '';
  const currentEdad = selEdad ? selEdad.value : '';

  // valores únicos SOLO de lo visible (applied)
  const rows = dataTable.rows({ search: 'applied' }).data().toArray();

  const estadoSet = new Set();
  const edadSet = new Set();

  for (const r of rows) {
    const est = String(r[colB] ?? '').trim();
    const ed = String(r[colE] ?? '').trim();
    if (est) estadoSet.add(est);
    if (ed) edadSet.add(ed);
  }

  const estados = Array.from(estadoSet).sort((a, b) => normalizeText(a).localeCompare(normalizeText(b), 'es'));
  const edades = Array.from(edadSet).sort((a, b) => normalizeText(a).localeCompare(normalizeText(b), 'es'));

  if (selEstado) {
    selEstado.innerHTML = '';
    selEstado.appendChild(new Option('Todos', ''));
    estados.forEach(v => selEstado.appendChild(new Option(v, v)));
    selEstado.value = (currentEstado && estados.includes(currentEstado)) ? currentEstado : '';
  }

  if (selEdad) {
    selEdad.innerHTML = '';
    selEdad.appendChild(new Option('Todas', ''));
    edades.forEach(v => selEdad.appendChild(new Option(v, v)));
    selEdad.value = (currentEdad && edades.includes(currentEdad)) ? currentEdad : '';
  }
}

/* =========================
   Descargar CSV
   - pregunta desde qué fecha (YYYY-MM-DD)
   - toma filas filtradas actuales
   - filtra por AC >= fecha
   - ordena por AC desc
   - exporta SOLO A y C..Z
========================= */
function downloadCsvFiltered() {
  const colA = colLetterToDtIndex('A');      // 1
  const colC = colLetterToDtIndex('C');      // 3
  const colZ = colLetterToDtIndex('Z');      // 26
  const colAC = colLetterToDtIndex('AC');    // 29

  // 1) Preguntar fecha mínima
  const input = prompt(
    "¿Desde qué fecha quieres descargar?\n\n" +
    "Formato recomendado: YYYY-MM-DD\n" +
    "Ejemplo: 2026-01-15\n\n" +
    "Deja vacío para descargar todo."
  );

  let minDateMs = 0;
  let minDateLabel = 'todo';

  if (input && input.trim() !== "") {
    const parsed = Date.parse(input.trim());
    if (Number.isNaN(parsed)) {
      alert("Fecha inválida 😅 Usa formato YYYY-MM-DD.");
      return;
    }
    minDateMs = parsed;
    minDateLabel = input.trim();
  }

  // 2) Tomar filas filtradas actuales
  let rows = dataTable.rows({ search: 'applied' }).data().toArray();

  // 3) Filtrar por fecha AC >= minDate
  if (minDateMs > 0) {
    rows = rows.filter(r => parseDateToMs(r[colAC]) >= minDateMs);
  }

  if (!rows.length) {
    alert("No hay registros desde esa fecha 📭");
    return;
  }

  // 4) Ordenar por fecha AC desc
  rows.sort((r1, r2) => parseDateToMs(r2[colAC]) - parseDateToMs(r1[colAC]));

  // 5) Exportar SOLO A y C..Z
  const exportColIndices = [colA];
  for (let i = colC; i <= colZ; i++) exportColIndices.push(i);

  const exportHeaders = exportColIndices.map(i => HEADERS[i] ?? `Col${i}`);

  const csvLines = [];
  csvLines.push(exportHeaders.map(csvEscape).join(','));

  for (const row of rows) {
    const out = exportColIndices.map(i => csvEscape(String(row[i] ?? '').trim()));
    csvLines.push(out.join(','));
  }

  // 6) Descargar archivo
  const csv = csvLines.join('\n');
  const filename = `Musicala_Inscritos_${formatDateForFile(new Date())}_desde_${sanitizeFilePart(minDateLabel)}.csv`;
  downloadTextFile(csv, filename, 'text/csv;charset=utf-8;');

  setStatus(`CSV descargado (${rows.length} filas) ✅`);
}

/* =========================
   Parse fecha (AC) robusto
========================= */
function parseDateToMs(value) {
  const s = String(value ?? '').trim();
  if (!s) return 0;

  // Intento 1: Date.parse (ISO / formatos reconocibles)
  const p = Date.parse(s);
  if (!Number.isNaN(p)) return p;

  // Intento 2: dd/mm/yyyy hh:mm:ss o dd/mm/yyyy
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]) - 1;
    let yy = Number(m[3]);
    if (yy < 100) yy += 2000;
    const hh = Number(m[4] ?? 0);
    const mi = Number(m[5] ?? 0);
    const ss = Number(m[6] ?? 0);
    const dt = new Date(yy, mm, dd, hh, mi, ss);
    return dt.getTime();
  }

  return 0;
}

/* =========================
   Drawer (ficha)
   Nota: no afecta filtros/CSV, pero lo dejamos vivo.
========================= */
const DRAWER_IDS = {
  drawer: 'studentDrawer',
  title: 'drawerTitle',
  subtitle: 'drawerSubtitle',
  pNombre: 'pNombre',
  pTel: 'pTel',
  pAcudiente: 'pAcudiente',
  pTelAcudiente: 'pTelAcudiente',
  pTelActions: 'pTelActions',
  pTelAcudienteActions: 'pTelAcudienteActions',
  fields: 'drawerFields'
};

function initDrawer() {
  const drawer = document.getElementById(DRAWER_IDS.drawer);
  if (!drawer) return;

  drawer.addEventListener('click', (e) => {
    const t = e.target;
    if (t && t.hasAttribute && t.hasAttribute('data-close-drawer')) closeDrawer();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDrawer();
  });
}

function wireRowClick() {
  $('#tablaEstudiantes tbody').off('click.studentDrawer');
  $('#tablaEstudiantes tbody').on('click.studentDrawer', 'tr', function () {
    if (!dataTable) return;
    const rowData = dataTable.row(this).data();
    if (!Array.isArray(rowData)) return;
    openDrawerFromRow(rowData);
  });
}

function openDrawerFromRow(rowData) {
  const drawer = document.getElementById(DRAWER_IDS.drawer);
  if (!drawer) return;

  const titleEl = document.getElementById(DRAWER_IDS.title);
  const subtitleEl = document.getElementById(DRAWER_IDS.subtitle);
  const pNombreEl = document.getElementById(DRAWER_IDS.pNombre);
  const pTelEl = document.getElementById(DRAWER_IDS.pTel);
  const pAcEl = document.getElementById(DRAWER_IDS.pAcudiente);
  const pTelAcEl = document.getElementById(DRAWER_IDS.pTelAcudiente);
  const telActions = document.getElementById(DRAWER_IDS.pTelActions);
  const telAcActions = document.getElementById(DRAWER_IDS.pTelAcudienteActions);
  const fieldsEl = document.getElementById(DRAWER_IDS.fields);

  // Ojo: estos fallbacks dependen de tu sheet real.
  const nombre = String(rowData[colLetterToDtIndex('C')] ?? rowData[1] ?? '—').trim(); // ejemplo
  const tel = String(rowData[colLetterToDtIndex('D')] ?? '').trim();                  // ejemplo
  const acudiente = String(rowData[colLetterToDtIndex('F')] ?? '').trim();            // ejemplo
  const telAcudiente = String(rowData[colLetterToDtIndex('G')] ?? '').trim();         // ejemplo

  if (titleEl) titleEl.textContent = nombre || 'Ficha';
  if (subtitleEl) subtitleEl.textContent = 'Ficha del estudiante';
  if (pNombreEl) pNombreEl.textContent = nombre || '—';
  if (pTelEl) pTelEl.textContent = tel || '—';
  if (pAcEl) pAcEl.textContent = acudiente || '—';
  if (pTelAcEl) pTelAcEl.textContent = telAcudiente || '—';

  renderPhoneActions(telActions, tel, 'Teléfono copiado');
  renderPhoneActions(telAcActions, telAcudiente, 'Tel. acudiente copiado');

  if (fieldsEl) {
    fieldsEl.innerHTML = '';
    for (let i = 1; i < HEADERS.length; i++) {
      const label = String(HEADERS[i] || '').trim();
      if (!label) continue;
      const value = String(rowData[i] ?? '').trim() || '—';
      const row = document.createElement('div');
      row.className = 'kv__row';
      row.innerHTML = `
        <dt class="kv__k">${escapeHtml(label)}</dt>
        <dd class="kv__v">${escapeHtml(value)}</dd>
      `;
      fieldsEl.appendChild(row);
    }
  }

  drawer.classList.add('is-open');
  drawer.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeDrawer() {
  const drawer = document.getElementById(DRAWER_IDS.drawer);
  if (!drawer) return;
  drawer.classList.remove('is-open');
  drawer.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

/* =========================
   Phone actions
========================= */
function normalizePhone(v) {
  const s = String(v ?? '').trim();
  if (!s || s === '—') return '';
  const digits = s.replace(/[^\d]/g, '');
  if (digits.length < 7) return '';
  return digits;
}

function buildWhatsappLink(phoneDigits) {
  let digits = String(phoneDigits || '').replace(/[^\d]/g, '');
  if (/^\d{10}$/.test(digits)) digits = '57' + digits;
  return 'https://wa.me/' + digits;
}

function renderPhoneActions(containerEl, phoneRaw, copiedMsg = 'Copiado') {
  if (!containerEl) return;
  containerEl.innerHTML = '';

  const phoneDigits = normalizePhone(phoneRaw);
  if (!phoneDigits) return;

  const btnCopy = document.createElement('button');
  btnCopy.type = 'button';
  btnCopy.className = 'chip-btn';
  btnCopy.textContent = 'Copiar';
  btnCopy.addEventListener('click', async (e) => {
    e.stopPropagation();
    await copyToClipboard(phoneDigits);
    setStatus(`📋 ${copiedMsg}: ${phoneDigits}`);
  });

  const btnWa = document.createElement('button');
  btnWa.type = 'button';
  btnWa.className = 'chip-btn';
  btnWa.textContent = 'WhatsApp';
  btnWa.addEventListener('click', (e) => {
    e.stopPropagation();
    window.open(buildWhatsappLink(phoneDigits), '_blank', 'noopener,noreferrer');
  });

  containerEl.appendChild(btnCopy);
  containerEl.appendChild(btnWa);
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(String(text));
  } catch {
    const ta = document.createElement('textarea');
    ta.value = String(text);
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch {}
    document.body.removeChild(ta);
  }
}

/* =========================
   Header index (por si luego lo usas)
========================= */
function normKey(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w]+/g, ' ')
    .trim();
}

function buildHeaderIndex(headers) {
  const idx = {};
  headers.forEach((h, i) => { idx[normKey(h)] = i; });
  return idx;
}

/* =========================
   UI helpers
========================= */
function actualizarTotal(total) {
  const totalEl = document.getElementById(UI.total);
  if (!totalEl) return;
  totalEl.textContent = String(total ?? 0);
}

function setStatus(msg) {
  const statusEl = document.getElementById(UI.status);
  if (!statusEl) return;
  statusEl.textContent = msg;
}

/* =========================
   File download utils
========================= */
function downloadTextFile(text, filename, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();

  setTimeout(() => {
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }, 0);
}

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function formatDateForFile(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function sanitizeFilePart(s) {
  return String(s ?? 'todo').trim().replace(/[^\w\-]+/g, '_').slice(0, 40);
}

/* =========================
   Utils
========================= */
function debounce(fn, wait = 150) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function withCacheBuster(url) {
  try {
    const u = new URL(url);
    u.searchParams.set('_ts', String(Date.now()));
    return u.toString();
  } catch {
    const sep = url.includes('?') ? '&' : '?';
    return url + sep + '_ts=' + Date.now();
  }
}

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeRegex(s) {
  return String(s ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
