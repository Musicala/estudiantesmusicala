/**
 * Envio automatico de correos de cumpleanos para estudiantes Musicala.
 *
 * Este archivo esta pensado para pegarse/subirse en Google Apps Script.
 * El envio sale desde la cuenta que instala y autoriza el script
 * (notificaciones.musicala@gmail.com).
 */

const TSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQQO-CBQoN1QZ4GFExJWmPz6YNLO6rhaIsWBv-Whlu9okpZRpcxfUtLYeAMKaiNOQJrrf3Vcwhk32kZ/pub?gid=2130299316&single=true&output=tsv';

const TIMEZONE = 'America/Bogota';
const SENT_KEY_PREFIX = 'BIRTHDAY_SENT';
const DEFAULT_NAME = 'estudiante Musicala';

const HEADER_ALIASES = {
  nombre: [
    'nombre',
    'nombre completo',
    'nombres y apellidos',
    'estudiante',
    'nombre del estudiante',
    'alumno',
    'alumna'
  ],
  correo: [
    'correo',
    'email',
    'e-mail',
    'correo electrónico',
    'correo electronico',
    'mail',
    'gmail',
    'email acudiente',
    'correo acudiente',
    'correo del acudiente',
    'correo responsable'
  ],
  cumpleanos: [
    'cumpleanos',
    'cumpleaños',
    'fecha de cumpleanos',
    'fecha de cumpleaños',
    'fecha cumpleanos',
    'fecha cumpleaños',
    'fecha de nacimiento',
    'fecha nacimiento',
    'fecha nac',
    'nacimiento',
    'birthday',
    'birthdate',
    'date of birth'
  ],
  planSeleccionado: [
    'plan seleccionado',
    'plan',
    'tipo de plan'
  ]
};

/**
 * Ejecuta el proceso real: lee el TSV, detecta cumpleanos de hoy y envia correos.
 */
function enviarCorreosCumpleanosHoy() {
  const todayKey = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
  const preview = previewCumpleanosHoy();
  const matches = preview.matches || [];

  Logger.log('Proceso real de cumpleanos para %s. Coincidencias: %s', todayKey, matches.length);

  matches.forEach(function (person) {
    const email = String(person.correo || '').trim().toLowerCase();

    if (!email) {
      Logger.log('Fila %s omitida: no tiene correo. Nombre: %s', person.fila, person.nombre);
      return;
    }

    if (!isValidEmail_(email)) {
      Logger.log('Fila %s omitida: correo invalido "%s". Nombre: %s', person.fila, person.correo, person.nombre);
      return;
    }

    if (alreadySentToday_(email)) {
      Logger.log('Fila %s omitida: ya se envio hoy a %s.', person.fila, email);
      return;
    }

    const emailContent = buildBirthdayEmail_(person.nombre);

    try {
      MailApp.sendEmail({
        to: email,
        subject: emailContent.subject,
        body: emailContent.textBody,
        htmlBody: emailContent.htmlBody,
        name: 'Equipo Musicala'
      });
      markSentToday_(email);
      Logger.log('Correo de cumpleanos enviado a %s (%s).', person.nombre, email);
    } catch (error) {
      Logger.log('Error enviando correo a %s (%s): %s', person.nombre, email, error && error.message ? error.message : error);
    }
  });
}

/**
 * No envia correos. Retorna y registra la lista de personas que cumplen hoy.
 */
function previewCumpleanosHoy() {
  const tsv = fetchTSV_();
  const rows = parseTSV_(tsv);
  const result = {
    fecha: Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd'),
    matches: []
  };

  if (!rows.length) {
    Logger.log('El TSV no contiene filas.');
    return result;
  }

  const headers = rows[0];
  const headerIndex = buildHeaderIndex_(headers);
  const nameIndex = findHeaderIndex_(headerIndex, HEADER_ALIASES.nombre);
  const emailIndex = findHeaderIndex_(headerIndex, HEADER_ALIASES.correo);
  const birthdayIndex = findHeaderIndex_(headerIndex, HEADER_ALIASES.cumpleanos);
  const planIndex = findHeaderIndex_(headerIndex, HEADER_ALIASES.planSeleccionado);

  Logger.log('Encabezados detectados: nombre=%s, correo=%s, cumpleanos=%s, plan=%s', nameIndex, emailIndex, birthdayIndex, planIndex);

  if (birthdayIndex < 0) {
    Logger.log('No se encontro columna de cumpleanos/fecha de nacimiento. No se puede continuar.');
    return result;
  }

  if (emailIndex < 0) {
    Logger.log('No se encontro columna de correo. El preview detectara cumpleanos, pero no habra destino de envio.');
  }

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (isBusinessBirthdayRow_(row, planIndex)) {
      Logger.log('Fila %s omitida: corresponde a empresa/taller empresarial.', i + 1);
      continue;
    }

    const rawBirthday = row[birthdayIndex];
    const parsedBirthday = parseBirthday_(rawBirthday);

    if (!parsedBirthday) continue;
    if (!isTodayBirthday_(parsedBirthday)) continue;

    const name = nameIndex >= 0 ? String(row[nameIndex] || '').trim() : '';
    const email = emailIndex >= 0 ? String(row[emailIndex] || '').trim() : '';

    result.matches.push({
      fila: i + 1,
      nombre: name || DEFAULT_NAME,
      correo: email,
      fechaDetectada: String(rawBirthday || '').trim(),
      mes: parsedBirthday.month,
      dia: parsedBirthday.day
    });
  }

  Logger.log('Cumpleanos detectados para hoy (%s): %s', result.fecha, JSON.stringify(result.matches, null, 2));
  return result;
}

