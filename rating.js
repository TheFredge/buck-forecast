// Buck Forecast rating rules. Shared by the page (and kept in step with the daily refresh's push).
export const SKIP_HOURS = 72; // buck visits this long after a feed drop are left out
export const TZ = "America/New_York";
export const STAND_CAM = "FCH_Cam002"; // the stand is near Cam002
export const DOES_COUNTED_FROM = "2026-11-20"; // does counted from photos after the Nov 20 morning refresh

export const toMin = (s) => { const [h, m] = String(s).split(":").map(Number); return h * 60 + m; };
export const fmtT = (m) => { m = ((m % 1440) + 1440) % 1440; const h = Math.floor(m / 60), mm = String(m % 60).padStart(2, "0"); return (h % 12 || 12) + ":" + mm + (h < 12 ? " AM" : " PM"); };
export const etToday = (ms = Date.now()) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(ms));
export function etNowMin(ms = Date.now()) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(ms));
  return (+p.find((x) => x.type === "hour").value % 24) * 60 + +p.find((x) => x.type === "minute").value;
}
const tsOf = (d, t) => Date.parse(d + "T" + t + ":00Z"); // Eastern wall clock as a plain number, fine for gaps
const addDays = (iso, n) => new Date(Date.parse(iso + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
export const dayName = (iso, opts = { weekday: "short" }) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts }).format(new Date(iso + "T12:00:00Z"));

// Mark each buck visit that came within SKIP_HOURS after a feed drop on the same camera.
export function tagVisits(visits, people) {
  const drops = people.filter((p) => p.kind === "Feed drop").map((p) => ({ cam: p.camera, t: tsOf(p.date, p.time) }));
  return visits.map((v) => {
    const t = tsOf(v.date, v.time);
    return { ...v, fed: drops.some((d) => d.cam === v.camera && t >= d.t && t < d.t + SKIP_HOURS * 3600e3) };
  });
}

export function summary(tagged) {
  const ok = tagged.filter((v) => !v.fed);
  const last = tagged.reduce((a, v) => (v.date > a ? v.date : a), "");
  const cut = last ? addDays(last, -6) : "";
  return { visits: tagged.length, fed: tagged.length - ok.length, normal: ok.length, recent: ok.filter((v) => v.date >= cut).length, legal: ok.filter((v) => v.legal_light === "yes").length };
}

function season(iso) {
  const m = +iso.slice(5, 7), d = +iso.slice(8, 10);
  if (m === 11 && d <= 15) return [10, "peak rut"]; if (m === 11) return [7, "late rut"];
  if (m === 12 && d <= 15) return [8, "second rut"]; if (m === 10 && d >= 20) return [7, "pre-rut"];
  return [4, "outside the rut"];
}

// Buck timing with and without feed down: dark vs daylight, morning vs afternoon,
// and near misses just outside legal light. tagged = tagVisits() output.
export function feedStats(tagged, people) {
  const one = (vs) => {
    const o = { visits: vs.length, dark: 0, am: 0, pm: 0, lateEve: 0, earlyMorn: 0 };
    for (const v of vs) {
      const t = toMin(v.time), ls = toMin(v.sunrise) - 30, le = toMin(v.sunset) + 30;
      if (t >= ls && t <= le) { if (t < 720) o.am++; else o.pm++; }
      else { o.dark++; if (t > le && t <= le + 30) o.lateEve++; if (t < ls && t >= ls - 30) o.earlyMorn++; }
    }
    o.daylight = o.am + o.pm;
    return o;
  };
  const drops = people.filter((p) => p.kind === "Feed drop").sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const perDrop = drops.map((d) => {
    const t0 = tsOf(d.date, d.time);
    const vs = tagged.filter((v) => v.camera === d.camera && tsOf(v.date, v.time) >= t0 && tsOf(v.date, v.time) < t0 + SKIP_HOURS * 3600e3);
    return { ...d, ...one(vs) };
  });
  return { fed: one(tagged.filter((v) => v.fed)), normal: one(tagged.filter((v) => !v.fed)), perDrop };
}

