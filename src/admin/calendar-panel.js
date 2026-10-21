import {
  TIMEZONES,
  WEEKDAYS,
  genesisHoursFromCalendar,
  joinNotice,
  minutesToTime,
  normalizeCalendar,
  previewUpcoming,
  splitNotice,
  timeToMinutes,
  validateCalendar,
} from "../lib/calendar-config.js";

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(str) {
  return escapeHtml(str).replaceAll("'", "&#39;");
}

function isoDateOffset(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function defaultRange(mode) {
  return mode === "online" ? { start: "10:00", end: "13:00" } : { start: "15:00", end: "19:00" };
}

function nextRange(list, mode) {
  const last = list[list.length - 1];
  if (!last) return defaultRange(mode);
  const startMin = timeToMinutes(last.end);
  const endMin = startMin + 180;
  if (!Number.isFinite(startMin) || endMin >= 24 * 60 || endMin - startMin < 30) return defaultRange(mode);
  return { start: minutesToTime(startMin), end: minutesToTime(endMin) };
}

const PRESETS = [30, 45, 60, 90, 120];

export function createCalendarPanel({ query, queryAll, requireSupabase, isPreview }) {
  const stash = { online: {}, presencial: {} };
  let draft = null;
  let mode = "presencial";
  let isNew = false;
  let bound = false;

  const $ = (sel, root) => query(sel, root);
  const $$ = (sel, root) => queryAll(sel, root);

  const showError = (text) => {
    const errorEl = $("[data-calendar-error]");
    if (!errorEl) return;
    errorEl.hidden = !text;
    errorEl.textContent = text || "";
    if (text) errorEl.scrollIntoView({ block: "nearest" });
  };

  const refreshPresets = () => {
    const current = Number(draft?.[mode]?.duration_minutes);
    $$("[data-cal-preset]").forEach((btn) => {
      btn.classList.toggle("is-active", Number(btn.dataset.calPreset) === current);
    });
  };

  const refreshPreview = () => {
    const root = $("[data-cal-preview]");
    if (!root || !draft) return;
    const rows = previewUpcoming(draft, mode, Number(draft.window_days) || 14);
    if (!rows.length) {
      root.innerHTML = `<p class="empty">No hay horas libres con estas reglas en los próximos días.</p>`;
      return;
    }
    root.innerHTML = `<ul class="cal-preview-list">${rows
      .map(
        (row) =>
          `<li><strong>${escapeHtml(row.label)}</strong><span>${row.times.map((time) => escapeHtml(time)).join(" · ")}</span></li>`,
      )
      .join("")}</ul>`;
  };

  const render = () => {
    const root = $("[data-calendar-body]");
    if (!root || !draft) return;
    const entry = draft[mode];
    const notice = splitNotice(draft.min_notice_minutes);
    const zones = TIMEZONES.some((zone) => zone.id === draft.timezone)
      ? TIMEZONES
      : [{ id: draft.timezone, label: draft.timezone }, ...TIMEZONES];
    const days = WEEKDAYS.map((day) => {
      const ranges = entry.weekly[day.id] || [];
      const open = ranges.length > 0;
      const intervals = open
        ? ranges
            .map(
              (range, index) => `<div class="cal-range">
                <input type="time" required data-range-start data-dow="${day.id}" data-index="${index}" value="${escapeAttr(range.start)}" />
                <span>a</span>
                <input type="time" required data-range-end data-dow="${day.id}" data-index="${index}" value="${escapeAttr(range.end)}" />
                <button type="button" class="cal-remove" data-cal-remove-range data-dow="${day.id}" data-index="${index}">Quitar</button>
              </div>`,
            )
            .join("")
        : `<p class="cal-off">No disponible</p>`;
      return `<div class="cal-day">
        <label class="check-line">
          <input type="checkbox" data-cal-day-toggle value="${day.id}" ${open ? "checked" : ""} />
          <span>${day.label}</span>
        </label>
        <div>
          <div class="cal-ranges">${intervals}</div>
          <div class="cal-day-actions">
            ${open ? `<button type="button" class="cal-mini" data-cal-add-range data-dow="${day.id}">Agregar horario</button>` : ""}
            <button type="button" class="cal-mini" data-cal-copy="weekdays" data-dow="${day.id}">Copiar a lun–vie</button>
            <button type="button" class="cal-mini" data-cal-copy="all" data-dow="${day.id}">Copiar a toda la semana</button>
          </div>
        </div>
      </div>`;
    }).join("");

    const overrides = (draft.date_overrides || [])
      .map((item, index) => {
        const ranges = (item.ranges || [])
          .map(
            (range, rangeIndex) => `<div class="cal-range">
              <input type="time" data-ov-start data-index="${index}" data-range="${rangeIndex}" value="${escapeAttr(range.start)}" />
              <span>a</span>
              <input type="time" data-ov-end data-index="${index}" data-range="${rangeIndex}" value="${escapeAttr(range.end)}" />
              <button type="button" class="cal-remove" data-cal-remove-override-range data-index="${index}" data-range="${rangeIndex}">Quitar</button>
            </div>`,
          )
          .join("");
        return `<div class="cal-override">
          <div class="cal-inline">
            <input type="date" data-ov-date data-index="${index}" value="${escapeAttr(item.date)}" />
            <select data-ov-mode data-index="${index}">
              <option value="ambas" ${item.mode === "ambas" ? "selected" : ""}>Online y presencial</option>
              <option value="online" ${item.mode === "online" ? "selected" : ""}>Solo online</option>
              <option value="presencial" ${item.mode === "presencial" ? "selected" : ""}>Solo presencial</option>
            </select>
            <label class="check-line"><input type="checkbox" data-ov-closed data-index="${index}" ${item.closed ? "checked" : ""} /> Cerrado</label>
            <button type="button" class="cal-remove" data-cal-remove-override data-index="${index}">Eliminar fecha</button>
          </div>
          ${
            item.closed
              ? `<p class="cal-off">Ese día no se ofrece esta modalidad.</p>`
              : `<div class="cal-ranges">${ranges}</div><button type="button" class="cal-mini" data-cal-add-override-range data-index="${index}">Agregar horario</button>`
          }
        </div>`;
      })
      .join("");

    root.innerHTML = `
      ${isNew ? `<p class="cal-note">Todavía no guardaste esta agenda. Los bloques iniciales salen de las horas que ya tenía Génesis.</p>` : ""}
      <div class="cal-tabs" role="tablist" aria-label="Modalidad">
        <button type="button" class="cal-tab ${mode === "presencial" ? "is-active" : ""}" data-cal-tab="presencial" role="tab" aria-selected="${mode === "presencial"}">Presencial${draft.presencial.enabled === false ? " · inactivo" : ""}</button>
        <button type="button" class="cal-tab ${mode === "online" ? "is-active" : ""}" data-cal-tab="online" role="tab" aria-selected="${mode === "online"}">Online${draft.online.enabled === false ? " · inactivo" : ""}</button>
      </div>

      <article class="card cal-card">
        <h3>Tipo de evento</h3>
        <label class="check-line"><input type="checkbox" data-cal-field="enabled" ${entry.enabled !== false ? "checked" : ""} /> Los pacientes pueden reservar esta modalidad</label>
        <div class="cal-grid">
          <label>Nombre en la web
            <input data-cal-field="name" maxlength="80" value="${escapeAttr(entry.name)}" />
          </label>
          <label>Lugar
            <input data-cal-field="location" maxlength="120" value="${escapeAttr(entry.location || "")}" placeholder="Consultorio, videollamada, WhatsApp…" />
          </label>
        </div>
        <label>Duración
          <input type="number" min="5" max="480" step="5" data-cal-field="duration_minutes" value="${escapeAttr(entry.duration_minutes)}" />
        </label>
        <div class="cal-presets">
          ${PRESETS.map((minutes) => `<button type="button" class="cal-mini cal-preset ${Number(entry.duration_minutes) === minutes ? "is-active" : ""}" data-cal-preset="${minutes}">${minutes} min</button>`).join("")}
        </div>
      </article>

      <article class="card cal-card">
        <h3>Disponibilidad semanal</h3>
        <p class="hint">Como en Calendly: cada día puede tener uno o más bloques. Las horas que ve el paciente salen de la duración y del intervalo de inicio.</p>
        ${days}
      </article>

      <article class="card cal-card">
        <h3>Cuándo pueden reservar</h3>
        <div class="cal-grid">
          <label>Zona horaria
            <select data-global="timezone">
              ${zones.map((zone) => `<option value="${escapeAttr(zone.id)}" ${zone.id === draft.timezone ? "selected" : ""}>${escapeHtml(zone.label)}</option>`).join("")}
            </select>
          </label>
          <label>Pueden reservar hasta
            <span class="cal-inline"><input type="number" min="1" max="180" step="1" data-global="window_days" value="${escapeAttr(draft.window_days)}" /> <span>días hacia adelante</span></span>
          </label>
          <label>Anticipación mínima
            <span class="cal-inline">
              <input type="number" min="0" step="1" data-global="notice_value" value="${escapeAttr(notice.value)}" />
              <select data-global="notice_unit">
                <option value="minutes" ${notice.unit === "minutes" ? "selected" : ""}>minutos</option>
                <option value="hours" ${notice.unit === "hours" ? "selected" : ""}>horas</option>
                <option value="days" ${notice.unit === "days" ? "selected" : ""}>días</option>
              </select>
            </span>
          </label>
          <label>Los horarios empiezan
            <select data-global="increment_minutes">
              <option value="0" ${Number(draft.increment_minutes) === 0 ? "selected" : ""}>cada duración de la cita</option>
              ${[5, 10, 15, 20, 30, 45, 60].map((step) => `<option value="${step}" ${Number(draft.increment_minutes) === step ? "selected" : ""}>cada ${step} minutos</option>`).join("")}
            </select>
          </label>
          <label>Descanso antes de la cita
            <span class="cal-inline"><input type="number" min="0" max="240" step="5" data-global="buffer_before_minutes" value="${escapeAttr(draft.buffer_before_minutes)}" /> <span>min</span></span>
          </label>
          <label>Descanso después de la cita
            <span class="cal-inline"><input type="number" min="0" max="240" step="5" data-global="buffer_after_minutes" value="${escapeAttr(draft.buffer_after_minutes)}" /> <span>min</span></span>
          </label>
        </div>
        <label>Máximo de citas por día (online y presencial juntos)
          <input type="number" min="0" max="50" step="1" data-global="max_per_day" value="${draft.max_per_day ? escapeAttr(draft.max_per_day) : ""}" placeholder="Sin límite" />
        </label>
        <label>Mensaje al reservar
          <textarea data-global="confirmation_message" rows="3" maxlength="400">${escapeHtml(draft.confirmation_message || "")}</textarea>
        </label>
      </article>

      <article class="card cal-card">
        <h3>Fechas especiales</h3>
        <p class="hint">Feriados o días con otro horario. Reemplazan la semana tipo solo en esa fecha. Un día bloqueado desde Agenda sigue cerrado para las dos modalidades.</p>
        <div class="cal-overrides">${overrides || `<p class="cal-off">No hay fechas especiales.</p>`}</div>
        <button type="button" class="btn btn-ghost" data-cal-add-override>Agregar fecha</button>
      </article>

      <article class="card cal-card">
        <h3>Vista previa · ${mode === "online" ? "online" : "presencial"}</h3>
        <p class="hint">Próximos días según estas reglas y la anticipación mínima. No descuenta citas ya tomadas ni días bloqueados en Agenda.</p>
        <div data-cal-preview></div>
      </article>
    `;
    refreshPreview();
  };

  const onEdit = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !draft) return;
    const entry = draft[mode];

    if (target.matches("[data-cal-day-toggle]")) {
      if (event.type !== "change") return;
      const key = String(target.value);
      if (target.checked) {
        const saved = stash[mode][key];
        entry.weekly[key] = saved?.length ? saved.map((range) => ({ ...range })) : [defaultRange(mode)];
      } else {
        if (entry.weekly[key]?.length) stash[mode][key] = entry.weekly[key].map((range) => ({ ...range }));
        entry.weekly[key] = [];
      }
      render();
      return;
    }

    if (target.matches("[data-cal-field='enabled']")) {
      if (event.type !== "change") return;
      entry.enabled = target.checked;
      render();
      return;
    }

    if (target.matches("[data-cal-field='name']") || target.matches("[data-cal-field='location']")) {
      entry[target.dataset.calField] = target.value;
      return;
    }

    if (target.matches("[data-cal-field='duration_minutes']")) {
      entry.duration_minutes = Number(target.value);
      refreshPresets();
      refreshPreview();
      return;
    }

    if (target.matches("[data-range-start], [data-range-end]")) {
      const list = entry.weekly[String(target.dataset.dow)];
      const index = Number(target.dataset.index);
      if (!list?.[index]) return;
      list[index][target.matches("[data-range-start]") ? "start" : "end"] = target.value;
      refreshPreview();
      return;
    }

    if (target.matches("[data-global='notice_value'], [data-global='notice_unit']")) {
      const form = target.closest("form");
      draft.min_notice_minutes = joinNotice(
        form?.querySelector("[data-global='notice_value']")?.value,
        form?.querySelector("[data-global='notice_unit']")?.value,
      );
      refreshPreview();
      return;
    }

    if (target.matches("[data-global]")) {
      const key = target.dataset.global;
      if (key === "timezone" || key === "confirmation_message") draft[key] = target.value;
      else if (key === "max_per_day") draft.max_per_day = target.value === "" ? 0 : Number(target.value);
      else draft[key] = Number(target.value);
      refreshPreview();
      return;
    }

    if (target.matches("[data-ov-date], [data-ov-mode], [data-ov-closed], [data-ov-start], [data-ov-end]")) {
      const item = draft.date_overrides[Number(target.dataset.index)];
      if (!item) return;
      if (target.matches("[data-ov-date]")) item.date = target.value;
      if (target.matches("[data-ov-mode]")) item.mode = target.value;
      if (target.matches("[data-ov-closed]")) {
        if (event.type !== "change") return;
        item.closed = target.checked;
        if (!item.closed && !item.ranges.length) item.ranges.push({ start: "10:00", end: "13:00" });
        render();
        return;
      }
      if (target.matches("[data-ov-start], [data-ov-end]")) {
        const range = item.ranges[Number(target.dataset.range)];
        if (!range) return;
        range[target.matches("[data-ov-start]") ? "start" : "end"] = target.value;
      }
      refreshPreview();
    }
  };

  const onClick = (event) => {
    const btn = event.target.closest("button");
    if (!btn || !draft) return;
    const entry = draft[mode];
    if (btn.dataset.calTab) {
      mode = btn.dataset.calTab === "online" ? "online" : "presencial";
      render();
      return;
    }
    if (btn.dataset.calPreset) {
      entry.duration_minutes = Number(btn.dataset.calPreset);
      const input = $("[data-cal-field='duration_minutes']");
      if (input) input.value = String(entry.duration_minutes);
      refreshPresets();
      refreshPreview();
      return;
    }
    if (btn.hasAttribute("data-cal-add-range")) {
      const key = String(btn.dataset.dow);
      if (!Array.isArray(entry.weekly[key])) entry.weekly[key] = [];
      entry.weekly[key].push(nextRange(entry.weekly[key], mode));
      render();
      return;
    }
    if (btn.hasAttribute("data-cal-remove-range")) {
      const list = entry.weekly[String(btn.dataset.dow)];
      list?.splice(Number(btn.dataset.index), 1);
      render();
      return;
    }
    if (btn.dataset.calCopy) {
      const source = (entry.weekly[String(btn.dataset.dow)] || []).map((range) => ({ ...range }));
      const targets = btn.dataset.calCopy === "all" ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];
      for (const dow of targets) entry.weekly[dow] = source.map((range) => ({ ...range }));
      render();
      return;
    }
    if (btn.hasAttribute("data-cal-add-override")) {
      draft.date_overrides.push({
        date: isoDateOffset(1),
        mode: "ambas",
        closed: true,
        ranges: [{ start: "10:00", end: "13:00" }],
      });
      render();
      return;
    }
    if (btn.hasAttribute("data-cal-remove-override")) {
      draft.date_overrides.splice(Number(btn.dataset.index), 1);
      render();
      return;
    }
    if (btn.hasAttribute("data-cal-add-override-range")) {
      const item = draft.date_overrides[Number(btn.dataset.index)];
      if (!item) return;
      item.ranges.push(nextRange(item.ranges, mode));
      render();
      return;
    }
    if (btn.hasAttribute("data-cal-remove-override-range")) {
      const item = draft.date_overrides[Number(btn.dataset.index)];
      item?.ranges.splice(Number(btn.dataset.range), 1);
      render();
    }
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    const okEl = $("[data-calendar-ok]");
    if (okEl) okEl.hidden = true;
    const problem = validateCalendar(draft);
    if (problem) {
      showError(problem);
      return;
    }
    const value = normalizeCalendar(draft);
    draft = value;
    if (isPreview()) {
      showError("Vista previa: la agenda es válida, pero este entorno no tiene Supabase para guardarla.");
      render();
      return;
    }
    const submit = event.currentTarget.querySelector("[type='submit']");
    if (submit) submit.disabled = true;
    try {
      const client = requireSupabase();
      const { error } = await client.from("site_settings").upsert({ key: "calendar", value });
      if (error) throw error;
      const { data: prevRow, error: readError } = await client
        .from("site_settings")
        .select("value")
        .eq("key", "genesis")
        .maybeSingle();
      if (readError) throw readError;
      const hours = genesisHoursFromCalendar(value);
      const genesis = { ...(prevRow?.value || {}), ...hours };
      const { error: genesisError } = await client.from("site_settings").upsert({ key: "genesis", value: genesis });
      if (genesisError) throw genesisError;
      isNew = false;
      showError("");
      if (okEl) okEl.hidden = false;
      render();
    } catch (err) {
      showError(err instanceof Error ? err.message : "No se pudo guardar la agenda.");
    } finally {
      if (submit) submit.disabled = false;
    }
  };

  const bind = () => {
    const form = $("[data-calendar-form]");
    if (!form || bound) return;
    bound = true;
    form.addEventListener("submit", onSubmit);
    form.addEventListener("input", onEdit);
    form.addEventListener("change", onEdit);
    form.addEventListener("click", onClick);
  };

  const load = async () => {
    bind();
    const body = $("[data-calendar-body]");
    if (isPreview()) {
      draft = normalizeCalendar(null, {});
      mode = "presencial";
      isNew = true;
      render();
      return;
    }
    try {
      const client = requireSupabase();
      const [{ data: saved, error: savedError }, { data: genesis, error: genesisError }] = await Promise.all([
        client.from("site_settings").select("value").eq("key", "calendar").maybeSingle(),
        client.from("site_settings").select("value").eq("key", "genesis").maybeSingle(),
      ]);
      if (savedError) throw savedError;
      if (genesisError) throw genesisError;
      isNew = !saved?.value;
      draft = normalizeCalendar(saved?.value, genesis?.value || {});
      if (draft[mode]?.enabled === false) mode = draft.online.enabled === false ? "presencial" : "online";
      render();
    } catch (err) {
      if (body) {
        body.innerHTML = `<p class="form-error">${escapeHtml(err instanceof Error ? err.message : "No se pudo cargar la agenda.")}</p>`;
      }
    }
  };

  return { load, bind };
}
