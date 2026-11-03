"use client";

// P5 (JS diet): interaction-only chrome is split out of the initial bundle
// with next/dynamic. This wrapper must be a Client Component — the Next 16.4
// lazy-loading guide states `ssr: false` is not allowed in Server
// Components, so the (main) layout (a Server Component) imports these
// wrappers instead of calling dynamic() itself.
//
// CartDrawer / MobileMenu: both render closed on first paint and are driven
// by state that lives OUTSIDE them (CartContext / window events), so a tap
// that lands before the chunk arrives is not lost semantically — the drawer
// chunk starts loading immediately on mount (dynamic components render, and
// therefore fetch, right away; they are just excluded from First Load JS and
// from SSR HTML), and once mounted the drawer reflects the already-set open
// state. The window for a missed first interaction is the brief post-hydration
// chunk fetch, after which every tap works exactly as before.
//
// FloatingWidgets: purely ambient (chat links + floating cart shortcut),
// nothing above the fold depends on it, so deferring it costs nothing.

import dynamic from "next/dynamic";

export const LazyCartDrawer = dynamic(() => import("./CartDrawer"), {
  ssr: false,
});

export const LazyMobileMenu = dynamic(() => import("./MobileMenu"), {
  ssr: false,
});

export const LazyFloatingWidgets = dynamic(() => import("./FloatingWidgets"), {
  ssr: false,
});
