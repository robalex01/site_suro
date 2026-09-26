import { createRoot } from "react-dom/client";
import "./index.css";
import { AppSidebar } from "./AppSidebar";
import { sidebarStore } from "./sidebarStore";

const data = window.__SIDEBAR_DATA__;

if (data) {
    if (data.activeView) sidebarStore.setActive(data.activeView);
    if (data.counts) sidebarStore.setCounts(data.counts);

    // Bridge exposed to app.js / settings.js — see sidebarStore.ts for the
    // reasoning. Nothing else on the page should need this global.
    window.__sidebar = {
        setActive: (id) => sidebarStore.setActive(id),
        setCounts: (counts) => sidebarStore.setCounts(counts),
        onSelect: (fn) => sidebarStore.onSelect(fn),
    };

    // sidebar.js is a deferred ES module — it can execute AFTER app.js /
    // settings.js (plain blocking <script> tags) have already run. Those
    // scripts wait for this event instead of assuming window.__sidebar is
    // present yet, so the bridge registration never races the load order.
    window.dispatchEvent(new Event("sidebar:ready"));
}

const rootEl = document.getElementById("sidebar-root");
if (rootEl) {
    createRoot(rootEl).render(<AppSidebar />);
} else {
    console.warn("[sidebar] #sidebar-root not found — nothing to mount into.");
}
