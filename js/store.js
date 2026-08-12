/* ============================================================
   store.js — the log. This is the only thing that changes.

   Writes land in memory and in localStorage immediately; nothing
   here waits on a network. sync.js layers on top of this in phase 5.
   ============================================================ */
"use strict";

import { toast } from "./dom.js";

/* Version 2 adds per-field timestamps (travelAt, noteAt, ttAt, cadenceAt).
   The number is what tells the merge whether a missing field stamp means
   "this device never touched that field" (v2) or "this shape predates field
   stamps, fall back to the week" (v1). Nothing else about v1 changes, so
   there is no data migration — only a difference in how it is read. */
export const LOG_VERSION = 2;
const LOG_KEY = "hm2027:log";
const SAVE_DELAY = 350;

/* Reading a week or session that has never been touched must not create it.
   An empty log stays empty, which keeps log.json small and the merge honest. */
const EMPTY_SESSION = Object.freeze({ done:false, km:"", pain:"", updatedAt:null });
const EMPTY_WEEK = Object.freeze({
  travel:false, note:"", updatedAt:null, travelAt:null, noteAt:null, sessions:{}
});

function nowISO(){ return new Date().toISOString(); }

function newDeviceId(){
  const bytes = new Uint8Array(2);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  const kind = /iPhone|iPad|Android|Mobile/.test(navigator.userAgent) ? "phone" : "desk";
  return kind + "-" + hex;
}

function blankState(){
  return {
    version: LOG_VERSION,
    updatedAt: nowISO(),
    deviceId: newDeviceId(),
    tt: { dist:3, time:690 },          // 3 km in 11:30 until a real test lands
    cadence: { now:"", target:"" },
    /* Per-field stamps. The merge rule asks for tt, cadence, travel and note
       to reconcile independently, and one timestamp per week cannot say which
       of two fields a device actually touched. These are additive: a log
       written without them falls back to the week or document stamp. */
    ttAt: null,
    cadenceAt: null,
    weeks: {}
  };
}

/* ============================================================
   Shape guard

   Anything coming off disk, out of a file the athlete picked, or
   down from GitHub goes through here. It never throws and never
   discards a week it can partly understand: a log that survives
   is worth more than a log that is perfectly typed.
   ============================================================ */
export function normaliseState(raw, fallbackDeviceId){
  const base = blankState();
  if(!raw || typeof raw !== "object") return base;

  const out = {
    /* Kept as found, not relabelled: the merge reads it to know whether
       absent field stamps are meaningful. */
    version: resolveVersion(raw),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : base.updatedAt,
    deviceId: typeof raw.deviceId === "string" && raw.deviceId ? raw.deviceId
            : (fallbackDeviceId || base.deviceId),
    tt: { dist:base.tt.dist, time:base.tt.time },
    cadence: { now:"", target:"" },
    ttAt: iso(raw.ttAt),
    cadenceAt: iso(raw.cadenceAt),
    weeks: {}
  };

  if(raw.tt && typeof raw.tt === "object"){
    const dist = Number(raw.tt.dist);
    const time = Number(raw.tt.time);
    if(isFinite(dist) && dist > 0) out.tt.dist = dist;
    if(isFinite(time) && time > 0) out.tt.time = Math.round(time);
  }
  if(raw.cadence && typeof raw.cadence === "object"){
    out.cadence.now = str(raw.cadence.now);
    out.cadence.target = str(raw.cadence.target);
  }

  const weeks = raw.weeks && typeof raw.weeks === "object" ? raw.weeks : {};
  for(const key in weeks){
    if(!/^\d+$/.test(key)) continue;              // week keys are the index, as a string
    const w = weeks[key];
    if(!w || typeof w !== "object") continue;
    const week = {
      travel: !!w.travel,
      note: str(w.note),
      updatedAt: iso(w.updatedAt),
      travelAt: iso(w.travelAt),
      noteAt: iso(w.noteAt),
      sessions: {}
    };
    const sessions = w.sessions && typeof w.sessions === "object" ? w.sessions : {};
    for(const id in sessions){
      const s = sessions[id];
      if(!s || typeof s !== "object") continue;
      week.sessions[id] = {
        done: !!s.done,
        km: kmString(s.km),
        pain: painString(s.pain),
        updatedAt: iso(s.updatedAt)
      };
    }
    out.weeks[key] = week;
  }
  return out;
}

/* An explicit version wins. Without one, a document that carries any field
   stamp is version 2; anything else is read with version 1 semantics. */
