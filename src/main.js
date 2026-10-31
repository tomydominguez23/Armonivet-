/* Core UI first — without Supabase imports so the page works on static hosting */
const header = document.querySelector("[data-header]");
const navToggle = document.querySelector("[data-nav-toggle]");
const mobileNav = document.querySelector("[data-mobile-nav]");
const yearEl = document.querySelector("[data-year]");

document.documentElement.classList.add("js");

if (yearEl) {
  yearEl.textContent = String(new Date().getFullYear());
}

function closeMobileNav() {
  if (!header || !navToggle || !mobileNav) return;
  header.classList.remove("is-open");
  navToggle.setAttribute("aria-expanded", "false");
  mobileNav.hidden = true;
}

function headerOffset() {
  return Math.round((header?.getBoundingClientRect().height || 72) + 12);
}

function scrollToId(id) {
  const el = document.getElementById(id);
  if (!el) return false;
  const top = el.getBoundingClientRect().top + window.scrollY - headerOffset();
  window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  return true;
}

function hashTarget(hash) {
  const raw = String(hash || "").replace(/^#/, "");
  if (!raw || raw.includes("=")) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function gotoHash(hash, { push = true } = {}) {
  const id = hashTarget(hash);
  if (!id) return false;
  closeMobileNav();
  if (push && location.hash !== `#${id}`) {
    history.pushState(null, "", `#${id}`);
  }
  window.setTimeout(() => scrollToId(id), 60);
  return Boolean(document.getElementById(id));
}

if (navToggle && header && mobileNav) {
  navToggle.addEventListener("click", () => {
    const open = header.classList.toggle("is-open");
    navToggle.setAttribute("aria-expanded", String(open));
    mobileNav.hidden = !open;
  });
}

document.addEventListener("click", (e) => {
  const link = e.target.closest("a[href]");
  if (!link || link.target === "_blank" || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  let url;
  try {
    url = new URL(link.href, window.location.href);
  } catch {
    return;
  }
  if (url.origin !== window.location.origin) return;
  const here = window.location.pathname.replace(/\/index\.html$/i, "/");
  const there = url.pathname.replace(/\/index\.html$/i, "/");
  if (here !== there) {
    closeMobileNav();
    return;
  }
  const id = hashTarget(url.hash);
  if (!id || !document.getElementById(id)) return;
  e.preventDefault();
  gotoHash(url.hash);
});

document.querySelectorAll(".search-bar").forEach((form) => {
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const dest = form.getAttribute("action") || "#agendar";
    if (dest.startsWith("#") && document.getElementById(hashTarget(dest))) {
      gotoHash(dest);
      return;
    }
    window.location.href = dest.startsWith("#") ? `./index.html${dest}` : dest;
  });
});

window.addEventListener("armonivet:goto", (e) => {
  const hash = e.detail?.hash || "#agendar";
  if (!gotoHash(hash)) {
    window.location.href = hash.startsWith("#") ? `./index.html${hash}` : hash;
  }
});

window.addEventListener("load", () => {
  const id = hashTarget(window.location.hash);
  if (id && document.getElementById(id)) {
    window.setTimeout(() => scrollToId(id), 80);
  }
});

const revealEls = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.16, rootMargin: "0px 0px -8% 0px" }
  );
  revealEls.forEach((el) => observer.observe(el));
} else {
  revealEls.forEach((el) => el.classList.add("is-visible"));
}

/* Hero carousel */
const heroSlides = Array.from(document.querySelectorAll("[data-hero-slide]"));
const heroPrev = document.querySelector("[data-hero-prev]");
const heroNext = document.querySelector("[data-hero-next]");
const heroDots = document.querySelector("[data-hero-dots]");
let heroIndex = heroSlides.findIndex((slide) => slide.classList.contains("is-active"));
if (heroIndex < 0) heroIndex = 0;
let heroTimer;

const renderHeroDots = () => {
  if (!heroDots) return;
  heroDots.innerHTML = "";
  heroSlides.forEach((_, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("aria-label", `Ir al slide ${i + 1}`);
    btn.classList.toggle("is-active", i === heroIndex);
    btn.addEventListener("click", () => showHero(i));
    heroDots.appendChild(btn);
  });
};

