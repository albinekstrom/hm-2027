/* ============================================================
   views/week.js — the default view, and the one that has to be
   perfect on a phone.
   ============================================================ */
"use strict";

import { esc, paint, normaliseDecimal } from "../dom.js";
import { store } from "../store.js";
import { fmtD, fmtDY, phaseOf, sessionsFor, targetFor, findSession, round1, PHASE_COLOR } from "../plan.js";

const TRAVEL_RULE =
  "Cut volume, keep the intensity. Two runs hold your fitness; three is a good week. " +
  "Do not try to win back missed kilometres next week — pick the plan back up where it stands.";

const VERDICTS = {
  0: { cls:"g", title:"Green — progress as written",
       body:"No shin pain during, after, or the next morning. Move to next week’s volume." },
  1: { cls:"a", title:"Amber — hold, do not add",
       body:"Repeat this week’s volume instead of increasing, drop one hard session, and keep the calf and soleus " +
            "work going. Only progress once you log two clear weeks." },
  2: { cls:"r", title:"Red — stop running and get it looked at",
       body:"Pain during the run, pain that limits you, or tenderness you can cover with two fingertips on the bone " +
            "means you treat this as a bone stress injury until proven otherwise. Swap to cycling, swimming or " +
            "skating, keep lifting, and book a physio. Coming back six weeks late beats coming back three times." }
};

const PAIN_OPTIONS = [
  ["",  "—"],
  ["0", "0 clear"],
  ["1", "1 niggle"],
  ["2", "2 limits me"],
  ["3", "3 sharp or focal"]
];

export function renderWeek(ctx){
  const { plan, index } = ctx;
  const week = plan.weeks[index];
  const phase = phaseOf(plan, week);
  const travel = store.isTravel(index);
  const sessions = sessionsFor(plan, index, travel);
  const target = targetFor(plan, index, travel);
  const logged = round1(store.loggedKm(index));

  let h = "";

  /* ---------- header card ---------- */
  h += '<div class="card">';
  h += '<div class="wkhead"><div>';
  h += '<div class="wknum">Week ' + week.week +
       (week.isTestWeek ? ' · test' : '') + (week.isDownWeek ? ' · down' : '') + '</div>';
  h += '<div class="wkdate">' + esc(fmtD(week.startDate)) + ' – ' + esc(fmtDY(week.endDate)) + '</div>';
  h += '</div><div class="row">';
  h += '<span class="phasetag" style="background:' + (PHASE_COLOR[phase.id] || 'var(--slate)') + '">' +
       esc(phase.name) + '</span>';
  h += '<button class="pill' + (travel ? ' on' : '') + '" id="travel-toggle" aria-pressed="' + travel + '">' +
       (travel ? 'Travel week: on' : 'Travel week') + '</button>';
  h += '</div></div>';
  h += '<p class="wkbrief">' + esc(phase.brief) + '</p>';
  h += '<div class="wkfacts"><span>Target ' + target + ' km</span><span>·</span>' +
       '<span>Logged ' + logged + ' km</span><span>·</span>' +
       '<span>Long run ' + (travel ? 'optional' : week.longKm + ' km') + '</span></div>';

  if(travel){
    h += '<div class="keybox"><b>Travel rule</b>' + esc(TRAVEL_RULE) + '</div>';
  } else {
    h += '<div class="keybox"><b>Key session, week ' + week.week + '</b>' + esc(week.keySession) + '</div>';
    if(week.secondQuality){
      h += '<div class="keybox second"><b>Second quality session</b>' + esc(week.secondQuality) + '</div>';
    }
    if(week.longNote){
      h += '<div class="keybox second"><b>Long run, week ' + week.week + '</b>' + esc(week.longNote) + '</div>';
    }
  }
  h += '</div>';

  /* ---------- sessions ---------- */
  h += '<div class="card"><h3>Sessions</h3>';
  h += '<div class="sesshead"><div>Done</div><div>Day</div><div>Session</div><div>km</div><div>Shin</div></div>';
  for(const s of sessions){
    h += sessionRow(index, s);
  }

  const worst = store.worstPain(index);
  if(worst !== null){
    const v = VERDICTS[Math.min(worst, 2)];
    h += '<div class="verdict ' + v.cls + '"><b>' + esc(v.title) + '</b>' + esc(v.body) + '</div>';
  }
  h += '</div>';

  /* ---------- notes ---------- */
  h += '<div class="card"><h3>Week notes</h3>' +
       '<textarea id="week-note" aria-label="Week notes" ' +
       'placeholder="Sleep, travel, how the legs felt, what you changed.">' +
       esc(store.note(index)) + '</textarea></div>';

  const panel = paint("p-week", h);
  wire(panel, ctx, sessions);
}

