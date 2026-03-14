'use strict';

/* =============================================================================
  app.js — Estudiantes inscritos (TSV → DataTables) v5.0
  -----------------------------------------------------------------------------
  ✅ Carga TSV (Google Sheets publicado)
  ✅ Búsqueda NO sensible a tildes
  ✅ Filtros específicos: Estado y Edad
  ✅ Filtros nuevos: hoy / fecha exacta / mes de inscripción
  ✅ Opciones de filtros se actualizan con lo visible (dependientes)
  ✅ Oculta columnas completamente vacías en la tabla
  ✅ Drawer muestra solo campos con información
  ✅ Ficha principal detectada por encabezados reales
  ✅ Viñeta de color por estado
  ✅ Descargar CSV respetando filtros actuales
============================================================================= */

const TSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQQO-CBQoN1QZ4GFExJWmPz6YNLO6rhaIsWBv-Whlu9okpZRpcxfUtLYeAMKaiNOQJrrf3Vcwhk32kZ/pub?gid=2130299316&single=true&output=tsv';

let dataTable = null;
let HEADERS = [];
let HEADER_INDEX = {};
let ALL_ROWS = [];
let EMPTY_COLUMN_INDEXES = new Set();

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

  // Inyectados si no existen
  btnToday: 'btnTodayInscriptions',
  btnClearDate: 'btnClearDateFilters',
  filterDate: 'filterInscripcionFecha',
  filterMonth: 'filterInscripcionMes',
  legend: 'statusLegend'
};

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

const FILTER_STATE = {
  todayOnly: false,
  exactDate: '',
  month: ''
};

const HEADER_ALIASES = {
  estado: [
    'estado',
    'status',
    'estado estudiante'
  ],
  edad: [
    'edad',
    'anos',
    'años'
  ],
  nombre: [
    'nombre',
    'nombre completo',
    'nombres y apellidos',
    'estudiante',
    'nombre del estudiante',
    'alumno',
    'alumna'
  ],
  telefono: [
    'telefono',
    'teléfono',
    'celular',
    'whatsapp',
    'telefono estudiante',
    'celular estudiante',
    'tel estudiante'
  ],
  acudiente: [
    'acudiente',
    'nombre acudiente',
    'acudiente principal',
    'responsable',
    'padre',
    'madre',
    'padre o madre',
    'padre/madre'
  ],
  telefonoAcudiente: [
    'telefono acudiente',
    'teléfono acudiente',
    'celular acudiente',
    'whatsapp acudiente',
    'telefono del acudiente',
    'celular del acudiente',
    'telefono responsable',
    'telefono padre',
    'telefono madre',
    'tel acudiente'
  ],
  fechaInscripcion: [
    'fecha de inscripcion',
    'fecha de inscripción',
    'fecha inscripcion',
    'fecha inscripción',
    'fecha registro',
    'fecha de registro',
    'timestamp',
    'marca temporal',
    'creado el',
    'fecha',
    'inscrito el'
  ]
};

document.addEventListener('DOMContentLoaded', () => {
  injectRuntimeStyles();
  ensureEnhancedToolbar();
  setupAccentInsensitiveSearch();
  setupDateRangeFilter();
  initDrawer();
  bindUI();
  cargarDatosDesdeTSV();
});

