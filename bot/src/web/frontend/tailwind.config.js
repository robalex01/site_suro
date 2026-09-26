/** @type {import('tailwindcss').Config} */
export default {
    // Matches the Access Panel's existing theme mechanism: a data-theme
    // attribute on <html>, toggled by theme.js and stored in localStorage —
    // not the OS-level prefers-color-scheme.
    darkMode: ["selector", '[data-theme="dark"]'],
    content: ["./index.html", "./src/**/*.{ts,tsx}"],
    // The Access Panel already has its own base stylesheet (style.css) for
    // body/headings/links/etc. Tailwind's preflight reset would fight that
    // (both are loaded into the same document) — disabled so this bundle
    // only ever adds utility classes, never resets anything global.
    corePlugins: { preflight: false },
    theme: {
        extend: {
            // Mapped straight onto the Access Panel's own CSS custom
            // properties (see src/web/public/style.css) instead of a
            // separate shadcn palette — so switching the site's dark/light
            // theme (already just a data-theme attribute flip) re-themes
            // this bundle for free, with no second source of truth.
            colors: {
                background: "var(--bg)",
                foreground: "var(--text)",
                card: "var(--surface)",
                "card-foreground": "var(--text)",
                popover: "var(--surface)",
                "popover-foreground": "var(--text)",
                border: "var(--border)",
                input: "var(--border)",
                ring: "var(--accent)",
                muted: "var(--surface-2)",
                "muted-foreground": "var(--muted)",
                primary: "var(--accent)",
                "primary-foreground": "var(--accent-ink)",
                accent: "var(--surface-2)",
                "accent-foreground": "var(--text)",
                destructive: "var(--red)",
                "destructive-foreground": "#fff",
                success: "var(--green)",
                amber: "var(--amber)",
            },
            fontFamily: {
                sans: ['"IBM Plex Sans"', "-apple-system", "Segoe UI", "sans-serif"],
                mono: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
            },
        },
    },
    plugins: [],
};