function sessionRow(index, s){
  const log = store.session(index, s.id);
  const rest = s.kind === "rest";
  const label = s.day + " " + s.title;
  const painCls = log.pain === "" ? "" : " pain" + log.pain;

  let h = '<div class="srow' + (rest ? ' rest' : '') + (log.done ? ' done' : '') + '">';
  h += '<div class="checkcell"><label class="check">' +
       '<input type="checkbox" data-act="done" data-id="' + esc(s.id) + '"' + (log.done ? ' checked' : '') +
       ' aria-label="Mark done: ' + esc(label) + '"></label></div>';
  h += '<div class="day">' + esc(s.day) + '</div>';
  h += '<div><div class="stitle">' + esc(s.title) +
       (s.km ? ' <span class="splan">' + s.km + ' km</span>' : '') + '</div>' +
       '<div class="sdetail">' + esc(s.detail) + '</div></div>';
  h += '<div class="sctl">';
  h += '<div class="kmfield"><span class="fieldlab">km</span>' +
       '<input class="kmbox" type="text" inputmode="decimal" autocomplete="off" ' +
       'data-act="km" data-id="' + esc(s.id) + '" value="' + esc(log.km) + '" ' +
       'aria-label="Kilometres run: ' + esc(label) + '"></div>';
  h += '<div class="painfield"><span class="fieldlab">Shin</span>' +
       '<select class="painsel' + painCls + '" data-act="pain" data-id="' + esc(s.id) + '" ' +
       'aria-label="Shin signal: ' + esc(label) + '">';
  for(const [value, text] of PAIN_OPTIONS){
    h += '<option value="' + value + '"' + (log.pain === value ? ' selected' : '') + '>' + esc(text) + '</option>';
  }
  h += '</select></div>';
  h += '</div></div>';
  return h;
}

function wire(panel, ctx, sessions){
  panel.querySelector("#travel-toggle").addEventListener("click", () => {
    store.setTravel(ctx.index, !store.isTravel(ctx.index));
    ctx.refresh();
  });

  panel.querySelector("#week-note").addEventListener("input", event => {
    store.setNote(ctx.index, event.target.value);
    ctx.refreshLedger();
  });

  for(const el of panel.querySelectorAll("[data-act]")){
    const act = el.dataset.act;
    const id = el.dataset.id;

    if(act === "km"){
      /* Typing must not re-render underneath the cursor. */
      el.addEventListener("input", () => {
        store.setSessionField(ctx.index, id, "km", normaliseDecimal(el.value));
        ctx.refreshLedger();
      });
      el.addEventListener("blur", () => {
        el.value = normaliseDecimal(el.value);
        ctx.refresh();
      });
      continue;
    }

    el.addEventListener("change", () => {
      if(act === "done"){
        store.setSessionField(ctx.index, id, "done", el.checked);
        /* Ticking a box prefills the planned distance — nobody wants to
           type "8" after ticking a box that already says 8 km. */
        if(el.checked && !store.session(ctx.index, id).km){
          const planned = findSession(sessions, id);
          if(planned && planned.km){
            store.setSessionField(ctx.index, id, "km", String(planned.km));
          }
        }
      } else if(act === "pain"){
        store.setSessionField(ctx.index, id, "pain", el.value);
      }
      ctx.refresh();
    });
  }
}
