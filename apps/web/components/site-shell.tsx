"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useChog } from "./chog-provider";
import { Icon } from "./icons";

const navigation = [
  { href: "/", label: "The story" },
  { href: "/evolution", label: "Evolution" },
  { href: "/quests", label: "Quests" },
  { href: "/profile", label: "My Chog" },
];
const accountRoutes = ["/profile", "/activity", "/upgrade"];

export function SiteShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const {
    address,
    signedIn,
    walletBusy,
    walletError,
    connect,
    clearWalletError,
  } = useChog();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);
  const isCurrent = (href: string) =>
    href === "/profile" ? accountRoutes.includes(pathname) : href === pathname;
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="site-header">
        <div className="header-inner">
          <Link className="brand" href="/" aria-label="Chog Evolution home">
            <Icon name="chog" size={34} />
            <span>
              CHOG<small>EVOLUTION</small>
            </span>
          </Link>
          <nav className="desktop-navigation" aria-label="Main navigation">
            {navigation.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isCurrent(item.href) ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="header-actions">
            {signedIn ? (
              <Link
                className="wallet-chip"
                href="/profile"
                aria-label={`Connected wallet ${address}`}
              >
                <span className="connection-dot" />
                <span>
                  {address.slice(0, 5)}…{address.slice(-4)}
                </span>
              </Link>
            ) : (
              <button
                type="button"
                className="button button-quiet connect-nav"
                disabled={walletBusy}
                onClick={() => void connect()}
              >
                <Icon name="wallet" size={17} />
                <span>
                  {walletBusy
                    ? "Connecting…"
                    : address
                      ? "Sign in"
                      : "Connect wallet"}
                </span>
              </button>
            )}
            <Link className="button button-primary nav-mint" href="/mint">
              Mint a Chog <Icon name="up-right" size={17} />
            </Link>
            <button
              ref={menuRef}
              className="icon-button mobile-toggle"
              type="button"
              aria-controls="mobile-navigation"
              aria-expanded={menuOpen}
              aria-label={menuOpen ? "Close navigation" : "Open navigation"}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <Icon name={menuOpen ? "close" : "menu"} size={24} />
            </button>
          </div>
        </div>
        <nav
          id="mobile-navigation"
          className={`mobile-navigation ${menuOpen ? "is-open" : ""}`}
          aria-label="Mobile navigation"
          inert={!menuOpen ? true : undefined}
        >
          {navigation.map((item, index) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isCurrent(item.href) ? "page" : undefined}
              onClick={() => setMenuOpen(false)}
            >
              <span className="caption">0{index + 1}</span>
              {item.label}
              <Icon name="up-right" />
            </Link>
          ))}
          <div className="mobile-account-links">
            <Link href="/activity" onClick={() => setMenuOpen(false)}>
              Activity
            </Link>
            <Link href="/upgrade" onClick={() => setMenuOpen(false)}>
              Upgrade
            </Link>
          </div>
          {!signedIn && (
            <button
              type="button"
              className="button button-secondary"
              disabled={walletBusy}
              onClick={() => {
                setMenuOpen(false);
                void connect();
              }}
            >
              <Icon name="wallet" />
              {walletBusy ? "Connecting…" : "Connect wallet"}
            </button>
          )}
        </nav>
      </header>
      {walletError && (
        <div className="global-notice" role="status">
          <span>{walletError}</span>
          <button
            className="icon-button"
            aria-label="Dismiss wallet message"
            type="button"
            onClick={clearWalletError}
          >
            <Icon name="close" size={17} />
          </button>
        </div>
      )}
      {children}
      <footer className="site-footer">
        <div className="footer-top">
          <Link className="brand" href="/">
            <Icon name="chog" size={30} />
            <span>
              CHOG<small>EVOLUTION</small>
            </span>
          </Link>
          <p>
            A little weird.
            <br />
            Always becoming.
          </p>
          <Link className="text-link" href="/mint">
            Start your story <Icon name="up-right" />
          </Link>
        </div>
        <div className="footer-bottom">
          <span>Made for the Monad ecosystem.</span>
          <nav aria-label="Footer navigation">
            <Link href="/quests">Explore quests</Link>
            <Link href="/upgrade">Check for an evolution</Link>
            <a href="https://www.chog.xyz/" target="_blank" rel="noreferrer">
              The Chog world <Icon name="up-right" size={14} />
            </a>
          </nav>
          <span>Stay curious. Stay Chog.</span>
        </div>
      </footer>
    </>
  );
}

export function AccountNavigation() {
  const pathname = usePathname();
  return (
    <nav className="account-navigation" aria-label="My Chog navigation">
      {[
        { href: "/profile", label: "My profile", icon: "chog" },
        { href: "/activity", label: "Activity", icon: "clock" },
        { href: "/upgrade", label: "Upgrade", icon: "spark" },
      ].map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={pathname === item.href ? "page" : undefined}
        >
          <Icon name={item.icon as "chog" | "clock" | "spark"} size={18} />
          {item.label}
          {item.href === "/upgrade" && <span className="tiny-dot" />}
        </Link>
      ))}
    </nav>
  );
}
