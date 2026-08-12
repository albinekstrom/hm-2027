/* ============================================================
   views/season.js — all 40 weeks as rows.
   ============================================================ */
"use strict";

import { esc, paint, toast } from "../dom.js";
import { store, painColor } from "../store.js";
import { fmtD, phaseOf, currentWeekIndex, PHASE_COLOR } from "../plan.js";
import { isConfigured } from "../sync.js";

export function renderSeason(ctx){
  const { plan } = ctx;
  const current = currentWeekIndex(plan);

  let h = '<div class="card"><h3>All 40 weeks — tap a row to open it</h3><div class="seasonwrap">';
  h += '<table class="season"><thead><tr>' +
       '<th>Wk</th><th>Dates</th><th>Phase</th>' +
       '<th class="num">Plan</th><th class="num">Done</th><th class="num">Long</th>' +
       '<th>Key session</th></tr></thead><tbody>';

  plan.weeks.forEach((week, i) => {
    const phase = phaseOf(plan, week);
    const logged = store.loggedKm(i);
    const worst = store.worstPain(i);
    const travel = store.isTravel(i);

    h += '<tr data-i="' + i + '" tabindex="0"' +
         (i === current ? ' class="now"' : '') +
         ' aria-label="Week ' + week.week + ', open it">';
    h += '<td class="num" style="color:' + painColor(worst) + ';font-weight:600">' + week.week + '</td>';
    h += '<td class="day">' + esc(fmtD(week.startDate)) + '–' + esc(fmtD(week.endDate)) + '</td>';
    h += '<td><span class="phasetag" style="background:' + (PHASE_COLOR[phase.id] || 'var(--slate)') + '">' +
         esc(phase.name) + '</span>' +
         (travel ? ' <span class="travelflag">travel</span>' : '') +
         (week.isTestWeek ? ' <span class="testflag">test</span>' : '') + '</td>';
    h += '<td class="num">' + week.targetKm + '</td>';
    h += '<td class="num" style="color:' + (logged > 0 ? 'var(--frost)' : 'var(--mute)') + '">' +
         (logged > 0 ? Math.round(logged) : '—') + '</td>';
    h += '<td class="num">' + week.longKm + '</td>';
    h += '<td style="font-size:13px">' + esc(week.keySession) + '</td>';
    h += '</tr>';
  });

  h += '</tbody></table></div></div>';

  h += logCard();

  const panel = paint("p-season", h);
  wireLogCard(panel, ctx);

  for(const tr of panel.querySelectorAll("tr[data-i]")){
    const open = () => { ctx.select(Number(tr.dataset.i)); };
    tr.addEventListener("click", open);
    tr.addEventListener("keydown", event => {
      if(event.key === "Enter" || event.key === " "){ event.preventDefault(); open(); }
    });
  }

}

/* ============================================================
   Your log — backup, restore, reset.

   This is the path that works with no token, no network and no
   GitHub account, so it is deliberately plain: a file out, a file in.
   ============================================================ */
function logCard(){
  const counts = store.countLogged();
  const summary = counts.sessions === 0
    ? "Nothing logged yet."
    : counts.sessions + (counts.sessions === 1 ? " session" : " sessions") +
      " logged across " + counts.weeks + (counts.weeks === 1 ? " week" : " weeks") + ".";

  let h = '<div class="card"><h3>Your log</h3>';
  h += '<p style="font-size:14px;color:var(--slate)">' + esc(summary) +
       ' It lives on this device. Export it before you rely on it.</p>';
  if(!store.persistent){
    h += '<p style="font-size:14px;color:var(--signal)">This device is not saving — private browsing, or ' +
         'storage is full. Export your log now; it is on screen only.</p>';
  }
  h += '<div class="row">' +
       '<button class="btn" id="log-export">Export JSON</button>' +
       '<button class="btn ghost" id="log-import">Import JSON</button>' +
       '<input type="file" id="log-file" accept="application/json,.json" hidden>' +
       '</div>';
  h += '<p style="font-size:13px;color:var(--mute);margin-top:10px">Import replaces the log on this device. ' +
       'Export first if you are not sure.</p>';
  h += '<div id="log-fallback"></div>';
  h += '<h3 style="margin-top:20px">Reset</h3>' +
       '<p style="font-size:14px;color:var(--slate)">Clears every logged session, note and travel flag. ' +
       'The plan itself stays.</p>' +
       '<button class="btn danger" id="reset-logs">Clear all my logs</button></div>';
  return h;
}

function wireLogCard(panel, ctx){
  panel.querySelector("#log-export").addEventListener("click", () => {
    const json = store.exportJSON();
    if(!download(store.exportFilename(), json)){
      /* A download can be refused — an iOS in-app browser, or a policy.
         Put the JSON on screen so it can still be copied out by hand. */
      showFallback(panel, json);
      return;
    }
    toast("Log exported");
  });

  const file = panel.querySelector("#log-file");
  panel.querySelector("#log-import").addEventListener("click", () => file.click());
  file.addEventListener("change", async () => {
    const chosen = file.files && file.files[0];
    if(!chosen) return;
    file.value = "";
    let text;
    try{
      text = await chosen.text();
    } catch (err){
      toast("Could not read that file");
      return;
    }
    if(!window.confirm("Replace the log on this device with " + chosen.name + "?")) return;
    const result = store.importJSON(text);
    if(!result.ok){
      window.alert(result.error);
      return;
    }
    ctx.refresh();
    toast("Imported " + result.sessions + " sessions");
  });

  panel.querySelector("#reset-logs").addEventListener("click", () => {
    /* If sync is on, clearing is not local — it replaces log.json in the repo,
       and the other device will pick that up. Say so before, not after. */
    const question = isConfigured()
      ? "Clear all logged data on this device AND in your data repo? " +
        "Your other devices will pick up the empty log. The plan stays, your log does not."
      : "Clear all logged data? The plan stays, your log does not.";
    if(!window.confirm(question)) return;
    store.clearAll();
    ctx.refresh();
    toast("Logs cleared");
  });
}

function download(filename, text){
  try{
    const blob = new Blob([text], { type:"application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return true;
  } catch (err){
    console.warn("export: download refused — " + err.message);
    return false;
  }
}

function showFallback(panel, json){
  const host = panel.querySelector("#log-fallback");
  host.innerHTML = '<p style="font-size:13px;color:var(--slate);margin-top:12px">' +
    'This browser would not hand over a file. Copy the text below instead — it is your whole log.</p>' +
    '<textarea id="log-text" readonly style="min-height:140px;font-family:var(--mono);font-size:12px"></textarea>';
  const box = host.querySelector("#log-text");
  box.value = json;
  box.focus();
  box.select();
}
