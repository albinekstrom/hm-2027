/* ============================================================
   app.js — entry, tab routing, ledger, gauges, boot sequence.
   ============================================================ */
"use strict";

import { $, esc, paint } from "./dom.js";
import { store, painColor, painWord, installFlushHandlers } from "./store.js";
import {
  loadPlan, fmtD, fmtWD, phaseOf, currentWeekIndex, daysToRace,
  targetFor, round1, PHASE_COLOR
} from "./plan.js";
import { sync, loadSettings, saveSettings, forgetToken, maskToken, isConfigured } from "./sync.js";
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
   Sync indicator — one small element, four states, no toast
   ============================================================ */
function renderSyncIndicator(){
  const dot = $("sync-indicator");
  const label = $("sync-label");
  dot.dataset.state = sync.state;

  let text;
  let title;
  switch(sync.state){
    case "syncing":
      text = "Syncing";
      title = "Talking to your data repo";
      break;
    case "synced":
      text = "Synced " + relativeTime(sync.lastSyncedAt);
      title = "Last synced " + new Date(sync.lastSyncedAt).toLocaleString();
      break;
    case "offline":
      text = "Offline";
      title = "No network. Your data is safe on this device and will sync when you are back.";
      break;
    case "failed":
      text = "Not synced";
      title = "Not synced — your data is safe on this device. " + (sync.lastError || "");
      break;
    case "idle":
      text = sync.lastSyncedAt ? "Synced " + relativeTime(sync.lastSyncedAt) : "Sync ready";
      title = "Sync is configured";
      break;
    default:
      text = "Local only";
      title = "No token on this device. Everything works; nothing leaves the phone.";
  }
  label.textContent = text;
  dot.title = title;
  dot.setAttribute("aria-label", "Sync status: " + text + ". Opens sync settings.");
}

function relativeTime(iso){
  if(!iso) return "";
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if(seconds < 45) return "just now";
  if(seconds < 90) return "1 min ago";
  const minutes = Math.round(seconds / 60);
  if(minutes < 60) return minutes + " min ago";
  const hours = Math.round(minutes / 60);
  if(hours < 24) return hours + (hours === 1 ? " hour ago" : " hours ago");
  const days = Math.round(hours / 24);
  return days + (days === 1 ? " day ago" : " days ago");
}

/* "week 12, Tue" for the commit subject. */
function commitLabel(){
  let bestKey = null;
  let bestId = null;
  let bestTime = -1;
  const weeks = store.state.weeks;
  for(const key in weeks){
    const sessions = weeks[key].sessions;
    for(const id in sessions){
      const t = Date.parse(sessions[id].updatedAt || "");
      if(isFinite(t) && t > bestTime){
        bestTime = t;
        bestKey = key;
        bestId = id;
      }
    }
  }
  if(bestKey === null) return "";
  const week = app.plan && app.plan.weeks[Number(bestKey)];
  if(!week) return "week " + (Number(bestKey) + 1);
  const travel = store.isTravel(Number(bestKey));
  const list = travel ? app.plan.travelWeekSessions : week.sessions;
  const session = list.find(s => s.id === bestId);
  return "week " + week.week + (session ? ", " + session.day : "");
}

/* ============================================================
   Settings panel
   ============================================================ */
