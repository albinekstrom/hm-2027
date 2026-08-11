/* ============================================================
   views/season.js — all 40 weeks as rows.
   ============================================================ */
"use strict";

import { esc, paint, toast } from "../dom.js";
import { store, painColor } from "../store.js";
import { fmtD, phaseOf, currentWeekIndex, PHASE_COLOR } from "../plan.js";

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

  h += '<div class="card"><h3>Reset</h3>' +
       '<p style="font-size:14px;color:var(--slate)">Clears every logged session, note and travel flag. ' +
       'The plan itself stays.</p>' +
       '<button class="btn danger" id="reset-logs">Clear all my logs</button></div>';

  const panel = paint("p-season", h);

  for(const tr of panel.querySelectorAll("tr[data-i]")){
    const open = () => { ctx.select(Number(tr.dataset.i)); };
    tr.addEventListener("click", open);
    tr.addEventListener("keydown", event => {
      if(event.key === "Enter" || event.key === " "){ event.preventDefault(); open(); }
    });
  }

  panel.querySelector("#reset-logs").addEventListener("click", () => {
    if(!window.confirm("Clear all logged data? The plan stays, your log does not.")) return;
    store.clearAll();
    ctx.refresh();
    toast("Logs cleared");
  });
}
