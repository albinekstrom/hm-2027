/* ============================================================
   dom.js — the few DOM helpers every view needs.
   ============================================================ */
"use strict";

export function esc(value){
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function $(id){ return document.getElementById(id); }

export function paint(id, html){
  const node = $(id);
  node.innerHTML = html;
  return node;
}

let toastTimer = null;
export function toast(message){
  const node = $("toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("show"), 2400);
}

/* Comma to dot: a Swedish keyboard offers a comma, and "8,2" must mean 8.2. */
export function normaliseDecimal(value){
  return String(value == null ? "" : value).replace(",", ".");
}