const showHero = (index) => {
  if (!heroSlides.length) return;
  heroSlides.forEach((slide, i) => {
    slide.classList.toggle("is-active", i === index);
  });
  heroIndex = index;
  renderHeroDots();
  restartHeroTimer();
};

const restartHeroTimer = () => {
  window.clearInterval(heroTimer);
  if (heroSlides.length > 1) {
    heroTimer = window.setInterval(() => {
      showHero((heroIndex + 1) % heroSlides.length);
    }, 6500);
  }
};

heroPrev?.addEventListener("click", () => {
  showHero((heroIndex - 1 + heroSlides.length) % heroSlides.length);
});

heroNext?.addEventListener("click", () => {
  showHero((heroIndex + 1) % heroSlides.length);
});

if (heroSlides.length) {
  renderHeroDots();
  restartHeroTimer();
}

/* Planes carousel: 2 cards on desktop, 1 on mobile */
const packageCarousel = document.querySelector("[data-package-carousel]");
const packageTrack = document.querySelector("[data-package-track]");
const packagePrev = document.querySelector("[data-package-prev]");
const packageNext = document.querySelector("[data-package-next]");
const packageCards = () => Array.from(packageTrack?.children || []);
let packageIndex = 0;

const packagePerView = () => (window.matchMedia("(max-width: 720px)").matches ? 1 : 2);

const renderPackageCarousel = () => {
  if (!packageTrack) return;
  const cards = packageCards();
  const perView = packagePerView();
  const maxIndex = Math.max(0, cards.length - perView);
  packageIndex = Math.min(packageIndex, maxIndex);
  const card = cards[0];
  const gap = parseFloat(getComputedStyle(packageTrack).gap) || 12;
  const step = card ? card.getBoundingClientRect().width + gap : 0;
  packageTrack.style.transform = `translateX(${-packageIndex * step}px)`;
  if (packagePrev) packagePrev.disabled = packageIndex <= 0;
  if (packageNext) packageNext.disabled = packageIndex >= maxIndex;
};

packagePrev?.addEventListener("click", () => {
  packageIndex -= 1;
  renderPackageCarousel();
});

packageNext?.addEventListener("click", () => {
  packageIndex += 1;
  renderPackageCarousel();
});

if (packageCarousel && packageTrack) {
  renderPackageCarousel();
  window.addEventListener("resize", renderPackageCarousel);
}

/* Servicios de portada: 3 tarjetas en escritorio, el resto con las flechas */
const offerCarousel = document.querySelector("[data-offer-carousel]");
const offerTrack = document.querySelector("[data-offers-grid]");
const offerPrev = document.querySelector("[data-offer-prev]");
const offerNext = document.querySelector("[data-offer-next]");
const offerCards = () => Array.from(offerTrack?.querySelectorAll(":scope > .offer-card") || []);
let offerIndex = 0;

const offerPerView = () => {
  if (window.matchMedia("(max-width: 720px)").matches) return 1;
  if (window.matchMedia("(max-width: 980px)").matches) return 2;
  return 3;
};

const OFFER_AUTOPLAY_MS = 10000;
let offerTimer = 0;
let offerHovering = false;

const offerMaxIndex = () => {
  const cards = offerCards();
  const perView = Math.min(offerPerView(), Math.max(cards.length, 1));
  return Math.max(0, cards.length - perView);
};

const renderOfferCarousel = () => {
  if (!offerTrack) return;
  const cards = offerCards();
  const perView = Math.min(offerPerView(), Math.max(cards.length, 1));
  const maxIndex = Math.max(0, cards.length - perView);
  offerIndex = Math.min(Math.max(0, offerIndex), maxIndex);
  const card = cards[0];
  const gap = parseFloat(getComputedStyle(offerTrack).columnGap || getComputedStyle(offerTrack).gap) || 16;
  const step = card ? card.getBoundingClientRect().width + gap : 0;
  offerTrack.style.transform = offerIndex && step ? `translateX(${-offerIndex * step}px)` : "";
  if (offerPrev) offerPrev.disabled = offerIndex <= 0;
  if (offerNext) offerNext.disabled = offerIndex >= maxIndex;
};

const stopOfferAutoplay = () => {
  window.clearInterval(offerTimer);
  offerTimer = 0;
};

