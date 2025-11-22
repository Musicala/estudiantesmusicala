const TSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQQO-CBQoN1QZ4GFExJWmPz6YNLO6rhaIsWBv-Whlu9okpZRpcxfUtLYeAMKaiNOQJrrf3Vcwhk32kZ/pub?gid=2130299316&single=true&output=tsv';

let dataTable = null;

document.addEventListener('DOMContentLoaded', () => {
  cargarDatosDesdeTSV();

  const searchInput = document.getElementById('customSearch');
  searchInput.addEventListener('input', () => {
    if (dataTable) {
      dataTable.search(searchInput.value).draw();
    }
  });
});

function cargarDatosDesdeTSV() {
  const statusEl = document.getElementById('statusMessage');
  statusEl.textContent = 'Cargando datos de estudiantes…';

  fetch(TSV_URL)
    .then(res => {
      if (!res.ok) throw new Error('Error HTTP ' + res.status);
      return res.text();
    })
    .then(text => {
      // 1. Parsear TSV crudo
      const rawRows = text
        .trim()
        .split(/\r?\n/)
        .map(row => row.split('\t'));

      if (!rawRows.length) {
        throw new Error('Archivo TSV vacío');
      }

      // 2. Averiguar el máximo número de columnas
      const maxCols = rawRows.reduce(
        (max, row) => Math.max(max, row.length),
        0
      );

      // 3. Normalizar todas las filas al mismo tamaño
      const rows = rawRows.map(row => {
        const r = row.slice(0, maxCols); // si vienen de más, se cortan
        while (r.length < maxCols) {
          r.push(''); // rellenar faltantes
        }
        return r;
      });

      // 4. Encabezados y datos
      const headers = rows[0];

      const data = rows
        .slice(1)
        .filter(row => row.some(cell => String(cell).trim() !== ''));

      construirTabla(headers, data);
      actualizarTotal(data.length);
      statusEl.textContent = 'Datos cargados correctamente.';
    })
    .catch(err => {
      console.error('Error cargando datos:', err);
      statusEl.textContent =
        'Error cargando datos. Revisa la URL TSV o los permisos del archivo.';
    });
}

function construirTabla(headers, data) {
  const thead = document.querySelector('#tablaEstudiantes thead');
  thead.innerHTML = '';

  const headRow = document.createElement('tr');
  headers.forEach(h => {
    const th = document.createElement('th');
    th.textContent = h || '';
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);

  $(document).ready(function () {
    dataTable = $('#tablaEstudiantes').DataTable({
      data: data,
      columns: headers.map(h => ({ title: h || '' })),
      pageLength: 25,
      deferRender: true,
      order: [],
      language: {
        url: 'https://cdn.datatables.net/plug-ins/1.13.8/i18n/es-ES.json'
      }
    });
  });
}

function actualizarTotal(total) {
  const totalEl = document.getElementById('totalRegistros');
  totalEl.textContent = total.toString();
}
