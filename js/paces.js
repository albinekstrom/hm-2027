/* ============================================================
   paces.js — Riegel equivalents and training pace bands.

   t2 = t1 × (d2/d1)^1.06
   Zone pace = 1000 / (v10 × factor), where v10 is metres per second
   at the 10 km equivalent and the factors are lo/hi from plan.json.
   A faster factor gives a faster pace, so the band's lower bound comes
   from `hi` and its upper bound from `lo`.
   ============================================================ */
"use strict";

import { HALF_KM } from "./plan.js";

export const RIEGEL_EXPONENT = 1.06;
export const DISTANCES = [3, 5, 10, HALF_KM];

export function riegel(seconds, fromKm, toKm){
  return seconds * Math.pow(toKm / fromKm, RIEGEL_EXPONENT);
}

export function mmss(seconds){
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  return m + ":" + String(s % 60).padStart(2, "0");
}
export function hms(seconds){
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  if(!h) return m + ":" + sec;
  return h + ":" + String(m).padStart(2, "0") + ":" + sec;
}

/* Accepts mm:ss and h:mm:ss. Also tolerates a plain number of minutes
   and a comma, because phone keyboards offer one. Returns 0 on nonsense. */
export function parseTime(input){
  const raw = String(input || "").trim().replace(/,/g, ":").replace(/\s/g, "");
  if(!raw) return 0;
  const parts = raw.split(":");
  if(parts.length > 3) return 0;
  const nums = parts.map(p => (p === "" ? NaN : Number(p)));
  if(nums.some(n => isNaN(n) || n < 0)) return 0;
  if(nums.length === 1) return Math.round(nums[0] * 60);
  if(nums.length === 2) return Math.round(nums[0] * 60 + nums[1]);
  return Math.round(nums[0] * 3600 + nums[1] * 60 + nums[2]);
}

export function labelFor(km){
  if(km === HALF_KM) return "Half marathon";
  return km + " km";
}
export function shortLabelFor(km){
  return km === HALF_KM ? "half" : km + " km";
}

/* Everything the paces view needs, from one test result. */
export function computePaces(zones, testDistKm, testSeconds){
  const t10 = riegel(testSeconds, testDistKm, 10);
  const v10 = 10000 / t10;                       // m/s
  const equivalents = {};
  for(const d of DISTANCES) equivalents[d] = riegel(testSeconds, testDistKm, d);
  const bands = zones.map(z => ({
    name: z.n,
    use: z.use,
    fast: 1000 / (v10 * z.hi),
    slow: 1000 / (v10 * z.lo)
  }));
  return { t10, v10, equivalents, bands };
}
