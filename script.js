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

// Subtle scroll reveals: premium, restrained, and accessible.
(() => {
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion || !("IntersectionObserver" in window)) return;

  const revealTargets = [
    [".services-intro", "left"],
    [".service-card", "up"],
    [".why-image", "left"],
    [".why-copy", "right"],
    [".proof-grid > div", "up"],
    [".work-heading", "left"],
    [".work-card", "up"],
    [".insights-inner > div", "up"],
    [".consultation-copy", "left"],
    [".enquiry-form", "right"],
    [".footer-main > div", "up"]
  ];

  document.documentElement.classList.add("js-motion-enabled");
  const elements = [];
  revealTargets.forEach(([selector, direction]) => {
    document.querySelectorAll(selector).forEach((element, index) => {
      element.classList.add("reveal");
      if (direction !== "up") element.dataset.reveal = direction;
      if (element.matches(".service-card,.work-card,.proof-grid > div")) {
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

/* Submit consultation enquiries securely to the NISCO Worker. */
(() => {
  const form = document.getElementById("nisco-enquiry-form");
  if (!form) return;
  const note = document.getElementById("enquiry-form-note");
  const submit = form.querySelector('button[type="submit"]');
  if (submit) submit.dataset.defaultHtml = submit.innerHTML;
  const config = window.NISCO_CONFIG || {};
  document.querySelectorAll(".package-cta[data-service]").forEach(link => link.addEventListener("click", () => {
    const select = document.getElementById("enquiry-service");
    if (select) select.value = link.dataset.service;
  }));
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const values = new FormData(form);
    const payload = {
      name: String(values.get("name") || "").trim(),
      email: String(values.get("email") || "").trim(),
      phone: String(values.get("phone") || "").trim(),
      business: String(values.get("business") || "").trim(),
      service: String(values.get("service") || "").trim(),
      budget: String(values.get("budget") || "").trim(),
      requirement: String(values.get("requirement") || "").trim(),
      consent: document.getElementById("enquiry-consent")?.checked === true,
      website: String(values.get("website") || "")
    };
    if (submit) {
      submit.disabled = true;
      submit.setAttribute("aria-busy", "true");
      submit.textContent = "Sending…";
    }
    if (note) note.textContent = "Sending your enquiry securely to NISCO…";
    try {
      const response = await fetch((config.workerUrl || "https://nisco-ai.speedhome7852.workers.dev") + "/enquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!response.ok || result.success !== true) throw new Error(result.error || "Unable to submit your enquiry.");
      form.reset();
      if (note) note.textContent = "Thank you! Your enquiry has been sent to NISCO. We’ll reply to the email address you provided.";
    } catch (error) {
      if (note) note.textContent = error.message || "We couldn't send your enquiry. Please try again shortly.";
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.removeAttribute("aria-busy");
        submit.innerHTML = submit.dataset.defaultHtml || 'Request a Consultation <span>→</span>';
      }
    }
  });
})();
