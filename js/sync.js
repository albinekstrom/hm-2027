/* ============================================================
   sync.js — the private data repo, reached from the browser.

   Offline-first. Every edit is already on this device before anything
   here runs; sync is a background reconciliation that is allowed to
   fail. Nothing in this file may block the UI, and nothing in it may
   lose an edit made on another device.

   The token lives in localStorage and travels only in an Authorization
   header — never in a URL, a query string, a commit or a log line.
   ============================================================ */
"use strict";

import { store, normaliseState, LOG_VERSION } from "./store.js";

const SETTINGS_KEY = "hm2027:settings";
const API = "https://api.github.com";
const PUSH_DELAY = 3000;          // debounce after an edit
const FILE = "log.json";

/* ============================================================
   Settings
   ============================================================ */
function blankSettings(){
  return { user:"", repo:"hm-2027-data", token:"" };
}

export function loadSettings(){
  try{
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
    if(!raw || typeof raw !== "object") return blankSettings();
    return {
      user: String(raw.user || "").trim(),
      repo: String(raw.repo || "").trim() || "hm-2027-data",
      token: String(raw.token || "")
    };
  } catch (err){
    return blankSettings();
  }
}

export function saveSettings(next){
  const settings = {
    user: String(next.user || "").trim(),
    repo: String(next.repo || "").trim(),
    token: String(next.token || "")
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  sync.settings = settings;
  sync.setState(settings.token && settings.user && settings.repo ? "idle" : "local");
  return settings;
}

export function forgetToken(){
  const settings = loadSettings();
  settings.token = "";
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  sync.settings = settings;
  sync.sha = null;
  sync.setState("local");
}

/* Masked for display. Enough to tell two tokens apart, not enough to use. */
export function maskToken(token){
  if(!token) return "";
  const tail = token.slice(-4);
  return "•".repeat(Math.max(8, Math.min(24, token.length - 4))) + tail;
}

export function isConfigured(settings = sync.settings){
  return !!(settings.user && settings.repo && settings.token);
}

/* ============================================================
   base64 — must survive "Skenben, körde grusrundan"

   btoa throws on anything above U+00FF, so go through UTF-8 bytes
   in both directions. A note in Swedish is not an edge case here.
   ============================================================ */
export function encodeBase64(text){
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  const CHUNK = 0x8000;
  for(let i = 0; i < bytes.length; i += CHUNK){
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
export function decodeBase64(b64){
  const binary = atob(String(b64).replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for(let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/* ============================================================
   Merge — newest updatedAt wins per leaf

   Leaves are: each session object, each week's travel flag, each
   week's note, tt and cadence. Never the whole file. Two devices
   editing the same week is the normal case, not the exception.

   No tombstones: a session that exists on either side survives.
   Deleting is done by clearing or importing, which push
   authoritatively instead of merging.
   ============================================================ */
export function mergeLogs(local, remote){
  if(!remote) return local;
  if(!local) return remote;

  /* Does an absent field stamp mean "untouched", or "written before field
     stamps existed"? The document version answers it, per side. */
  const localFields = usesFieldStamps(local);
  const remoteFields = usesFieldStamps(remote);
  const pick = (aAt, bAt, aFallback, bFallback) =>
    newer(effective(aAt, aFallback, localFields), effective(bAt, bFallback, remoteFields));

  const out = {
    version: LOG_VERSION,
    deviceId: local.deviceId,
    tt: pick(local.ttAt, remote.ttAt, local.updatedAt, remote.updatedAt) === "remote"
        ? { ...remote.tt } : { ...local.tt },
    ttAt: latest(local.ttAt, remote.ttAt),
    cadence: pick(local.cadenceAt, remote.cadenceAt, local.updatedAt, remote.updatedAt) === "remote"
        ? { ...remote.cadence } : { ...local.cadence },
    cadenceAt: latest(local.cadenceAt, remote.cadenceAt),
    updatedAt: latest(local.updatedAt, remote.updatedAt) || new Date().toISOString(),
    weeks: {}
  };

  const keys = new Set([...Object.keys(local.weeks || {}), ...Object.keys(remote.weeks || {})]);
  for(const key of keys){
    const a = (local.weeks || {})[key];
    const b = (remote.weeks || {})[key];
    if(!a){ out.weeks[key] = b; continue; }
    if(!b){ out.weeks[key] = a; continue; }

    const travelFromRemote = pick(a.travelAt, b.travelAt, a.updatedAt, b.updatedAt) === "remote";
    const noteFromRemote = pick(a.noteAt, b.noteAt, a.updatedAt, b.updatedAt) === "remote";

    const week = {
      travel: travelFromRemote ? !!b.travel : !!a.travel,
      travelAt: latest(a.travelAt, b.travelAt),
      note: noteFromRemote ? (b.note || "") : (a.note || ""),
      noteAt: latest(a.noteAt, b.noteAt),
      updatedAt: latest(a.updatedAt, b.updatedAt),
      sessions: {}
    };

    const ids = new Set([...Object.keys(a.sessions || {}), ...Object.keys(b.sessions || {})]);
    for(const id of ids){
      const sa = (a.sessions || {})[id];
      const sb = (b.sessions || {})[id];
      if(!sa){ week.sessions[id] = sb; continue; }
      if(!sb){ week.sessions[id] = sa; continue; }
      /* A tie keeps local. Deterministic beats clever: with no vector
         clocks, flapping between two devices is the thing to avoid. */
      week.sessions[id] = stamp(sb) > stamp(sa) ? sb : sa;
    }
    out.weeks[key] = week;
  }
  return out;
}

function stamp(obj){
  const t = obj && obj.updatedAt ? Date.parse(obj.updatedAt) : NaN;
  return isFinite(t) ? t : 0;
}
function usesFieldStamps(doc){
  return Number(doc && doc.version) >= 2;
}

/* When a document uses field stamps, a missing one means the field was never
   touched there — so it must not inherit the container's stamp and beat a
   real edit on the other side. Toggling travel on the phone used to lose to
   typing a note on the laptop for exactly that reason. */
function effective(fieldAt, containerAt, hasFieldStamps){
  const own = time(fieldAt);
  if(own) return own;
  return hasFieldStamps ? 0 : time(containerAt);
}

function newer(a, b){
  return b > a ? "remote" : "local";
}
function time(v){
  const t = v ? Date.parse(v) : NaN;
  return isFinite(t) ? t : 0;
}
function latest(a, b){
  const ta = time(a);
  const tb = time(b);
  if(!ta && !tb) return null;
  return tb > ta ? b : a;
}

/* ============================================================
   The sync object
   ============================================================ */
export const sync = {
  settings: blankSettings(),
  state: "local",          // local | idle | syncing | synced | offline | failed
  lastSyncedAt: null,
  lastError: "",
  sha: null,               // blob sha of log.json as we last saw it
  pushTimer: null,
  running: false,
  queued: false,
  onChange: null,          // the indicator redraws from here
  commitLabel: () => "",   // app.js supplies "week 12, Tue"

  init(){
    this.settings = loadSettings();
    this.state = isConfigured(this.settings) ? "idle" : "local";
    store.onSaved = () => this.schedulePush();

    document.addEventListener("visibilitychange", () => {
      if(document.visibilityState === "visible" && isConfigured(this.settings)){
        this.run("visible");
      }
    });
    /* Coming back online is worth a try; going offline just relabels. */
    window.addEventListener("online", () => {
      if(isConfigured(this.settings)) this.run("online");
    });
    window.addEventListener("offline", () => {
      if(isConfigured(this.settings)) this.setState("offline");
    });
  },

  setState(state, error){
    this.state = state;
    this.lastError = error || "";
    if(state === "synced") this.lastSyncedAt = new Date().toISOString();
    if(this.onChange) this.onChange();
  },

  /* Debounced 3 s after an edit. Never a timer while backgrounded. */
  schedulePush(){
    if(!isConfigured(this.settings)) return;
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      this.run("edit");
    }, PUSH_DELAY);
  },

  /* One sync at a time; a request arriving mid-flight runs after. */
  async run(reason){
    if(!isConfigured(this.settings)){
      this.setState("local");
      return;
    }
    if(this.running){
      this.queued = true;
      return;
    }
    if(navigator.onLine === false){
      this.setState("offline");
      return;
    }
    this.running = true;
    this.setState("syncing");
    try{
      await this.reconcile(reason);
    } catch (err){
      if(isOffline(err)){
        this.setState("offline");
      } else {
        console.warn("sync: " + err.message);
        this.setState("failed", err.message);
      }
    } finally {
      this.running = false;
      if(this.queued){
        this.queued = false;
        this.run("queued");
      }
    }
  },

  /* Read, merge, write back only if the merge changed anything.
     On a conflict: re-fetch, merge again, retry once. */
  async reconcile(reason){
    const authoritative = store.authoritative;
    const remote = await this.read();

    let next;
    if(authoritative){
      /* A clear or an import replaces the repo rather than merging with it. */
      next = store.state;
    } else {
      next = mergeLogs(store.state, remote.log);
      const merged = normaliseState(next, store.state.deviceId);
      if(!sameLog(merged, store.state)){
        store.applyMerged(merged);
        if(this.onApplied) this.onApplied();
      }
      next = store.state;
    }

    const needsPush = authoritative || !remote.log || !sameLog(next, remote.log);
    if(!needsPush){
      store.authoritative = false;
      this.setState("synced");
      return;
    }

    try{
      await this.write(next, remote.sha);
      store.authoritative = false;
      this.setState("synced");
    } catch (err){
      if(!err.conflict) throw err;
      /* Somebody else wrote between our read and our write. */
      const fresh = await this.read();
      const remerged = authoritative
        ? store.state
        : normaliseState(mergeLogs(store.state, fresh.log), store.state.deviceId);
      if(!authoritative && !sameLog(remerged, store.state)){
        store.applyMerged(remerged);
        if(this.onApplied) this.onApplied();
      }
      await this.write(store.authoritative ? store.state : remerged, fresh.sha);
      store.authoritative = false;
      this.setState("synced");
    }
  },

  /* ---------- the two API calls ---------- */
  async read(){
    const res = await this.request("GET", this.contentsPath());
    if(res.status === 404){
      this.sha = null;
      return { log:null, sha:null };      // first push will create the file
    }
    if(!res.ok) throw await apiError(res);
    const body = await res.json();
    this.sha = body.sha || null;
    let log = null;
    try{
      log = normaliseState(JSON.parse(decodeBase64(body.content || "")), store.state.deviceId);
    } catch (err){
      /* A corrupt log.json must not take the local one with it. */
      throw new Error("log.json in the repo is not readable JSON");
    }
    return { log, sha:this.sha };
  },

  async write(state, sha){
    const payload = {
      message: commitMessage(this.commitLabel()),
      content: encodeBase64(JSON.stringify(state, null, 2) + "\n")
    };
    if(sha) payload.sha = sha;

    const res = await this.request("PUT", this.contentsPath(), payload);
    if(res.status === 409 || res.status === 422){
      const err = new Error("log.json moved under us");
      err.conflict = true;
      throw err;
    }
    if(!res.ok) throw await apiError(res);
    const body = await res.json();
    this.sha = (body.content && body.content.sha) || null;
    return this.sha;
  },

  contentsPath(){
    const { user, repo } = this.settings;
    return "/repos/" + encodeURIComponent(user) + "/" + encodeURIComponent(repo) +
           "/contents/" + FILE;
  },

  request(method, path, body){
    return fetch(API + path, {
      method,
      cache: "no-store",
      headers: {
        /* The token is a header, never part of the URL. */
        "Authorization": "Bearer " + this.settings.token,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type":"application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
  },

  /* Used by the settings panel to check credentials without writing. */
  async test(settings){
    const previous = this.settings;
    this.settings = settings;
    try{
      const res = await this.request("GET", this.contentsPath());
      if(res.status === 404) return { ok:true, note:"Repo reached. log.json will be created on the first sync." };
      if(res.status === 401) return { ok:false, error:"That token was rejected. Check it has not expired." };
      if(res.status === 403) return { ok:false, error:"Token lacks Contents: Read and write on this repo." };
      if(res.status === 404) return { ok:false, error:"No such repo for that user." };
      if(!res.ok){
        const err = await apiError(res);
        return { ok:false, error:err.message };
      }
      return { ok:true, note:"Repo reached and log.json found." };
    } catch (err){
      return { ok:false, error:isOffline(err) ? "No network right now." : err.message };
    } finally {
      this.settings = previous;
    }
  }
};

/* "log: week 12, Tue" — the athlete's history should read like a log,
   not like a machine's. Never includes anything sensitive. */
function commitMessage(label){
  return label ? "log: " + label : "log: update";
}

async function apiError(res){
  let detail = "";
  try{
    const body = await res.json();
    detail = body && body.message ? body.message : "";
  } catch (err){ /* non-JSON error body */ }
  const map = {
    401: "Token rejected — it may have expired",
    403: "Token is not allowed to write there",
    404: "Repo or file not found",
    422: "GitHub refused the write"
  };
  const message = map[res.status] || ("GitHub returned " + res.status);
  return new Error(detail && !map[res.status] ? message + ": " + detail : message);
}

/* A failed fetch is indistinguishable from being offline at this level,
   and the honest label for both is "offline". */
function isOffline(err){
  return err instanceof TypeError || /network|failed to fetch|load failed/i.test(err.message || "");
}

/* Compare what is actually logged, ignoring bookkeeping timestamps. */
function sameLog(a, b){
  return logFingerprint(a) === logFingerprint(b);
}
function logFingerprint(state){
  if(!state) return "";
  const weeks = Object.keys(state.weeks || {}).sort();
  const parts = [
    "tt:" + state.tt.dist + "/" + state.tt.time,
    "cad:" + state.cadence.now + "/" + state.cadence.target
  ];
  for(const key of weeks){
    const w = state.weeks[key];
    const ids = Object.keys(w.sessions || {}).sort();
    const sessions = ids.map(id => {
      const s = w.sessions[id];
      return id + "=" + (s.done ? 1 : 0) + "," + s.km + "," + s.pain;
    }).join(";");
    parts.push(key + "[" + (w.travel ? "T" : "-") + "|" + w.note + "|" + sessions + "]");
  }
  return parts.join("\n");
}
