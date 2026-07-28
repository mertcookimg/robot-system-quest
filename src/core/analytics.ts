// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Analytics is opt-in at build time. Local development and forks without
// their own VITE_GA_ID never load Google Tag Manager or send measurements.

type AnalyticsWindow = Window & {
  dataLayer?: unknown[][];
  gtag?: (...args: unknown[]) => void;
};

export function setupAnalytics(): void {
  const measurementId = import.meta.env.VITE_GA_ID?.trim();
  if (!import.meta.env.PROD || !measurementId || !/^G-[A-Z0-9]+$/.test(measurementId)) return;

  const analyticsWindow = window as AnalyticsWindow;
  analyticsWindow.dataLayer = analyticsWindow.dataLayer ?? [];
  analyticsWindow.gtag = (...args: unknown[]) => analyticsWindow.dataLayer!.push(args);
  analyticsWindow.gtag("js", new Date());
  analyticsWindow.gtag("config", measurementId);

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.appendChild(script);
}
