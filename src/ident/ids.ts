/**
 * The ident catalogue as plain data, so the render script and the tests can use it
 * without bundling any React. src/ident/Idents.tsx maps each idea to its components.
 *
 * Composition ids are the nb-bumpers prototype's ids prefixed "Ident":
 *   Ident<Idea>               9:16 alpha stinger (transparent outside the ident)
 *   Ident<Idea>-preview       the same over stand-in footage
 *   Ident<Idea>-16x9          16:9 cut (only ideas with `wide`)
 *   Ident<Idea>-16x9-preview  the same over stand-in footage
 */

export interface IdentIdea {
  /** Prototype composition id, without the "Ident" prefix. */
  idea: string;
  /** Has a 16:9 layout. */
  wide: boolean;
  /** One line for the README and the Studio sidebar. */
  blurb: string;
}

/** Fuse is the Sessions intro; FuseLines are its redrawn-beam alternatives. Studio lists these first. */
export const SESSIONS_INTRO: IdentIdea[] = [
  { idea: "Fuse", wide: true, blurb: "the Sessions intro: the scope beam draws the mark, then it is scratched on a record (Splice's soundtrack)" },
  { idea: "FuseLines-Ink", wide: true, blurb: "Fuse with the beam redrawn as an ink line after the Waterhouse Radio poster; Denzo pressed 4 semitones lower" },
  { idea: "FuseLines-Wave", wide: true, blurb: "the ink line with wave echoes; Denzo 7 semitones lower" },
  { idea: "FuseLines-Draft", wide: true, blurb: "the ink line as a draughtsman's drawing (ruler, callouts); Denzo 12 semitones lower" },
];

/** The rest of the nb-bumpers ideas, alphabetical. */
export const OTHER_IDENTS: IdentIdea[] = [
  { idea: "Cymatics", wide: true, blurb: "white sand on a speaker-driven plate runs into Chladni figures, then into the mark" },
  { idea: "Deadpan", wide: false, blurb: "typed mono lines, a browser selection, DELETE, a slammed title card" },
  { idea: "Drop", wide: false, blurb: "physics comedy: the title and the mark land on a ledge as heavy blocks, then a trapdoor drops them" },
  { idea: "Extrude", wide: false, blurb: "the brutal offset shadow extrudes into a 3D block" },
  { idea: "Feedback", wide: true, blurb: "a camera pointed at its own monitor; kicks push the feedback into a tunnel" },
  { idea: "Fracture", wide: false, blurb: "the mark chiselled out of a board-formed concrete slab" },
  { idea: "Groove", wide: true, blurb: "Scope's Lissajous resolves into a spinning record, then Platter's second half" },
  { idea: "Laser", wide: true, blurb: "a club laser show in haze; the projector draws the mark" },
  { idea: "Louvre", wide: false, blurb: "a wall of metal fins turns in waves to reveal the mark" },
  { idea: "Monolith", wide: false, blurb: "Extrude remade serious: dark concrete slabs under one raking light" },
  { idea: "Morph", wide: false, blurb: "a black square bounces, splits and morphs into the logo pieces on the beat" },
  { idea: "Phosphor", wide: true, blurb: "Scope's beam becomes Platter's record without a cut" },
  { idea: "Pinscreen", wide: false, blurb: "a wall of machined pins presses the mark out in relief" },
  { idea: "Platter", wide: true, blurb: "a record under a booth light; the DJ scratches the mark on the label" },
  { idea: "Popup", wide: false, blurb: "the mark as a paper pop-up book" },
  { idea: "Press", wide: false, blurb: "the site's button is the ident: a card pops, the logo pieces land on the beat" },
  { idea: "Scope", wide: true, blurb: "an oscilloscope beam draws the mark; the sound is the XY signal" },
  { idea: "Slice", wide: false, blurb: "knife cuts split a stack of cut paper, showing its coloured layers" },
  { idea: "Spectro", wide: true, blurb: "the mark hidden in the spectrogram of the sound" },
  { idea: "Splice", wide: true, blurb: "Scope's first half, hard-cut on the big kick into Platter's second half" },
  { idea: "Stamp", wide: false, blurb: "a riso press: misregistered ink passes snap into register" },
  { idea: "Strobe", wide: false, blurb: "the mark cut out of a black wall, a club strobe behind it" },
  { idea: "Tile", wide: false, blurb: "the mark multiplies into brand wallpaper, then a dive through one door" },
  { idea: "Xerox", wide: false, blurb: "an underground techno flyer coming off a photocopier" },
];

export const IDENT_IDEAS: IdentIdea[] = [...SESSIONS_INTRO, ...OTHER_IDENTS];

export const IDENT_PREFIX = "Ident";

/** The alpha composition ids for one idea: portrait first, then 16:9 if it has one. */
export function identCompIds(i: IdentIdea): string[] {
  const base = `${IDENT_PREFIX}${i.idea}`;
  return i.wide ? [base, `${base}-16x9`] : [base];
}

/** Every alpha composition id (no -preview ones). */
export const IDENT_COMP_IDS: string[] = IDENT_IDEAS.flatMap(identCompIds);