/* =========================
   Init UI
========================= */
function bindUI() {
  const searchInput = document.getElementById(UI.searchInput);
  const btnAsc = document.getElementById(UI.btnAsc);
  const btnDesc = document.getElementById(UI.btnDesc);
  const btnClearSearch = document.getElementById(UI.btnClearSearch);
  const btnClearFilters = document.getElementById(UI.btnClearFilters);
  const btnDownloadCsv = document.getElementById(UI.btnDownloadCsv);
  const selEstado = document.getElementById(UI.filterEstado);
  const selEdad = document.getElementById(UI.filterEdad);
  const btnToday = document.getElementById(UI.btnToday);
  const btnClearDate = document.getElementById(UI.btnClearDate);
  const inputDate = document.getElementById(UI.filterDate);
  const inputMonth = document.getElementById(UI.filterMonth);

  if (searchInput) {
    const debouncedSearch = debounce((value) => {
      if (!dataTable) return;
      dataTable.search(String(value || '')).draw();
      refreshSelectOptions();
      syncVisibleCount();
    }, 120);

    searchInput.addEventListener('input', () => {
      debouncedSearch(searchInput.value || '');
    });
  }

  if (btnClearSearch) {
    btnClearSearch.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      if (dataTable) {
        dataTable.search('').draw();
        refreshSelectOptions();
        syncVisibleCount();
      }
      setStatus('Búsqueda limpia ✅');
    });
  }

  if (btnClearFilters) {
    btnClearFilters.addEventListener('click', () => {
      if (!dataTable) return;

      if (selEstado) selEstado.value = '';
      if (selEdad) selEdad.value = '';

      const estadoCol = getEstadoColIndex();
      const edadCol = getEdadColIndex();

      if (estadoCol > -1) dataTable.column(estadoCol).search('', true, false);
      if (edadCol > -1) dataTable.column(edadCol).search('', true, false);

      dataTable.draw();
      refreshSelectOptions();
      syncVisibleCount();
      setStatus('Filtros limpios ✅');
    });
  }

  if (btnAsc) btnAsc.addEventListener('click', () => dataTable && dataTable.order([[0, 'asc']]).draw());
  if (btnDesc) btnDesc.addEventListener('click', () => dataTable && dataTable.order([[0, 'desc']]).draw());

  if (selEstado) {
    selEstado.addEventListener('change', () => {
      if (!dataTable) return;
      const estadoCol = getEstadoColIndex();
      if (estadoCol > -1) {
        applyExactColumnFilter(estadoCol, selEstado.value);
      }
      refreshSelectOptions();
      syncVisibleCount();
    });
  }

  if (selEdad) {
    selEdad.addEventListener('change', () => {
      if (!dataTable) return;
      const edadCol = getEdadColIndex();
      if (edadCol > -1) {
        applyExactColumnFilter(edadCol, selEdad.value);
      }
      refreshSelectOptions();
      syncVisibleCount();
    });
  }

  if (btnDownloadCsv) {
    btnDownloadCsv.addEventListener('click', () => {
      if (!dataTable) return;
      downloadCsvFiltered();
    });
  }

  if (btnToday) {
    btnToday.addEventListener('click', () => {
      FILTER_STATE.todayOnly = !FILTER_STATE.todayOnly;

      if (FILTER_STATE.todayOnly) {
        FILTER_STATE.exactDate = '';
        FILTER_STATE.month = '';
        if (inputDate) inputDate.value = '';
        if (inputMonth) inputMonth.value = '';
        btnToday.classList.add('is-active-filter');
        setStatus('Mostrando inscripciones nuevas de hoy 📌');
      } else {
        btnToday.classList.remove('is-active-filter');
        setStatus('Filtro de hoy desactivado');
      }

      if (dataTable) {
        dataTable.draw();
        refreshSelectOptions();
        syncVisibleCount();
      }
    });
  }

  if (inputDate) {
    inputDate.addEventListener('change', () => {
      FILTER_STATE.todayOnly = false;
      FILTER_STATE.exactDate = String(inputDate.value || '').trim();
      FILTER_STATE.month = '';
      if (btnToday) btnToday.classList.remove('is-active-filter');
      if (inputMonth) inputMonth.value = '';

      if (dataTable) {
        dataTable.draw();
        refreshSelectOptions();
        syncVisibleCount();
      }

      setStatus(FILTER_STATE.exactDate
        ? `Filtrando por fecha: ${FILTER_STATE.exactDate}`
        : 'Filtro por fecha quitado');
    });
  }

  if (inputMonth) {
    inputMonth.addEventListener('change', () => {
      FILTER_STATE.todayOnly = false;
      FILTER_STATE.month = String(inputMonth.value || '').trim();
      FILTER_STATE.exactDate = '';
      if (btnToday) btnToday.classList.remove('is-active-filter');
      if (inputDate) inputDate.value = '';

      if (dataTable) {
        dataTable.draw();
        refreshSelectOptions();
        syncVisibleCount();
      }

      setStatus(FILTER_STATE.month
        ? `Filtrando por mes: ${FILTER_STATE.month}`
        : 'Filtro por mes quitado');
    });
  }

  if (btnClearDate) {
    btnClearDate.addEventListener('click', () => {
      clearDateFilters(true);
    });
  }
}

