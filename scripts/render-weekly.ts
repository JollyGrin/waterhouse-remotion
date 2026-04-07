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
  website: string | null;
  social_media: string | null; // JSON string: {"instagram":"...", "tiktok":"..."}
  profile_image_url: string | null;
}

function parseInstagram(artist: Artist): string | null {
  if (!artist.social_media) return null;
  try {
    const parsed =
      typeof artist.social_media === "string"
        ? JSON.parse(artist.social_media)
        : artist.social_media;
    return parsed?.instagram || null;
  } catch {
    return null;
  }
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
  const allReservations = await fetchReservations(token);
  const reservations = allReservations.filter((r) => r.status === "approved");
  console.log(`Found ${allReservations.length} total, ${reservations.length} approved.`);

  // Next 5 upcoming events (including today)
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const upcoming = reservations
    .filter((r) => new Date(r.start_time) >= today)
    .sort(
      (a, b) =>
        new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    )
    .slice(0, 5);

  if (upcoming.length === 0) {
    console.error("No upcoming events found.");
    process.exit(1);
  }

  // Interactive selection
  console.log("\nUpcoming events (toggle with number, Enter to confirm):\n");
  const selected = new Set<number>(
    upcoming.map((_, i) => i) // all selected by default
  );

  const printMenu = () => {
    for (let i = 0; i < upcoming.length; i++) {
      const r = upcoming[i];
      const check = selected.has(i) ? "[x]" : "[ ]";
      const artistNames = r.artists.map((a) => a.stage_name).join(", ");
      const label = `${formatDate(r.start_time)} ${formatTime(r.start_time)} - ${r.purpose || "Event"}${artistNames ? ` (${artistNames})` : ""}`;
      console.log(`  ${i + 1}) ${check} ${label}`);
    }
    console.log("\nType numbers to toggle (e.g. 1 3), then Enter to render:");
  };

  printMenu();

  while (true) {
    const line = (await readLine()).trim();
    if (line === "") {
      // Confirm selection
      break;
    }

    // Parse space-separated numbers
    const nums = line.split(/[\s,]+/).map(Number);
    for (const n of nums) {
      if (n >= 1 && n <= upcoming.length) {
        if (selected.has(n - 1)) {
          selected.delete(n - 1);
        } else {
          selected.add(n - 1);
        }
      }
    }

    // Reprint
    console.log("");
    printMenu();
  }

  const chosen = upcoming.filter((_, i) => selected.has(i));
  if (chosen.length === 0) {
    console.error("No events selected.");
    process.exit(1);
  }

  const firstDate = new Date(chosen[0].start_time);
  const lastDate = new Date(chosen[chosen.length - 1].start_time);
  return renderEvents(chosen, "COMING UP", formatDateRange(firstDate, lastDate));
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
    instagram: string | null;
    website: string | null;
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
          instagram: parseInstagram(artist),
          website: artist.website,
          eventDate: formatDate(event.start_time),
          eventTime: formatTime(event.start_time),
          purpose: event.purpose || "Live",
        });
      }
    } else {
      const name =
        event.purpose?.replace(/^(Radio|Reserved|Private):\s*/i, "") ||
        "Event";
      artistEntries.push({
        artistName: name,
        artistImage: null,
        genre: null,
        instagram: null,
        website: null,
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
  ].join(" ");

  console.log(`\n$ ${cmd}\n`);
  execSync(cmd, { stdio: ["ignore", "inherit", "inherit"], cwd: process.cwd() });
  console.log(`\nDone! Output: ${outPath}`);
}

function readLine(): Promise<string> {
  return new Promise((resolve) => {
    let buf = "";
    const stdin = process.stdin;
    stdin.setEncoding("utf-8");
    stdin.resume();

    const onData = (chunk: string) => {
      buf += chunk;
      const newlineIdx = buf.indexOf("\n");
      if (newlineIdx !== -1) {
        const line = buf.slice(0, newlineIdx);
        stdin.removeListener("data", onData);
        stdin.pause();
        resolve(line.trim());
      }
    };

    stdin.on("data", onData);
  });
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
