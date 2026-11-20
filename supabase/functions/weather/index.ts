// Buck Forecast weather collector: National Weather Service forecast for the camera spot,
// plus sun times, moon phase, and hour-by-hour wind, pressure, fog and snow per sit window (Open-Meteo). Runs on a schedule; needs the collector token.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { sunTimesUTC, moonAge, moonName } from "./sun.ts";

const LAT = 40.93, LON = -74.36; // near the FCH cameras, rounded to about half a mile
const UA = "BuckForecast/1.0 (personal hunting dashboard)";
const TZ = "America/New_York";

const ymd = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(ms));
function etOffsetMin(ms: number): number { // minutes to add to UTC to get Eastern wall time
  const p = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(ms));
  const g = (t: string) => +p.find((x) => x.type === t)!.value;
  return (Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute")) - Math.floor(ms / 60000) * 60000) / 60000;
}
const hhmm = (min: number) => { const m = ((Math.round(min) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
const ptype = (t: string) => /snow|flurr|sleet|wintry/i.test(t) ? "snow" : /rain|shower|drizzle|storm/i.test(t) ? "rain" : null;

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const token = req.headers.get("x-collector-token") ?? "";
  const { data: ok } = await sb.rpc("collector_token_ok", { token });
  if (ok !== true) return new Response("forbidden", { status: 403 });
  const notes: string[] = [];
  let good = true;
  try {
    // Sun and moon for today plus 8 days
    const now = Date.now();
    const sun = [];
    for (let i = 0; i < 9; i++) {
      const date = ymd(now + i * 86400000);
      const s = sunTimesUTC(date, LAT, LON);
      const off = etOffsetMin(Date.parse(date + "T17:00:00Z"));
      const rise = s.rise + off, set = s.set + off, age = moonAge(date);
      sun.push({ date, sunrise: hhmm(rise), sunset: hhmm(set), legal_start: hhmm(rise - 30), legal_end: hhmm(set + 30), moon_phase: moonName(age), moon_age_days: Math.round(age * 10) / 10 });
    }
    const r1 = await sb.from("sun_moon").upsert(sun);
    if (r1.error) throw new Error("sun: " + r1.error.message);

    // Forecast
    const pt = await fetch(`https://api.weather.gov/points/${LAT},${LON}`, { headers: { "User-Agent": UA, Accept: "application/geo+json" } });
    if (!pt.ok) throw new Error(`weather.gov points ${pt.status}`);
    const fURL = (await pt.json()).properties.forecast;
    const fr = await fetch(fURL, { headers: { "User-Agent": UA, Accept: "application/geo+json" } });
    if (!fr.ok) throw new Error(`weather.gov forecast ${fr.status}`);
    const periods = (await fr.json()).properties.periods as any[];
    const days = new Map<string, any>();
    const get = (d: string) => { if (!days.has(d)) days.set(d, { date: d, high_f: null, low_f: null, precip_chance: null, precip_type: null, day_text: null, night_text: null, wind_text: null }); return days.get(d); };
    for (const p of periods) {
      const startD = ymd(Date.parse(p.startTime)), endD = ymd(Date.parse(p.endTime));
      const pop = p.probabilityOfPrecipitation?.value ?? 0;
      if (p.isDaytime) {
        const r = get(startD);
        r.high_f = p.temperature; r.day_text = p.shortForecast; r.wind_text = p.windSpeed;
        r.precip_chance = pop;
        r.precip_type = ptype(p.shortForecast) ?? (pop >= 30 ? r.precip_type : null);
      } else {
        // overnight low belongs to the morning it ends on
        const r = get(endD);
        r.low_f = p.temperature; r.night_text = p.shortForecast;
        if (r.precip_chance == null) { r.precip_chance = pop; r.precip_type = ptype(p.shortForecast); }
        const tonight = get(startD); if (tonight.high_f == null && tonight.precip_chance == null) { tonight.precip_chance = pop; tonight.precip_type = ptype(p.shortForecast); }
      }
    }
    const rows = [...days.values()].map((r) => ({ ...r, fetched_at: new Date().toISOString() }));
    const r2 = await sb.from("forecast_daily").upsert(rows);
    if (r2.error) throw new Error("forecast: " + r2.error.message);
    await sb.from("forecast_daily").delete().lt("date", ymd(now - 2 * 86400000));
    // Weather log: keep the first forecast of each day (the morning call)
    const today = rows.find((r) => r.date === ymd(now));
    if (today) await sb.from("weather_log").upsert({ date: today.date, high_f: today.high_f, low_f: today.low_f, precip_chance: today.precip_chance, precip_type: today.precip_type, day_text: today.day_text }, { onConflict: "date", ignoreDuplicates: true });
    notes.push(`${rows.length} forecast days, ${sun.length} sun days`);

    // Hour-by-hour weather for each sit window (Open-Meteo): wind, air pressure trend, fog, snow
    try {
      const om = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&hourly=wind_speed_10m,wind_gusts_10m,pressure_msl,visibility,snowfall,snow_depth&wind_speed_unit=mph&precipitation_unit=inch&timezone=America%2FNew_York&past_days=31&forecast_days=9`);
      if (!om.ok) throw new Error(`open-meteo ${om.status}`);
      const j = await om.json(), H = j.hourly, U = j.hourly_units ?? {};
      const idx = new Map<string, number>((H.time as string[]).map((t, i) => [t.slice(0, 13), i]));
      const depthIn = (v: number) => U.snow_depth === "ft" ? v * 12 : /inch|in/.test(U.snow_depth ?? "") ? v : v * 39.37;
      const visM = (v: number) => U.visibility === "ft" ? v * 0.3048 : v;
      const at = (arr: (number | null)[], i: number) => (i >= 0 && i < arr.length ? arr[i] : null);
      const span = (arr: (number | null)[], a: number, b: number) => { const out: number[] = []; for (let i = a; i <= b; i++) { const v = at(arr, i); if (v != null) out.push(v); } return out; };
      const r1 = (n: number | null) => (n == null || !isFinite(n) ? null : Math.round(n * 10) / 10);
      const ww: any[] = [];
      for (const s of sun) {
        const hm = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
        const ls = hm(s.legal_start), le = hm(s.legal_end);
        for (const [win, a, b, fogEnd] of [["Morning", ls, ls + 150, ls + 90], ["Evening", le - 150, le, le]] as [string, number, number, number][]) {
          const key = (m: number) => `${s.date}T${String(Math.floor(m / 60)).padStart(2, "0")}`;
          const i0 = idx.get(key(a)), i1 = idx.get(key(b - 1)), iF = idx.get(key(fogEnd - 1));
          if (i0 == null || i1 == null) continue;
          const wind = span(H.wind_speed_10m, i0, i1), gust = span(H.wind_gusts_10m, i0, i1), vis = span(H.visibility, i0, iF ?? i1);
          const p0 = at(H.pressure_msl, i0), p12 = at(H.pressure_msl, i0 - 12), dep = at(H.snow_depth, i0);
          const s24 = span(H.snowfall, i0 - 24, i0 - 1), s30 = span(H.snowfall, i0 - 744, i0 - 25);
          ww.push({ date: s.date, window: win,
            wind_mph: wind.length ? r1(Math.max(...wind)) : null, gust_mph: gust.length ? r1(Math.max(...gust)) : null,
            pressure_change_hpa: p0 != null && p12 != null ? r1(p0 - p12) : null,
            visibility_min_m: vis.length ? Math.round(visM(Math.min(...vis))) : null,
            snow_24h_in: s24.length ? r1(s24.reduce((x, y) => x + y, 0)) : null,
            snow_30d_in: s30.length >= 600 ? r1(s30.reduce((x, y) => x + y, 0)) : null,
            snow_depth_in: dep == null ? null : r1(depthIn(dep)), fetched_at: new Date().toISOString() });
        }
      }
      const r3 = await sb.from("window_weather").upsert(ww);
      if (r3.error) throw new Error(r3.error.message);
      await sb.from("window_weather").delete().lt("date", ymd(now - 2 * 86400000));
      const todays = ww.filter((w) => w.date === ymd(now));
      if (todays.length) await sb.from("window_weather_log").upsert(todays, { onConflict: "date,window", ignoreDuplicates: true });
      notes.push(`${ww.length} sit windows`);
    } catch (e) { notes.push("hourly weather: " + String((e as Error).message ?? e)); }
  } catch (e) { good = false; notes.push(String((e as Error).message ?? e)); }
  await sb.from("refresh_log").insert({ source: "weather", ok: good, note: notes.join("; ") });
  return new Response(JSON.stringify({ ok: good, notes }), { headers: { "Content-Type": "application/json" }, status: good ? 200 : 500 });
});
