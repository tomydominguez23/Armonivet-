import "./style.css";

const header = document.querySelector("[data-header]");
const navToggle = document.querySelector("[data-nav-toggle]");
const mobileNav = document.querySelector("[data-mobile-nav]");
const yearEl = document.querySelector("[data-year]");

if (yearEl) {
  yearEl.textContent = String(new Date().getFullYear());
}

const setHeaderState = () => {
  if (!header) return;
  header.classList.toggle("is-scrolled", window.scrollY > 12);
};

setHeaderState();
window.addEventListener("scroll", setHeaderState, { passive: true });

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

const reviews = Array.from(document.querySelectorAll("[data-reviews] .review"));
const prevBtn = document.querySelector("[data-review-prev]");
const nextBtn = document.querySelector("[data-review-next]");
let reviewIndex = reviews.findIndex((r) => r.classList.contains("is-active"));
if (reviewIndex < 0) reviewIndex = 0;

const showReview = (index) => {
  if (!reviews.length) return;
  reviews.forEach((review, i) => {
    review.classList.toggle("is-active", i === index);
  });
  reviewIndex = index;
};

prevBtn?.addEventListener("click", () => {
  const next = (reviewIndex - 1 + reviews.length) % reviews.length;
  showReview(next);
});

nextBtn?.addEventListener("click", () => {
  const next = (reviewIndex + 1) % reviews.length;
  showReview(next);
});

if (reviews.length > 1) {
  window.setInterval(() => {
    showReview((reviewIndex + 1) % reviews.length);
  }, 7000);
}
