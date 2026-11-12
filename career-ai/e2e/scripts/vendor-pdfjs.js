// Vendors pdf.js into the frontend and verifies it.
//
//   node scripts/vendor-pdfjs.js update   copy the pinned pdfjs-dist build into frontend/vendor/pdfjs
//                                          and write manifest.json (version + SHA-256 of each file)
//   node scripts/vendor-pdfjs.js verify   fail unless every vendored file matches the manifest AND is
//                                          byte-identical to the same file in the installed package
//
// Integrity chain: npm verifies the pdfjs-dist tarball against the SHA-512 in e2e/package-lock.json
// during `npm ci`; `verify` then proves the committed files are exactly that package's files.
// The frontend has no build step, so the library is committed; CI runs `verify` on every change.
// The files are renamed from .mjs to .js so every static host (Cloudflare Pages included) serves
// them as JavaScript; with X-Content-Type-Options: nosniff a wrong type would block them.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { E2E_DIR, FRONTEND_DIR } from "../e2e.config.js";

const PACKAGE_DIR = path.join(E2E_DIR, "node_modules", "pdfjs-dist");
const VENDOR_DIR = path.join(FRONTEND_DIR, "vendor", "pdfjs");
const MANIFEST = path.join(VENDOR_DIR, "manifest.json");
const FILES = [
  { source: "build/pdf.min.mjs", target: "pdf.min.js" },
  { source: "build/pdf.worker.min.mjs", target: "pdf.worker.min.js" },
  { source: "LICENSE", target: "LICENSE" },
];

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

function installed() {
  const manifestFile = path.join(PACKAGE_DIR, "package.json");
  if (!existsSync(manifestFile)) throw new Error("pdfjs-dist is not installed. Run `npm ci` in career-ai/e2e first.");
  const pkg = JSON.parse(readFileSync(manifestFile, "utf8"));
  const pinned = JSON.parse(readFileSync(path.join(E2E_DIR, "package.json"), "utf8")).devDependencies["pdfjs-dist"];
  if (pkg.version !== pinned) throw new Error(`Installed pdfjs-dist ${pkg.version} does not match the pinned ${pinned}.`);
  return pkg;
}

function update() {
  const pkg = installed();
  mkdirSync(VENDOR_DIR, { recursive: true });
  const files = {};
  for (const { source, target } of FILES) {
    copyFileSync(path.join(PACKAGE_DIR, source), path.join(VENDOR_DIR, target));
    files[target] = sha256(path.join(VENDOR_DIR, target));
  }
  const manifest = { package: "pdfjs-dist", version: pkg.version, license: pkg.license, source: "https://www.npmjs.com/package/pdfjs-dist", files };
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Vendored pdfjs-dist ${pkg.version} into ${path.relative(process.cwd(), VENDOR_DIR)}`);
}

function verify() {
  const pkg = installed();
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const problems = [];
  if (manifest.package !== "pdfjs-dist" || manifest.version !== pkg.version) {
    problems.push(`manifest says ${manifest.package}@${manifest.version}, installed is pdfjs-dist@${pkg.version}`);
  }
  for (const { source, target } of FILES) {
    const vendored = path.join(VENDOR_DIR, target);
    if (!existsSync(vendored)) {
      problems.push(`${target} is missing`);
      continue;
    }
    const actual = sha256(vendored);
    if (actual !== manifest.files?.[target]) problems.push(`${target} does not match manifest.json`);
    if (actual !== sha256(path.join(PACKAGE_DIR, source))) problems.push(`${target} differs from ${source} in the installed package`);
  }
  const unexpected = Object.keys(manifest.files ?? {}).filter((name) => !FILES.some((file) => file.target === name));
  if (unexpected.length > 0) problems.push(`manifest lists unexpected files: ${unexpected.join(", ")}`);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`::error::pdf.js vendor check: ${problem}`);
    process.exit(1);
  }
  console.log(`pdf.js vendor check passed: pdfjs-dist ${pkg.version}, ${FILES.length} files match the installed package and manifest.json.`);
}

const mode = process.argv[2];
if (mode === "update") update();
else if (mode === "verify") verify();
else {
  console.error("Usage: node scripts/vendor-pdfjs.js update|verify");
  process.exit(2);
}
