// Central, environment-overridable test data for the Nectar AI / Pollen media
// planner. Specs use logical names (e.g. "N360_Unilever_MS"); the live app may
// surface a different label (e.g. "N360 | Unilever | MS"). Keep the real values
// here so tests stay runnable across non-production environments — override any
// value with the matching E2E_MP_* env var instead of editing tests.
//
// Defaults are seeded from the live DOM reconnaissance of
// https://www.dev.pollen.js-devops.co.uk (2026-06-22).

function env(key: string, fallback: string): string {
  const value = process.env[key];
  return value && value.trim() !== '' ? value : fallback;
}

export const mediaPlannerData = {
  // Advertiser/brand as the assistant search matches them (verified live 2026-06-22:
  // the advertiser is searched as N360_Unilever_MS; the brand checkbox is the full
  // "Unilever | Knorr | MS" label). Override per environment.
  advertiser: env('E2E_MP_ADVERTISER', 'N360_Unilever_MS'),
  brand: env('E2E_MP_BRAND', 'Unilever | Knorr | MS'),
  objective: env('E2E_MP_OBJECTIVE', 'Customer retention'),
  productSearch: env('E2E_MP_PRODUCT_SEARCH', 'knorr'),
  sku: env('E2E_MP_SKU', '2001227'),
  channels: {
    onsiteDisplay: env('E2E_MP_ONSITE_CHANNEL', 'Onsite Display'),
    offsiteDisplay: env('E2E_MP_OFFSITE_CHANNEL', 'Offsite Display'),
    offsitePubmatic: env('E2E_MP_OFFSITE_PUBMATIC_CHANNEL', 'DD Pubmatic - Display')
  },
  // Read-only configured booking deadline (days) for Onsite Display in the dev env.
  onsiteBookingDeadlineDays: Number(env('E2E_MP_ONSITE_DISPLAY_BOOKING_DEADLINE_DAYS', '2'))
} as const;

export type MediaPlannerData = typeof mediaPlannerData;

// Build a DD/MM/YYYY date string offset from today (never hardcode calendar dates).
export function offsetDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${date.getFullYear()}`;
}

// Free-text channel request as typed into the Nectar AI assistant.
export function channelRequest(channelName: string, startOffsetDays: number, budget = '7k'): string {
  return `${channelName}, ${offsetDate(startOffsetDays)} till ${offsetDate(startOffsetDays + 30)}, the budget is ${budget}`;
}
