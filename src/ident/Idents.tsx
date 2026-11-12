/**
 * Studio registrations for the idents ported from the nb-bumpers prototype (#28).
 * Everything sits in one "Idents" folder; the Sessions intro (Fuse and its FuseLines
 * variants) comes first in its own subfolder. Ids and the catalogue live in ./ids.
 */
import React from "react";
import { AbsoluteFill, Composition, Folder } from "remotion";
import { FPS, H, W } from "./brand";
import { Backdrop } from "./common";
import { Fuse, FUSE_FRAMES, FuseWide } from "./Fuse";
import { makeFuseLines } from "./FuseLines";
import { IDENT_PREFIX, SESSIONS_INTRO, OTHER_IDENTS, type IdentIdea } from "./ids";

export const WIDE_W = 1920;
export const WIDE_H = 1080;

/**
 * The prototype had no CSS reset; this repo loads Tailwind's preflight (src/index.css), whose
 * `html { line-height: 1.5 }` would drop every ident's text a pixel or two. Put back the
 * browser default so the idents render exactly as they did in nb-bumpers.
 */
const PROTOTYPE_CSS: React.CSSProperties = { lineHeight: "normal" };

const asInPrototype = (C: React.FC): React.FC => {
  const Ident: React.FC = () => (
    <AbsoluteFill style={PROTOTYPE_CSS}>
      <C />
    </AbsoluteFill>
  );
  return Ident;
};

/** The ident over the stand-in interview footage, to judge it in context. */
const withBackdrop = (C: React.FC): React.FC => {
  const Preview: React.FC = () => (
    <AbsoluteFill style={PROTOTYPE_CSS}>
      <Backdrop />
      <C />
    </AbsoluteFill>
  );
  return Preview;
};

interface Cut {
  C: React.FC;
  /** Built once, so Studio re-renders don't hand Remotion new component identities. */
  Preview: React.FC;
}
interface IdentParts {
  tall: Cut;
  wide?: Cut;
  frames: number;
}

const cut = (C: React.FC): Cut => ({ C: asInPrototype(C), Preview: withBackdrop(C) });
const parts = (Tall: React.FC, Wide: React.FC | null, frames: number): IdentParts => ({
  tall: cut(Tall),
  wide: Wide ? cut(Wide) : undefined,
  frames,
});

// FuseLines: the scope beam redrawn after the Waterhouse Radio poster, each on a lower Denzo pressing.
const fuseLines = (v: "ink" | "wave" | "draft", semitones: number): IdentParts => {
  const { Tall, Wide } = makeFuseLines(v, `ident/audio/fuselines/mix-${semitones}.wav`);
  return parts(Tall, Wide, FUSE_FRAMES);
};

const PARTS: Record<string, IdentParts> = {
  Fuse: parts(Fuse, FuseWide, FUSE_FRAMES),
  "FuseLines-Ink": fuseLines("ink", 4),
  "FuseLines-Wave": fuseLines("wave", 7),
  "FuseLines-Draft": fuseLines("draft", 12),
};

const IdeaFolder: React.FC<{ i: IdentIdea }> = ({ i }) => {
  const p = PARTS[i.idea];
  if (!p) throw new Error(`No components registered for ident "${i.idea}"`);
  const id = `${IDENT_PREFIX}${i.idea}`;
  const { frames } = p;
  return (
    <Folder name={i.idea}>
      <Composition id={id} component={p.tall.C} durationInFrames={frames} fps={FPS} width={W} height={H} />
      <Composition id={`${id}-preview`} component={p.tall.Preview} durationInFrames={frames} fps={FPS} width={W} height={H} />
      {p.wide ? (
        <>
          <Composition id={`${id}-16x9`} component={p.wide.C} durationInFrames={frames} fps={FPS} width={WIDE_W} height={WIDE_H} />
          <Composition id={`${id}-16x9-preview`} component={p.wide.Preview} durationInFrames={frames} fps={FPS} width={WIDE_W} height={WIDE_H} />
        </>
      ) : null}
    </Folder>
  );
};

export const IdentCompositions: React.FC = () => (
  <Folder name="Idents">
    <Folder name="Sessions-intro">
      {SESSIONS_INTRO.map((i) => (
        <IdeaFolder key={i.idea} i={i} />
      ))}
    </Folder>
    {OTHER_IDENTS.map((i) => (
      <IdeaFolder key={i.idea} i={i} />
    ))}
  </Folder>
);
