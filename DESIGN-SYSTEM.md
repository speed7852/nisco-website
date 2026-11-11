# NISCO Design System

Version: 1.0  
Status: Active  
Brand promise: **Built to Rise. Driven to Grow.**  
Audience: business owners and decision-makers across India and Saudi Arabia.

## 1. Design principles
1. **Clarity before decoration** — every section has one primary message and a clear next action.
2. **Premium, not flashy** — restrained navy, warm gold, generous whitespace and purposeful imagery.
3. **Trust through consistency** — repeat spacing, type, buttons, cards, borders and interaction states.
4. **Mobile-first usability** — content and actions must work at 320px and above without horizontal scrolling.
5. **Accessible by default** — semantic HTML, keyboard access, visible focus, meaningful names, sufficient contrast and reduced-motion support.
6. **Performance is part of design** — optimize images, avoid unnecessary libraries and prevent layout shifts.

## 2. Brand foundations

### Colour tokens
Use CSS custom properties; do not introduce one-off brand colours without documenting the reason.

| Token | Value | Intended use |
|---|---|---|
| `--navy` | `#07182a` | Primary brand / dark backgrounds |
| `--navy2` | `#0d2941` | Secondary dark surfaces |
| `--gold` | `#e9b94f` | Primary accent and key actions |
| `--gold2` | `#f5d17d` | Highlight on dark backgrounds |
| `--ink` | `#102338` | Main text |
| `--muted` | `#617184` | Supporting text |
| `--paper` | `#f6f8fb` | Page background |
| `--white` | `#fff` | Surface |
| `--line` | `#dfe5ec` | Borders and dividers |

Gold is an accent, not a default body-text colour. Check actual foreground/background pairs with axe and manual contrast review before release.

### Typography
- Display/headings: Montserrat, weight 600–900.
- Body/UI: Inter or the currently loaded sans-serif fallback, weight 400–700.
- Use a restrained type scale, readable line lengths and line-height around 1.5–1.8 for body copy.
- Avoid long all-caps paragraphs and excessive letter spacing.

### Layout and spacing
- Main content maximum width: approximately 1160px.
- Page gutters: 24px desktop baseline; reduce carefully on narrow screens.
- Use a consistent 4px spacing rhythm (8, 12, 16, 24, 32, 48, 64, 96).
- Use CSS Grid/Flexbox for layout; avoid fixed widths that overflow.
- Cards use consistent radius, border, padding and hover/focus behaviour.

## 3. Component standards
- **Navigation:** semantic `header/nav`, keyboard-operable mobile toggle, accurate `aria-expanded` and `aria-controls`.
- **Buttons/links:** links navigate; buttons perform actions. Visible text must match accessible name. Every interactive element has hover, focus-visible and disabled states as relevant.
- **Cards:** consistent heading hierarchy; avoid clickable nested controls and vague link labels.
- **Forms:** every field has a persistent label, clear required/error states and useful success feedback. Keep honeypots visually hidden and out of keyboard navigation.
- **Images:** meaningful alt text for informative images; empty alt for decorative images. Supply dimensions/aspect ratio and optimized formats.
- **Motion:** short and purposeful; honour `prefers-reduced-motion`.

## 4. Responsive rules
Validate at 320, 360, 375, 390, 412, 430, 768, 1024 and 1366px. No horizontal overflow, clipped text, overlapping controls or inaccessible navigation. At mobile widths, stack complex grids and preserve comfortable tap targets.

## 5. Page composition
A marketing page should answer, in order:
1. What NISCO does and who it serves.
2. Why the visitor should trust NISCO.
3. Which services solve their problem.
4. Evidence of capability (work, process, outcomes or testimonials).
5. A clear enquiry / consultation action.

Do not add decorative sections that dilute the conversion path. Keep copy specific and avoid unsupported claims.

## 6. Design change workflow
1. **Discover:** inspect the current page, assets, audience, goals and existing patterns before editing.
2. **Define:** state the design problem, target audience, hierarchy and success criteria.
3. **Systemize:** reuse existing tokens/components; document any new token or pattern here.
4. **Implement:** make the smallest coherent HTML/CSS/JS change; preserve content and working integrations.
5. **Review:** inspect desktop and mobile layouts, keyboard flow, focus states, contrast, forms and reduced motion.
6. **Automate:** run Playwright responsive and axe checks; run Lighthouse against the deployed site.
7. **Release:** merge/push only after checks pass or document known exceptions. Verify the live Cloudflare Pages deployment.
8. **Record:** update this file when foundations or reusable components change.

## 7. Definition of done
- [ ] Design follows documented brand tokens and reusable components.
- [ ] Layout passes the supported viewport matrix with no horizontal overflow.
- [ ] Keyboard navigation and visible focus work.
- [ ] Accessible names, labels, heading order and image alternatives are correct.
- [ ] Contrast issues are fixed or explicitly documented with a remediation plan.
- [ ] Reduced-motion preference is respected.
- [ ] Playwright, axe and Lighthouse results are reviewed.
- [ ] Live deployment is verified; screenshots/report are retained for review.
