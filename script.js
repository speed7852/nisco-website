const toggle = document.querySelector(".menu-toggle");
const nav = document.querySelector(".main-nav");
if (toggle && nav) {
  const navLinks = [...nav.querySelectorAll("a[href^='#']")].filter(link => !link.classList.contains("nav-cta"));
  const setActive = (link) => {
    navLinks.forEach(item => item.classList.toggle("active", item === link));
  };

  toggle.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
  });

  nav.querySelectorAll("a").forEach(link => link.addEventListener("click", () => {
    if (link.matches("a[href^='#']") && !link.classList.contains("nav-cta")) setActive(link);
    nav.classList.remove("open");
    toggle.setAttribute("aria-expanded", "false");
  }));

  // Keep the gold selection underline aligned with the section currently in view.
  const sectionLinks = new Map(navLinks.map(link => [link.getAttribute("href").slice(1), link]));
  const observedSections = [...sectionLinks.keys()]
    .map(id => document.getElementById(id))
    .filter(Boolean);
  if ("IntersectionObserver" in window && observedSections.length) {
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) {
        const link = sectionLinks.get(visible.target.id);
        if (link) setActive(link);
      }
    }, { rootMargin: "-25% 0px -60% 0px", threshold: [0, .15, .35] });
    observedSections.forEach(section => observer.observe(section));
  }
}
const year = document.getElementById("year");
if (year) year.textContent = new Date().getFullYear();

// Before launch, replace CONTACT_EMAIL_PLACEHOLDER in index.html with your business email.


// Subtle scroll reveals: premium, restrained, and accessible.
(() => {
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion || !("IntersectionObserver" in window)) return;

  const revealTargets = [
    [".about-section .section-copy", "left"],
    [".about-section .about-visual", "right"],
    [".section-heading", "up"],
    [".division-card", "up"],
    [".approach-section .container > div:first-child", "left"],
    [".approach-point", "right"],
    [".contact-panel > div", "left"],
    [".contact-panel > a", "right"],
    [".footer-main > div", "up"]
  ];

  document.documentElement.classList.add("js-motion-enabled");
  const elements = [];
  revealTargets.forEach(([selector, direction]) => {
    document.querySelectorAll(selector).forEach((element, index) => {
      element.classList.add("reveal");
      if (direction !== "up") element.dataset.reveal = direction;
      if (element.matches(".division-card,.approach-point")) {
        element.style.transitionDelay = (Math.min(index % 4, 3) * 90) + "ms";
      }
      elements.push(element);
    });
  });

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -45px 0px" });

  elements.forEach(element => observer.observe(element));
})();

/* Prepare an enquiry email for the visitor to review and send. */
(() => {
  const form = document.getElementById("nisco-enquiry-form");
  if (!form) return;
  const note = document.getElementById("enquiry-form-note");
  const config = window.NISCO_CONFIG || {};
  document.querySelectorAll(".package-cta[data-service]").forEach(link => link.addEventListener("click", () => {
    const select = document.getElementById("enquiry-service");
    if (select) select.value = link.dataset.service;
  }));
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const values = new FormData(form);
    const message = [
      "Hello NISCO, I would like to discuss a business requirement.",
      "Name: " + values.get("name"),
      "Business: " + (values.get("business") || "Not provided"),
      "Service: " + values.get("service"),
      "Budget: " + values.get("budget"),
      "Requirement: " + values.get("requirement"),
      "Location: Chennai, India"
    ].join("\n");
    const email = String(config.email || "nisco.in@outlook.com");
    const url = "mailto:" + email + "?subject=" + encodeURIComponent("NISCO business enquiry: " + values.get("service")) + "&body=" + encodeURIComponent(message);
    window.location.href = url;
    if (note) note.textContent = "Your email app should open with a draft enquiry. Review the details and press Send to contact NISCO."
  });
})();
