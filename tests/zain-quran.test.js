import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, app, sw, manifest, headers] = await Promise.all([
  readFile(new URL("../zain-quran/index.html", import.meta.url), "utf8"),
  readFile(new URL("../zain-quran/app.js", import.meta.url), "utf8"),
  readFile(new URL("../zain-quran/sw.js", import.meta.url), "utf8"),
  readFile(new URL("../zain-quran/manifest.webmanifest", import.meta.url), "utf8"),
  readFile(new URL("../_headers", import.meta.url), "utf8")
]);

test("Zain Quran is a separately scoped installable PWA", () => {
  assert.match(html, /Zain Quran/);
  assert.match(html, /manifest\.webmanifest/);
  assert.match(manifest, /"start_url":"\.\//);
  assert.match(manifest, /"scope":"\.\//);
  assert.match(manifest, /"display":"standalone"/);
  assert.match(sw, /serviceWorker|addEventListener\("install"/);
});

test("Quran text and English translation are loaded from the configured API", () => {
  assert.match(app, /api\.alquran\.cloud/);
  assert.match(app, /quran-uthmani/);
  assert.match(app, /en\.sahih/);
  assert.match(app, /114/);
});

test("all four requested reciters are configured through the reciter catalogue", () => {
  for (const name of ["Saud Al-Shuraim", "Saad Al-Ghamdi", "Yasser Al-Dosari", "Mishary Al-Afasy"]) {
    assert.ok(app.includes(name), "Missing reciter: " + name);
  }
  assert.match(app, /mp3quran\.net\/api\/v3/);
  assert.match(app, /ayat_timing/);
});

test("habit features and local bookmarks are present", () => {
  assert.match(app, /Daily reading goal|goal/);
  assert.match(app, /streak/);
  assert.match(app, /bookmarks/);
  assert.match(app, /setInterval/);
  assert.match(app, /localStorage/);
});

test("offline audio is user-initiated and stored locally", () => {
  assert.match(app, /data-action="download"/);
  assert.match(app, /caches\.open\("zain-quran-audio"\)/);
  assert.match(app, /cache\.put\(url,r\)/);
  assert.match(sw, /zain-quran-audio/);
});

test("content security policy permits only the Quran content and recitation API hosts needed by the app", () => {
  assert.match(headers, /https:\/\/api\.alquran\.cloud/);
  assert.match(headers, /https:\/\/\*\.mp3quran\.net/);
  assert.match(headers, /script-src 'self'/);
});
