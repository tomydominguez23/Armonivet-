const header = document.querySelector("[data-header]");
const navToggle = document.querySelector("[data-nav-toggle]");
const mobileNav = document.querySelector("[data-mobile-nav]");
const yearEl = document.querySelector("[data-year]");

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

