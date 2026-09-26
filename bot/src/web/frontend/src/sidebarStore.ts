type Listener = () => void;

/**
 * Minimal external store bridging this React bundle with the existing
 * vanilla app.js / settings.js. Queue rendering, sockets and API calls stay
 * exactly where they are — this only keeps the sidebar's active view and
 * badge counts in sync with them, in both directions:
 *   - app.js calls window.__sidebar.setActive()/setCounts() when its own
 *     state changes (a socket event, a switchView() call, etc).
 *   - this store calls back into app.js via onSelect() when the user clicks
 *     a sidebar item, so app.js's switchView() stays the single place that
 *     decides what a view switch actually does.
 */
class SidebarStore {
  active = "";
  counts: Record<string, number> = {};
  private listeners = new Set<Listener>();
  private selectHandlers = new Set<(id: string) => void>();

  setActive(id: string) {
    this.active = id;
    this.emit();
  }

  setCounts(counts: Record<string, number>) {
    this.counts = { ...this.counts, ...counts };
    this.emit();
  }

  onSelect(fn: (id: string) => void) {
    this.selectHandlers.add(fn);
    return () => this.selectHandlers.delete(fn);
  }

  emitSelect(id: string) {
    this.selectHandlers.forEach((fn) => fn(id));
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.listeners.forEach((fn) => fn());
  }
}

export const sidebarStore = new SidebarStore();