function resolveVersion(raw){
  const stated = Number(raw.version);
  if(isFinite(stated) && stated >= 1) return Math.min(stated, LOG_VERSION);
  if(raw.ttAt || raw.cadenceAt) return 2;
  const weeks = raw.weeks && typeof raw.weeks === "object" ? raw.weeks : {};
  for(const key in weeks){
    const w = weeks[key];
    if(w && typeof w === "object" && (w.travelAt || w.noteAt)) return 2;
  }
  return 1;
}

function str(v){ return v == null ? "" : String(v); }
/* A timestamp we can compare, or null. Anything unparseable is treated as
   absent rather than as the epoch, so it loses to a real stamp on merge. */
function iso(v){
  if(typeof v !== "string" || !v) return null;
  const t = Date.parse(v);
  return isFinite(t) ? v : null;
}
/* km and pain stay strings: "" means not recorded, which is not the same as 0. */
function kmString(v){
  if(v == null || v === "") return "";
  const n = Number(String(v).replace(",", "."));
  return isFinite(n) && n >= 0 ? String(v).replace(",", ".") : "";
}
function painString(v){
  const s = str(v);
  return /^[0-3]$/.test(s) ? s : "";
}

/* ============================================================
   Migrations

   Nothing to migrate yet — version 1 is the first shape. A log
   written by a newer version of the site is left alone rather
   than downgraded, so an old tab cannot quietly destroy it.
   ============================================================ */
function migrate(raw){
  if(!raw || typeof raw !== "object") return raw;
  const version = Number(raw.version);
  if(!isFinite(version) || version === LOG_VERSION) return raw;
  if(version > LOG_VERSION){
    console.warn("store: log is version " + version + ", this site understands " + LOG_VERSION +
                 ". Loading it read-as-is; update the site before editing on this device.");
    return raw;
  }
  /* version < LOG_VERSION: future migrations chain here. */
  return raw;
}

/* ============================================================
   The store
   ============================================================ */
