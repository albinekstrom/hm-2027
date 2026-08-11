/* ============================================================
   views/playbook.js — renders data/playbook.md read-only.

   A deliberately tiny markdown subset: headings, bold, lists,
   paragraphs, and the one pipe table in the source. No library.
   ============================================================ */
"use strict";

import { esc, paint } from "../dom.js";

let cached = null;

export async function renderPlaybook(){
  if(cached === null){
    try{
      const res = await fetch("data/playbook.md", { cache:"no-cache" });
      if(!res.ok) throw new Error("HTTP " + res.status);
      cached = await res.text();
    } catch (err){
      console.warn("playbook: " + err.message);
      paint("p-playbook",
        '<div class="card"><h3>Playbook</h3><p>The playbook could not be loaded. ' +
        'It is prose only — nothing in your log depends on it.</p></div>');
      return;
    }
  }
  paint("p-playbook", '<div class="card pb">' + toHtml(cached) + '</div>');
}

/* ---------- inline ---------- */
function inline(text){
  return esc(text).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
}

/* The traffic light is the spine of the plan, so the three paragraphs that
   define it get the bordered treatment from the reference rather than
   arriving as three more paragraphs of prose. */
const LIGHTS = { Green:"g", Amber:"a", Red:"r" };
function trafficLight(text){
  const m = /^\*\*(Green|Amber|Red)\.\*\*\s*(.*)$/.exec(text);
  if(!m) return null;
  return '<div class="tl ' + LIGHTS[m[1]] + '"><b>' + m[1] + '</b><br>' + inline(m[2]) + '</div>';
}

/* ---------- block ---------- */
function toHtml(markdown){
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let paragraph = [];
  let list = [];
  let table = null;

  function flushParagraph(){
    if(!paragraph.length) return;
    const text = paragraph.join(" ").trim();
    paragraph = [];
    out.push(trafficLight(text) || "<p>" + inline(text) + "</p>");
  }
  function flushList(){
    if(!list.length) return;
    out.push("<ul>" + list.map(item => "<li>" + inline(item) + "</li>").join("") + "</ul>");
    list = [];
  }
  function flushTable(){
    if(!table) return;
    let h = "<table>";
    if(table.head){
      h += "<thead><tr>" + table.head.map(c => "<th>" + inline(c) + "</th>").join("") + "</tr></thead>";
    }
    h += "<tbody>" + table.rows.map(
      row => "<tr>" + row.map(c => "<td>" + inline(c) + "</td>").join("") + "</tr>"
    ).join("") + "</tbody></table>";
    table = null;
    out.push(h);
  }
  function flushAll(){ flushParagraph(); flushList(); flushTable(); }

  for(const raw of lines){
    const line = raw.trim();

    if(line === ""){ flushAll(); continue; }

    if(line.startsWith("|")){
      flushParagraph(); flushList();
      const cells = line.slice(1).replace(/\|$/, "").split("|").map(c => c.trim());
      if(!table){
        table = { head:cells, rows:[] };
      } else if(cells.every(c => /^:?-{2,}:?$/.test(c))){
        /* the |---|---| separator: the row above it was the header */
      } else {
        table.rows.push(cells);
      }
      continue;
    }
    flushTable();

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if(heading){
      flushParagraph(); flushList();
      const text = inline(heading[2]);
      out.push(heading[1].length === 1 ? '<h3>' + text + '</h3>' : '<h4>' + text + '</h4>');
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if(bullet){
      flushParagraph();
      list.push(bullet[1]);
      continue;
    }

    flushList();
    paragraph.push(line);
  }
  flushAll();
  return out.join("");
}
