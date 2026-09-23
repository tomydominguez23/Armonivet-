import { isSupabaseConfigured, supabase } from "./supabase.js";

const TZ = "America/Santiago";
const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function pad(n) {
  return String(n).padStart(2, "0");
}

function dateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseISODate(value) {
  const [y, m, day] = String(value).split("-").map(Number);
  return new Date(y, (m || 1) - 1, day || 1);
}

function monthLabel(d) {
  return new Intl.DateTimeFormat("es-CL", { month: "long", year: "numeric" }).format(d);
}

function formatWhen(iso) {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function groupSlots(slots) {
  const byDay = {};
  for (const slot of slots || []) {
    const key = slot.date;
    if (!byDay[key]) byDay[key] = [];
    byDay[key].push(slot);
  }
  return byDay;
}

export async function initBooking() {
  const root = document.querySelector("[data-booking]");
  if (!root) return;

  const monthEl = root.querySelector("[data-booking-month]");
  const gridEl = root.querySelector("[data-booking-grid]");
  const slotsEl = root.querySelector("[data-booking-slots]");
  const dayLabel = root.querySelector("[data-booking-day]");
  const form = root.querySelector("[data-booking-form]");
  const statusEl = root.querySelector("[data-booking-status]");
  const whenInput = root.querySelector("[name='scheduled_at']");
  const whenLabel = root.querySelector("[data-booking-when]");
  const prevBtn = root.querySelector("[data-booking-prev]");
  const nextBtn = root.querySelector("[data-booking-next]");

  if (!isSupabaseConfigured || !supabase) {
    if (statusEl) {
      statusEl.hidden = false;
      statusEl.textContent = "El calendario se activa cuando Supabase está configurado.";
    }
    return;
  }

  let cursor = new Date();
  cursor.setDate(1);
  let selectedDate = null;
  let selectedSlot = null;
  let byDay = {};

  const setStatus = (text, isError = false) => {
    if (!statusEl) return;
    statusEl.hidden = !text;
    statusEl.textContent = text || "";
    statusEl.classList.toggle("is-error", Boolean(isError));
  };

  const loadSlots = async () => {
    setStatus("Cargando horarios…");
    const { data, error } = await supabase.rpc("list_available_slots", { p_days: 45 });
    if (error) {
      setStatus("No se pudieron cargar las horas. ¿Corriste booking.sql en Supabase?", true);
      console.warn("[booking]", error);
      byDay = {};
      return;
    }
    byDay = groupSlots(data?.slots || []);
    setStatus("");
  };

  const renderMonth = () => {
    if (monthEl) monthEl.textContent = monthLabel(cursor);
    if (!gridEl) return;
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const first = new Date(year, month, 1);
    const startPad = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = [];
    for (const name of WEEKDAYS) cells.push(`<span class="booking-dow">${name}</span>`);
    for (let i = 0; i < startPad; i += 1) cells.push(`<span class="booking-day is-empty"></span>`);
    for (let day = 1; day <= daysInMonth; day += 1) {
      const key = `${year}-${pad(month + 1)}-${pad(day)}`;
      const available = byDay[key]?.length || 0;
      const isSelected = selectedDate === key;
      const disabled = available === 0;
      cells.push(
        `<button type="button" class="booking-day${disabled ? " is-disabled" : ""}${isSelected ? " is-selected" : ""}" data-day="${key}" ${disabled ? "disabled" : ""}>
          <strong>${day}</strong>
          <em>${available ? `${available} horas` : "—"}</em>
        </button>`,
      );
    }
    gridEl.innerHTML = cells.join("");
    gridEl.querySelectorAll("[data-day]").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedDate = btn.getAttribute("data-day");
        selectedSlot = null;
        if (whenInput) whenInput.value = "";
        if (whenLabel) whenLabel.textContent = "Elegí un horario";
        renderMonth();
        renderSlots();
      });
    });
  };

  const renderSlots = () => {
    if (!slotsEl) return;
    const list = selectedDate ? byDay[selectedDate] || [] : [];
    if (dayLabel) {
      dayLabel.textContent = selectedDate
        ? new Intl.DateTimeFormat("es-CL", { weekday: "long", day: "numeric", month: "long" }).format(parseISODate(selectedDate))
        : "Elegí un día con horas libres";
    }
    if (!selectedDate) {
      slotsEl.innerHTML = `<p class="booking-hint">Tocá un día del calendario para ver los horarios.</p>`;
      return;
    }
    if (!list.length) {
      slotsEl.innerHTML = `<p class="booking-hint">Ese día no tiene horas libres.</p>`;
      return;
    }
    slotsEl.innerHTML = list
      .map(
        (slot) =>
          `<button type="button" class="booking-slot${selectedSlot?.at === slot.at ? " is-selected" : ""}" data-at="${slot.at}">${slot.time}</button>`,
      )
      .join("");
    slotsEl.querySelectorAll("[data-at]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const at = btn.getAttribute("data-at");
        selectedSlot = list.find((s) => s.at === at) || { at };
        if (whenInput) whenInput.value = at;
        if (whenLabel) whenLabel.textContent = formatWhen(at);
        slotsEl.querySelectorAll(".booking-slot").forEach((el) => el.classList.toggle("is-selected", el === btn));
      });
    });
  };

  prevBtn?.addEventListener("click", () => {
    cursor.setMonth(cursor.getMonth() - 1);
    renderMonth();
  });
  nextBtn?.addEventListener("click", () => {
    cursor.setMonth(cursor.getMonth() + 1);
    renderMonth();
  });

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const scheduled = String(fd.get("scheduled_at") || selectedSlot?.at || "").trim();
    if (!scheduled) {
      setStatus("Elegí un día y un horario.", true);
      return;
    }
    const submit = form.querySelector("[type='submit']");
    if (submit) submit.disabled = true;
    setStatus("Reservando…");
    const { data, error } = await supabase.rpc("book_public_appointment", {
      p_name: String(fd.get("name") || "").trim(),
      p_phone: String(fd.get("phone") || "").trim(),
      p_scheduled_at: scheduled,
      p_email: String(fd.get("email") || "").trim() || null,
      p_pet_name: String(fd.get("pet_name") || "").trim() || null,
      p_pet_type: String(fd.get("pet_type") || "").trim() || null,
      p_service: String(fd.get("service") || "Consulta Etología Clínica").trim(),
      p_zone: String(fd.get("zone") || "").trim() || null,
      p_notes: String(fd.get("notes") || "").trim() || null,
    });
    if (submit) submit.disabled = false;
    if (error) {
      setStatus(error.message || "No se pudo reservar. Probá otra hora.", true);
      return;
    }
    form.reset();
    selectedSlot = null;
    if (whenInput) whenInput.value = "";
    await loadSlots();
    renderMonth();
    renderSlots();
    setStatus(data?.message || "Hora reservada. Confirmá con el abono de $20.000 en 12 horas.");
    import("./analytics.js")
      .then(({ trackEvent }) => trackEvent("reserva_web", "Agenda propia", { scheduled_at: scheduled }))
      .catch(() => {});
  });

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-book], [data-zone]");
    if (!el) return;
    const service = el.getAttribute("data-book");
    const zone = el.getAttribute("data-zone");
    const serviceSelect = form?.elements?.service;
    const zoneSelect = form?.elements?.zone;
    if (service && serviceSelect) {
      const match = Array.from(serviceSelect.options).find((o) => o.value === service);
      if (!match) {
        const opt = document.createElement("option");
        opt.value = service;
        opt.textContent = service;
        serviceSelect.appendChild(opt);
      }
      serviceSelect.value = service;
    }
    if (zone && zoneSelect) zoneSelect.value = zone;
  });

  await loadSlots();
  const firstDay = Object.keys(byDay).sort()[0];
  if (firstDay) {
    selectedDate = firstDay;
    cursor = parseISODate(firstDay);
    cursor.setDate(1);
  }
  renderMonth();
  renderSlots();
}
