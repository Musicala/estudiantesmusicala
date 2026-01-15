/* =============================================================================
  app.js — Estudiantes inscritos (TSV → DataTables) v2
  -----------------------------------------------------------------------------
  ✅ Carga TSV (Google Sheets publicado)
  ✅ Normaliza filas/columnas (TSV “sucio”)
  ✅ Preserva orden original del Sheet (idx oculto) + botones ↑/↓
  ✅ Búsqueda con debounce (para no matar el render)
  ✅ Manejo de errores decente + status UI
  ✅ Rebuild limpio (destroy DataTable si ya existe)
============================================================================= */

'use strict';

const TSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQQO-CBQoN1QZ4GFExJWmPz6YNLO6rhaIsWBv-Whlu9okpZRpcxfUtLYeAMKaiNOQJrrf3Vcwhk32kZ/pub?gid=2130299316&single=true&output=tsv';

let dataTable = null;

document.addEventListener('DOMContentLoaded', () => {
  // refs
  const searchInput = document.getElementById('customSearch');
  const btnAsc = document.getElementById('btnOrderSheetAsc');
  const btnDesc = document.getElementById('btnOrderSheetDesc');

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
    // Cache bust suave para evitar que el navegador se quede pegado con versiones viejas
    const url = withCacheBuster(TSV_URL);

    const res = await fetch(url, {
      method: 'GET',
      cache: 'no-store'
    });

    if (!res.ok) throw new Error('Error HTTP ' + res.status);

    const text = await res.text();
    const parsed = parseTSV(text);

    if (!parsed.headers.length) {
      throw new Error('Encabezados vacíos o TSV inválido');
    }

    // Construir / reconstruir tabla
    construirTabla(parsed.headers, parsed.data);

    // UI stats
    actualizarTotal(parsed.data.length);

    setStatus('Datos cargados correctamente.');
  } catch (err) {
    console.error('Error cargando datos:', err);
    setStatus('Error cargando datos. Revisa la URL TSV o los permisos del archivo.');
  }
}

/* =========================
   Parser TSV robusto
   - Normaliza columnas
   - Elimina filas totalmente vacías
   - Preserva orden original del Sheet (idx oculto)
========================= */
function parseTSV(text) {
  const clean = String(text || '').trim();
  if (!clean) return { headers: [], data: [] };

  // 1) filas crudas
  const rawRows = clean
    .split(/\r?\n/)
    .map((row) => row.split('\t'));

  if (!rawRows.length) return { headers: [], data: [] };

  // 2) max columnas
  const maxCols = rawRows.reduce((max, row) => Math.max(max, row.length), 0);

  // 3) normalizar filas al mismo tamaño
  const rows = rawRows.map((row) => {
    const r = row.slice(0, maxCols);
    while (r.length < maxCols) r.push('');
    return r;
  });

  // 4) headers + data
  const headersOriginal = rows[0].map((h) => String(h ?? '').trim());
  const headers = ['__sheet_order__', ...headersOriginal];

  const data = rows
    .slice(1)
    .filter((row) => row.some((cell) => String(cell ?? '').trim() !== ''))
    .map((row, idx) => [idx, ...row]); // idx = orden del Sheet

  return { headers, data };
}

/* =========================
   Construcción tabla (DataTables)
========================= */
function construirTabla(headers, data) {
  // 1) Render thead (para que se vea el header antes del DataTable init)
  const thead = document.querySelector('#tablaEstudiantes thead');
  if (thead) {
    thead.innerHTML = '';
    const headRow = document.createElement('tr');

    // Ojo: columna 0 es oculta, pero igual la ponemos en thead para consistencia
    headers.forEach((h) => {
      const th = document.createElement('th');
      th.textContent = h || '';
      headRow.appendChild(th);
    });

    thead.appendChild(headRow);
  }

  // 2) Si ya existe DataTable, destruir limpio
  if (dataTable) {
    try {
      dataTable.destroy(true); // true = remove added DOM
    } catch (e) {
      // por si está medio roto el estado, igual seguimos
      console.warn('No se pudo destruir el DataTable anterior:', e);
    }
    dataTable = null;
  }

  // 3) Init DataTable
  dataTable = $('#tablaEstudiantes').DataTable({
    data,
    columns: headers.map((h) => ({ title: h || '' })),

    // Columna 0: orden original del sheet, oculta
    columnDefs: [
      { targets: 0, visible: false, searchable: false }
    ],

    pageLength: 25,
    deferRender: true,
    processing: true,

    // Por defecto: como el Sheet
    order: [[0, 'asc']],

    // Pequeñas mejoras de UX
    autoWidth: false,
    stateSave: false, // si algún día lo quieres, se puede activar

    language: {
      url: 'https://cdn.datatables.net/plug-ins/1.13.8/i18n/es-ES.json'
    }
  });
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
    // Si por alguna razón no es URL válida, igual metemos un query básico
    const sep = url.includes('?') ? '&' : '?';
    return url + sep + '_ts=' + Date.now();
  }
}