/**
 * Instala un trigger diario entre 8:00 a.m. y 9:00 a.m. hora Colombia.
 * Primero elimina triggers anteriores de la misma funcion para evitar duplicados.
 */
function instalarTriggerCumpleanos() {
  const functionName = 'enviarCorreosCumpleanosHoy';
  const triggers = ScriptApp.getProjectTriggers();

  triggers.forEach(function (trigger) {
    if (trigger.getHandlerFunction && trigger.getHandlerFunction() === functionName) {
      ScriptApp.deleteTrigger(trigger);
      Logger.log('Trigger anterior eliminado para %s.', functionName);
    }
  });

  ScriptApp.newTrigger(functionName)
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .inTimezone(TIMEZONE)
    .create();

  Logger.log('Trigger diario instalado para %s entre 8:00 a.m. y 9:00 a.m. (%s).', functionName, TIMEZONE);
}

/**
 * Borra las marcas de envio del dia actual. Usar solo para pruebas controladas.
 */
function resetEnviosCumpleanosDeHoy() {
  const props = PropertiesService.getScriptProperties();
  const todayKey = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
  const prefix = SENT_KEY_PREFIX + '_' + todayKey + '_';
  const allProps = props.getProperties();
  let deleted = 0;

  Object.keys(allProps).forEach(function (key) {
    if (key.indexOf(prefix) === 0) {
      props.deleteProperty(key);
      deleted++;
    }
  });

  Logger.log('Marcas de envio borradas para %s: %s', todayKey, deleted);
  return deleted;
}

function fetchTSV_() {
  Logger.log('Leyendo TSV publicado: %s', TSV_URL);
  const response = UrlFetchApp.fetch(TSV_URL, {
    muteHttpExceptions: true,
    followRedirects: true
  });
  const code = response.getResponseCode();

  if (code < 200 || code >= 300) {
    throw new Error('No se pudo leer el TSV. HTTP ' + code + ': ' + response.getContentText().slice(0, 300));
  }

  return response.getContentText('UTF-8');
}

/**
 * Parsea TSV respetando columnas vacias y campos entre comillas.
 */
function parseTSV_(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  text = String(text || '').replace(/^\uFEFF/, '');

  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);
    const next = text.charAt(i + 1);

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === '\t' && !inQuotes) {
      row.push(field);
      field = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';

      if (char === '\r' && next === '\n') i++;
      continue;
    }

    field += char;
  }

  row.push(field);
  rows.push(row);

  while (rows.length && rows[rows.length - 1].every(function (cell) { return String(cell || '').trim() === ''; })) {
    rows.pop();
  }

  return rows;
}

function buildHeaderIndex_(headers) {
  const index = {};

  (headers || []).forEach(function (header, i) {
    const key = normalizeKey_(header);
    if (key && index[key] === undefined) {
      index[key] = i;
    }
  });

  return index;
}

function findHeaderIndex_(headerIndex, aliases) {
  for (let i = 0; i < aliases.length; i++) {
    const key = normalizeKey_(aliases[i]);
    if (headerIndex[key] !== undefined) {
      return headerIndex[key];
    }
  }

  const normalizedAliases = aliases.map(normalizeKey_);
  const headerKeys = Object.keys(headerIndex);

  for (let h = 0; h < headerKeys.length; h++) {
    const headerKey = headerKeys[h];
    for (let a = 0; a < normalizedAliases.length; a++) {
      const alias = normalizedAliases[a];
      if (headerKey.indexOf(alias) > -1 || alias.indexOf(headerKey) > -1) {
        return headerIndex[headerKey];
      }
    }
  }

  return -1;
}

function isBusinessBirthdayRow_(row, planIndex) {
  if (planIndex < 0) return false;
  const planValue = normalizeKey_(row[planIndex]);
  return planValue.indexOf('empresarial') > -1;
}

