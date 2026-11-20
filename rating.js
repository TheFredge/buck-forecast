// Buck Forecast rating rules. Shared by the page (and kept in step with the daily refresh's push).
export const SKIP_HOURS = 72; // buck visits this long after a feed drop are left out
export const TZ = "America/New_York";

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

// Morning and evening rating for each forecast day. Returns rows sorted by date then Morning/Evening.
export function sits(tagged, forecast, sunmoon, today = etToday()) {
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
    const rec = visits.filter((v) => v.date >= cut).length, ratio = rec / 7 / (visits.length / days);
    recentPts = Math.round(Math.max(0, Math.min(20, 10 * ratio)));
    recentTxt = `${rec} buck visits in the last 7 days (${ratio >= 1.1 ? "above" : ratio <= 0.9 ? "below" : "about"} the season average)`;
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
      wpts = Math.max(-20, Math.min(30, wpts));
      const camPts = Math.round((40 * (win === "Morning" ? am : pm)) / top);
      const score = Math.max(0, Math.min(100, camPts + recentPts + wpts + sp));
      why.unshift(`${win === "Morning" ? am : pm} buck visits near ${win === "Morning" ? "first" : "last"} light so far`);
      if (recentTxt) why.push(recentTxt);
      why.push(sname);
      const start = win === "Morning" ? ls : le - 150, end = win === "Morning" ? ls + 150 : le;
      rows.push({ date: s.date, window: win, score, rating: score >= 65 ? "Best" : score >= 45 ? "Good" : "Fair",
        start, end, hours: `${fmtT(start)} – ${fmtT(end)}`, hi: Math.round(hi), lo: lo == null ? null : Math.round(lo), rain, ptype: w.precip_type || "",
        sky: w.day_text || "", moon: s.moon_phase, sunday: dayName(s.date, { weekday: "long" }) === "Sunday", why });
    }
  }
  return rows;
}

// Today's call: the better of today's sits that haven't ended yet.
export function todayCall(rows, now = Date.now()) {
  const today = etToday(now), mins = etNowMin(now);
  const t = rows.filter((r) => r.date === today);
  if (!t.length) return { stale: true, level: "unknown", title: "No forecast for today", rows: [] };
  const open = t.filter((r) => r.end > mins);
  if (!open.length) return { level: "unknown", title: "Done for today", rows: t, done: true };
  const pick = [...open].sort((a, b) => b.score - a.score)[0];
  const level = pick.score >= 65 ? "go" : pick.score >= 45 ? "maybe" : "skip";
  const title = level === "go" ? `Go this ${pick.window.toLowerCase()}` : level === "maybe" ? `Worth ${pick.window === "Morning" ? "a morning" : "an evening"} sit` : "Skip today";
  return { level, title, pick, rows: t, mins };
}
