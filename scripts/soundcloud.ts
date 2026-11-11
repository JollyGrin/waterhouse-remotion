/**
 * Reads the WaterHouseRadio SoundCloud channel.
 *
 * SoundCloud stopped issuing API keys years ago, so this goes through the same
 * public endpoint the website itself uses: scrape a `client_id` out of their JS
 * bundle, then call api-v2. Read-only, and only ever against Waterhouse's own
 * public profile. The client_id rotates, so it is fetched fresh each run rather than
 * stored — if SoundCloud changes their bundle layout this is the piece that breaks,
 * and it fails loudly rather than silently returning nothing.
 */

const PROFILE = "https://soundcloud.com/waterhouseradio";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";

export type Mix = {
  artist: string;
  /** The show's own date, taken from the title, not the upload date. */
  date: Date;
  /** Upload timestamp — the tiebreak when two shows share a date. */
  uploadedAt: string;
  title: string;
  url: string;
};

async function get(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} from ${url}`);
  return res.text();
}

async function clientId(page: string): Promise<string> {
  const bundles = [...page.matchAll(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map(
    (m) => m[1]
  );
  // The id lives in one of the later bundles; walk backwards to find it sooner.
  for (const url of bundles.reverse()) {
    try {
      const found = (await get(url)).match(/client_id\s*[:=]\s*"([A-Za-z0-9]{20,})"/);
      if (found) return found[1];
    } catch {
      // A missing bundle is not fatal; try the next one.
    }
  }
  throw new Error(
    "could not find SoundCloud's client_id — they have probably changed their bundle layout"
  );
}

function userId(page: string): number {
  const m = page.match(/"id":(\d{6,}),"kind":"user"/) ?? page.match(/soundcloud:users:(\d+)/);
  if (!m) throw new Error("could not find the WaterHouseRadio user id on the profile page");
  return Number(m[1]);
}

/** Titles read "ARTIST @ WTHS Radio 8.7.2026", sometimes with the date bracketed. */
export function parseTitle(title: string): { artist: string; date: Date } | null {
  const m = title.match(/^(.*?)\s*@\s*WTHS\s*Radio\s*\(?\s*(\d{1,2})\.(\d{1,2})\.(\d{4})\s*\)?\s*$/i);
  if (!m) return null;
  return {
    artist: m[1].trim(),
    date: new Date(Number(m[4]), Number(m[3]) - 1, Number(m[2])),
  };
}

export async function fetchMixes(): Promise<{ mixes: Mix[]; skipped: string[] }> {
  const page = await get(PROFILE);
  const id = userId(page);
  const cid = await clientId(page);
  const raw = JSON.parse(
    await get(`https://api-v2.soundcloud.com/users/${id}/tracks?limit=200&client_id=${cid}`)
  ) as { collection: Array<{ title: string; created_at: string; permalink_url: string }> };

  const mixes: Mix[] = [];
  const skipped: string[] = [];
  for (const t of raw.collection) {
    const parsed = parseTitle(t.title);
    if (!parsed) {
      skipped.push(t.title);
      continue;
    }
    mixes.push({ ...parsed, uploadedAt: t.created_at, title: t.title, url: t.permalink_url });
  }
  // Session order is the show date, with the upload time breaking same-day ties.
  // Checked against the six covers whose numbers are known: all six land right.
  mixes.sort(
    (a, b) => a.date.getTime() - b.date.getTime() || a.uploadedAt.localeCompare(b.uploadedAt)
  );
  return { mixes, skipped };
}
