/* ============================================================
   plan.js — loads the fixed 40-week plan and answers questions
   about it. The plan is read-only input: nothing here derives,
   adjusts or regenerates a session.
   ============================================================ */
"use strict";

export const HALF_KM = 21.0975;

/* ---------- dates ----------
   Plan dates are plain calendar days ("2026-08-17"). Date parses a bare
   ISO date as UTC midnight, which lands on the previous day west of
   Greenwich, so build them locally instead. */
export function parseDay(iso){
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(date, n){
  const x = new Date(date.getTime());
  x.setDate(x.getDate() + n);
  return x;
}
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const WEEKDAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
export function fmtD(date){ return date.getDate() + " " + MONTHS[date.getMonth()]; }
export function fmtDY(date){ return fmtD(date) + " " + date.getFullYear(); }
export function fmtWD(date){ return WEEKDAYS[date.getDay()] + " " + fmtDY(date); }

/* ---------- phase colours ---------- */
export const PHASE_COLOR = {
  P0:"var(--p0)", P1:"var(--p1)", P2:"var(--p2)", P3:"var(--p3)", P4:"var(--p4)"
};

/* ============================================================
   Loading
   ============================================================ */
export async function loadPlan(){
  const res = await fetch("data/plan.json", { cache:"no-cache" });
  if(!res.ok) throw new Error("plan.json failed to load (HTTP " + res.status + ")");
  const plan = await res.json();
  decorate(plan);
  validatePlan(plan);
  return plan;
}

/* Cheap derived values the views would otherwise recompute on every render. */
function decorate(plan){
  plan.raceDay = parseDay(plan.meta.raceDate);
  plan.weekOne = parseDay(plan.meta.weekOneMonday);
  plan.maxTargetKm = Math.max(...plan.weeks.map(w => w.targetKm));
  plan.phaseById = {};
  for(const ph of plan.phases) plan.phaseById[ph.id] = ph;
  plan.weeks.forEach((w, i) => {
    w.index = i;                       // zero-based; the log's week key
    w.startDate = parseDay(w.start);
    w.endDate = parseDay(w.end);
  });
}

/* The plan is hand-built data, so check the invariant the brief names:
   every week's session kilometres add up to its target. Week 40 is
   0.1 km over because the race is 21.1 — that is rounding, not a fault,
   so the tolerance sits just above it. */
export function validatePlan(plan){
  if(plan.weeks.length !== plan.meta.totalWeeks){
    console.warn("plan: expected " + plan.meta.totalWeeks + " weeks, found " + plan.weeks.length);
  }
  for(const w of plan.weeks){
    const sum = w.sessions.reduce((t, s) => t + (s.km || 0), 0);
    if(Math.abs(sum - w.targetKm) > 0.15){
      console.warn("plan: week " + w.week + " sessions sum to " + round1(sum) +
                   " km but targetKm is " + w.targetKm);
    }
  }
  const lastEnd = plan.weeks[plan.weeks.length - 1].endDate;
  if(plan.raceDay > lastEnd){
    console.warn("plan: race date falls outside the last week");
  }
}

/* ============================================================
   Lookups
   ============================================================ */
export function phaseOf(plan, week){
  return plan.phaseById[week.phase] || { id:week.phase, name:week.phase, brief:"" };
}

/* Index of the week containing `now`; -1 before the plan starts,
   the last week once it has finished. */
export function currentWeekIndex(plan, now = new Date()){
  for(const w of plan.weeks){
    if(now >= w.startDate && now < addDays(w.endDate, 1)) return w.index;
  }
  return now < plan.weekOne ? -1 : plan.weeks.length - 1;
}

export function daysToRace(plan, now = new Date()){
  const race = addDays(plan.raceDay, 0);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((race - today) / 86400000));
}

/* Sessions to show for a week: the travel week replaces the written one. */
export function sessionsFor(plan, index, travel){
  return travel ? plan.travelWeekSessions : plan.weeks[index].sessions;
}
export function targetFor(plan, index, travel){
  const km = plan.weeks[index].targetKm;
  return travel ? Math.round(km * plan.travelWeekVolumeFactor) : km;
}
export function findSession(list, id){
  return list.find(s => s.id === id) || null;
}

export function round1(n){ return Math.round(n * 10) / 10; }