function wireSettings(){
  const dialog = $("settings");
  const user = $("set-user");
  const repo = $("set-repo");
  const token = $("set-token");
  const tokenState = $("set-token-state");
  const result = $("settings-result");

  const say = (message, kind) => {
    result.textContent = message || "";
    result.className = "dlgresult" + (kind ? " " + kind : "");
  };

  const fill = () => {
    const settings = loadSettings();
    user.value = settings.user;
    repo.value = settings.repo;
    token.value = "";
    if(settings.token){
      token.placeholder = "•••• stored on this device";
      tokenState.textContent = "Stored: " + maskToken(settings.token) +
                               " — leave blank to keep it.";
    } else {
      token.placeholder = "github_pat_…";
      tokenState.textContent = "No token on this device.";
    }
    say("");
  };

  const collect = () => {
    const existing = loadSettings();
    return {
      user: user.value.trim(),
      repo: repo.value.trim() || "hm-2027-data",
      /* Blank means "keep what is stored", so re-saving a username does
         not silently wipe the token. */
      token: token.value.trim() || existing.token
    };
  };

  $("sync-indicator").addEventListener("click", () => {
    fill();
    dialog.showModal();
  });

  $("settings-form").addEventListener("submit", event => {
    event.preventDefault();
    const settings = saveSettings(collect());
    renderSyncIndicator();
    if(isConfigured(settings)){
      say("Saved. Syncing now…", "ok");
      sync.run("settings-saved").then(() => {
        say(sync.state === "synced" ? "Synced." : (sync.lastError || "Not synced yet."),
            sync.state === "synced" ? "ok" : "bad");
        fillTokenState();
      });
    } else {
      say("Saved. Sync is off until all three are filled in.", "");
    }
  });

  const fillTokenState = () => {
    const settings = loadSettings();
    tokenState.textContent = settings.token
      ? "Stored: " + maskToken(settings.token) + " — leave blank to keep it."
      : "No token on this device.";
  };

  $("set-test").addEventListener("click", async () => {
    const settings = collect();
    if(!settings.user || !settings.repo || !settings.token){
      say("Fill in all three first.", "bad");
      return;
    }
    say("Checking…");
    const outcome = await sync.test(settings);
    say(outcome.ok ? outcome.note : outcome.error, outcome.ok ? "ok" : "bad");
  });

  $("set-sync").addEventListener("click", async () => {
    if(!isConfigured(sync.settings)){
      say("Save your username, repo and token first.", "bad");
      return;
    }
    say("Syncing…");
    await sync.run("manual");
    say(sync.state === "synced" ? "Synced." : (sync.lastError || "Not synced."),
        sync.state === "synced" ? "ok" : "bad");
  });

  $("set-forget").addEventListener("click", () => {
    if(!window.confirm("Forget the token on this device? Your log stays; it just stops syncing.")) return;
    forgetToken();
    fill();
    renderSyncIndicator();
    say("Token forgotten on this device.", "ok");
  });

  $("set-close").addEventListener("click", () => dialog.close());
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
  /* The log comes off disk before anything renders, so the first paint
     already shows what was logged rather than flashing an empty week. */
  store.load();
  installFlushHandlers();

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
  wireSettings();
  renderLedger();
  renderGauges();
  switchTab("week");

  /* Sync redraws the indicator on every state change, and the whole view
     when a merge brings something down from another device. */
  sync.onChange = renderSyncIndicator;
  sync.onApplied = () => ctx.refresh();
  sync.commitLabel = commitLabel;
  sync.init();
  renderSyncIndicator();
  if(isConfigured(sync.settings)) sync.run("load");

  /* Keep "synced 3 min ago" honest without polling the network. */
  setInterval(() => {
    if(sync.state === "synced" || sync.state === "idle") renderSyncIndicator();
  }, 30000);

  /* Bring the selected week into view in the ledger without yanking the page. */
  const bar = $("strip").children[app.index];
  if(bar && bar.scrollIntoView){
    bar.scrollIntoView({ block:"nearest", inline:"center" });
  }

  registerServiceWorker();
}

/* The offline shell. Registered after the first render so it never
   competes with the plan for the first paint, and skipped entirely on
   file:// where it cannot work. */
function registerServiceWorker(){
  if(!("serviceWorker" in navigator)) return;
  const secure = location.protocol === "https:" ||
                 location.hostname === "localhost" ||
                 location.hostname === "127.0.0.1";
  if(!secure) return;
  navigator.serviceWorker.register("sw.js").catch(err => {
    console.warn("service worker did not register — " + err.message);
  });
}

boot();
