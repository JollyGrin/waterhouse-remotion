import React from "react";
import { AbsoluteFill, type CalculateMetadataFunction } from "remotion";

// Some compositions play media that is gitignored (large footage, local
// renders). On a fresh clone those files are not there and Remotion fails
// with a 404. Instead, check the files up front in calculateMetadata and show
// a card naming what is missing. When every file is present `missingMedia`
// is empty and the composition renders exactly as before.

export type MediaCheckProps = { missingMedia?: string[] };

/** "public/session/head.mp4" for a staticFile() URL, else the URL itself. */
export function publicLabel(url: string): string {
  const base = typeof window === "undefined" ? "" : window.remotion_staticBase;
  const path = base && url.startsWith(`${base}/`) ? url.slice(base.length + 1) : url.replace(/^\//, "");
  try {
    return `public/${decodeURIComponent(path)}`;
  } catch {
    return `public/${path}`;
  }
}

/** Only a 404 counts as missing; any other answer or a network error is left to the player. */
async function isMissing(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    return res.status === 404;
  } catch {
    return false;
  }
}

/**
 * calculateMetadata that checks `media(props)` (staticFile() URLs) and passes
 * the missing ones down as `missingMedia`. Duration and size are untouched.
 */
export function checkMedia<P extends object>(
  media: (props: P) => string[],
): CalculateMetadataFunction<P & MediaCheckProps> {
  return async ({ props }) => {
    const urls = [...new Set(media(props))];
    const flags = await Promise.all(urls.map(isMissing));
    const missingMedia = urls.filter((_, i) => flags[i]).map(publicLabel);
    return { props: { ...props, missingMedia } };
  };
}

export const MissingMediaCard: React.FC<{ files: string[] }> = ({ files }) => (
  <AbsoluteFill
    style={{
      backgroundColor: "#111",
      color: "#eee",
      fontFamily: "Menlo, Consolas, monospace",
      justifyContent: "center",
      alignItems: "center",
      padding: 60,
      textAlign: "center",
      gap: 18,
    }}
  >
    <div style={{ fontSize: 48, fontWeight: 700, color: "#ffb020" }}>Missing media</div>
    {files.map((f) => (
      <div key={f} style={{ fontSize: 30 }}>
        missing {f}
      </div>
    ))}
    <div style={{ fontSize: 24, opacity: 0.6, marginTop: 24 }}>
      Gitignored, not in a fresh clone. See README: Media for local compositions.
    </div>
  </AbsoluteFill>
);

/** Render the placeholder card when `missingMedia` is non-empty, else the component as-is. */
export function withMediaCheck<P extends object>(
  Component: React.ComponentType<P>,
): React.FC<P & MediaCheckProps> {
  const Wrapped: React.FC<P & MediaCheckProps> = ({ missingMedia, ...rest }) =>
    missingMedia && missingMedia.length > 0 ? (
      <MissingMediaCard files={missingMedia} />
    ) : (
      <Component {...(rest as P)} />
    );
  Wrapped.displayName = `WithMediaCheck(${Component.displayName ?? Component.name})`;
  return Wrapped;
}
