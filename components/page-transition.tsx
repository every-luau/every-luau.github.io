/// <reference types="react/canary" />
import { ViewTransition, type ReactNode } from 'react';

// Fades the whole page when navigating, the same fade as the portfolio's Astro pages (Astro's
// `fade`): the old page fades out while the new one fades in, both over 180ms. Next.js runs
// navigations as transitions, so this animates on its own. It wraps the root layout's children,
// which stay mounted on every navigation: wrapped inside a layout that gets replaced (home to
// docs), React would not animate it. The animation is in app/global.css.
export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <ViewTransition enter="page-fade" exit="page-fade" update="page-fade" default="none">
      {children}
    </ViewTransition>
  );
}
