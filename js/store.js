/* ============================================================
   store.js — the log. This is the only thing that changes.

   Phase 2: state shape and accessors, held in memory.
   Phase 3 adds localStorage persistence, migrations and
   export/import behind the same API.
   ============================================================ */
"use strict";

export const LOG_VERSION = 1;

/* Reading a week or session that has never been touched must not create it.
   An empty log stays empty, which keeps log.json small and the merge honest. */
const EMPTY_SESSION = Object.freeze({ done:false, km:"", pain:"", updatedAt:null });
const EMPTY_WEEK = Object.freeze({ travel:false, note:"", updatedAt:null, sessions:{} });

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
    weeks: {}
  };
}

export const store = {
  state: blankState(),

  /* ---------- week-level ---------- */
  week(i){
    return this.state.weeks[String(i)] || EMPTY_WEEK;
  },
  /* Creates the week only when something is actually being written. */
  weekForWrite(i){
    const k = String(i);
    let w = this.state.weeks[k];
    if(!w){
      w = { travel:false, note:"", updatedAt:nowISO(), sessions:{} };
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
    this.touchWeek(w);
  },
  setNote(i, text){
    const w = this.weekForWrite(i);
    w.note = text;
    this.touchWeek(w);
  },

  /* ---------- session-level ---------- */
  session(i, id){
    const s = this.week(i).sessions[id];
    return s || EMPTY_SESSION;
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

  /* ---------- test result and cadence ---------- */
  get tt(){ return this.state.tt; },
  get cadence(){ return this.state.cadence; },
  setTT(dist, time){
    this.state.tt = { dist, time };
    this.state.updatedAt = nowISO();
    this.save();
  },
  setCadence(field, value){
    this.state.cadence[field] = value;
    this.state.updatedAt = nowISO();
    this.save();
  },

  /* ---------- housekeeping ---------- */
  clearAll(){
    const id = this.state.deviceId;
    this.state = blankState();
    this.state.deviceId = id;
    this.save();
  },
  touchWeek(w){
    w.updatedAt = nowISO();
    this.state.updatedAt = w.updatedAt;
    this.save();
  },

  /* Phase 3 replaces this with a debounced localStorage write. */
  save(){}
};

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
