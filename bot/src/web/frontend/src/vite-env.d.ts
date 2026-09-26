/// <reference types="vite/client" />

interface SidebarData {
    variant: "dashboard" | "settings";
    user: { id: string; username: string; avatar: string | null; owner: boolean };
    activeView: string;
    counts?: Record<string, number>;
}

interface SidebarBridge {
    setActive(id: string): void;
    setCounts(counts: Record<string, number>): void;
    onSelect(fn: (id: string) => void): () => void;
}

declare interface Window {
    __SIDEBAR_DATA__?: SidebarData;
    __sidebar?: SidebarBridge;
}
