// Expands an iCal (.ics) feed into concrete events inside a date window.
// Handles repeating events (RRULE/EXDATE), moved/cancelled single occurrences,
// all-day and multi-day events, and time zones (IANA or the feed's own VTIMEZONE).

const dtfCache = new Map();
function dtf(tz) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    dtfCache.set(tz, f);
  }
  return f;
}
export function validTz(tz) { try { dtf(tz); return true; } catch { return false; } }
function offsetMs(tz, ms) {
  const p = {};
  for (const x of dtf(tz).formatToParts(new Date(ms))) p[x.type] = x.value;
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - ms;
}
export function zonedToUtc(y, mo, d, h, mi, s, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const o1 = offsetMs(tz, guess);
  let t = guess - o1;
  const o2 = offsetMs(tz, t);
  if (o2 !== o1) t = guess - o2;
  return t;
}
export function todayIn(tz) {
  const p = {};
  for (const x of dtf(tz).formatToParts(new Date())) p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day}`;
}
const pad = (n) => String(n).padStart(2, "0");
const dayStr = (t) => `${t.year}-${pad(t.month)}-${pad(t.day)}`;
export function addDays(s, n) {
  const [y, m, d] = s.split("-").map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + n));
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
}

function instant(t, tzid, fallbackTz) {
  const z = t.zone && t.zone.tzid;
  if (z === "UTC") return Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
  for (const c of [tzid, z && z !== "floating" ? z : null]) {
    if (c && validTz(c)) return zonedToUtc(t.year, t.month, t.day, t.hour, t.minute, t.second, c);
  }
  if (z && z !== "floating") { try { return t.toJSDate().getTime(); } catch { /* fall through */ } }
  return zonedToUtc(t.year, t.month, t.day, t.hour, t.minute, t.second, fallbackTz);
}

export function expand(ICAL, text, { fromMs, toMs, fromDay, toDay, tz }) {
  const comp = new ICAL.Component(ICAL.parse(text));
  for (const vtz of comp.getAllSubcomponents("vtimezone")) { try { ICAL.TimezoneService.register(vtz); } catch { /* ignore bad zone */ } }

  const masters = new Map(), lone = [], excs = [];
  for (const ve of comp.getAllSubcomponents("vevent")) {
    const ev = new ICAL.Event(ve);
    if (ve.hasProperty("recurrence-id")) excs.push(ev);
    else if (ev.isRecurring()) masters.set(ev.uid, ev);
    else lone.push(ev);
  }
  for (const ex of excs) { const m = masters.get(ex.uid); if (m) m.relateException(ex); else lone.push(ex); }

  const out = [];
  const push = (item, s, e) => {
    if (!s) return;
    if (String(item.component.getFirstPropertyValue("status") || "").toUpperCase() === "CANCELLED") return;
    const tzid = item.component.getFirstProperty("dtstart")?.getParameter("tzid");
    const base = { t: String(item.summary || "(no title)").slice(0, 300), l: String(item.location || "").slice(0, 200) };
    if (s.isDate) {
      const sd = dayStr(s);
      let ed = e ? dayStr(e) : addDays(sd, 1);
      if (ed <= sd) ed = addDays(sd, 1);
      if (ed > fromDay && sd < toDay) out.push({ ...base, a: true, s: sd, e: ed });
    } else {
      const sm = instant(s, tzid, tz);
      const em = e ? Math.max(instant(e, tzid, tz), sm) : sm;
      if ((em > fromMs && sm < toMs) || (em === sm && sm >= fromMs && sm < toMs)) {
        out.push({ ...base, a: false, s: new Date(sm).toISOString(), e: new Date(em).toISOString() });
      }
    }
  };

  for (const ev of lone) push(ev, ev.startDate, ev.endDate);

  const slack = 2 * 864e5;
  for (const m of masters.values()) {
    const it = m.iterator();
    let next, n = 0;
    while ((next = it.next()) && n++ < 60000) {
      const rough = Date.UTC(next.year, next.month - 1, next.day, next.hour || 0, next.minute || 0);
      if (rough > toMs + slack) break;
      if (rough < fromMs - 40 * 864e5) continue; // long before window (keeps room for multi-week events)
      const d = m.getOccurrenceDetails(next);
      push(d.item, d.startDate, d.endDate);
    }
  }
  out.sort((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : 0));
  return out;
}
