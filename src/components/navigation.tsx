"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Boxes, Cable, CircleDot, Play, Sparkles } from "lucide-react";

const items = [
  { href: "/", label: "Create", icon: Sparkles },
  { href: "/assets", label: "Assets", icon: Boxes },
  { href: "/runs", label: "Runs", icon: Play },
  { href: "/connections", label: "Connections", icon: Cable },
];

export function Navigation() {
  const pathname = usePathname();
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" href="/" aria-label="Relay home">
            <span className="brand-mark"><CircleDot size={18} strokeWidth={1.8} /></span>
            <span>Relay</span>
          </Link>
          <nav className="desktop-nav" aria-label="Primary navigation">
            {items.map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return <Link key={item.href} href={item.href} className={active ? "active" : ""}>{item.label}</Link>;
            })}
          </nav>
          <div className="local-status"><span className="status-led" />Local workspace</div>
        </div>
      </header>
      <nav className="mobile-nav" aria-label="Primary navigation">
        {items.map((item) => {
          const Icon = item.icon;
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} className={active ? "active" : ""}>
              <Icon size={18} strokeWidth={1.7} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