/* =========================
   Toolbar extra (inyectado)
========================= */
function ensureEnhancedToolbar() {
  const toolbarLeft = document.querySelector('.toolbar-left');
  if (!toolbarLeft) return;

  if (!document.getElementById(UI.filterDate)) {
    const wrapper = document.createElement('div');
    wrapper.className = 'toolbar-date-tools';
    wrapper.innerHTML = `
      <button id="${UI.btnToday}" class="btn btn-ghost" type="button" title="Mostrar solo inscripciones nuevas del día">
        Nuevas de hoy
      </button>

      <label class="toolbar-label" for="${UI.filterDate}">
        Fecha:
        <input type="date" id="${UI.filterDate}" class="input-date-filter" />
      </label>

      <label class="toolbar-label" for="${UI.filterMonth}">
        Mes:
        <input type="month" id="${UI.filterMonth}" class="input-date-filter" />
      </label>

      <button id="${UI.btnClearDate}" class="btn btn-ghost" type="button" title="Quitar filtros de fecha">
        Limpiar fecha
      </button>
    `;
    toolbarLeft.appendChild(wrapper);
  }

  const toolbar = document.querySelector('.table-toolbar');
  if (toolbar && !document.getElementById(UI.legend)) {
    const legend = document.createElement('div');
    legend.id = UI.legend;
    legend.className = 'status-legend';
    legend.innerHTML = `
      <span class="legend-item"><span class="status-dot is-activo"></span> Activo</span>
      <span class="legend-item"><span class="status-dot is-activo-no-registro"></span> Activo no registro</span>
      <span class="legend-item"><span class="status-dot is-pausa"></span> Activo en pausa</span>
      <span class="legend-item"><span class="status-dot is-inactivo"></span> Inactivo</span>
    `;
    toolbar.appendChild(legend);
  }
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
   DataTables ext.search (fecha)
========================= */
function setupDateRangeFilter() {
  if (!window.jQuery || !jQuery.fn || !jQuery.fn.dataTable) return;

  jQuery.fn.dataTable.ext.search.push((settings, searchData, index, rowData) => {
    if (!settings || settings.nTable?.id !== 'tablaEstudiantes') return true;
    if (!Array.isArray(rowData)) return true;

    const dateCol = getFechaInscripcionColIndex();
    if (dateCol < 0) return true;

    const rawDate = rowData[dateCol];
    const rowDate = parseFlexibleDate(rawDate);
    if (!rowDate) return false;

    if (FILTER_STATE.todayOnly) {
      return isSameDay(rowDate, new Date());
    }

    if (FILTER_STATE.exactDate) {
      const target = parseFlexibleDate(FILTER_STATE.exactDate);
      return target ? isSameDay(rowDate, target) : true;
    }

    if (FILTER_STATE.month) {
      const [year, month] = FILTER_STATE.month.split('-').map(Number);
      return (
        rowDate.getFullYear() === year &&
        (rowDate.getMonth() + 1) === month
      );
    }

    return true;
  });
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

    if (!parsed.headers.length) {
      throw new Error('Encabezados vacíos o TSV inválido');
    }

    ALL_ROWS = parsed.data.slice();
    construirTabla(parsed.headers, parsed.data);
    actualizarTotal(parsed.data.length);
    syncVisibleCount();

    setStatus('Datos cargados correctamente ✅');
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
    .filter((row) => row.some((cell) => isMeaningfulValue(cell)))
    .map((row, idx) => [idx, ...row]);

  return { headers, data };
}

/* =========================
   Construcción de DataTable
========================= */
function construirTabla(headers, data) {
  HEADERS = headers.slice();
  HEADER_INDEX = buildHeaderIndex(headers);
  EMPTY_COLUMN_INDEXES = detectCompletelyEmptyColumns(headers, data);

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

  if (dataTable) {
    try { dataTable.destroy(true); } catch (e) { console.warn(e); }
    dataTable = null;
  }

  const columnDefs = [
    { targets: 0, visible: false, searchable: false }
  ];

  for (const idx of EMPTY_COLUMN_INDEXES) {
    if (idx !== 0) {
      columnDefs.push({ targets: idx, visible: false });
    }
  }

  const estadoCol = getEstadoColIndex();
  if (estadoCol > -1) {
    columnDefs.push({
      targets: estadoCol,
      render: function (data, type) {
        const raw = String(data ?? '').trim();
        if (type !== 'display') return raw;
        return renderEstadoBadge(raw);
      }
    });
  }

  dataTable = $('#tablaEstudiantes').DataTable({
    data,
    columns: headers.map((h) => ({ title: h || '' })),
    columnDefs,
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
      syncVisibleCount();

      dataTable.on('draw.dt', () => {
        refreshSelectOptions();
        syncVisibleCount();
      });
    }
  });
}

