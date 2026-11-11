import React, { useMemo } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { measureText } from "@remotion/layout-utils";
import { loadFont } from "@remotion/google-fonts/Inter";
import type { CaptionWord } from "../session/Captions";
import { CAPTIONS } from "./theme";

/**
 * The same karaoke treatment the episodes use, re-laid out for 9:16.
 *
 * The episode version fits a whole phrase on one 1560px line. That line is wider than
 * this entire canvas, so here a page wraps over up to two lines and the page breaks
 * when a third would be needed — a third line would push the block down into the
 * region Instagram covers with its own caption and buttons.
 */

const { fontFamily } = loadFont();

type Line = CaptionWord[];
type Page = { start: number; end: number; lines: Line[] };

const advanceOf = (word: CaptionWord) =>
  measureText({
    text: word.w,
    fontFamily,
    fontSize: CAPTIONS.fontSize,
    fontWeight: CAPTIONS.fontWeight,
  }).width + CAPTIONS.wordGap;

export const buildPages = (words: CaptionWord[]): Page[] => {
  const pages: Page[] = [];
  let lines: Line[] = [[]];
  let width = 0;

  const flush = () => {
    const used = lines.filter((l) => l.length);
    if (!used.length) return;
    const first = used[0][0];
    const lastLine = used[used.length - 1];
    const last = lastLine[lastLine.length - 1];
    pages.push({ start: first.t, end: last.t + last.d, lines: used });
    lines = [[]];
    width = 0;
  };

  for (const word of words) {
    const advance = advanceOf(word);
    const current = lines[lines.length - 1];

    if (current.length && width + advance > CAPTIONS.maxWidth) {
      // The line is full. Start another one, or start a new page if this page has
      // already used every line it is allowed.
      if (lines.length >= CAPTIONS.maxLines) {
        flush();
      } else {
        lines.push([]);
        width = 0;
      }
    } else if (word.br && lines[lines.length - 1].length) {
      // A break in the source transcript is a phrase boundary — respect it by
      // starting a new page rather than running two sentences together.
      flush();
    }

    lines[lines.length - 1].push(word);
    width += advance;
  }
  flush();

  // Hold a page until the next one starts so a short pause doesn't blank the frame,
  // but not indefinitely or a line hangs over silence.
  for (let i = 0; i < pages.length - 1; i++) {
    pages[i].end = Math.max(
      pages[i].end,
      Math.min(pages[i + 1].start, pages[i].end + 1.0),
    );
  }
  return pages;
};

export const ReelCaptions: React.FC<{ words: CaptionWord[] }> = ({ words }) => {
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
        flexDirection: "column",
        alignItems: "center",
        gap: 0,
        fontFamily,
        fontSize: CAPTIONS.fontSize,
        fontWeight: CAPTIONS.fontWeight,
        lineHeight: CAPTIONS.lineHeight,
        color: "white",
        whiteSpace: "pre",
      }}
    >
      {page.lines.map((line, li) => (
        <div
          key={li}
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "baseline",
            flexWrap: "nowrap",
            gap: CAPTIONS.wordGap,
          }}
        >
          {line.map((word, i) => {
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
                  textShadow: active ? "none" : "0 3px 12px rgba(0,0,0,0.6)",
                }}
              >
                {word.w}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
};
