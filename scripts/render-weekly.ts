#!/usr/bin/env bun
/**
 * Render Weekly Lineup video from Waterhouse Studios calendar API.
 *
 * Usage:
 *   bun scripts/render-weekly.ts
 *
 * You'll be prompted to either:
 *   1. Paste a bearer token directly, OR
 *   2. Paste a full curl command (the token will be extracted)
 *
 * Press Enter with no input to try the public endpoint without auth.
 */

import { execSync } from "child_process";
import { writeFileSync } from "fs";
import { getCompositionDuration } from "../src/WeeklyLineup";

const API_BASE = "https://api.waterhousestudios.nl/api";

// --- Types matching the API response ---
interface Artist {
  id: string;
  stage_name: string;
  bio: string | null;
  genre: string | null;
  profile_image_url: string | null;
}

interface Reservation {
  id: string;
  start_time: string;
  end_time: string;
  status: string;
  purpose: string | null;
  description: string | null;
  guest_name: string | null;
  color: string | null;
  artists: Artist[];
}

// --- Token extraction ---
function extractBearerToken(input: string): string | null {
  // If it's just a token (no spaces, looks like a JWT)
  if (!input.includes(" ") && input.includes(".")) {
    return input.trim();
  }
  // Extract from curl command
  const match = input.match(/Bearer\s+([A-Za-z0-9_\-\.]+)/);
  return match ? match[1] : null;
}

// --- Date helpers ---
function getWeekBounds(now: Date): { start: Date; end: Date } {
  const day = now.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return { start: monday, end: sunday };
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function formatDateRange(start: Date, end: Date): string {
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  if (start.getMonth() === end.getMonth()) {
    return `${start.getDate()} - ${end.getDate()} ${months[start.getMonth()]}`;
  }
  return `${start.getDate()} ${months[start.getMonth()]} - ${end.getDate()} ${months[end.getMonth()]}`;
}

// --- API fetch ---
async function fetchReservations(token: string | null): Promise<Reservation[]> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}/reservations/public`, { headers });
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { reservations: Reservation[] };
  return data.reservations;
}

// --- Main ---
async function main() {
  console.log("=== Waterhouse Weekly Lineup Renderer ===\n");
  console.log("Paste a bearer token, a full curl command, or press Enter for no auth:");

  const input = (await readLine()).trim();
  let token: string | null = null;

  if (input) {
    token = extractBearerToken(input);
    if (!token) {
      console.error("Could not extract a bearer token from your input.");
      process.exit(1);
    }
    console.log(`Using token: ${token.slice(0, 20)}...${token.slice(-10)}\n`);
  } else {
    console.log("Proceeding without authentication.\n");
  }

  // Fetch reservations
  console.log("Fetching reservations...");
  const reservations = await fetchReservations(token);
  console.log(`Found ${reservations.length} total reservations.`);

  // Filter to this week
  const now = new Date();
  const { start, end } = getWeekBounds(now);
  console.log(`This week: ${start.toDateString()} - ${end.toDateString()}\n`);

  const thisWeek = reservations.filter((r) => {
    const d = new Date(r.start_time);
    return d >= start && d <= end;
  });

  if (thisWeek.length === 0) {
    console.log("No reservations this week. Trying next week...");
    const nextStart = new Date(start);
    nextStart.setDate(nextStart.getDate() + 7);
    const nextEnd = new Date(end);
    nextEnd.setDate(nextEnd.getDate() + 7);

    const nextWeek = reservations.filter((r) => {
      const d = new Date(r.start_time);
      return d >= nextStart && d <= nextEnd;
    });

    if (nextWeek.length === 0) {
      // Fallback: just use the next N upcoming events
      console.log("No events next week either. Using next 5 upcoming events.");
      const upcoming = reservations
        .filter((r) => new Date(r.start_time) >= now)
        .sort(
          (a, b) =>
            new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
        )
        .slice(0, 5);

      if (upcoming.length === 0) {
        console.error("No upcoming events found at all.");
        process.exit(1);
      }

      return renderEvents(upcoming, "COMING UP", "Upcoming Events");
    }

    return renderEvents(
      nextWeek,
      "NEXT WEEK",
      formatDateRange(nextStart, nextEnd)
    );
  }

  return renderEvents(thisWeek, "THIS WEEK", formatDateRange(start, end));
}

async function renderEvents(
  events: Reservation[],
  weekLabel: string,
  dateRange: string
) {
  // Sort by date
  events.sort(
    (a, b) =>
      new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
  );

  console.log(`\nEvents to feature (${events.length}):`);
  for (const e of events) {
    const artistNames = e.artists.map((a) => a.stage_name).join(", ");
    console.log(
      `  ${formatDate(e.start_time)} ${formatTime(e.start_time)} - ${e.purpose || "Event"}${artistNames ? ` (${artistNames})` : ""}`
    );
  }

  // Build artist entries - one per artist, or one per event if no artists
  const artistEntries: Array<{
    artistName: string;
    artistImage: string | null;
    genre: string | null;
    eventDate: string;
    eventTime: string;
    purpose: string;
  }> = [];

  for (const event of events) {
    if (event.artists.length > 0) {
      for (const artist of event.artists) {
        artistEntries.push({
          artistName: artist.stage_name,
          artistImage: artist.profile_image_url,
          genre: artist.genre || artist.bio,
          eventDate: formatDate(event.start_time),
          eventTime: formatTime(event.start_time),
          purpose: event.purpose || "Live",
        });
      }
    } else {
      // Use the event purpose as the "artist" name
      const name =
        event.purpose?.replace(/^(Radio|Reserved|Private):\s*/i, "") ||
        "Event";
      artistEntries.push({
        artistName: name,
        artistImage: null,
        genre: null,
        eventDate: formatDate(event.start_time),
        eventTime: formatTime(event.start_time),
        purpose: event.purpose || "Event",
      });
    }
  }

  if (artistEntries.length === 0) {
    console.error("No entries to render.");
    process.exit(1);
  }

  const duration = getCompositionDuration(artistEntries.length);

  const props = {
    weekLabel,
    dateRange,
    artists: artistEntries,
  };

  console.log(
    `\nRendering ${artistEntries.length} artist(s), ${duration} frames (${(duration / 30).toFixed(1)}s)...`
  );

  // Write props to a temp file for Remotion
  const propsPath = "/tmp/waterhouse-weekly-props.json";
  writeFileSync(propsPath, JSON.stringify(props, null, 2));

  const outPath = `out/WeeklyLineup-${new Date().toISOString().slice(0, 10)}.mp4`;

  const cmd = [
    "bunx",
    "remotion",
    "render",
    "src/index.ts",
    "WeeklyLineup",
    outPath,
    `--props=${propsPath}`,
    `--frames=0-${duration - 1}`,
  ].join(" ");

  console.log(`\n$ ${cmd}\n`);
  execSync(cmd, { stdio: "inherit", cwd: process.cwd() });
  console.log(`\nDone! Output: ${outPath}`);
}

function readLine(): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const chunks: Buffer[] = [];

    stdin.setEncoding("utf-8");
    stdin.resume();

    const onData = (chunk: Buffer) => {
      const str = chunk.toString();
      if (str.includes("\n")) {
        chunks.push(Buffer.from(str.split("\n")[0]));
        stdin.removeListener("data", onData);
        stdin.pause();
        resolve(Buffer.concat(chunks).toString().trim());
      } else {
        chunks.push(chunk);
      }
    };

    stdin.on("data", onData);
  });
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
