/** Agenda tipo Calendly: duración, horario semanal, anticipación y topes. */

export const WEEKDAYS = [
  { id: 1, label: "Lunes" },
  { id: 2, label: "Martes" },
  { id: 3, label: "Miércoles" },
  { id: 4, label: "Jueves" },
  { id: 5, label: "Viernes" },
  { id: 6, label: "Sábado" },
  { id: 0, label: "Domingo" },
];

export const TIMEZONES = [
  { id: "America/Santiago", label: "Santiago (Chile continental)" },
  { id: "America/Punta_Arenas", label: "Punta Arenas" },
  { id: "Pacific/Easter", label: "Isla de Pascua" },
];

export const DEFAULT_CONFIRMATION =
  "Hora reservada. Para confirmar, paga el valor total de la consulta.";

const DOW_KEYS = ["0", "1", "2", "3", "4", "5", "6"];

export function emptyWeekly() {
  return { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
}

export function timeToMinutes(value) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return NaN;
  const hours = Number(match[1]);
  const mins = Number(match[2]);
  if (hours > 23 || mins > 59) return NaN;
  return hours * 60 + mins;
}

export function minutesToTime(total) {
  const mins = Math.max(0, Math.min(24 * 60, Math.round(Number(total) || 0)));
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

export function normalizeTime(value) {
  const mins = timeToMinutes(value);
  if (!Number.isFinite(mins) || mins >= 24 * 60) return "";
  return minutesToTime(mins);
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function cleanTimezone(value) {
  const tz = String(value || "").trim();
  if (/^[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)+$/.test(tz)) return tz;
  return "America/Santiago";
}

export function splitNotice(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  if (total && total % (60 * 24) === 0) return { value: total / (60 * 24), unit: "days" };
  if (total && total % 60 === 0) return { value: total / 60, unit: "hours" };
  return { value: total, unit: "minutes" };
}

export function joinNotice(value, unit) {
  const n = Math.max(0, Number(value) || 0);
  if (unit === "days") return Math.round(n * 60 * 24);
  if (unit === "hours") return Math.round(n * 60);
  return Math.round(n);
}

export function slotsFromRange(start, end, durationMinutes, incrementMinutes) {
  const from = timeToMinutes(start);
  const to = timeToMinutes(end);
  const duration = clampInt(durationMinutes, 5, 480, 60);
  const step = clampInt(incrementMinutes, 0, 240, 0) || duration;
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return [];
  const times = [];
  for (let cursor = from; cursor + duration <= to && times.length < 48; cursor += step) {
    times.push(minutesToTime(cursor));
  }
  return times;
}

function asArray(value, fallback) {
  return Array.isArray(value) && value.length ? value : fallback;
}

function hoursToWeekly(hours, days, duration) {
  const weekly = emptyWeekly();
  const ranges = asArray(hours, [])
    .map((hour) => {
      const start = normalizeTime(hour);
      if (!start) return null;
      const endMin = timeToMinutes(start) + duration;
      if (endMin > 24 * 60) return null;
      return { start, end: minutesToTime(endMin) };
    })
    .filter(Boolean);
  const usable = ranges.length ? ranges : [{ start: "10:00", end: minutesToTime(10 * 60 + duration) }];
  const openDays = (Array.isArray(days) ? days : []).map(Number).filter((day) => day >= 0 && day <= 6);
  for (const dow of openDays.length ? openDays : [1, 2, 3, 4, 5]) {
    weekly[dow] = usable.map((range) => ({ ...range }));
  }
  return weekly;
}

function calendarFromGenesis(genesis = {}) {
  const onlineHours = asArray(genesis.slot_hours_online, ["10:00", "12:00"]);
  const presencialHours = asArray(genesis.slot_hours_presencial, asArray(genesis.slot_hours, ["15:00", "17:30"]));
  const onlineDays = asArray(genesis.workdays_online, [1, 2, 3, 4, 5]).map(Number);
  const presencialDays = asArray(genesis.workdays_presencial, asArray(genesis.workdays, [1, 2, 3, 4, 5, 6])).map(Number);
  return {
    version: 1,
    timezone: cleanTimezone(genesis.timezone || "America/Santiago"),
    window_days: 45,
    min_notice_minutes: 120,
    increment_minutes: 0,
    buffer_before_minutes: 0,
    buffer_after_minutes: 0,
    max_per_day: 0,
    confirmation_message: DEFAULT_CONFIRMATION,
    online: {
      enabled: true,
      name: "Consulta online",
      duration_minutes: 60,
      location: "Videollamada",
      weekly: hoursToWeekly(onlineHours, onlineDays, 60),
    },
    presencial: {
      enabled: true,
      name: "Consulta presencial",
      duration_minutes: 60,
      location: "Consultorio",
      weekly: hoursToWeekly(presencialHours, presencialDays, 60),
    },
    date_overrides: [],
  };
}

function normalizeRange(range) {
  const start = normalizeTime(range?.start);
  const end = normalizeTime(range?.end);
  if (!start || !end || timeToMinutes(end) <= timeToMinutes(start)) return null;
  return { start, end };
}

function normalizeWeekly(weekly) {
  const out = emptyWeekly();
  const source = weekly && typeof weekly === "object" ? weekly : {};
  for (const dow of DOW_KEYS) {
    const list = Array.isArray(source[dow]) ? source[dow] : [];
    out[dow] = list.map(normalizeRange).filter(Boolean);
  }
  return out;
}

function normalizeMode(raw, kind, genesis) {
  const fallback = calendarFromGenesis(genesis)[kind];
  const source = raw && typeof raw === "object" ? raw : null;
  if (!source) return fallback;
  const duration = clampInt(source.duration_minutes, 5, 480, fallback.duration_minutes);
  return {
    enabled: source.enabled !== false,
    name: String(source.name || fallback.name).trim().slice(0, 80) || fallback.name,
    duration_minutes: duration,
    location: String(source.location || "").trim().slice(0, 120),
    weekly: normalizeWeekly(source.weekly),
  };
}

function normalizeOverrides(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      const date = String(item?.date || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
      const mode = ["online", "presencial", "ambas"].includes(item?.mode) ? item.mode : "ambas";
      const ranges = Array.isArray(item?.ranges) ? item.ranges.map(normalizeRange).filter(Boolean) : [];
      return {
        date,
        mode,
        closed: item?.closed !== false && (item?.closed === true || !ranges.length),
        ranges,
      };
    })
    .filter(Boolean)
    .slice(0, 60);
}

export function normalizeCalendar(raw, genesis = {}) {
  if (!raw || typeof raw !== "object" || (!raw.online && !raw.presencial)) {
    return calendarFromGenesis(genesis);
  }
  return {
    version: 1,
    timezone: cleanTimezone(raw.timezone || genesis.timezone),
    window_days: clampInt(raw.window_days, 1, 180, 45),
    min_notice_minutes: clampInt(raw.min_notice_minutes, 0, 60 * 24 * 90, 120),
    increment_minutes: clampInt(raw.increment_minutes, 0, 240, 0) === 0 ? 0 : clampInt(raw.increment_minutes, 5, 240, 0),
    buffer_before_minutes: clampInt(raw.buffer_before_minutes, 0, 240, 0),
    buffer_after_minutes: clampInt(raw.buffer_after_minutes, 0, 240, 0),
    max_per_day: clampInt(raw.max_per_day, 0, 50, 0),
    confirmation_message: String(raw.confirmation_message || DEFAULT_CONFIRMATION).trim().slice(0, 400) || DEFAULT_CONFIRMATION,
    online: normalizeMode(raw.online, "online", genesis),
    presencial: normalizeMode(raw.presencial, "presencial", genesis),
    date_overrides: normalizeOverrides(raw.date_overrides),
  };
}

function rangesOverlap(ranges) {
  const sorted = ranges
    .map((range) => ({ start: timeToMinutes(range.start), end: timeToMinutes(range.end), raw: range }))
    .sort((a, b) => a.start - b.start);
  for (let i = 0; i < sorted.length; i += 1) {
    if (!Number.isFinite(sorted[i].start) || !Number.isFinite(sorted[i].end)) return "incompleto";
    if (sorted[i].end <= sorted[i].start) return "orden";
    if (i > 0 && sorted[i].start < sorted[i - 1].end) return "solape";
  }
  return "";
}

const MODE_LABEL = { online: "Online", presencial: "Presencial" };

export function validateCalendar(config) {
  if (!config?.online || !config?.presencial) return "Falta la configuración de la agenda.";
  const errors = [];
  const windowDays = Number(config.window_days);
  if (!Number.isFinite(windowDays) || windowDays < 1 || windowDays > 180) {
    errors.push("El rango de reserva tiene que estar entre 1 y 180 días.");
  }
  const notice = Number(config.min_notice_minutes);
  if (!Number.isFinite(notice) || notice < 0 || notice > 60 * 24 * 90) {
    errors.push("La anticipación mínima no puede pasar de 90 días.");
  }
  const increment = Number(config.increment_minutes);
  if (!Number.isFinite(increment) || increment < 0 || (increment > 0 && increment < 5) || increment > 240) {
    errors.push("El intervalo entre horarios tiene que ser igual a la duración, o entre 5 y 240 minutos.");
  }
  for (const [key, label] of [
    ["buffer_before_minutes", "antes"],
    ["buffer_after_minutes", "después"],
  ]) {
    const buffer = Number(config[key]);
    if (!Number.isFinite(buffer) || buffer < 0 || buffer > 240) {
      errors.push(`El descanso ${label} de la cita tiene que estar entre 0 y 240 minutos.`);
    }
  }
  const maxDay = Number(config.max_per_day);
  if (!Number.isFinite(maxDay) || maxDay < 0 || maxDay > 50) {
    errors.push("El máximo de citas por día tiene que estar entre 0 (sin límite) y 50.");
  }
  const active = ["online", "presencial"].filter((mode) => config[mode].enabled !== false);
  if (!active.length) errors.push("Activá al menos una modalidad, online o presencial.");
  for (const mode of ["online", "presencial"]) {
    const label = MODE_LABEL[mode];
    const entry = config[mode];
    const duration = Number(entry.duration_minutes);
    if (!Number.isFinite(duration) || duration < 5 || duration > 480) {
      errors.push(`La duración de ${label} tiene que estar entre 5 y 480 minutos.`);
    }
    let openDays = 0;
    for (const day of WEEKDAYS) {
      const ranges = entry.weekly?.[day.id] || entry.weekly?.[String(day.id)] || [];
      if (!ranges.length) continue;
      openDays += 1;
      const problem = rangesOverlap(ranges);
      if (problem === "solape") errors.push(`En ${label}, el ${day.label.toLowerCase()} tiene horarios que se pisan.`);
      if (problem === "orden" || problem === "incompleto") {
        errors.push(`En ${label}, revisá el ${day.label.toLowerCase()}: la hora de fin tiene que ser posterior a la de inicio.`);
      }
      for (const range of ranges) {
        const span = timeToMinutes(range.end) - timeToMinutes(range.start);
        if (Number.isFinite(span) && span > 0 && span < duration) {
          errors.push(`En ${label}, el ${day.label.toLowerCase()} tiene un bloque más corto que la duración de la cita.`);
        }
      }
    }
    if (entry.enabled !== false && !openDays) {
      errors.push(`${label} está activo y no tiene ningún día con horario.`);
    }
  }
  const seen = new Set();
  for (const item of config.date_overrides || []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date || "")) {
      errors.push("Hay una fecha especial inválida.");
      continue;
    }
    const key = `${item.date}:${item.mode || "ambas"}`;
    if (seen.has(key)) errors.push(`La fecha ${item.date} está repetida para la misma modalidad.`);
    seen.add(key);
    if (!item.closed) {
      const problem = rangesOverlap(item.ranges || []);
      if (!item.ranges?.length || problem) errors.push(`Completa el horario especial del ${item.date}.`);
    }
  }
  return errors[0] || "";
}

