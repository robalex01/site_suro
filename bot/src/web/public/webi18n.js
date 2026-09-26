/**
 * webi18n.js — client-side interface language, shared by every page.
 *
 * Separate from the Discord message language (set in Discord Settings,
 * stored server-side per account): this one is a display preference for
 * the SITE itself, stored in localStorage like the theme — per browser,
 * not per account.
 *
 * Loads a JSON dictionary from /locales/<lang>.json and:
 *  - applies it to every [data-i18n="key"] element's textContent,
 *  - exposes window.WEBI18N = { lang, t(key, vars) } for app.js/settings.js
 *    to translate content they generate dynamically (card labels, toasts…),
 *  - exposes window.WEBI18N_READY, a promise other scripts can await before
 *    their first render so nothing flashes in English first.
 */

window.WEBI18N_AVAILABLE = [
    { code: "en", label: "English" },
    { code: "fr", label: "Français" },
    { code: "es", label: "Español" },
    { code: "pl", label: "Polski" },
    { code: "ar", label: "العربية" },
    { code: "de", label: "Deutsch" },
    { code: "it", label: "Italiano" },
];

window.WEBI18N_READY = (async function () {
    const lang = localStorage.getItem("snaptech-ui-lang") || "en";

    async function loadDict(code) {
        try {
            const res = await fetch(`/locales/${code}.json`);
            return res.ok ? await res.json() : null;
        } catch {
            return null;
        }
    }

    let dict = await loadDict(lang);
    if (!dict && lang !== "en") dict = await loadDict("en");
    dict = dict || {};

    window.WEBI18N = {
        lang,
        t(key, vars) {
            let s = dict[key] ?? key;
            if (vars) for (const k of Object.keys(vars)) s = s.replaceAll(`{${k}}`, vars[k]);
            return s;
        },
    };

    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.querySelectorAll("[data-i18n]").forEach(el => {
        el.textContent = window.WEBI18N.t(el.dataset.i18n);
    });
})();
