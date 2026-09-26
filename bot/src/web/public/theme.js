/**
 * theme.js — light/dark theme toggle, shared by every page.
 *
 * Stored in localStorage only (per-browser, not per-account). Applied as
 * early as possible via an inline snippet in <head> (see server.js) to
 * avoid a flash of the wrong theme; this file wires up the toggle button
 * (swapping its sun/moon icon + label) and any explicit [data-theme-set]
 * buttons (the Web Settings panel).
 */
(function () {
    const ICONS = {
        sun:  '<path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/><circle cx="12" cy="12" r="4"/>',
        moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    };
    function iconSvg(name) {
        return `<svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
    }

    function labelText(theme) {
        const key = theme === "light" ? "theme_dark" : "theme_light"; // shows the action, i.e. what clicking switches TO
        return window.WEBI18N ? window.WEBI18N.t(key) : (theme === "light" ? "Dark mode" : "Light mode");
    }

    function apply(theme) {
        document.documentElement.setAttribute("data-theme", theme);
        const btn = document.getElementById("theme-toggle");
        if (!btn) return;
        btn.querySelector(".label").textContent = labelText(theme);
        const iconEl = btn.querySelector(".theme-icon");
        if (iconEl) iconEl.innerHTML = iconSvg(theme === "light" ? "moon" : "sun");
    }

    document.addEventListener("DOMContentLoaded", () => {
        const current = localStorage.getItem("snaptech-theme") || "dark";
        apply(current);
        window.WEBI18N_READY?.then(() => apply(document.documentElement.getAttribute("data-theme")));

        document.getElementById("theme-toggle")?.addEventListener("click", () => {
            const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
            localStorage.setItem("snaptech-theme", next);
            apply(next);
        });
        document.querySelectorAll("[data-theme-set]").forEach(btn => {
            btn.addEventListener("click", () => {
                localStorage.setItem("snaptech-theme", btn.dataset.themeSet);
                apply(btn.dataset.themeSet);
            });
        });
    });
})();
