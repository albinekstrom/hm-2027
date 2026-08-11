/* ============================================================
   app.js — entry, tab routing, ledger, gauges, boot sequence.
   ============================================================ */
"use strict";

import { $, esc, paint } from "./dom.js";
import { store, painColor, painWord } from "./store.js";
import {
  loadPlan, fmtD, fmtWD, phaseOf, currentWeekIndex, daysToRace,
  targetFor, round1, PHASE_COLOR
} from "./plan.js";
import { renderWeek } from "./views/week.js";
import { renderSeason } from "./views/season.js";
import { renderPaces } from "./views/paces.js";
import { renderPlaybook } from "./views/playbook.js";

const TABS = ["week", "season", "paces", "playbook"];

const app = {
  plan: null,
  index: 0,        // selected week, zero-based
  tab: "week"
};

/* The object every view gets: the plan, what is selected, and the three
   ways a view is allowed to ask for a redraw. */
const ctx = {
  get plan(){ return app.plan; },
  get index(){ return app.index; },

  /* Full redraw of the current view plus the always-visible chrome. */
  refresh(){
    renderLedger();
    renderGauges();
    renderCurrentTab();
  },
  /* Cheap: ledger and gauges only, for use while someone is typing. */
  refreshLedger(){
    renderLedger();
    renderGauges();
  },
  select(index){
    app.index = index;
    renderLedger();
    renderGauges();
    renderWeek(ctx);
    switchTab("week");
    window.scrollTo({ top:0, behavior:"smooth" });
  }
};

/* ============================================================
   Ledger — bar height = planned km, fill = logged, square = shin
   ============================================================ */
function renderLedger(){
  const plan = app.plan;
  const strip = $("strip");
  const rail = $("phaserail");
  strip.replaceChildren();
  rail.replaceChildren();

  plan.weeks.forEach((week, i) => {
    const travel = store.isTravel(i);
    const target = targetFor(plan, i, travel);
    const logged = store.loggedKm(i);
    const worst = store.worstPain(i);

    /* 18% floor so the lightest week is still a visible, tappable bar. */
    const height = Math.round(18 + (week.targetKm / plan.maxTargetKm) * 82);
    const fill = target > 0 ? Math.min(100, Math.round((logged / target) * 100)) : 0;

    const bar = document.createElement("button");
    bar.className = "bar" + (i === app.index ? " sel" : "");
    bar.dataset.phase = week.phase;
    bar.type = "button";
    bar.title = "Week " + week.week + " · " + fmtD(week.startDate) + " · " + target + " km planned" +
                (logged > 0 ? " · " + round1(logged) + " km logged" : "") +
                (travel ? " · travel" : "");
    bar.setAttribute("aria-label",
      "Week " + week.week + ", " + target + " km planned, " +
      (logged > 0 ? round1(logged) + " km logged" : "nothing logged") +
      ", shins " + painWord(worst).toLowerCase());

    const plannedEl = document.createElement("div");
    plannedEl.className = "plan";
    plannedEl.style.height = height + "%";
    const doneEl = document.createElement("div");
    doneEl.className = "done";
    doneEl.style.height = fill + "%";
    plannedEl.appendChild(doneEl);

    const dot = document.createElement("div");
    dot.className = "dot";
    dot.style.background = painColor(worst);

    bar.append(plannedEl, dot);
    bar.addEventListener("click", () => ctx.select(i));
    strip.appendChild(bar);

    const railCell = document.createElement("div");
    railCell.style.background = PHASE_COLOR[week.phase] || "var(--slate)";
    rail.appendChild(railCell);
  });
}

/* ============================================================
   Gauges
   ============================================================ */
function renderGauges(){
  const plan = app.plan;
  const current = currentWeekIndex(plan);

  $("g-days").textContent = String(daysToRace(plan));
  $("g-date").textContent = fmtWD(plan.raceDay);

  if(current < 0){
    $("g-week").textContent = "Pre";
    $("g-phase").textContent = "Starts " + fmtWD(plan.weekOne).replace(/ \d{4}$/, "");
    $("g-km").textContent = "—";
    $("g-kmsub").textContent = "week 1 = " + plan.weeks[0].targetKm + " km";
  } else {
    const week = plan.weeks[current];
    const travel = store.isTravel(current);
    $("g-week").textContent = week.week + " / " + plan.meta.totalWeeks;
    $("g-phase").textContent = phaseOf(plan, week).name;
    $("g-km").textContent = targetFor(plan, current, travel) + " km";
    $("g-kmsub").textContent = travel ? "travel week target" : "planned volume";
  }

  /* Planned counts the weeks that have happened, plus any week with
     something logged in it. Logged counts everything. */
  let logged = 0;
  let planned = 0;
  plan.weeks.forEach((week, i) => {
    const km = store.loggedKm(i);
    logged += km;
    if(km > 0 || (current >= 0 && i <= current)){
      planned += targetFor(plan, i, store.isTravel(i));
    }
  });
  $("g-total").textContent = Math.round(logged) + " / " + Math.round(planned);

  /* Shin status: worst of the last three weeks, current week included. */
  const to = current < 0 ? 0 : current;
  let worst = null;
  for(let i = Math.max(0, to - 2); i <= to; i++){
    const p = store.worstPain(i);
    if(p !== null && (worst === null || p > worst)) worst = p;
  }
  const shin = $("g-shin");
  shin.textContent = painWord(worst);
  shin.style.color = worst === null ? "var(--mute)" : painColor(worst);
  $("g-shinsub").textContent = worst === null ? "log a session to start" : "worst of last 3 weeks";
}

/* ============================================================
   Tabs
   ============================================================ */
function switchTab(name){
  app.tab = name;
  for(const tab of document.querySelectorAll(".tab")){
    tab.setAttribute("aria-selected", tab.dataset.tab === name ? "true" : "false");
  }
  for(const n of TABS){
    $("p-" + n).hidden = (n !== name);
  }
  renderCurrentTab();
}

function renderCurrentTab(){
  switch(app.tab){
    case "week": renderWeek(ctx); break;
    case "season": renderSeason(ctx); break;
    case "paces": renderPaces(ctx); break;
    case "playbook": renderPlaybook(ctx); break;
  }
}

function wireTabs(){
  const tabs = Array.from(document.querySelectorAll(".tab"));
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
    tab.addEventListener("keydown", event => {
      const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if(!step) return;
      event.preventDefault();
      const next = tabs[(i + step + tabs.length) % tabs.length];
      next.focus();
      switchTab(next.dataset.tab);
    });
  });
}

/* ============================================================
   Boot
   ============================================================ */
async function boot(){
  try{
    app.plan = await loadPlan();
  } catch (err){
    console.error(err);
    paint("p-week",
      '<div class="card"><h3>The plan did not load</h3><p>' + esc(err.message) +
      '</p><p>Nothing has been lost — reload when you have a connection.</p></div>');
    return;
  }

  const current = currentWeekIndex(app.plan);
  app.index = current < 0 ? 0 : current;

  wireTabs();
  renderLedger();
  renderGauges();
  switchTab("week");

  /* Bring the selected week into view in the ledger without yanking the page. */
  const bar = $("strip").children[app.index];
  if(bar && bar.scrollIntoView){
    bar.scrollIntoView({ block:"nearest", inline:"center" });
  }
}

boot();
