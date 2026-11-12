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

/** The other 24 nb-bumpers ideas land in the second PR for #28. */
export const OTHER_IDENTS: IdentIdea[] = [];

export const IDENT_IDEAS: IdentIdea[] = [...SESSIONS_INTRO, ...OTHER_IDENTS];

export const IDENT_PREFIX = "Ident";

/** The alpha composition ids for one idea: portrait first, then 16:9 if it has one. */
export function identCompIds(i: IdentIdea): string[] {
  const base = `${IDENT_PREFIX}${i.idea}`;
  return i.wide ? [base, `${base}-16x9`] : [base];
}

/** Every alpha composition id (no -preview ones). */
export const IDENT_COMP_IDS: string[] = IDENT_IDEAS.flatMap(identCompIds);