// Morning and evening rating for each forecast day. Returns rows sorted by date then Morning/Evening.
// Camera-days with no photos at all (dead batteries, no signal): skipped when working out averages.
export function offlineDays(activity = []) {
  return activity.filter((r) => +r.photos === 0).map((r) => ({ camera: r.camera, date: r.date }));
}
const offIn = (off, a, b, cam) => off.filter((o) => o.date >= a && o.date <= b && (!cam || o.camera === cam)).length;

// Doe activity at the stand camera: last 3 days vs the average 3 days since does were counted.
export function doeTrend(doeVisits, people, today = etToday(), activity = []) {
  const ok = tagVisits(doeVisits.filter((v) => v.camera === STAND_CAM), people).filter((v) => !v.fed);
  const off = offlineDays(activity), yday = addDays(today, -1);
  const days = Math.round((Date.parse(today) - Date.parse(DOES_COUNTED_FROM)) / 86400000) - offIn(off, DOES_COUNTED_FROM, yday, STAND_CAM);
  if (days < 10) return { pts: 0, ready: false, days: Math.max(0, days), recent: 0 };
  const cut = addDays(today, -3), recentDays = 3 - offIn(off, cut, yday, STAND_CAM);
  const recent = ok.filter((v) => v.date >= cut && v.date < today).length;
  const avg = (ok.filter((v) => v.date < today).length / days) * Math.max(recentDays, 0);
  const ratio = recentDays <= 0 ? 1 : avg > 0 ? recent / avg : recent > 0 ? 2 : 1;
  return { pts: ratio >= 1.5 ? 5 : 0, ready: true, recent, ratio, avg };
}

// Wind, air pressure, snow and fog points for one sit window. ww: a window_weather row (or undefined).
function hourly(ww, win, why) {
  let pts = 0;
  if (!ww) return 0;
  const wind = ww.wind_mph == null ? null : +ww.wind_mph, gust = ww.gust_mph == null ? null : +ww.gust_mph;
  if (wind != null && wind >= 20) { pts -= 10; why.push(`very windy (${Math.round(wind)} mph)`); }
  else if (wind != null && wind >= 13) { pts -= 5; why.push(`windy (${Math.round(wind)} mph)`); }
  else if (gust != null && gust >= 30) { pts -= 3; why.push(`gusty (to ${Math.round(gust)} mph)`); }
  const pr = ww.pressure_change_hpa == null ? null : +ww.pressure_change_hpa;
  if (pr != null && pr >= 3) { pts += 5; why.push("air pressure rising fast"); }
  else if (pr != null && pr >= 1.5) { pts += 3; why.push("air pressure rising"); }
  const s24 = +(ww.snow_24h_in ?? 0), s30 = ww.snow_30d_in == null ? null : +ww.snow_30d_in, depth = +(ww.snow_depth_in ?? 0);
  if (s24 >= 0.5 && s30 != null && s30 < 0.5) { pts += 8; why.push(`first snow of the season (${s24}")`); }
  else if (s24 >= 0.5) { pts += 5; why.push(`fresh snow (${s24}")`); }
  else if (depth >= 1) { pts += 2; why.push("snow on the ground"); }
  const vis = ww.visibility_min_m == null ? null : +ww.visibility_min_m;
  if (win === "Morning" && vis != null && vis < 400) { pts -= 5; why.push("thick fog at first light"); }
  else if (win === "Morning" && vis != null && vis < 1600) { pts -= 2; why.push("foggy at first light"); }
  return pts;
}

