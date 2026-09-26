import { useEffect, useState } from "react";
import {
  Inbox,
  Wrench,
  Clock,
  Unlock,
  Radar,
  Trophy,
  Settings,
  LogOut,
  ArrowLeft,
  MessageSquare,
  Globe2,
  Sun,
  Moon,
} from "lucide-react";
import { SidebarNav, type NavGroupData, type NavItemData } from "@/components/ui/dashboard-sidebar";
import { sidebarStore } from "./sidebarStore";

type Me = { id: string; username: string; avatar: string | null; owner: boolean };

function useStoreSnapshot() {
  const [, setTick] = useState(0);
  useEffect(() => sidebarStore.subscribe(() => setTick((t) => t + 1)), []);
  return { active: sidebarStore.active, counts: sidebarStore.counts };
}

function badge(n: number | undefined) {
  return n && n > 0 ? n : undefined;
}

function buildDashboardGroups(counts: Record<string, number>, owner: boolean): NavGroupData[] {
  const queueItems: NavItemData[] = [
    { id: "pending", title: "Unclaimed", icon: Inbox, badge: badge(counts.pending) },
    { id: "active", title: "My In Progress", icon: Wrench, badge: badge(counts.active) },
    { id: "waiting", title: "My Awaiting Code", icon: Clock, badge: badge(counts.waiting) },
    { id: "submitted", title: "My Code Submitted", icon: Unlock, badge: badge(counts.submitted) },
  ];
  if (owner) {
    queueItems.push({ id: "all", title: "All Active", icon: Radar, badge: badge(counts.all) });
  }
  return [
    { heading: "Queue", items: queueItems },
    { heading: "Other", items: [{ id: "leaderboard", title: "Leaderboard", icon: Trophy }] },
  ];
}

function buildSettingsGroups(): NavGroupData[] {
  return [
    {
      items: [
        { id: "discord", title: "Discord Settings", icon: MessageSquare },
        { id: "web", title: "Web Settings", icon: Globe2 },
      ],
    },
  ];
}

/** Reads the theme this document is already in — the inline <head> snippet in server.js sets it before anything else runs. */
function currentTheme(): "dark" | "light" {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">(currentTheme());

  const toggle = () => {
    const next = theme === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("snaptech-theme", next);
    } catch {
      /* private browsing / storage disabled — theme still applies for this load */
    }
    setTheme(next);
  };

  return (
    <button
      onClick={toggle}
      className="flex items-center gap-2 px-2.5 py-2 rounded-[6px] bg-transparent border border-border/60 text-[12.5px] text-muted-foreground hover:text-foreground hover:border-muted-foreground/40 transition-colors w-full mb-2"
    >
      {theme === "light" ? <Moon className="w-4 h-4" strokeWidth={1.5} /> : <Sun className="w-4 h-4" strokeWidth={1.5} />}
      <span>{theme === "light" ? "Dark mode" : "Light mode"}</span>
    </button>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2 px-2 py-2 mb-3 text-[13px] font-semibold text-foreground select-none">
      <span>📍</span>
      <span>Access Panel</span>
    </div>
  );
}

function UserBox({ user }: { user: Me }) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-2 mt-2 rounded-[6px] border border-border/60 text-[12.5px]">
      {user.avatar ? (
        <img src={user.avatar} alt="" className="w-6 h-6 rounded-full shrink-0" />
      ) : (
        <div className="w-6 h-6 rounded-full bg-primary/20 shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="font-semibold truncate text-foreground">{user.username}</div>
        <span
          className={`inline-block px-1.5 py-[1px] rounded-[4px] text-[10px] font-semibold ${
            user.owner ? "bg-amber/15 text-amber" : "bg-primary/15 text-primary"
          }`}
        >
          {user.owner ? "Owner" : "Access"}
        </span>
      </div>
      <a href="/logout" className="text-muted-foreground text-[11px] hover:text-foreground">
        Log out
      </a>
    </div>
  );
}

/**
 * Real Access Panel integration of the copied SidebarNav component (see
 * components/ui/dashboard-sidebar.tsx). Mounted by main.tsx into
 * #sidebar-root on both the dashboard and the settings page — server.js
 * tells it which one via window.__SIDEBAR_DATA__.variant.
 */
export function AppSidebar() {
  const data = window.__SIDEBAR_DATA__;
  const { active, counts } = useStoreSnapshot();

  if (!data) return null;
  const { variant, user } = data;

  const handleSelect = (id: string) => {
    if (variant === "dashboard") {
      if (id === "settings") { window.location.href = "/settings"; return; }
      if (id === "logout") { window.location.href = "/logout"; return; }
    } else {
      if (id === "back") { window.location.href = "/"; return; }
      if (id === "logout") { window.location.href = "/logout"; return; }
    }
    sidebarStore.setActive(id);
    sidebarStore.emitSelect(id);
  };

  const navGroups = variant === "dashboard" ? buildDashboardGroups(counts, user.owner) : buildSettingsGroups();

  const bottomItems: NavItemData[] =
    variant === "dashboard"
      ? [{ id: "settings", title: "Settings", icon: Settings }, { id: "logout", title: "Log out", icon: LogOut }]
      : [{ id: "back", title: "Dashboard", icon: ArrowLeft }, { id: "logout", title: "Log out", icon: LogOut }];

  return (
    <SidebarNav
      className="!h-screen sticky top-0"
      activeId={active}
      onSelect={handleSelect}
      navGroups={navGroups}
      bottomItems={bottomItems}
      header={<Brand />}
      footer={
        <>
          <ThemeToggle />
          <UserBox user={user} />
        </>
      }
    />
  );
}
