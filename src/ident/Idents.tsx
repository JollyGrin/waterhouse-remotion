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
import { Cymatics, CYMATICS_FRAMES, CymaticsWide } from "./Cymatics";
import { Deadpan, DEADPAN_FRAMES } from "./Deadpan";
import { Drop, DROP_FRAMES } from "./Drop";
import { Extrude, EXTRUDE_FRAMES } from "./Extrude";
import { Feedback, FEEDBACK_FRAMES, FeedbackWide } from "./Feedback";
import { Fracture, FRACTURE_FRAMES } from "./Fracture";
import { Groove, GROOVE_FRAMES, GrooveWide } from "./Groove";
import { Laser, LASER_FRAMES, LaserWide } from "./Laser";
import { Louvre, LOUVRE_FRAMES } from "./Louvre";
import { Monolith, MONOLITH_FRAMES } from "./Monolith";
import { Morph, MORPH_FRAMES } from "./Morph";
import { Phosphor, PHOSPHOR_FRAMES, PhosphorWide } from "./Phosphor";
import { Pinscreen, PINSCREEN_FRAMES } from "./Pinscreen";
import { Platter, PLATTER_FRAMES, PlatterWide } from "./Platter";
import { Popup, POPUP_FRAMES } from "./Popup";
import { Press, PRESS_FRAMES } from "./Press";
import { Scope, SCOPE_FRAMES, ScopeWide } from "./Scope";
import { Slice, SLICE_FRAMES } from "./Slice";
import { Spectro, SPECTRO_FRAMES, SpectroWide } from "./Spectro";
import { Splice, SPLICE_FRAMES, SpliceWide } from "./Splice";
import { Stamp, STAMP_FRAMES } from "./Stamp";
import { Strobe, STROBE_FRAMES } from "./Strobe";
import { Tile, TILE_FRAMES } from "./Tile";
import { Xerox, XEROX_FRAMES } from "./Xerox";
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
  Cymatics: parts(Cymatics, CymaticsWide, CYMATICS_FRAMES),
  Deadpan: parts(Deadpan, null, DEADPAN_FRAMES),
  Drop: parts(Drop, null, DROP_FRAMES),
  Extrude: parts(Extrude, null, EXTRUDE_FRAMES),
  Feedback: parts(Feedback, FeedbackWide, FEEDBACK_FRAMES),
  Fracture: parts(Fracture, null, FRACTURE_FRAMES),
  Groove: parts(Groove, GrooveWide, GROOVE_FRAMES),
  Laser: parts(Laser, LaserWide, LASER_FRAMES),
  Louvre: parts(Louvre, null, LOUVRE_FRAMES),
  Monolith: parts(Monolith, null, MONOLITH_FRAMES),
  Morph: parts(Morph, null, MORPH_FRAMES),
  Phosphor: parts(Phosphor, PhosphorWide, PHOSPHOR_FRAMES),
  Pinscreen: parts(Pinscreen, null, PINSCREEN_FRAMES),
  Platter: parts(Platter, PlatterWide, PLATTER_FRAMES),
  Popup: parts(Popup, null, POPUP_FRAMES),
  Press: parts(Press, null, PRESS_FRAMES),
  Scope: parts(Scope, ScopeWide, SCOPE_FRAMES),
  Slice: parts(Slice, null, SLICE_FRAMES),
  Spectro: parts(Spectro, SpectroWide, SPECTRO_FRAMES),
  Splice: parts(Splice, SpliceWide, SPLICE_FRAMES),
  Stamp: parts(Stamp, null, STAMP_FRAMES),
  Strobe: parts(Strobe, null, STROBE_FRAMES),
  Tile: parts(Tile, null, TILE_FRAMES),
  Xerox: parts(Xerox, null, XEROX_FRAMES),
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