function normalizeKey_(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function parseBirthday_(value) {
  const raw = String(value || '').trim();
  let match;

  if (!raw) return null;

  // Serial de Excel/Google Sheets. La base usada por Sheets/Excel es 1899-12-30.
  if (/^\d{4,6}(?:\.\d+)?$/.test(raw)) {
    const serial = Number(raw);
    if (!Number.isFinite(serial) || serial <= 0) return null;

    const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 24 * 60 * 60 * 1000;
    const date = new Date(ms);
    return {
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      source: raw
    };
  }

  // YYYY-MM-DD o YYYY/MM/DD
  match = raw.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:\D|$)/);
  if (match) {
    return buildMonthDay_(Number(match[2]), Number(match[3]), raw);
  }

  // DD/MM/YYYY, D/M/YYYY, DD-MM-YYYY, DD/MM o D/M
  match = raw.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?(?:\D|$)/);
  if (match) {
    return buildMonthDay_(Number(match[2]), Number(match[1]), raw);
  }

  return null;
}

function isTodayBirthday_(birthday) {
  const now = new Date();
  const currentYear = Number(Utilities.formatDate(now, TIMEZONE, 'yyyy'));
  const todayMonth = Number(Utilities.formatDate(now, TIMEZONE, 'M'));
  const todayDay = Number(Utilities.formatDate(now, TIMEZONE, 'd'));

  if (!birthday) return false;

  if (birthday.month === 2 && birthday.day === 29 && !isLeapYear_(currentYear)) {
    return todayMonth === 2 && todayDay === 28;
  }

  return birthday.month === todayMonth && birthday.day === todayDay;
}

function isValidEmail_(email) {
  const value = String(email || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function alreadySentToday_(email) {
  return PropertiesService.getScriptProperties().getProperty(buildSentKey_(email)) === '1';
}

function markSentToday_(email) {
  PropertiesService.getScriptProperties().setProperty(buildSentKey_(email), '1');
}

function buildBirthdayEmail_(name) {
  const safeName = escapeHtml_(name || DEFAULT_NAME);
  const subject = '🎂 ¡Feliz cumpleaños de parte de Musicala!';
  const textBody = [
    'Hola, ' + (name || DEFAULT_NAME) + ':',
    '',
    'Hoy en Musicala queremos desearte un muy feliz cumpleaños. 🎂✨',
    '',
    'Que este nuevo año de vida venga lleno de música, creatividad, aprendizajes, momentos bonitos y muchas razones para sonreír.',
    '',
    'Gracias por hacer parte de nuestra comunidad artística.',
    '',
    'Con cariño,',
    'Equipo Musicala'
  ].join('\n');

  const htmlBody = [
    '<div style="margin:0;padding:24px;background:#f7f3ee;font-family:Arial,Helvetica,sans-serif;color:#242124;">',
    '  <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #eadfd4;border-radius:14px;overflow:hidden;">',
    '    <div style="background:#7c2d12;color:#fff;padding:22px 24px;">',
    '      <h1 style="margin:0;font-size:24px;line-height:1.25;">¡Feliz cumpleaños!</h1>',
    '      <p style="margin:6px 0 0;font-size:14px;opacity:.92;">Un saludo especial de Musicala</p>',
    '    </div>',
    '    <div style="padding:24px;font-size:16px;line-height:1.6;">',
    '      <p style="margin:0 0 16px;">Hola, <strong>' + safeName + '</strong>:</p>',
    '      <p style="margin:0 0 16px;">Hoy en Musicala queremos desearte un muy feliz cumpleaños. 🎂✨</p>',
    '      <p style="margin:0 0 16px;">Que este nuevo año de vida venga lleno de música, creatividad, aprendizajes, momentos bonitos y muchas razones para sonreír.</p>',
    '      <p style="margin:0 0 22px;">Gracias por hacer parte de nuestra comunidad artística.</p>',
    '      <p style="margin:0;">Con cariño,<br><strong>Equipo Musicala</strong></p>',
    '    </div>',
    '  </div>',
    '</div>'
  ].join('');

  return {
    subject: subject,
    textBody: textBody,
    htmlBody: htmlBody
  };
}

function escapeHtml_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildMonthDay_(month, day, source) {
  if (!isValidMonthDay_(month, day)) return null;
  return {
    month: month,
    day: day,
    source: source
  };
}

function isValidMonthDay_(month, day) {
  if (!Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  const date = new Date(2024, month - 1, day);
  return date.getMonth() === month - 1 && date.getDate() === day;
}

function isLeapYear_(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function buildSentKey_(email) {
  const todayKey = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
  return SENT_KEY_PREFIX + '_' + todayKey + '_' + String(email || '').trim().toLowerCase();
}

/**
 * Guia breve de instalacion:
 * 1. Abrir Apps Script desde la cuenta notificaciones.musicala@gmail.com.
 * 2. Pegar o subir este archivo como code.gs.
 * 3. Ejecutar manualmente previewCumpleanosHoy para revisar a quien enviaria correo.
 * 4. Ejecutar manualmente instalarTriggerCumpleanos.
 * 5. Autorizar los permisos solicitados por Google.
 * 6. El trigger quedara enviando correos automaticamente todos los dias.
 */
