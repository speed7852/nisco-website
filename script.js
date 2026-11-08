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
