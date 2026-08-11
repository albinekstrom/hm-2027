/* ============================================================
   views/paces.js — a test result in, equivalents and pace bands out.
   ============================================================ */
"use strict";

import { esc, paint, toast } from "../dom.js";
import { store } from "../store.js";
import { HALF_KM } from "../plan.js";
import { computePaces, parseTime, mmss, hms, DISTANCES, labelFor, shortLabelFor } from "../paces.js";

export function renderPaces(ctx){
  const { plan } = ctx;
  const test = store.tt;
  const paces = computePaces(plan.zones, test.dist, test.time);

  const goalA = parseTime(plan.meta.goals.A.time);      // 1:20:00
  const goalC = parseTime(plan.meta.goals.C.time);      // 1:25:00 — the 2019 PB
  const currentHalf = paces.equivalents[HALF_KM];
  const gap = currentHalf - goalA;

  let h = "";

  /* ---------- test input ---------- */
  h += '<div class="card"><h3>Where you are right now</h3>';
  h += '<span class="lab">Latest test</span>';
  h += '<div class="row" style="margin-top:6px">';
  h += '<select id="test-dist" aria-label="Test distance">';
  for(const d of DISTANCES){
    h += '<option value="' + d + '"' + (Number(test.dist) === d ? ' selected' : '') + '>' +
         esc(shortLabelFor(d)) + '</option>';
  }
  h += '</select>';
  h += '<input type="text" id="test-time" value="' + esc(hms(test.time)) + '" size="8" ' +
       'inputmode="numeric" autocomplete="off" aria-label="Time, mm:ss or h:mm:ss">';
  h += '<button class="btn" id="test-save">Update</button>';
  h += '</div>';

  h += '<div class="cmp" style="margin-top:18px">';
  h += cmpBlock("Half equivalent today", hms(currentHalf), mmss(currentHalf / HALF_KM) + " /km", "");
  h += cmpBlock("Goal A", plan.meta.goals.A.time, plan.meta.goals.A.paceKm + " /km", "var(--frost)");
  h += cmpBlock("Goal C", plan.meta.goals.C.time, mmss(goalC / HALF_KM) + " /km", "var(--slate)");
  h += cmpBlock("Gap to " + esc(plan.meta.goals.A.time),
                gap > 0 ? "−" + mmss(gap) : "there",
                gap > 0 ? "of race time to find" : "on target",
                gap > 0 ? "var(--amber)" : "var(--moss)");
  h += '</div>';
  h += '<p class="note">Equivalents use Riegel with a 1.06 exponent. They assume your endurance matches your ' +
       'speed — early in a rebuild the longer predictions will flatter you, so trust the 5 km and 10 km numbers ' +
       'most.</p>';
  h += '</div>';

  /* ---------- equivalents ---------- */
  h += '<div class="card"><h3>Equivalent race times</h3><table class="pace"><tbody>';
  for(const d of DISTANCES){
    const t = paces.equivalents[d];
    h += '<tr><td>' + esc(labelFor(d)) + '</td>' +
         '<td class="p">' + hms(t) + '</td>' +
         '<td class="p" style="color:var(--slate)">' + mmss(t / d) + ' /km</td></tr>';
  }
  h += '</tbody></table></div>';

  /* ---------- pace bands ---------- */
  h += '<div class="card"><h3>Training paces</h3>' +
       '<table class="pace"><thead><tr><th>Zone</th><th>Pace /km</th><th>Where it is used</th></tr></thead><tbody>';
  for(const band of paces.bands){
    h += '<tr><td>' + esc(band.name) + '</td>' +
         '<td class="p">' + mmss(band.fast) + '–' + mmss(band.slow) + '</td>' +
         '<td style="font-size:13px;color:var(--slate)">' + esc(band.use) + '</td></tr>';
  }
  h += '</tbody></table>';
  h += '<p class="note">Recalculate after every test week (' + plan.testWeeks.join(", ") + '). Your paces should ' +
       'move underneath you three or four times across this build — that is the whole point of testing.</p></div>';

  /* ---------- cadence ---------- */
  const cad = store.cadence;
  h += '<div class="card"><h3>Cadence</h3><div class="row">';
  h += '<label style="font-size:14px"><span class="fieldlab">Current spm</span>' +
       '<input type="text" id="cad-now" size="5" inputmode="numeric" autocomplete="off" ' +
       'value="' + esc(cad.now) + '" aria-label="Current cadence, steps per minute"></label>';
  h += '<label style="font-size:14px"><span class="fieldlab">Target spm</span>' +
       '<input type="text" id="cad-target" size="5" inputmode="numeric" autocomplete="off" ' +
       'value="' + esc(cad.target) + '" aria-label="Target cadence, steps per minute"></label>';
  h += '<button class="btn ghost" id="cad-calc">Set target +7%</button>';
  h += '</div>';
  h += '<p class="note">Count your steps for 30 s on an easy run and double it, or read it off your watch. ' +
       'Target is 5–8% above whatever that is — not a fixed 180.</p></div>';

  const panel = paint("p-paces", h);
  wire(panel, ctx);
}

function cmpBlock(label, value, sub, color){
  return '<div><span class="lab">' + esc(label) + '</span>' +
         '<div class="big"' + (color ? ' style="color:' + color + '"' : '') + '>' + esc(value) + '</div>' +
         '<div style="font-size:13px;color:var(--slate)">' + esc(sub) + '</div></div>';
}

function wire(panel, ctx){
  panel.querySelector("#test-save").addEventListener("click", () => {
    const dist = Number(panel.querySelector("#test-dist").value);
    const seconds = parseTime(panel.querySelector("#test-time").value);
    if(!seconds){
      toast("Time format: mm:ss or h:mm:ss");
      return;
    }
    store.setTT(dist, seconds);
    ctx.refresh();
    toast("Paces updated");
  });

  panel.querySelector("#cad-calc").addEventListener("click", () => {
    const now = parseInt(panel.querySelector("#cad-now").value, 10);
    if(!now){
      toast("Enter your current cadence first");
      return;
    }
    store.setCadence("now", String(now));
    store.setCadence("target", String(Math.round(now * 1.07)));
    ctx.refresh();
  });

  for(const [id, field] of [["cad-now", "now"], ["cad-target", "target"]]){
    panel.querySelector("#" + id).addEventListener("input", event => {
      store.setCadence(field, event.target.value);
    });
  }
}
