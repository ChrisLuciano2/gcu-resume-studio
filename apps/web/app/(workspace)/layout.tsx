"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Persistent shell from Connect Accounts.dc.html's in-app state: a 232px left
// nav (Editor / Bank / Settings, active item = white ground + 2px purple rule)
// plus a "chatbot live" indicator once setup completes.
const NAV_ITEMS = [
  { href: "/editor", label: "Editor" },
  { href: "/bank", label: "Bank" },
  { href: "/settings", label: "Settings" },
];

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <div
        style={{
          width: 232,
          flex: "0 0 232px",
          background: "var(--surface)",
          borderRight: "1px solid var(--line)",
          padding: "24px 0",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          className="mono"
          style={{ padding: "0 20px 20px", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-3)" }}
        >
          Workspace
        </div>
        {NAV_ITEMS.map((item) => {
          const active = pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item${active ? " nav-item-active" : ""}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                textAlign: "left",
                width: "100%",
                padding: "11px 20px",
                borderLeft: `2px solid ${active ? "var(--purple)" : "transparent"}`,
                background: active ? "var(--white)" : undefined,
                color: active ? "var(--purple)" : "var(--black)",
                fontSize: 14,
                fontWeight: active ? 600 : 400,
                textDecoration: "none",
                transition: "all 180ms cubic-bezier(.2,.6,.2,1)",
              }}
            >
              <span>{item.label}</span>
            </Link>
          );
        })}
        <div style={{ flex: 1 }} />
        <div style={{ padding: 20, borderTop: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 999, background: "var(--purple)" }} />
          <span className="mono" style={{ fontSize: 11, color: "var(--ink-2)" }}>
            chatbot live
          </span>
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0, padding: "40px clamp(20px, 3vw, 48px) 80px" }}>{children}</div>
    </div>
  );
}
