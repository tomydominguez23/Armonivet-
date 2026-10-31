import { isSupabaseConfigured, supabase } from "./supabase.js";
import { applyZoneToCart, cartTotal, formatCLP, getCart, quoteAmount, serviceMode } from "./cart.js";

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

function normalizePhone(raw) {
  let digits = String(raw || "").replace(/\D/g, "");
  if (digits.startsWith("0")) digits = digits.replace(/^0+/, "");
  if (digits.startsWith("56") && digits.length >= 10) return digits;
  if (digits.startsWith("9") && digits.length === 9) return `56${digits}`;
  return digits;
}

function chilean(text) {
  return String(text || "")
    .replace(/\bElegí\b/g, "Elige")
    .replace(/\bEscribí\b/g, "Escribe")
    .replace(/\bProbá\b/g, "Prueba")
    .replace(/\bPodés\b/g, "Puedes")
    .replace(/\bpodés\b/g, "puedes")
    .replace(/\bTocá\b/g, "Toca")
    .replace(/\bPagá\b/g, "Paga")
    .replace(/\bpagá\b/g, "paga")
    .replace(/\bConfirmá\b/g, "Confirma")
    .replace(/\bCompletá\b/g, "Completa")
    .replace(/\bcerrás\b/g, "cierras");
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

export function bookingModeFromService(service, zone) {
  return serviceMode(service, zone);
}

function applyBookTarget(form, el) {
  if (!form || !el) return;
  const service = el.getAttribute("data-book");
  const zone = el.getAttribute("data-zone");
  const serviceSelect = form.elements?.service;
  const zoneSelect = form.elements?.zone;
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
  form.dispatchEvent(new CustomEvent("armonivet:book-target", { bubbles: true }));
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
  const payEl = root.querySelector("[data-booking-pay]");
  const payMsg = root.querySelector("[data-booking-pay-msg]");
  const modeBar = root.querySelector("[data-booking-mode]");

  let allSlots = [];
  let calendarConfig = null;
  let activeMode = "presencial";
  let lastSector = "Sector A";
  let cursor = new Date();
  cursor.setDate(1);
  let selectedDate = null;
  let selectedSlot = null;
  let byDay = {};

  const modeConfig = (mode) => calendarConfig?.[mode] || null;
  const modeEnabled = (mode) => {
    const cfg = modeConfig(mode);
    return !cfg || cfg.enabled !== false;
  };
  const applyCalendarPrefs = () => {
    modeBar?.querySelectorAll("[data-mode]").forEach((btn) => {
      const mode = btn.getAttribute("data-mode");
      const cfg = modeConfig(mode);
      btn.hidden = Boolean(cfg && cfg.enabled === false);
      if (cfg?.name) btn.textContent = cfg.name;
    });
    const cfg = modeConfig(activeMode);
    const meta = root.querySelector("[data-booking-meta]");
    if (meta) {
      const bits = [];
      if (cfg?.duration_minutes) bits.push(`${cfg.duration_minutes} min`);
      if (cfg?.location) bits.push(cfg.location);
      meta.hidden = bits.length === 0;
      meta.textContent = bits.join(" · ");
    }
  };

  const syncModeUi = () => {
    applyCalendarPrefs();
    modeBar?.querySelectorAll("[data-mode]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-mode") === activeMode);
    });
    if (form?.elements?.zone && activeMode === "online" && !form.elements.zone.value) {
      form.elements.zone.value = "Online";
    }
  };

  const setMode = (mode, { fromService = false } = {}) => {
    const next = mode === "online" ? "online" : "presencial";
    if (!modeEnabled(next)) {
      if (statusEl) {
        statusEl.hidden = false;
        statusEl.textContent = `La modalidad ${next === "online" ? "online" : "presencial"} no está abierta para reservar.`;
        statusEl.classList.add("is-error");
      }
      if (modeEnabled(activeMode)) {
        syncModeUi();
        return;
      }
      activeMode = modeEnabled("presencial") ? "presencial" : "online";
    } else {
      activeMode = next;
      if (statusEl?.textContent?.includes("no está abierta")) {
        statusEl.hidden = true;
        statusEl.textContent = "";
        statusEl.classList.remove("is-error");
      }
    }
    syncModeUi();
    if (!fromService && form?.elements?.service) {
      const current = String(form.elements.service.value || "");
      const matches = bookingModeFromService(current, form.elements.zone?.value) === activeMode;
      if (!matches) {
        form.elements.service.value = activeMode === "online" ? "Consulta remota" : "Consulta presencial";
        if (form.elements.zone) {
          form.elements.zone.value =
            activeMode === "online"
              ? "Online"
              : form.elements.zone.value && form.elements.zone.value !== "Online"
                ? form.elements.zone.value
                : lastSector;
        }
      }
    }
    byDay = groupSlots(slotsForModes(relevantModes()));
    selectedSlot = null;
    if (whenInput) whenInput.value = "";
    if (whenLabel) whenLabel.textContent = "Elige un horario";
    const firstDay = Object.keys(byDay).sort()[0];
    if (firstDay) {
      selectedDate = firstDay;
      cursor = parseISODate(firstDay);
      cursor.setDate(1);
    }
    renderMonth();
    renderSlots();
  };

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-book], [data-zone]");
    if (!el || e.target.closest("[data-add]")) return;
    applyBookTarget(form, el);
  });

  const paintMonth = (byDayMap = {}) => {
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
      const available = byDayMap[key]?.length || 0;
      const isSelected = selectedDate === key;
      const isToday = key === dateKey(new Date());
      const disabled = available === 0;
      cells.push(
        `<button type="button" class="booking-day${disabled ? " is-disabled" : ""}${isSelected ? " is-selected" : ""}${isToday ? " is-today" : ""}" data-day="${key}" ${disabled ? "disabled" : ""}>
          <strong>${day}</strong>
          ${available ? `<em class="booking-dot" aria-label="${available} horas"></em>` : `<em class="booking-dot" hidden></em>`}
        </button>`,
      );
    }
    gridEl.innerHTML = cells.join("");
  };

  paintMonth();

  const calendarOffline = !isSupabaseConfigured || !supabase;
  if (calendarOffline && statusEl) {
    statusEl.hidden = false;
    statusEl.textContent = "El calendario se activa cuando Supabase está configurado.";
  }

  const setStatus = (text, isError = false) => {
    if (!statusEl) return;
    statusEl.hidden = !text;
    statusEl.textContent = chilean(text);
    statusEl.classList.toggle("is-error", Boolean(isError));
  };

  const loadCalendarPrefs = async () => {
    if (calendarOffline || !supabase) return;
    const { data, error } = await supabase.from("site_settings").select("value").eq("key", "calendar").maybeSingle();
    if (error) {
      console.warn("[booking] calendar", error);
      return;
    }
    calendarConfig = data?.value || null;
  };

  const loadSlots = async () => {
    if (calendarOffline || !supabase) {
      allSlots = [];
      byDay = {};
      return;
    }
    setStatus("Cargando horarios…");
    let data = null;
    let error = null;
    const horizon = Math.min(180, Math.max(1, Number(calendarConfig?.window_days) || 60));
    ({ data, error } = await supabase.rpc("list_available_slots", { p_days: horizon, p_mode: null }));
    if (error) {
      ({ data, error } = await supabase.rpc("list_available_slots", { p_days: horizon }));
    }
    if (error) {
      setStatus("No se pudieron cargar las horas. ¿Corriste booking.sql y booking_modes.sql en Supabase?", true);
      console.warn("[booking]", error);
      allSlots = [];
      byDay = {};
      return;
    }
    allSlots = data?.slots || [];
    byDay = groupSlots(slotsForModes(relevantModes()));
    setStatus("");
  };

  const relevantModes = () => {
    const fromCart = [...new Set(getCart().map((item) => serviceMode(item.book, item.zone)))];
    if (fromCart.length > 1) return fromCart;
    return [activeMode];
  };

  const slotsForModes = (modes) => {
    const wanted = new Set(modes);
    return (allSlots || []).filter((slot) => !slot.mode || wanted.has(slot.mode));
  };

  const serviceForMode = (mode) => getCart().find((item) => serviceMode(item.book, item.zone) === mode);

  const refreshBookingZonePrices = () => {
    const select = form?.elements?.zone;
    const service = String(form?.elements?.service?.value || "");
    if (!select) return;
    Array.from(select.options).forEach((option) => {
      const zone = option.value;
      if (!zone) return;
      const amount = quoteAmount(service, zone);
      if (!amount) return;
      option.setAttribute("data-price", String(amount));
      const communes = option.getAttribute("data-communes") || "";
      const short = communes.length > 52 ? `${communes.slice(0, 50)}…` : communes;
      option.textContent = `${zone} · ${formatCLP(amount)}${short ? ` · ${short}` : ""}`;
    });
  };

  const updateZoneHelp = () => {
    const help = form?.querySelector("[data-zone-help]");
    const zone = String(form?.elements?.zone?.value || "");
    const service = String(form?.elements?.service?.value || "");
    if (!help) return;
    refreshBookingZonePrices();
    const option = form?.elements?.zone?.selectedOptions?.[0];
    const communes = option?.getAttribute("data-communes") || "";
    const amount = quoteAmount(service, zone);
    if (!zone) {
      help.textContent = "Al elegir la zona ves el valor y las comunas que abarca. Ese valor es el que se cobra.";
      return;
    }
    if (!amount) {
      help.textContent = communes
        ? `${communes}. Este servicio no cambia de precio por zona.`
        : "Este servicio no cambia de precio por zona.";
      return;
    }
    help.textContent = [formatCLP(amount), communes].filter(Boolean).join(". ");
  };

  const alignFormToMode = (mode) => {
    const item = serviceForMode(mode);
    if (item?.book && form?.elements?.service) {
      const select = form.elements.service;
      const match = Array.from(select.options).find((option) => option.value === item.book);
      if (!match) {
        const opt = document.createElement("option");
        opt.value = item.book;
        opt.textContent = item.book;
        select.appendChild(opt);
      }
      select.value = item.book;
    }
    if (form?.elements?.zone) {
      if (mode === "online") form.elements.zone.value = item?.zone || "Online";
      else if (item?.zone) form.elements.zone.value = item.zone;
    }
    activeMode = mode;
    syncModeUi();
    updateZoneHelp();
  };

  const renderMonth = () => {
    paintMonth(byDay);
    gridEl?.querySelectorAll("[data-day]").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedDate = btn.getAttribute("data-day");
        selectedSlot = null;
        if (whenInput) whenInput.value = "";
        if (whenLabel) whenLabel.textContent = "Elige un horario";
        renderMonth();
        renderSlots();
      });
    });
  };

  const renderSlots = () => {
    if (!slotsEl) return;
    const modes = relevantModes();
    const mixed = modes.length > 1;
    const list = selectedDate ? byDay[selectedDate] || [] : [];
    if (dayLabel) {
      const modeLabel = mixed ? "presencial y online" : activeMode === "online" ? "online" : "presencial";
      dayLabel.textContent = selectedDate
        ? `${new Intl.DateTimeFormat("es-CL", { weekday: "long", day: "numeric", month: "long" }).format(parseISODate(selectedDate))} · ${modeLabel}`
        : `Elige un día con horas ${modeLabel}`;
    }
    if (!selectedDate) {
      slotsEl.innerHTML = `<p class="booking-hint">Toca un día del calendario para ver los horarios.</p>`;
      return;
    }
    if (!list.length) {
      slotsEl.innerHTML = `<p class="booking-hint">Ese día no tiene horas libres.</p>`;
      return;
    }
    const slotButton = (slot, mode) =>
      `<button type="button" class="booking-slot${selectedSlot?.at === slot.at && (selectedSlot?.mode || activeMode) === mode ? " is-selected" : ""}" data-at="${slot.at}" data-slot-mode="${mode}">${slot.time}</button>`;
    if (!mixed) {
      slotsEl.innerHTML = list.map((slot) => slotButton(slot, slot.mode || activeMode)).join("");
    } else {
      slotsEl.innerHTML = `<div class="booking-slot-groups">${modes
        .map((mode) => {
          const rows = list.filter((slot) => slot.mode === mode);
          const item = serviceForMode(mode);
          const title = item?.title || (mode === "online" ? "Online" : "Presencial");
          const safeTitle = String(title).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
          const buttons = rows.length
            ? rows.map((slot) => slotButton(slot, mode)).join("")
            : `<p class="booking-hint">Sin horas ${mode === "online" ? "online" : "presenciales"} este día.</p>`;
          return `<div class="booking-slot-group"><h4>${safeTitle} · Horario ${mode === "online" ? "online" : "presencial"}</h4><div class="booking-slot-row">${buttons}</div></div>`;
        })
        .join("")}</div>`;
    }
    slotsEl.querySelectorAll("[data-at]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const at = btn.getAttribute("data-at");
        const mode = btn.getAttribute("data-slot-mode") || activeMode;
        selectedSlot = list.find((slot) => slot.at === at && (!slot.mode || slot.mode === mode)) || { at, mode };
        selectedSlot.mode = mode;
        if (whenInput) whenInput.value = at;
        alignFormToMode(mode);
        const duration = modeConfig(mode)?.duration_minutes;
        const label = mode === "online" ? "online" : "presencial";
        if (whenLabel) whenLabel.textContent = `${formatWhen(at)} · ${label}${duration ? ` · ${duration} min` : ""}`;
        slotsEl.querySelectorAll(".booking-slot").forEach((el) => el.classList.toggle("is-selected", el === btn));
      });
    });
  };

  const syncServiceZone = (event) => {
    let service = String(form?.elements?.service?.value || "");
    let zone = String(form?.elements?.zone?.value || "");
    if (zone && zone !== "Online") lastSector = zone;
    const pickedOnline = event?.target === form?.elements?.zone && zone === "Online";
    if (serviceMode(service, "") === "online") {
      zone = "Online";
      if (form?.elements?.zone && form.elements.zone.value !== "Online") form.elements.zone.value = "Online";
    } else if (pickedOnline) {
      service = /control/i.test(service) ? "Control remoto" : "Consulta remota";
      if (form?.elements?.service) form.elements.service.value = service;
      zone = "Online";
    } else if (zone === "Online") {
      zone = lastSector;
      if (form?.elements?.zone) form.elements.zone.value = lastSector;
    }
    const mode = serviceMode(form?.elements?.service?.value || service, form?.elements?.zone?.value || zone);
    setMode(mode, { fromService: true });
    applyZoneToCart(form?.elements?.service?.value || service, form?.elements?.zone?.value || zone);
    updateZoneHelp();
  };

  form?.addEventListener("armonivet:book-target", () => {
    syncServiceZone();
    byDay = groupSlots(slotsForModes(relevantModes()));
    renderMonth();
    renderSlots();
  });
  form?.elements?.service?.addEventListener("change", syncServiceZone);
  form?.elements?.zone?.addEventListener("change", syncServiceZone);
  modeBar?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-mode]");
    if (!btn) return;
    setMode(btn.getAttribute("data-mode"));
  });
  window.addEventListener("armonivet:zones", () => updateZoneHelp());
  window.addEventListener("armonivet:cart", () => {
    const modes = relevantModes();
    if (modes.length === 1 && modes[0] !== activeMode) {
      const item = serviceForMode(modes[0]);
      if (item?.book && form?.elements?.service) form.elements.service.value = item.book;
      if (form?.elements?.zone) {
        form.elements.zone.value = modes[0] === "online" ? "Online" : item?.zone && item.zone !== "Online" ? item.zone : form.elements.zone.value || lastSector;
      }
      setMode(modes[0], { fromService: true });
      updateZoneHelp();
      return;
    }
    byDay = groupSlots(slotsForModes(modes));
    renderMonth();
    renderSlots();
  });

  prevBtn?.addEventListener("click", () => {
    cursor.setMonth(cursor.getMonth() - 1);
    renderMonth();
  });
  nextBtn?.addEventListener("click", () => {
    cursor.setMonth(cursor.getMonth() + 1);
    renderMonth();
  });

  window.addEventListener("armonivet:hold-released", () => {
    if (payEl) payEl.hidden = true;
    form?.removeAttribute("hidden");
    setStatus("La hora se liberó porque el pago no se completó. Puedes elegir otro horario.", true);
    loadSlots()
      .then(() => {
        renderMonth();
        renderSlots();
      })
      .catch(() => {});
  });

  if (!calendarOffline) form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const scheduled = String(fd.get("scheduled_at") || selectedSlot?.at || "").trim();
    if (!scheduled) {
      setStatus("Elige un día y un horario.", true);
      return;
    }
    const phone = normalizePhone(fd.get("phone"));
    if (phone.length < 8) {
      setStatus("Escribe un WhatsApp válido. Ej: +56 9 1234 5678", true);
      return;
    }
    const service = String(fd.get("service") || "Consulta Etología Clínica").trim();
    const zone = String(fd.get("zone") || "").trim();
    const address = String(fd.get("address") || "").trim();
    if (bookingModeFromService(service, zone) === "presencial" && !address) {
      setStatus("Escribe la dirección de la visita (calle, número, depto).", true);
      return;
    }
    const submit = form.querySelector("[type='submit']");
    if (submit) submit.disabled = true;
    setStatus("Reservando…");
    const { rememberHold } = await import("./checkout.js");
    const name = String(fd.get("name") || "").trim();
    const email = String(fd.get("email") || "").trim();
    const petName = String(fd.get("pet_name") || "").trim();
    const petType = String(fd.get("pet_type") || "").trim();
    const notesRaw = String(fd.get("notes") || "").trim();
    const notes = [address ? `Dirección: ${address}` : "", notesRaw].filter(Boolean).join(" · ") || null;
    applyZoneToCart(service, zone);
    const quoted = Math.round(Number(cartTotal(getCart()) || quoteAmount(service, zone) || 0));
    const payload = {
      p_name: name,
      p_phone: phone,
      p_scheduled_at: scheduled,
      p_email: email || null,
      p_pet_name: petName || null,
      p_pet_type: String(fd.get("pet_type") || "").trim() || null,
      p_service: service,
      p_zone: zone || null,
      p_notes: notes,
      p_address: address || null,
    };
    let { data, error } = await supabase.rpc("book_public_appointment", {
      ...payload,
      p_amount: quoted >= 1000 ? quoted : null,
    });
    if (error && /p_address|p_amount|schema cache|PGRST202|could not find the function/i.test(error.message || "")) {
      const { p_address: _omit, ...withoutAddress } = payload;
      ({ data, error } = await supabase.rpc("book_public_appointment", {
        ...withoutAddress,
        ...(quoted >= 1000 ? { p_amount: quoted } : {}),
      }));
      if (error && /p_amount|schema cache|PGRST202|could not find the function/i.test(error.message || "")) {
        ({ data, error } = await supabase.rpc("book_public_appointment", withoutAddress));
      }
    }
    if (submit) submit.disabled = false;
    if (error) {
      setStatus(error.message || "No se pudo reservar. Prueba otra hora.", true);
      return;
    }
    const amount = Math.round(Number(data?.amount || quoted || 0));
    rememberHold({
      appointmentId: data?.appointment_id,
      name,
      phone,
      email,
      title: service,
      pet: petName,
      petType,
      when: scheduled,
      amount,
    });
    form.reset();
    selectedSlot = null;
    if (whenInput) whenInput.value = "";
    await loadSlots();
    renderMonth();
    renderSlots();
    const holdNote = "Te guardamos la hora por 20 minutos. Si el pago no se completa, el horario se libera.";
    const base =
      String(data?.message || "").trim() ||
      String(calendarConfig?.confirmation_message || "").trim() ||
      holdNote;
    const okMsg = chilean(`${base.includes("20 minutos") ? base : `${base} ${holdNote}`}${amount >= 1000 ? ` Total: ${formatCLP(amount)}.` : ""}`);
    setStatus(okMsg);
    if (payMsg) payMsg.textContent = okMsg;
    if (payEl) {
      payEl.hidden = false;
      form?.setAttribute("hidden", "");
      payEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    const payNow = root.querySelector("[data-pay-now]");
    const runPay = async () => {
      if (payNow) payNow.disabled = true;
      setStatus("Abriendo el pago…");
      const { startCheckout } = await import("./checkout.js");
      const pay = await startCheckout({
        appointmentId: data?.appointment_id,
        name,
        email,
        title: service,
        amount: amount >= 1000 ? amount : undefined,
        when: scheduled,
        phone,
        pet: petName,
        petType,
      });
      if (payNow) payNow.disabled = false;
      if (pay.redirected || pay.brick) return;
      if (!pay.ok) {
        setStatus(`${pay.error || "No se pudo iniciar el pago."} La hora sigue reservada: puedes intentar otra vez.`, true);
        return;
      }
      setStatus(pay.message || "Pago registrado. Te confirmamos cuando se acredite.");
    };
    if (payNow) payNow.onclick = () => {
      runPay().catch((err) => setStatus(err?.message || "No se pudo iniciar el pago.", true));
    };
    import("./analytics.js")
      .then(({ trackEvent }) => trackEvent("reserva_web", "Agenda propia", { scheduled_at: scheduled }))
      .catch(() => {});
  });

  if (calendarOffline) {
    updateZoneHelp();
    syncModeUi();
    return;
  }

  await loadCalendarPrefs();
  activeMode = bookingModeFromService(form?.elements?.service?.value, form?.elements?.zone?.value);
  if (!modeEnabled(activeMode)) activeMode = modeEnabled("presencial") ? "presencial" : "online";
  await loadSlots();
  byDay = groupSlots(slotsForModes(relevantModes()));
  syncModeUi();
  updateZoneHelp();
  if (calendarConfig && !modeEnabled("online") && !modeEnabled("presencial")) {
    setStatus("La agenda no está recibiendo reservas en este momento.", true);
  }
  const firstDay = Object.keys(byDay).sort()[0];
  if (firstDay) {
    selectedDate = firstDay;
    cursor = parseISODate(firstDay);
    cursor.setDate(1);
  }
  renderMonth();
  renderSlots();

  const paid = new URLSearchParams(window.location.search).get("pago") || (window.location.hash.includes("pago=") ? window.location.hash.split("pago=")[1] : "");
  if (paid === "ok") {
    if (payEl) payEl.hidden = false;
    setStatus("Pago recibido. Tu hora quedó confirmada.");
    import("./cart.js").then(({ clearCart }) => clearCart()).catch(() => {});
  } else if (paid === "error") {
    setStatus("El pago no se completó. Esa hora volvió a quedar libre. Puedes elegir otro horario.", true);
  }
}
