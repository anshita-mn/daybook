// Daybook calendar reader: returns the signed-in user's calendar events for a date window.
// Calendar links live in public.calendar_feeds (row-level security: each user only sees their own).
import ICAL from "npm:ical.js@1.5.0";
import { addDays, expand, todayIn, validTz, zonedToUtc } from "./core.js";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "sb_publishable_9lVUdlHCa1R5zoQd29EjKg_0UVWyOsV";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Only fetch from real calendar providers (never arbitrary hosts).
const ALLOWED = [/(^|\.)google\.com$/i, /(^|\.)outlook\.(live|office365|office)\.com$/i, /(^|\.)icloud\.com$/i];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Sign in first" }, 401);
  const h = { apikey: SB_KEY, Authorization: auth };
  const who = await fetch(`${SB_URL}/auth/v1/user`, { headers: h });
  if (!who.ok) return json({ error: "Sign in first" }, 401);

  const body = await req.json().catch(() => ({}));
  const tz = typeof body.tz === "string" && validTz(body.tz) ? body.tz : "Asia/Kolkata";
  const days = Math.min(Math.max(Math.floor(+body.days || 14), 1), 62);
  const fromDay = typeof body.fromDay === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.fromDay) ? body.fromDay : todayIn(tz);
  const [y, m, d] = fromDay.split("-").map(Number);
  const fromMs = zonedToUtc(y, m, d, 0, 0, 0, tz);
  const toDay = addDays(fromDay, days);
  const [ty, tm, td] = toDay.split("-").map(Number);
  const toMs = zonedToUtc(ty, tm, td, 0, 0, 0, tz);

  const r = await fetch(`${SB_URL}/rest/v1/calendar_feeds?select=id,name,url&order=created_at`, { headers: h });
  if (!r.ok) return json({ error: "Couldn't load your calendars" }, 500);
  const feeds: { id: string; name: string; url: string }[] = await r.json();

  const results = await Promise.all(feeds.slice(0, 8).map(async (f) => {
    try {
      const url = f.url.trim().replace(/^webcal:\/\//i, "https://");
      const host = new URL(url).hostname;
      if (!ALLOWED.some((rx) => rx.test(host))) throw new Error("Only Google, Outlook or iCloud calendar links work here");
      const res = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { "User-Agent": "Daybook calendar reader" } });
      if (!res.ok) throw new Error(res.status === 404 ? "Link not found. Was the secret address reset?" : `Calendar answered ${res.status}`);
      const text = await res.text();
      if (!text.includes("BEGIN:VCALENDAR")) throw new Error("That link isn't an iCal calendar address");
      const events = expand(ICAL, text, { fromMs, toMs, fromDay, toDay, tz }).slice(0, 1500).map((e) => ({ ...e, f: f.id }));
      return { id: f.id, events };
    } catch (e) {
      return { id: f.id, error: String((e as Error).message || e).slice(0, 200), events: [] };
    }
  }));

  return json({
    fromDay, days, tz,
    feeds: feeds.map((f) => ({ id: f.id, name: f.name })),
    events: results.flatMap((x) => x.events).sort((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : 0)),
    errors: results.filter((x) => x.error).map((x) => ({ id: x.id, msg: x.error })),
  });
});