// extra: { ww: window_weather rows, does: doe_visits rows, people, activity: daily_activity rows }
export function sits(tagged, forecast, sunmoon, today = etToday(), extra = {}) {
  const WW = new Map((extra.ww || []).map((w) => [w.date + w.window, w]));
  const doe = doeTrend(extra.does || [], extra.people || [], today, extra.activity || []);
  const off = offlineDays(extra.activity || []);
  const ncams = Math.max(1, new Set((extra.activity || []).map((r) => r.camera)).size);
  const visits = tagged.filter((v) => !v.fed);
  let am = 0, pm = 0;
  for (const v of visits) {
    const t = toMin(v.time), ls = toMin(v.sunrise) - 30, le = toMin(v.sunset) + 30;
    if (t >= ls - 90 && t <= ls + 150) am++;
    if (t >= le - 150 && t <= le + 90) pm++;
  }
  const top = Math.max(am, pm, 1);
  let recentPts = 10, recentTxt = "";
  if (visits.length) {
    const first = visits.reduce((a, v) => (v.date < a ? v.date : a), "9999"), last = visits.reduce((a, v) => (v.date > a ? v.date : a), "");
    const days = Math.max(1, Math.round((Date.parse(last) - Date.parse(first)) / 86400000) + 1);
    const cut = addDays(last, -6);
    // rates per camera-day, leaving out days a camera sent no photos at all
    const camDays = Math.max(1, days * ncams - offIn(off, first, last)), offRecent = offIn(off, cut, last);
    const recDays = Math.max(1, 7 * ncams - offRecent);
    const rec = visits.filter((v) => v.date >= cut).length, ratio = rec / recDays / (visits.length / camDays);
    recentPts = Math.round(Math.max(0, Math.min(20, 10 * ratio)));
    recentTxt = `${rec} buck visits in the last 7 days (${ratio >= 1.1 ? "above" : ratio <= 0.9 ? "below" : "about"} the season average${offRecent ? `, skipping ${offRecent} camera-day${offRecent === 1 ? "" : "s"} with no photos` : ""})`;
  }
  const W = new Map(forecast.map((w) => [w.date, w]));
  const rows = [];
  for (const s of [...sunmoon].sort((a, b) => a.date.localeCompare(b.date))) {
    if (s.date < today) continue;
    const w = W.get(s.date); if (!w || w.high_f == null) continue;
    const prev = W.get(addDays(s.date, -1));
    const hi = +w.high_f, lo = w.low_f == null ? null : +w.low_f, rain = +(w.precip_chance ?? 0);
    const [sp, sname] = season(s.date);
    const wx = []; let base = 0;
    if (prev && prev.high_f != null) {
      const drop = +prev.high_f - hi;
      if (drop >= 15) { base += 20; wx.push(`strong cold front (high down ${Math.round(drop)}°F)`); }
      else if (drop >= 8) { base += 15; wx.push(`cooler (high down ${Math.round(drop)}°F)`); }
      if (+(prev.precip_chance ?? 0) >= 70 && rain < 40) { base += 10; wx.push("first dry day after rain"); }
    }
    if (rain >= 70) { base -= 10; wx.push(`${rain}% chance of ${w.precip_type || "rain"}`); }
    const ls = toMin(s.legal_start), le = toMin(s.legal_end);
    for (const win of ["Morning", "Evening"]) {
      let wpts = base; const why = [...wx];
      if (win === "Morning" && lo != null && lo <= 32) { wpts += 5; why.push("frosty morning"); }
      if (hi >= 60) { wpts -= win === "Evening" ? 10 : 5; why.push(`warm (${Math.round(hi)}°F high)`); }
      const ww = WW.get(s.date + win);
      wpts += hourly(ww, win, why);
      wpts = Math.max(-25, Math.min(40, wpts));
      const camPts = Math.round((40 * (win === "Morning" ? am : pm)) / top);
      const doePts = sp >= 7 ? doe.pts : 0;
      if (doePts) why.push(`doe activity up at Cam002 (${doe.recent} visits in 3 days)`);
      const score = Math.max(0, Math.min(100, camPts + recentPts + wpts + sp + doePts));
      why.unshift(`${win === "Morning" ? am : pm} buck visits near ${win === "Morning" ? "first" : "last"} light so far`);
      if (recentTxt) why.push(recentTxt);
      why.push(sname);
      const start = win === "Morning" ? ls : le - 150, end = win === "Morning" ? ls + 150 : le;
      rows.push({ date: s.date, window: win, score, rating: score >= 65 ? "Best" : score >= 45 ? "Good" : "Fair",
        start, end, hours: `${fmtT(start)} – ${fmtT(end)}`, hi: Math.round(hi), lo: lo == null ? null : Math.round(lo), rain, ptype: w.precip_type || "",
        sky: w.day_text || "", moon: s.moon_phase, ww: ww || null,
        parts: { cameras: camPts, recent: recentPts, weather: wpts, season: sp, does: doePts }, sunday: dayName(s.date, { weekday: "long" }) === "Sunday", why });
    }
  }
  return rows;
}

