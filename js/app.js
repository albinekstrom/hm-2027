/* Entry point. Phase 1: prove the deploy pipeline. */
"use strict";

const RACE = new Date(2027, 4, 22); // Sat 22 May 2027

const days = Math.ceil((RACE - new Date()) / 86400000);
document.getElementById("days").textContent = days > 0 ? String(days) : "0";
