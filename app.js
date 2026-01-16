/* =============================================================================
  app.js — Estudiantes inscritos (TSV → DataTables) v3.1 (FIX Drawer)
  -----------------------------------------------------------------------------
  ✅ Carga TSV (Google Sheets publicado)
  ✅ Normaliza TSV “sucio”
  ✅ Preserva orden original del Sheet (idx oculto) + botones ↑/↓
  ✅ Búsqueda con debounce
  ✅ Rebuild limpio (destroy DataTable)
  ✅ Drawer/Ficha por estudiante (click fila)
  ✅ FIX: NO clonar tabla (eso rompe DataTables y deja la tabla vacía)
============================================================================= */

'use strict';

const TSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQQO-CBQoN1QZ4GFExJWmPz6YNLO6rhaIsWBv-Whlu9okpZRpcxfUtLYeAMKaiNOQJrrf3Vcwhk32kZ/pub?gid=2130299316&single=true&output=tsv';

let dataTable = null;

// Mapeo global (se llena al construir tabla)
let HEADERS = [];
let HEADER_INDEX = {};

document.addEventListener('DOMContentLoaded', () => {
  // refs
  const searchInput = document.getElementById('customSearch');
  const btnAsc = document.getElementById('btnOrderSheetAsc');
  const btnDesc = document.getElementById('btnOrderSheetDesc');

  // Drawer init (si existe en el HTML)
  initDrawer();

  // Buscar (debounced)
  if (searchInput) {
    const debouncedSearch = debounce((value) => {
      if (dataTable) dataTable.search(value).draw();
    }, 120);

    searchInput.addEventListener('input', () => {
      debouncedSearch(searchInput.value || '');
    });
  }

  // Orden del Sheet (↑/↓)
  if (btnAsc) {
    btnAsc.addEventListener('click', () => {
      if (dataTable) dataTable.order([[0, 'asc']]).draw();
    });
  }
  if (btnDesc) {
    btnDesc.addEventListener('click', () => {
      if (dataTable) dataTable.order([[0, 'desc']]).draw();
    });
  }

  // Cargar datos
  cargarDatosDesdeTSV();
});

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

/* =========================
   Parser TSV robusto
========================= */
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
   Construcción tabla (DataTables)
========================= */
function construirTabla(headers, data) {
  HEADERS = headers.slice();
  HEADER_INDEX = buildHeaderIndex(headers);

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

  // Destruir DataTable anterior
  if (dataTable) {
    try { dataTable.destroy(true); } catch (e) { console.warn(e); }
    dataTable = null;
  }

  // Init DataTable
  dataTable = $('#tablaEstudiantes').DataTable({
    data,
    columns: headers.map((h) => ({ title: h || '' })),

    columnDefs: [
      { targets: 0, visible: false, searchable: false } // ocultar __sheet_order__
    ],

    pageLength: 25,
    deferRender: true,
    processing: true,
    order: [[0, 'asc']],

    autoWidth: false,
    stateSave: false,

    language: {
      url: 'https://cdn.datatables.net/plug-ins/1.13.8/i18n/es-ES.json'
    }
  });

  // Bind correcto de eventos (sin romper DataTables)
  wireRowClick();
}

/* =========================
   Click fila => Drawer (FIX)
========================= */
function wireRowClick() {
  // Limpiar handlers anteriores (por si recargas la tabla)
  $('#tablaEstudiantes tbody').off('click.studentDrawer');
  $('#tablaEstudiantes tbody').off('dblclick.studentDrawer');

  // Click => abrir ficha
  $('#tablaEstudiantes tbody').on('click.studentDrawer', 'tr', function () {
    if (!dataTable) return;
    const rowData = dataTable.row(this).data();
    if (!Array.isArray(rowData)) return;
    openDrawerFromRow(rowData);
  });

  // Doble click => copiar teléfono (si existe)
  $('#tablaEstudiantes tbody').on('dblclick.studentDrawer', 'tr', function () {
    if (!dataTable) return;
    const rowData = dataTable.row(this).data();
    if (!Array.isArray(rowData)) return;

    const phone = pickFieldValue(rowData, FIELD_SYNONYMS.phone);
    const normalized = normalizePhone(phone);
    if (normalized) {
      copyToClipboard(normalized);
      setStatus(`📋 Teléfono copiado: ${normalized}`);
    }
  });
}

/* =========================
   Drawer logic
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

  const nombre = pickFieldValue(rowData, FIELD_SYNONYMS.studentName) || '—';
  const tel = pickFieldValue(rowData, FIELD_SYNONYMS.phone) || '—';
  const acudiente = pickFieldValue(rowData, FIELD_SYNONYMS.guardianName) || '—';
  const telAcudiente = pickFieldValue(rowData, FIELD_SYNONYMS.guardianPhone) || '—';

  if (titleEl) titleEl.textContent = nombre;
  if (subtitleEl) subtitleEl.textContent = 'Ficha del estudiante';
  if (pNombreEl) pNombreEl.textContent = nombre;
  if (pTelEl) pTelEl.textContent = tel;
  if (pAcEl) pAcEl.textContent = acudiente;
  if (pTelAcEl) pTelAcEl.textContent = telAcudiente;

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
   Field detection (sinónimos)
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

const FIELD_SYNONYMS = {
  studentName: [
    'nombres y apellidos (estudiante)', 'nombre estudiante', 'estudiante',
    'nombre del estudiante', 'nombres y apellidos',
    'nombre completo', 'nombre', 'alumno', 'alumna'
  ],
  phone: [
    'telefono (estudiante)', 'telefono', 'tel', 'celular', 'movil',
    'telefono estudiante', 'celular estudiante',
    'numero', 'numero de telefono', 'numero celular'
  ],
  guardianName: [
    'nombre acudiente', 'acudiente', 'padre', 'madre', 'responsable', 'tutor',
    'nombre del acudiente', 'acudiente nombre'
  ],
  guardianPhone: [
    'telefono acudiente', 'tel acudiente', 'celular acudiente',
    'telefono del acudiente', 'numero acudiente', 'celular del acudiente'
  ]
};

function findHeaderIndexBySynonyms(synonyms) {
  if (!HEADERS || !HEADERS.length) return -1;

  for (const syn of synonyms) {
    const k = normKey(syn);
    if (k in HEADER_INDEX) return HEADER_INDEX[k];
  }

  const normalizedHeaders = HEADERS.map(h => normKey(h));
  for (const syn of synonyms) {
    const s = normKey(syn);
    for (let i = 0; i < normalizedHeaders.length; i++) {
      const h = normalizedHeaders[i];
      if (!h) continue;
      if (h === s) return i;
      if (h.includes(s) || s.includes(h)) return i;
    }
  }
  return -1;
}

function pickFieldValue(rowData, synonyms) {
  const idx = findHeaderIndexBySynonyms(synonyms);
  if (idx < 0) return '';
  return String(rowData[idx] ?? '').trim();
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
  if (/^\d{10}$/.test(digits)) digits = '57' + digits; // CO
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
   UI helpers
========================= */

function actualizarTotal(total) {
  const totalEl = document.getElementById('totalRegistros');
  if (!totalEl) return;
  totalEl.textContent = String(total ?? 0);
}

function setStatus(msg) {
  const statusEl = document.getElementById('statusMessage');
  if (!statusEl) return;
  statusEl.textContent = msg;
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