const startOfferAutoplay = () => {
  stopOfferAutoplay();
  if (!offerCarousel || !offerTrack) return;
  if (offerHovering || document.hidden) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (offerMaxIndex() <= 0) return;
  offerTimer = window.setInterval(() => {
    const maxIndex = offerMaxIndex();
    if (maxIndex <= 0 || document.hidden) return;
    const wrap = offerIndex >= maxIndex;
    if (wrap) {
      offerIndex = 0;
      offerTrack.style.transition = "none";
    } else {
      offerIndex += 1;
    }
    renderOfferCarousel();
    if (wrap) {
      offerTrack.getBoundingClientRect();
      offerTrack.style.transition = "";
    }
  }, OFFER_AUTOPLAY_MS);
};

offerPrev?.addEventListener("click", () => {
  offerIndex -= 1;
  renderOfferCarousel();
  startOfferAutoplay();
});

offerNext?.addEventListener("click", () => {
  offerIndex += 1;
  renderOfferCarousel();
  startOfferAutoplay();
});

if (offerCarousel && offerTrack) {
  renderOfferCarousel();
  startOfferAutoplay();
  window.addEventListener("resize", () => {
    renderOfferCarousel();
    startOfferAutoplay();
  });
  offerCarousel.addEventListener("mouseenter", () => {
    offerHovering = true;
    stopOfferAutoplay();
  });
  offerCarousel.addEventListener("mouseleave", () => {
    offerHovering = false;
    startOfferAutoplay();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopOfferAutoplay();
    else startOfferAutoplay();
  });
  offerTrack.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (event.target.closest("a, button, select, input, textarea, label")) return;
    offerTrack.dataset.dragX = String(event.clientX);
    stopOfferAutoplay();
  });
  document.addEventListener("pointerup", (event) => {
    if (!offerTrack.dataset.dragX) return;
    const start = Number(offerTrack.dataset.dragX);
    delete offerTrack.dataset.dragX;
    if (!Number.isFinite(start)) return;
    const delta = event.clientX - start;
    if (Math.abs(delta) >= 48) {
      offerIndex += delta < 0 ? 1 : -1;
      renderOfferCarousel();
    }
    startOfferAutoplay();
  });
  window.addEventListener("load", () => {
    renderOfferCarousel();
    startOfferAutoplay();
  });
}

/* Reel inside phone: reveal Instagram embed when ready */
const phoneFrame = document.querySelector(".phone-frame");
const reelLaunch = document.querySelector("[data-reel-launch]");
const igEmbed = document.querySelector("[data-ig-embed]");
const reelCover = document.querySelector("[data-reel-cover]");

const showPhoneReel = () => {
  phoneFrame?.classList.add("is-playing");
};

reelLaunch?.addEventListener("click", () => {
  showPhoneReel();
});

igEmbed?.addEventListener("load", () => {
  window.setTimeout(showPhoneReel, 400);
});

reelCover?.addEventListener("error", () => {
  showPhoneReel();
});

window.setTimeout(showPhoneReel, 2800);

/* Analytics + CMS: carga diferida para no romper la UI si falla el bundling */
import("./lib/analytics.js")
  .then(({ trackPageVisit, bindConversionTracking }) => {
    trackPageVisit();
    bindConversionTracking();
    return import("./lib/content.js").then(({ hydrateSiteContent }) =>
      hydrateSiteContent().then(() => {
        bindConversionTracking();
        renderPackageCarousel();
        renderOfferCarousel();
        startOfferAutoplay();
      })
    );
  })
  .catch((err) => console.warn("[supabase-init]", err));

import("./lib/booking.js")
  .then(({ initBooking }) => initBooking())
  .catch((err) => console.warn("[booking]", err));

import("./lib/cart.js")
  .then(({ initCart }) => initCart())
  .catch((err) => console.warn("[cart]", err));

import("./lib/checkout.js")
  .then(({ initCheckoutUi }) => initCheckoutUi())
  .catch((err) => console.warn("[checkout]", err));

/* Chat Genesis: reemplaza el botón WhatsApp con el widget de pre-consulta */
import("./lib/genesis-chat.js")
  .then(({ default: initGenesisChat }) => initGenesisChat())
  .catch((err) => console.warn("[genesis-chat]", err));