export function deriveSlotHours(modeConfig, incrementMinutes) {
  const times = new Set();
  for (const ranges of Object.values(modeConfig?.weekly || {})) {
    for (const range of ranges || []) {
      for (const time of slotsFromRange(range.start, range.end, modeConfig.duration_minutes, incrementMinutes)) {
        times.add(time);
      }
    }
  }
  if (!times.size) {
    for (const ranges of Object.values(modeConfig?.weekly || {})) {
      for (const range of ranges || []) {
        const start = normalizeTime(range.start);
        if (start) times.add(start);
      }
    }
  }
  return [...times].sort();
}

export function workdaysFromWeekly(weekly) {
  return DOW_KEYS.map(Number).filter((dow) => Array.isArray(weekly?.[dow]) && weekly[dow].length);
}

/** Horas fijas que sigue leyendo la agenda anterior si todavía no corre calendar_settings.sql. */
export function genesisHoursFromCalendar(calendar) {
  const slotOnline = deriveSlotHours(calendar.online, calendar.increment_minutes);
  const slotPresencial = deriveSlotHours(calendar.presencial, calendar.increment_minutes);
  const daysOnline = calendar.online.enabled === false ? [7] : workdaysFromWeekly(calendar.online.weekly);
  const daysPresencial = calendar.presencial.enabled === false ? [7] : workdaysFromWeekly(calendar.presencial.weekly);
  const workdaysOnline = daysOnline.length ? daysOnline : [1, 2, 3, 4, 5];
  const workdaysPresencial = daysPresencial.length ? daysPresencial : [1, 2, 3, 4, 5, 6];
  return {
    timezone: calendar.timezone,
    slot_hours_online: slotOnline.length ? slotOnline : ["10:00"],
    slot_hours_presencial: slotPresencial.length ? slotPresencial : ["15:00"],
    workdays_online: workdaysOnline,
    workdays_presencial: workdaysPresencial,
    slot_hours: slotPresencial.length ? slotPresencial : ["15:00"],
    workdays: [...new Set([...workdaysOnline, ...workdaysPresencial])].filter((day) => day !== 7),
  };
}

