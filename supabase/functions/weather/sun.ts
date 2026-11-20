// Sunrise/sunset (NOAA method) and moon age, no outside services.
const rad = Math.PI / 180, deg = 180 / Math.PI;
export function sunTimesUTC(dateISO: string, lat: number, lon: number): { rise: number; set: number } {
  // returns minutes after UTC midnight of that date
  const [y, m, d] = dateISO.split("-").map(Number);
  const jd = Date.UTC(y, m - 1, d) / 86400000 + 2440587.5;
  const calc = (rising: boolean) => {
    let t = 720 - 4 * lon; // first guess: solar noon in UTC minutes (lon east positive)
    for (let i = 0; i < 3; i++) {
      const T = (jd + t / 1440 - 2451545) / 36525;
      const L0 = (280.46646 + T * (36000.76983 + 0.0003032 * T)) % 360;
      const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
      const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
      const C = Math.sin(M * rad) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * rad) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * rad) * 0.000289;
      const lam = L0 + C - 0.00569 - 0.00478 * Math.sin((125.04 - 1934.136 * T) * rad);
      const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
      const eps = eps0 + 0.00256 * Math.cos((125.04 - 1934.136 * T) * rad);
      const decl = Math.asin(Math.sin(eps * rad) * Math.sin(lam * rad)) * deg;
      const yv = Math.tan((eps / 2) * rad) ** 2;
      const eqt = 4 * deg * (yv * Math.sin(2 * L0 * rad) - 2 * e * Math.sin(M * rad) + 4 * e * yv * Math.sin(M * rad) * Math.cos(2 * L0 * rad) - 0.5 * yv * yv * Math.sin(4 * L0 * rad) - 1.25 * e * e * Math.sin(2 * M * rad));
      const ha = Math.acos(Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl * rad)) - Math.tan(lat * rad) * Math.tan(decl * rad)) * deg;
      t = 720 - 4 * (lon + (rising ? ha : -ha)) - eqt;
    }
    return t;
  };
  return { rise: calc(true), set: calc(false) };
}
export function moonAge(dateISO: string): number {
  const syn = 29.530588853, ref = Date.UTC(2000, 0, 6, 18, 14) / 86400000; // known new moon
  const [y, m, d] = dateISO.split("-").map(Number);
  const days = Date.UTC(y, m - 1, d) / 86400000 - ref;
  return ((days % syn) + syn) % syn;
}
export function moonName(p: number): string {
  return p < 1.85 || p >= 25.8 ? "New moon" : p < 5.5 ? "Waxing crescent" : p < 9.2 ? "First quarter" : p < 12.9 ? "Waxing gibbous" : p < 16.6 ? "Full moon" : p < 20.3 ? "Waning gibbous" : p < 24 ? "Last quarter" : "Waning crescent";
}
