# NISCO Website — Starter Project

A responsive, static corporate website for NISCO using a navy-and-gold visual identity.

## Included
- Responsive homepage for desktop, tablet and mobile
- NISCO brand header and navigation
- Hero section using the approved NISCO sample artwork featuring three people reaching a summit
- Four business divisions:
  1. Digital Marketing
  2. Digital Solutions (website development and maintenance)
  3. Business Transformation
  4. Business Services (real estate-related services, cattle feed/livestock supplies, trading and future ventures)
- About, approach and contact sections
- Mobile navigation and current-year footer

## Run locally
No build tools or package installation are required.

1. Extract the ZIP.
2. Open `index.html` in a browser.
3. For a local development server, use VS Code Live Server or run `python -m http.server 8000` from this folder and open `http://localhost:8000`.

## Before publishing
1. Replace `CONTACT_EMAIL_PLACEHOLDER` in `index.html` with the official NISCO business email.
2. Confirm the final legal company name, address, phone, social links and business authorisations.
3. Review service descriptions and remove anything NISCO does not currently offer.
4. Add real project photos, team photos and approved company logo artwork.
5. Add a privacy notice and configure an actual enquiry form if collecting visitor information.
6. Connect the chosen domain after confirming ownership and availability.

## Deploy to Vercel
1. Create a new GitHub repository (for example, `nisco-website`).
2. Upload all files and folders from this project to the repository root.
3. In Vercel, choose **Add New → Project**, import the repository and deploy.
4. Framework preset: **Other**. Build command: leave blank. Output directory: `.`.
5. Add the domain in Vercel after registering it with a domain registrar.

Cloudflare Pages can also deploy this static project directly from GitHub.

## Project structure
```
nisco-website/
├── index.html
├── styles.css
├── script.js
├── README.md
└── assets/
    ├── favicon.svg
    ├── nisco-logo.svg
    └── nisco-hero.jpg
```

## Notes
- This is the first homepage version, not a complete multi-page website.
- The contact link is a placeholder until an official email address is supplied.
- The hero uses a cropped photograph from the approved NISCO sample homepage; the logo is a vector recreation of the sample wordmark.
- No analytics, tracking, backend, database or form submission service is configured yet.
