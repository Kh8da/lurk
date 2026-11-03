'use strict';
// Farming hours: "01:00" to "09:00", wrapping past midnight when the end is
// earlier than the start. Equal times mean all day.

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

function inFarmingHours(from, to, date = new Date()) {
  const t = date.getHours() * 60 + date.getMinutes();
  const f = toMinutes(from);
  const e = toMinutes(to);
  if (f === e) return true;
  return f < e ? t >= f && t < e : t >= f || t < e;
}

module.exports = { inFarmingHours };