function detectCompletelyEmptyColumns(headers, data) {
  const emptySet = new Set();
  if (!headers.length || !data.length) return emptySet;

  for (let col = 1; col < headers.length; col++) {
    const allEmpty = data.every(row => !isMeaningfulValue(row[col]));
    if (allEmpty) emptySet.add(col);
  }

  return emptySet;
}

/* =========================
   Filtros Estado/Edad
========================= */
function applyExactColumnFilter(colIdx, rawValue) {
  if (!dataTable || colIdx < 0) return;
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

  const estadoCol = getEstadoColIndex();
  const edadCol = getEdadColIndex();

  const currentEstado = selEstado ? selEstado.value : '';
  const currentEdad = selEdad ? selEdad.value : '';

  const rows = dataTable.rows({ search: 'applied' }).data().toArray();

  const estadoSet = new Set();
  const edadSet = new Set();

  for (const r of rows) {
    if (estadoCol > -1) {
      const est = String(r[estadoCol] ?? '').trim();
      if (est) estadoSet.add(est);
    }
    if (edadCol > -1) {
      const ed = String(r[edadCol] ?? '').trim();
      if (ed) edadSet.add(ed);
    }
  }

  const estados = Array.from(estadoSet).sort((a, b) =>
    normalizeText(a).localeCompare(normalizeText(b), 'es')
  );

  const edades = Array.from(edadSet).sort((a, b) =>
    normalizeText(a).localeCompare(normalizeText(b), 'es')
  );

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

function clearDateFilters(redraw = false) {
  FILTER_STATE.todayOnly = false;
  FILTER_STATE.exactDate = '';
  FILTER_STATE.month = '';

  const btnToday = document.getElementById(UI.btnToday);
  const inputDate = document.getElementById(UI.filterDate);
  const inputMonth = document.getElementById(UI.filterMonth);

  if (btnToday) btnToday.classList.remove('is-active-filter');
  if (inputDate) inputDate.value = '';
  if (inputMonth) inputMonth.value = '';

  if (redraw && dataTable) {
    dataTable.draw();
    refreshSelectOptions();
    syncVisibleCount();
  }

  setStatus('Filtros de fecha limpios ✅');
}

/* =========================
   Drawer / ficha
========================= */
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

  const nombre = getBestFieldValue(rowData, HEADER_ALIASES.nombre, [colLetterToDtIndex('A')]);
  const telefono = getBestFieldValue(rowData, HEADER_ALIASES.telefono, [colLetterToDtIndex('K')]);
  const acudiente = getBestFieldValue(rowData, HEADER_ALIASES.acudiente, [colLetterToDtIndex('U')]);
  const telefonoAcudiente = getBestFieldValue(rowData, HEADER_ALIASES.telefonoAcudiente, [colLetterToDtIndex('W')]);
  const estado = getBestFieldValue(rowData, HEADER_ALIASES.estado, [colLetterToDtIndex('B')]);
  const fechaInscripcion = getBestFieldValue(rowData, HEADER_ALIASES.fechaInscripcion, [colLetterToDtIndex('AC')]);

  const displayName = isMeaningfulValue(nombre)
    ? String(nombre).trim()
    : 'Ficha del estudiante';

  if (titleEl) titleEl.textContent = displayName;

  if (subtitleEl) {
    const subtitleParts = [];
    if (isMeaningfulValue(estado)) subtitleParts.push(`Estado: ${String(estado).trim()}`);
    if (isMeaningfulValue(fechaInscripcion)) subtitleParts.push(`Inscripción: ${String(fechaInscripcion).trim()}`);
    subtitleEl.textContent = subtitleParts.length ? subtitleParts.join(' · ') : 'Ficha del estudiante';
  }

  setPrimaryValue(DRAWER_IDS.pNombre, displayName, true);
  setPrimaryValue(DRAWER_IDS.pTel, telefono, false);
  setPrimaryValue(DRAWER_IDS.pAcudiente, acudiente, false);
  setPrimaryValue(DRAWER_IDS.pTelAcudiente, telefonoAcudiente, false);

  renderPhoneActions(telActions, telefono, 'Teléfono copiado');
  renderPhoneActions(telAcActions, telefonoAcudiente, 'Tel. acudiente copiado');

  togglePrimaryItemVisibility(pNombreEl, true);
  togglePrimaryItemVisibility(pTelEl, isMeaningfulValue(telefono));
  togglePrimaryItemVisibility(pAcEl, isMeaningfulValue(acudiente));
  togglePrimaryItemVisibility(pTelAcEl, isMeaningfulValue(telefonoAcudiente));

  if (fieldsEl) {
    fieldsEl.innerHTML = '';

    for (let i = 1; i < HEADERS.length; i++) {
      const label = String(HEADERS[i] || '').trim();
      const value = String(rowData[i] ?? '').trim();

      if (!label) continue;
      if (EMPTY_COLUMN_INDEXES.has(i)) continue;
      if (!isMeaningfulValue(value)) continue;

      const row = document.createElement('div');
      row.className = 'kv__row';
      row.innerHTML = `
        <dt class="kv__k">${escapeHtml(label)}</dt>
        <dd class="kv__v">${escapeHtml(value)}</dd>
      `;
      fieldsEl.appendChild(row);
    }

    if (!fieldsEl.children.length) {
      fieldsEl.innerHTML = `
        <div class="kv__row">
          <dt class="kv__k">Información</dt>
          <dd class="kv__v">No hay más campos con información para mostrar.</dd>
        </div>
      `;
    }
  }

  drawer.classList.add('is-open');
  drawer.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function setPrimaryValue(id, value, alwaysVisible = false) {
  const el = document.getElementById(id);
  if (!el) return;
  if (alwaysVisible) {
    el.textContent = String(value || '—').trim() || '—';
    return;
  }
  el.textContent = isMeaningfulValue(value) ? String(value).trim() : '—';
}

function togglePrimaryItemVisibility(valueElement, shouldShow) {
  if (!valueElement) return;
  const item = valueElement.closest('.primary__item');
  if (!item) return;
  item.style.display = shouldShow ? '' : 'none';
}

function closeDrawer() {
  const drawer = document.getElementById(DRAWER_IDS.drawer);
  if (!drawer) return;
  drawer.classList.remove('is-open');
  drawer.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

/* =========================
   Descargar CSV
========================= */
function downloadCsvFiltered() {
  const colA = colLetterToDtIndex('A');
  const colC = colLetterToDtIndex('C');
  const colZ = colLetterToDtIndex('Z');
  const colAC = colLetterToDtIndex('AC');

  const input = prompt(
    "¿Desde qué fecha quieres descargar?\n\n" +
    "Formato recomendado: YYYY-MM-DD\n" +
    "Ejemplo: 2026-01-15\n\n" +
    "Deja vacío para descargar todo."
  );

  let minDateMs = 0;
  let minDateLabel = 'todo';

  if (input && input.trim() !== '') {
    const parsed = Date.parse(input.trim());
    if (Number.isNaN(parsed)) {
      alert('Fecha inválida 😅 Usa formato YYYY-MM-DD.');
      return;
    }
    minDateMs = parsed;
    minDateLabel = input.trim();
  }

  let rows = dataTable.rows({ search: 'applied' }).data().toArray();

  if (minDateMs > 0) {
    rows = rows.filter(r => parseDateToMs(r[colAC]) >= minDateMs);
  }

  if (!rows.length) {
    alert('No hay registros desde esa fecha 📭');
    return;
  }

  rows.sort((r1, r2) => parseDateToMs(r2[colAC]) - parseDateToMs(r1[colAC]));

  const exportColIndices = [colA];
  for (let i = colC; i <= colZ; i++) exportColIndices.push(i);

  const exportHeaders = exportColIndices.map(i => HEADERS[i] ?? `Col${i}`);

  const csvLines = [];
  csvLines.push(exportHeaders.map(csvEscape).join(','));

  for (const row of rows) {
    const out = exportColIndices.map(i => csvEscape(String(row[i] ?? '').trim()));
    csvLines.push(out.join(','));
  }

  const csv = csvLines.join('\n');
  const filename = `Musicala_Inscritos_${formatDateForFile(new Date())}_desde_${sanitizeFilePart(minDateLabel)}.csv`;
  downloadTextFile(csv, filename, 'text/csv;charset=utf-8;');

  setStatus(`CSV descargado (${rows.length} filas) ✅`);
}

/* =========================
   Estado visual
========================= */
function renderEstadoBadge(rawValue) {
  const value = String(rawValue ?? '').trim();
  if (!value) return '';

  const cls = getStatusClass(value);
  return `
    <span class="estado-badge ${cls}" title="${escapeHtml(value)}">
      <span class="status-dot ${cls}"></span>
      <span>${escapeHtml(value)}</span>
    </span>
  `;
}

function getStatusClass(value) {
  const s = normalizeText(value);

  if (s.includes('pausa')) return 'is-pausa';
  if (s.includes('inactivo')) return 'is-inactivo';
  if (s.includes('no registro')) return 'is-activo-no-registro';
  if (s.includes('activo')) return 'is-activo';

  return 'is-neutro';
}

/* =========================
   Detección de columnas
========================= */
function getEstadoColIndex() {
  return findHeaderIndex(HEADER_ALIASES.estado, colLetterToDtIndex('B'));
}

function getEdadColIndex() {
  return findHeaderIndex(HEADER_ALIASES.edad, colLetterToDtIndex('E'));
}

function getFechaInscripcionColIndex() {
  return findHeaderIndex(HEADER_ALIASES.fechaInscripcion, colLetterToDtIndex('AC'));
}

function findHeaderIndex(aliasList = [], fallbackIndex = -1) {
  for (const alias of aliasList) {
    const key = normKey(alias);
    if (Object.prototype.hasOwnProperty.call(HEADER_INDEX, key)) {
      return HEADER_INDEX[key];
    }
  }

  if (
    Number.isInteger(fallbackIndex) &&
    fallbackIndex >= 0 &&
    fallbackIndex < HEADERS.length
  ) {
    return fallbackIndex;
  }

  return -1;
}

function getBestFieldValue(rowData, aliases = [], fallbackIndexes = []) {
  const idx = findHeaderIndex(aliases, -1);
  if (idx > -1 && isMeaningfulValue(rowData[idx])) {
    return String(rowData[idx]).trim();
  }

  for (const fallback of fallbackIndexes) {
    if (
      Number.isInteger(fallback) &&
      fallback >= 0 &&
      fallback < rowData.length &&
      isMeaningfulValue(rowData[fallback])
    ) {
      return String(rowData[fallback]).trim();
    }
  }

  return '';
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
   Header index
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
  headers.forEach((h, i) => {
    idx[normKey(h)] = i;
  });
  return idx;
}

/* =========================
   Fecha helpers
========================= */
function parseDateToMs(value) {
  const dt = parseFlexibleDate(value);
  return dt ? dt.getTime() : 0;
}

function parseFlexibleDate(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;

  // YYYY-MM-DD
  const isoLike = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoLike) {
    const dt = new Date(Number(isoLike[1]), Number(isoLike[2]) - 1, Number(isoLike[3]));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  // dd/mm/yyyy o d/m/yyyy con o sin hora
  const latam = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (latam) {
    const dd = Number(latam[1]);
    const mm = Number(latam[2]) - 1;
    let yy = Number(latam[3]);
    if (yy < 100) yy += 2000;
    const hh = Number(latam[4] ?? 0);
    const mi = Number(latam[5] ?? 0);
    const ss = Number(latam[6] ?? 0);
    const dt = new Date(yy, mm, dd, hh, mi, ss);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isSameDay(a, b) {
  return (
    a instanceof Date &&
    b instanceof Date &&
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/* =========================
   UI helpers
========================= */
function actualizarTotal(total) {
  const totalEl = document.getElementById(UI.total);
  if (!totalEl) return;
  totalEl.textContent = String(total ?? 0);
}

function syncVisibleCount() {
  const totalEl = document.getElementById(UI.total);
  if (!totalEl || !dataTable) return;

  const visible = dataTable.rows({ search: 'applied' }).count();
  const total = ALL_ROWS.length;

  totalEl.textContent = visible === total
    ? String(total)
    : `${visible} de ${total}`;
}

function setStatus(msg) {
  const statusEl = document.getElementById(UI.status);
  if (!statusEl) return;
  statusEl.textContent = msg;
}

/* =========================
   Helpers de columnas/letras
========================= */
function colLetterToDtIndex(letter) {
  return colLetterToNumber(letter);
}

function colLetterToNumber(letter) {
  const s = String(letter || '').toUpperCase().trim();
  let num = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 65 || code > 90) continue;
    num = num * 26 + (code - 64);
  }
  return num;
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
   Utils generales
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

function isMeaningfulValue(value) {
  if (value === null || value === undefined) return false;
  const s = String(value).trim();
  if (!s) return false;
  const n = normalizeText(s);
  return n !== '-' && n !== '—' && n !== 'null' && n !== 'undefined' && n !== 'n/a';
}

/* =========================
   Estilos runtime
========================= */
function injectRuntimeStyles() {
  if (document.getElementById('runtime-enhancements-styles')) return;

  const style = document.createElement('style');
  style.id = 'runtime-enhancements-styles';
  style.textContent = `
    .toolbar-date-tools{
      display:flex;
      gap:10px;
      flex-wrap:wrap;
      align-items:center;
    }

    .input-date-filter{
      border-radius: 999px;
      border: 1px solid rgba(12, 10, 30, 0.18);
      padding: 8px 12px;
      font-size: 0.86rem;
      background: #fff;
      outline: none;
      min-width: 150px;
    }

    .input-date-filter:focus{
      border-color: rgba(12, 65, 196, 0.55);
      box-shadow: 0 0 0 3px rgba(12, 65, 196, 0.22);
    }

    .status-legend{
      display:flex;
      gap:12px;
      flex-wrap:wrap;
      align-items:center;
      font-size: 0.78rem;
      color:#4b5563;
      width:100%;
      padding-top:4px;
    }

    .legend-item{
      display:inline-flex;
      align-items:center;
      gap:6px;
      background: rgba(12,10,30,0.03);
      border:1px solid rgba(12,10,30,0.06);
      border-radius:999px;
      padding:5px 9px;
    }

    .estado-badge{
      display:inline-flex;
      align-items:center;
      gap:8px;
      font-weight:600;
      white-space:nowrap;
    }

    .status-dot{
      width:10px;
      height:10px;
      border-radius:50%;
      display:inline-block;
      flex:0 0 10px;
      box-shadow: inset 0 0 0 1px rgba(0,0,0,0.06);
    }

    .status-dot.is-activo,
    .estado-badge.is-activo .status-dot{
      background:#16a34a;
    }

    .status-dot.is-activo-no-registro,
    .estado-badge.is-activo-no-registro .status-dot{
      background:#2563eb;
    }

    .status-dot.is-pausa,
    .estado-badge.is-pausa .status-dot{
      background:#f59e0b;
    }

    .status-dot.is-inactivo,
    .estado-badge.is-inactivo .status-dot{
      background:#dc2626;
    }

    .status-dot.is-neutro,
    .estado-badge.is-neutro .status-dot{
      background:#6b7280;
    }

    .is-active-filter{
      background: rgba(12, 65, 196, 0.14) !important;
      border-color: rgba(12, 65, 196, 0.42) !important;
    }

    #drawerFields .kv__row{
      align-items:start;
    }
  `;
  document.head.appendChild(style);
}