export const store = {
  state: blankState(),
  persistent: true,        // false once a write has failed, so we stop lying
  saveTimer: null,
  onSaved: null,           // sync.js schedules a push from here
  applying: false,         // true while sync writes a merged result in
  authoritative: false,    // next push replaces the repo instead of merging

  /* ---------- boot ---------- */
  load(){
    let raw = null;
    try{
      const text = localStorage.getItem(LOG_KEY);
      if(text) raw = JSON.parse(text);
    } catch (err){
      /* Corrupt JSON, or Safari with storage blocked. Keep the bad text
         under a side key rather than overwriting it with a blank log. */
      console.warn("store: could not read the saved log — " + err.message);
      try{
        const text = localStorage.getItem(LOG_KEY);
        if(text) localStorage.setItem(LOG_KEY + ":broken:" + Date.now(), text);
      } catch (ignored){ /* nothing more we can do */ }
      raw = null;
    }
    const deviceId = this.state.deviceId;
    this.state = normaliseState(migrate(raw), deviceId);
    if(!raw) this.saveNow();      // stamp a device id on first run
    return this.state;
  },

  /* ---------- week-level ---------- */
  week(i){
    return this.state.weeks[String(i)] || EMPTY_WEEK;
  },
  /* Creates the week only when something is actually being written. */
  weekForWrite(i){
    const k = String(i);
    let w = this.state.weeks[k];
    if(!w){
      w = { travel:false, note:"", updatedAt:nowISO(), travelAt:null, noteAt:null, sessions:{} };
      this.state.weeks[k] = w;
    }
    if(!w.sessions) w.sessions = {};
    return w;
  },
  isTravel(i){ return !!this.week(i).travel; },
  note(i){ return this.week(i).note || ""; },

  setTravel(i, on){
    const w = this.weekForWrite(i);
    w.travel = !!on;
    w.travelAt = nowISO();
    this.touchWeek(w);
  },
  setNote(i, text){
    const w = this.weekForWrite(i);
    w.note = text;
    w.noteAt = nowISO();
    this.touchWeek(w);
  },

  /* ---------- session-level ---------- */
  session(i, id){
    return this.week(i).sessions[id] || EMPTY_SESSION;
  },
  setSessionField(i, id, field, value){
    const w = this.weekForWrite(i);
    let s = w.sessions[id];
    if(!s){
      s = { done:false, km:"", pain:"", updatedAt:null };
      w.sessions[id] = s;
    }
    s[field] = value;
    s.updatedAt = nowISO();
    this.state.updatedAt = s.updatedAt;
    this.save();
  },

  /* ---------- derived ---------- */
  loggedKm(i){
    const w = this.week(i);
    let total = 0;
    for(const id in w.sessions){
      const v = parseFloat(w.sessions[id].km);
      if(!isNaN(v)) total += v;
    }
    return total;
  },
  /* The worst shin value logged in a week decides that week's verdict.
     null means nothing recorded at all. */
  worstPain(i){
    const w = this.week(i);
    let worst = null;
    for(const id in w.sessions){
      const raw = w.sessions[id].pain;
      if(raw === "" || raw == null) continue;
      const p = parseInt(raw, 10);
      if(isNaN(p)) continue;
      if(worst === null || p > worst) worst = p;
    }
    return worst;
  },
  countLogged(){
    let sessions = 0;
    let weeks = 0;
    for(const key in this.state.weeks){
      const w = this.state.weeks[key];
      const n = Object.keys(w.sessions).length;
      if(n || w.note || w.travel) weeks++;
      sessions += n;
    }
    return { weeks, sessions };
  },

  /* ---------- test result and cadence ---------- */
  get tt(){ return this.state.tt; },
  get cadence(){ return this.state.cadence; },
  setTT(dist, time){
    this.state.tt = { dist, time };
    this.state.ttAt = nowISO();
    this.state.updatedAt = this.state.ttAt;
    this.save();
  },
  setCadence(field, value){
    this.state.cadence[field] = value;
    this.state.cadenceAt = nowISO();
    this.state.updatedAt = this.state.cadenceAt;
    this.save();
  },

  /* ---------- housekeeping ---------- */
  /* Clearing is a decision, not an edit. Merging a cleared log against a full
     remote would quietly undo it, so this marks the next push as authoritative:
     local replaces the repo instead of reconciling with it. */
  clearAll(){
    const id = this.state.deviceId;
    this.state = blankState();
    this.state.deviceId = id;
    this.authoritative = true;
    this.saveNow();
  },
  touchWeek(w){
    w.updatedAt = nowISO();
    this.state.updatedAt = w.updatedAt;
    this.save();
  },

  /* ---------- persistence ---------- */
  save(){
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), SAVE_DELAY);
  },
  /* Called on the debounce, and directly whenever the page might be
     about to disappear — a force-quit 200 ms after typing must not
     cost the athlete the run they just logged. */
  saveNow(){
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    try{
      localStorage.setItem(LOG_KEY, JSON.stringify(this.state));
      if(!this.persistent){
        this.persistent = true;
      }
      /* Applying a merged result must not schedule another push of the
         same thing straight back up. */
      if(this.onSaved && !this.applying) this.onSaved();
      return true;
    } catch (err){
      if(this.persistent){
        this.persistent = false;
        console.warn("store: save failed — " + err.message);
        toast("Could not save on this device — export your log");
      }
      return false;
    }
  },
  flush(){
    if(this.saveTimer !== null) this.saveNow();
  },

  /* ---------- export / import ----------
     The manual path, and the fallback for when sync misbehaves. */
  exportJSON(){
    return JSON.stringify(this.state, null, 2);
  },
  exportFilename(){
    const stamp = new Date().toISOString().slice(0, 10);
    return "hm-2027-log-" + stamp + ".json";
  },
  /* Replaces the log on this device. The caller confirms first. */
  importJSON(text){
    let raw;
    try{
      raw = JSON.parse(text);
    } catch (err){
      return { ok:false, error:"That file is not valid JSON." };
    }
    if(!raw || typeof raw !== "object" || (raw.weeks && typeof raw.weeks !== "object")){
      return { ok:false, error:"That JSON is not a training log." };
    }
    const next = normaliseState(migrate(raw), this.state.deviceId);
    /* Keep this device's own id: two devices must not claim to be the same one. */
    next.deviceId = this.state.deviceId;
    this.state = next;
    /* Restoring a backup is a decision too — it replaces the repo rather
       than merging back into what it was meant to replace. */
    this.authoritative = true;
    const saved = this.saveNow();
    const counts = this.countLogged();
    return { ok:true, saved, ...counts };
  },

  /* Used by sync to install a merged result without echoing it back up. */
  applyMerged(state){
    this.applying = true;
    try{
      state.deviceId = this.state.deviceId;
      this.state = state;
      this.saveNow();
    } finally {
      this.applying = false;
    }
  }
};

/* A force-quit, a swipe away, or a tab going to the background all land
   here before the debounce would have fired. */
export function installFlushHandlers(){
  window.addEventListener("pagehide", () => store.flush());
  window.addEventListener("beforeunload", () => store.flush());
  document.addEventListener("visibilitychange", () => {
    if(document.visibilityState === "hidden") store.flush();
  });
}

export function painColor(p){
  if(p === null || p === undefined) return "var(--line2)";
  if(p === 0) return "var(--moss)";
  if(p === 1) return "var(--amber)";
  return "var(--signal)";
}
export function painWord(p){
  if(p === null || p === undefined) return "—";
  return p === 0 ? "Clear" : p === 1 ? "Niggle" : "Stop";
}