// The top card: the better of today's sits that haven't ended yet. Once today's last sit is over
// (evening legal light has ended), it switches to tomorrow's sits, Sundays included.
// sunmoon: sun_moon rows, used to know when today's hunting hours end even if today has no rating.
export function todayCall(rows, now = Date.now(), sunmoon = []) {
  const today = etToday(now), mins = etNowMin(now), tomorrow = addDays(today, 1);
  const t = rows.filter((r) => r.date === today);
  const sunToday = sunmoon.find((s) => s.date === today);
  const dayEnd = t.length ? Math.max(...t.map((r) => r.end)) : sunToday ? toMin(sunToday.legal_end) : null;
  const next = dayEnd != null && mins >= dayEnd; // today's hunting hours are over
  const date = next ? tomorrow : today;
  const d = rows.filter((r) => r.date === date);
  if (!d.length) return { stale: true, level: "unknown", title: next ? "No forecast for tomorrow yet" : "No forecast for today", rows: [], date, tomorrow: next, mins };
  const open = next ? d : d.filter((r) => r.end > mins);
  const pick = [...open].sort((a, b) => b.score - a.score)[0];
  const level = pick.score >= 65 ? "go" : pick.score >= 45 ? "maybe" : "skip";
  const win = pick.window.toLowerCase();
  const title = level === "go" ? (next ? `Go tomorrow ${win}` : `Go this ${win}`)
    : level === "maybe" ? `Worth ${pick.window === "Morning" ? "a morning" : "an evening"} sit${next ? " tomorrow" : ""}`
    : next ? "Skip tomorrow" : "Skip today";
  return { level, title, pick, rows: d, date, tomorrow: next, mins };
}

// When today's forecast row has been blanked (the weather service stops listing the day once evening
// comes), use the forecast saved that morning instead. forecast: forecast_daily rows; log: weather_log rows.
export function fillFromLog(forecast, log = []) {
  const L = new Map(log.map((r) => [r.date, r]));
  const out = forecast.map((r) => {
    const l = L.get(r.date);
    return r.high_f == null && l && l.high_f != null
      ? { ...r, high_f: l.high_f, low_f: r.low_f ?? l.low_f, precip_chance: l.precip_chance, precip_type: l.precip_type, day_text: l.day_text }
      : r;
  });
  for (const l of log) if (l.high_f != null && !out.some((r) => r.date === l.date)) out.push({ ...l });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// Rating for a sit on an earlier day (logged late), as the page would have shown it before the sit:
// the forecast saved that morning, and only camera visits, does and people from before the sit started.
// d: { visits (counted buck visits), people, does, activity, sun (that day's sun_moon row),
//      forecast (that day's weather_log row), ww (that day's window_weather_log row for this sit) }
export function rateEarlierSit(date, win, d) {
  if (!d.sun || !d.forecast || d.forecast.high_f == null) return null;
  const ls = toMin(d.sun.legal_start), le = toMin(d.sun.legal_end);
  const start = win === "Morning" ? ls : le - 150;
  const hh = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const cut = `${date} ${hh(start)}`, before = (x) => `${x.date} ${x.time}` < cut;
  const people = (d.people || []).filter(before);
  const tagged = tagVisits((d.visits || []).filter(before), people);
  const extra = { ww: d.ww ? [d.ww] : [], does: (d.does || []).filter(before), people, activity: (d.activity || []).filter((r) => r.date < date) };
  const rows = sits(tagged, [{ ...d.forecast, date }], [d.sun], date, extra);
  return rows.find((r) => r.window === win) || null;
}
