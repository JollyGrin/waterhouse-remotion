import React, { useMemo } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { measureText } from "@remotion/layout-utils";
import { loadFont } from "@remotion/google-fonts/Inter";
import { CAPTIONS } from "./theme";

/**
 * Word-level karaoke captions, matching the look already burned into the finished
 * Waterhouse episodes: a whole phrase on one line, spoken words at full white, the
 * word being said in a solid blue box, and the words still to come dimmed.
 */

const { fontFamily } = loadFont();

export type CaptionWord = { t: number; d: number; w: string; br: boolean };
type Page = { start: number; end: number; words: CaptionWord[] };

/**
 * Group words into pages. One line at a time — the reference shows a whole phrase and
 * highlights the word being spoken, rather than popping words in one at a time.
 */
export const buildPages = (words: CaptionWord[]): Page[] => {
  const pages: Page[] = [];
  let current: CaptionWord[] = [];
  let width = 0;

  const flush = () => {
    if (!current.length) return;
    const last = current[current.length - 1];
    pages.push({ start: current[0].t, end: last.t + last.d, words: current });
    current = [];
    width = 0;
  };

  for (const word of words) {
    const advance =
      measureText({
        text: word.w,
        fontFamily,
        fontSize: CAPTIONS.fontSize,
        fontWeight: CAPTIONS.fontWeight,
      }).width + CAPTIONS.wordGap;

    if (current.length && (word.br || width + advance > CAPTIONS.maxWidth)) flush();
    current.push(word);
    width += advance;
  }
  flush();

  // A page holds until the next begins, so a short pause after a phrase doesn't leave
  // the frame empty — but not indefinitely, or a line lingers over silence.
  for (let i = 0; i < pages.length - 1; i++) {
    pages[i].end = Math.max(
      pages[i].end,
      Math.min(pages[i + 1].start, pages[i].end + 1.2),
    );
  }
  return pages;
};

export const Captions: React.FC<{ words: CaptionWord[] }> = ({ words }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const time = frame / fps;

  const pages = useMemo(() => buildPages(words), [words]);
  const page = useMemo(
    () => pages.find((p) => time >= p.start && time < p.end),
    [pages, time],
  );

  if (!page) return null;

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: CAPTIONS.centreY,
        transform: "translateY(-50%)",
        display: "flex",
        justifyContent: "center",
        alignItems: "baseline",
        flexWrap: "nowrap",
        gap: CAPTIONS.wordGap,
        paddingLeft: 60,
        paddingRight: 60,
        fontFamily,
        fontSize: CAPTIONS.fontSize,
        fontWeight: CAPTIONS.fontWeight,
        color: "white",
        whiteSpace: "pre",
      }}
    >
      {page.words.map((word, i) => {
        const active = time >= word.t && time < word.t + word.d;
        const spoken = time >= word.t;
        return (
          <span
            key={`${word.t}-${i}`}
            style={{
              opacity: spoken ? 1 : CAPTIONS.upcomingOpacity,
              backgroundColor: active ? CAPTIONS.activeBackground : "transparent",
              borderRadius: CAPTIONS.boxRadius,
              padding: `${CAPTIONS.boxPaddingY}px ${CAPTIONS.boxPaddingX}px`,
              margin: `${-CAPTIONS.boxPaddingY}px ${-CAPTIONS.boxPaddingX}px`,
              // Only the unhighlighted words need the shadow; behind the blue box it
              // just muddies the edge.
              textShadow: active ? "none" : "0 2px 8px rgba(0,0,0,0.55)",
            }}
          >
            {word.w}
          </span>
        );
      })}
    </div>
  );
};
