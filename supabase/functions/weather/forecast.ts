// Once a day's daytime period has passed, the weather service's forecast starts at "Tonight" and no
// longer lists that day's high, sky or rain chance. Keep the day's last daytime forecast instead of
// overwriting it with blanks, so the page can still rate (and you can still log) that day's sits.
// The same goes for the overnight low, which drops off the list once the night is over.
// rows: this run's forecast days. old: the forecast_daily rows already saved for the same dates.
export function keepPassedForecast(rows: any[], old: any[]): any[] {
  const prev = new Map(old.map((r) => [String(r.date), r]));
  return rows.map((r) => {
    const o = prev.get(String(r.date));
    if (!o) return r;
    const out = { ...r };
    if (out.high_f == null && o.high_f != null) {
      out.high_f = o.high_f; out.day_text = o.day_text; out.wind_text = o.wind_text;
      out.precip_chance = o.precip_chance; out.precip_type = o.precip_type;
    }
    if (out.low_f == null && o.low_f != null) out.low_f = o.low_f;
    if (out.night_text == null && o.night_text != null) out.night_text = o.night_text;
    return out;
  });
}