function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function rangesForDate(config, mode, key, dow) {
  const overrides = (config.date_overrides || []).filter(
    (item) => item.date === key && (item.mode === mode || item.mode === "ambas" || !item.mode),
  );
  const specific = overrides.filter((item) => item.mode === mode);
  const chosen = (specific.length ? specific : overrides).at(-1);
  if (chosen) {
    if (chosen.closed) return [];
    return chosen.ranges || [];
  }
  return config[mode]?.weekly?.[dow] || config[mode]?.weekly?.[String(dow)] || [];
}

export function previewUpcoming(config, mode, days = 14, now = new Date()) {
  const entry = config?.[mode];
  if (!entry || entry.enabled === false) return [];
  const notice = Math.max(0, Number(config.min_notice_minutes) || 0);
  const increment = Number(config.increment_minutes) || 0;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const out = [];
  const horizon = Math.min(21, Math.max(1, Number(days) || 14));
  for (let offset = 0; offset < horizon && out.length < 8; offset += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + offset);
    const ranges = rangesForDate(config, mode, dateKey(day), day.getDay());
    const times = [];
    for (const range of ranges) {
      for (const time of slotsFromRange(range.start, range.end, entry.duration_minutes, increment)) {
        const [hours, mins] = time.split(":").map(Number);
        const slot = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, mins);
        if (slot.getTime() <= now.getTime() + notice * 60000) continue;
        if (!times.includes(time)) times.push(time);
      }
    }
    if (!times.length) continue;
    out.push({
      date: dateKey(day),
      label: new Intl.DateTimeFormat("es-CL", { weekday: "long", day: "numeric", month: "short" }).format(day),
      times,
    });
  }
  return out;
}
