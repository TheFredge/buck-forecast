// Buck Forecast weather collector: National Weather Service forecast for the camera spot,
// plus sun times and moon phase. Runs on a schedule; needs the collector token.
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
  } catch (e) { good = false; notes.push(String((e as Error).message ?? e)); }
  await sb.from("refresh_log").insert({ source: "weather", ok: good, note: notes.join("; ") });
  return new Response(JSON.stringify({ ok: good, notes }), { headers: { "Content-Type": "application/json" }, status: good ? 200 : 500 });
});
