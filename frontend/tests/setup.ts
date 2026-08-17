// Pins the interface language for every test file.
//
// Without this the suite's language depends on the machine it runs on, and it
// took CI to notice. `initialLang()` auto-detects from `navigator.languages`,
// but only when the browser storage actually works — otherwise there is nowhere
// to record the choice, so it falls back to Russian.
//
// On the developer's Node the built-in `localStorage` is inert (it warns
// `localStorage is not available because --localstorage-file was not provided`),
// so storage looked broken and every test rendered Russian. On GitHub Actions
// the jsdom environment gives the tests a working `localStorage` and a
// `navigator.language` of `en-US`, so the very same components rendered English
// and ~40 assertions looking for Russian text failed at once.
//
// Neither language is wrong — the suite simply must not decide it by accident.
// Russian is the source language of the product and the language the assertions
// are written in, so it is pinned here. A test that cares about English sets the
// store itself.

const STORAGE_KEY = "cubr_lang";

try {
  (globalThis as { localStorage?: Storage }).localStorage?.setItem(STORAGE_KEY, "ru");
} catch {
  // No usable storage in this environment — `initialLang()` already falls back
  // to Russian there, which is the value we want anyway.
}
