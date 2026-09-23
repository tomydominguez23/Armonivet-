/* Core UI first — without Supabase imports so the page works on static hosting */
const header = document.querySelector("[data-header]");
const navToggle = document.querySelector("[data-nav-toggle]");
const mobileNav = document.querySelector("[data-mobile-nav]");
const yearEl = document.querySelector("[data-year]");

document.documentElement.classList.add("js");

if (yearEl) {
  yearEl.textContent = String(new Date().getFullYear());
}

if (navToggle && header && mobileNav) {
  navToggle.addEventListener("click", () => {
    const open = header.classList.toggle("is-open");
    navToggle.setAttribute("aria-expanded", String(open));
    mobileNav.hidden = !open;
  });

  mobileNav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      header.classList.remove("is-open");
      navToggle.setAttribute("aria-expanded", "false");
      mobileNav.hidden = true;
    });
  });
}

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
      })
    );
  })
  .catch((err) => console.warn("[supabase-init]", err));

import("./lib/booking.js")
  .then(({ initBooking }) => initBooking())
  .catch((err) => console.warn("[booking]", err));

/* Chat Genesis: reemplaza el botón WhatsApp con el widget de pre-consulta */
import("./lib/genesis-chat.js")
  .then(({ default: initGenesisChat }) => initGenesisChat())
  .catch((err) => console.warn("[genesis-chat]", err));
