import "./index.css";
import { Composition, type CalculateMetadataFunction } from "remotion";
import { MyComposition } from "./Composition";
import {
  SessionPosterType,
  SessionPosterTypeSchema,
  type SessionPosterTypeProps,
} from "./SessionPosterType";
import {
  SessionPoster,
  SessionPosterSchema,
  type SessionPosterProps,
} from "./SessionPoster";
import {
  WeeklyLineup,
  WeeklyLineupSchema,
  getCompositionDuration,
  type WeeklyLineupProps,
} from "./WeeklyLineup";
import { PullUp, PullUpSchema, PULLUP_DURATION } from "./PullUp";
import {
  WaterhouseSession,
  WaterhouseSessionSchema,
  SESSION_DURATION,
} from "./WaterhouseSession";
import {
  ArtistRecap,
  ArtistRecapSchema,
  ARTIST_RECAP_DURATION,
} from "./ArtistRecap";
import {
  HouseWeekly,
  houseWeeklyPropsSchema,
  HOUSEWEEKLY_DURATION,
} from "./HouseWeekly";
import {
  SessionBumper,
  SessionBumperSchema,
  bumperDuration,
  bumperOutName,
  calculateBumperMetadata,
  type SessionBumperProps,
} from "./bumper/SessionBumper";
import {
  BumperStrip,
  BumperStripSchema,
  stripSize,
  type BumperStripProps,
} from "./bumper/Strip";
import { BumperMatte, MATTE_HEIGHT, MATTE_WIDTH } from "./bumper/Matte";
import recapFixture from "./audience/fixtures/recap.json";
import weeklyFixture from "./audience/fixtures/weekly.json";
import weeklyFallbackFixture from "./audience/fixtures/weekly-fallback.json";
import type { ArtistRecapProps } from "./audience/schema";
import { staticFile } from "remotion";
import { LogoReveal } from "./session/LogoReveal";
import type { CaptionWord } from "./session/Captions";
import { FPS, WIDTH, HEIGHT, OPEN, CLOSE } from "./session/theme";
import {
  SessionReel,
  getReelDuration,
  type ReelSegment,
} from "./reel/SessionReel";
import { FPS as REEL_FPS, WIDTH as REEL_WIDTH, HEIGHT as REEL_HEIGHT } from "./reel/theme";
import reelData from "./reel/data/current.json";
import { FortRiddim } from "./fort-riddim/FortRiddim";
import { FortRiddimPromo } from "./fort-riddim/FortRiddimPromo";
import * as PROMO from "./fort-riddim/promo";
import { FortRiddimShowcase } from "./fort-riddim/FortRiddimShowcase";
import * as SHOWCASE from "./fort-riddim/showcase";
import * as FR from "./fort-riddim/edit";

/**
 * SessionOpen / SessionClose mask a clip inside the Waterhouse mark. They read the
 * first and last five seconds of a finished episode from public/session/ (gitignored)
 * rather than the whole episode: Remotion copies all of public/ into its bundle on
 * every render. Cut them with ffmpeg (see CLAUDE.md, "Session logo reveal").
 * Editing the episode itself is sesh-edit's job (longform/).
 */
const HEAD_SRC = staticFile("session/head.mp4");
const TAIL_SRC = staticFile("session/tail.mp4");

const calculateWeeklyMetadata: CalculateMetadataFunction<WeeklyLineupProps> = ({
  props,
}) => {
  return {
    durationInFrames: getCompositionDuration(props.artists.length),
  };
};

// The strip's canvas grows with the number of cells.
const calculateStripMetadata: CalculateMetadataFunction<BumperStripProps> = ({
  props,
}) => ({ ...stripSize(props), durationInFrames: 1 });

const defaultBumperProps: SessionBumperProps = {
  idea: "door",
  guestName: null,
  idle: false,
  preview: false,
};

const defaultArtists: WeeklyLineupProps["artists"] = [
  {
    artistName: "Denzo",
    artistImage: "https://i.imgur.com/nt2wsuD.png",
    genre: "DJ",
    instagram: "denzo.dj",
    website: null,
    eventDate: "Thu 5 Mar",
    eventTime: "19:00",
    purpose: "Radio: Denzo",
  },
  {
    artistName: "The Silintist",
    artistImage: null,
    genre: null,
    instagram: null,
    website: "https://thesilintist.com",
    eventDate: "Fri 7 Mar",
    eventTime: "20:00",
    purpose: "Radio: Sudden Rave",
  },
];

// Demo data for PullUp - the same two artists WeeklyLineup previews with.
const defaultPullUpAvatars = [
  { label: "MZ", image: null },
  { label: "NB", image: null },
  { label: "SR", image: null },
  { label: "JV", image: null },
  { label: "KL", image: null },
  { label: "TN", image: null },
];

// The first bubble is always yours - you act before anyone else arrives.
const defaultPullUpChat = [
  { name: "you", text: "let's go Denzo!" },
  { name: "joos", text: "track 3 is nasty" },
  { name: "sef", text: "what is this??" },
];

// A shared booking: one clip for the night, both artists on the bill. Real
// props from `bun run render:pullup`.
const sharedPullUpPerformers = [
  { name: "Elemzene", image: "https://i.imgur.com/awQ1ZOR.png" },
  { name: "L4C4", image: "https://i.imgur.com/W9s7uwJ.jpeg" },
];

const sharedPullUpChat = [
  { name: "you", text: "let's go Beatshopping!" },
  { name: "nadi", text: "shazam is useless here" },
  { name: "sef", text: "tuned in from work" },
];

const fallbackPullUpChat = [
  { name: "you", text: "let's go The Silintist!" },
  { name: "mira", text: "heyy \u{1F44B}" },
  { name: "roos", text: "what is this??" },
];

// Tuesday's Waterhouse Sessions: Denzo hosts. Real props from
// `bun run render:session --guest "Duncen"`.
const sessionHost = {
  name: "Denzo",
  image:
    "https://cdn.waterhousestudios.nl/artists/019ad5fb-59f4-72ef-b661-988ce2b7a1e4/1788538839200.jpg",
};

const sessionChat = [
  { name: "you", text: "let's go Duncen Haakmat!" },
  { name: "joos", text: "denzo ask about the first gig" },
  { name: "sef", text: "staying for the set" },
];

const plainSetChat = [
  { name: "you", text: "let's go The Silintist!" },
  { name: "mira", text: "heyy \u{1F44B}" },
  { name: "roos", text: "tuesday ritual" },
];

// Real shape, real numbers, initials only - regenerated by
// `bun scripts/fetch-audience.ts --fixtures`.
const recapProps = recapFixture as ArtistRecapProps;

// Second registration for the fallbacks the spec calls out: no artist image,
// a single session, and nobody left to count after exclusions.
const recapFallbackProps: ArtistRecapProps = {
  artistName: "The Silintist",
  artistImage: null,
  sessions: [
    {
      start: "2026-09-05T20:00:00Z",
      end: "2026-09-05T21:30:00Z",
      durationMin: 90,
      slotLabel: "Sat 8pm",
      dateLabel: "Sep 5",
      peak: 1,
      uniques: 0,
      pulled: 0,
      returning: 0,
      regulars: 0,
      crowd: 0,
      holdRate: 0,
      follows: 0,
      // Before chat capture shipped, so spoke is omitted rather than shown as 0.
      chat: null,
      quadrant: "quiet",
      shared: false,
      viewers: [],
    },
  ],
  bestUniques: 0,
  bestCrowd: 0,
  nextSlot: null,
};

const defaultPoster: SessionPosterProps = {
  artistName: "Timo Feyman",
  sessionNumber: 12,
  dateLabel: "30.7.2026",
  photo: "artists/timo-feyman.png",
  photoScale: 0.56,
  photoOffsetX: -0.272,
  photoOffsetY: -0.365,
  photoMode: "window",
  photoBottomFade: 0.32,
  nameFont: "anton",
  grainOpacity: 0.16,
};

const defaultTypePoster: SessionPosterTypeProps = {
  artistName: "Miss Remalu",
  sessionNumber: 9,
  dateLabel: "23.7.2026",
  variant: "blueprint",
  grainOpacity: 0.18,
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="SessionPosterType"
        component={SessionPosterType}
        schema={SessionPosterTypeSchema}
        durationInFrames={1}
        fps={30}
        width={2000}
        height={2000}
        defaultProps={defaultTypePoster}
      />
      <Composition
        id="FortRiddim"
        component={FortRiddim}
        durationInFrames={FR.TOTAL_FRAMES}
        fps={FR.FPS}
        width={FR.WIDTH}
        height={FR.HEIGHT}
      />
      <Composition
        id="FortRiddimPromo"
        component={FortRiddimPromo}
        durationInFrames={PROMO.FRAMES}
        fps={PROMO.FPS}
        width={PROMO.WIDTH}
        height={PROMO.HEIGHT}
      />
      <Composition
        id="FortRiddimShowcase"
        component={FortRiddimShowcase}
        durationInFrames={SHOWCASE.FRAMES}
        fps={SHOWCASE.FPS}
        width={SHOWCASE.WIDTH}
        height={SHOWCASE.HEIGHT}
      />
      <Composition
        id="SessionReel"
        component={SessionReel}
        durationInFrames={getReelDuration(reelData.pictureFrames)}
        fps={REEL_FPS}
        width={REEL_WIDTH}
        height={REEL_HEIGHT}
        defaultProps={{
          cutSrc: staticFile(reelData.cutFile),
          segments: reelData.segments as ReelSegment[],
          captions: reelData.captions as CaptionWord[],
          pictureFrames: reelData.pictureFrames,
          artist: reelData.artist,
          episodeLabel: reelData.episodeLabel,
          cta: reelData.cta,
        }}
      />
      <Composition
        id="SessionOpen"
        component={LogoReveal}
        durationInFrames={OPEN.durationInFrames}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        defaultProps={{ mode: "open" as const, src: HEAD_SRC, trimBefore: 0 }}
      />
      <Composition
        id="SessionClose"
        component={LogoReveal}
        durationInFrames={CLOSE.durationInFrames}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        defaultProps={{ mode: "close" as const, src: TAIL_SRC, trimBefore: 0 }}
      />
      <Composition
        id="SessionPoster"
        component={SessionPoster}
        schema={SessionPosterSchema}
        durationInFrames={1}
        fps={30}
        width={2000}
        height={2000}
        defaultProps={defaultPoster}
      />
      <Composition
        id="MyComp"
        component={MyComposition}
        durationInFrames={450}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="WeeklyLineup"
        component={WeeklyLineup}
        schema={WeeklyLineupSchema}
        calculateMetadata={calculateWeeklyMetadata}
        durationInFrames={getCompositionDuration(defaultArtists.length)}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          weekLabel: "THIS WEEK",
          dateRange: "3 - 9 March",
          artists: defaultArtists,
          audioTrack: null,
        }}
      />
      <Composition
        id="PullUp"
        component={PullUp}
        schema={PullUpSchema}
        durationInFrames={PULLUP_DURATION}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          artistName: "Denzo",
          artistImage: "https://i.imgur.com/nt2wsuD.png",
          genre: "Dub Techno",
          eventDay: "Thu",
          eventTime: "19:00",
          eventDate: "Thu 5 Mar",
          avatars: defaultPullUpAvatars,
          chatLines: defaultPullUpChat,
          seed: 0,
          bedVariant: "b" as const,
        }}
      />
      <Composition
        id="HouseWeekly"
        component={HouseWeekly}
        schema={houseWeeklyPropsSchema}
        durationInFrames={HOUSEWEEKLY_DURATION}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={houseWeeklyPropsSchema.parse(weeklyFixture)}
      />
      {/* A one-show week: single board row, badges mostly unearned, no lineup
          for next week yet. The thin end of the data. */}
      <Composition
        id="HouseWeeklyFallback"
        component={HouseWeekly}
        schema={houseWeeklyPropsSchema}
        durationInFrames={HOUSEWEEKLY_DURATION}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={houseWeeklyPropsSchema.parse(weeklyFallbackFixture)}
      />
      {/* A shared booking: the event leads, both artists share the window. */}
      <Composition
        id="PullUpShared"
        component={PullUp}
        schema={PullUpSchema}
        durationInFrames={PULLUP_DURATION}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          artistName: "Beatshopping",
          artistImage: null,
          genre: null,
          eventDay: "Fri",
          eventTime: "19:00",
          eventDate: "Fri 11 Sep",
          avatars: defaultPullUpAvatars,
          chatLines: sharedPullUpChat,
          performers: sharedPullUpPerformers,
          seed: 2,
          bedVariant: "b" as const,
        }}
      />
      {/* Second demo artist - no photo, no genre: exercises the fallbacks. */}
      <Composition
        id="PullUpFallback"
        component={PullUp}
        schema={PullUpSchema}
        durationInFrames={PULLUP_DURATION}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          artistName: "The Silintist",
          artistImage: null,
          genre: null,
          eventDay: "Fri",
          eventTime: "20:00",
          eventDate: "Fri 7 Mar",
          avatars: defaultPullUpAvatars,
          chatLines: fallbackPullUpChat,
          seed: 2,
          bedVariant: "b" as const,
        }}
      />
      <Composition
        id="WaterhouseSession"
        component={WaterhouseSession}
        schema={WaterhouseSessionSchema}
        durationInFrames={SESSION_DURATION}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          guest: {
            name: "Duncen Haakmat",
            image:
              "https://cdn.waterhousestudios.nl/artists/21860d09-044d-45f9-9983-3a9b18f67397/1790640980851.png",
          },
          host: sessionHost,
          eventDay: "Tuesday",
          eventTime: "19:00",
          eventDate: "Tue 29 Sep",
          today: true,
          interview: true,
          interviewMinutes: 20,
          avatars: defaultPullUpAvatars,
          chatLines: sessionChat,
          seed: 1,
          bedVariant: "b" as const,
        }}
      />
      {/* No interview this week, and a guest with no photo: the plain-set
          copy and the initials fallback. */}
      <Composition
        id="WaterhouseSessionSetOnly"
        component={WaterhouseSession}
        schema={WaterhouseSessionSchema}
        durationInFrames={SESSION_DURATION}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          guest: { name: "The Silintist", image: null },
          host: sessionHost,
          eventDay: "Tuesday",
          eventTime: "19:00",
          eventDate: "Tue 6 Oct",
          interview: false,
          interviewMinutes: 20,
          avatars: defaultPullUpAvatars,
          chatLines: plainSetChat,
          seed: 3,
          bedVariant: "b" as const,
        }}
      />
      {/* The Tuesday stream stinger: landscape, VP9 webm with alpha. One
          registration per idea (door, corner, lamp, paper, neon, vhs, fader, flap) so each is a click
          away; `preview` shows a checkerboard where the live scene will be. */}
      <Composition
        id="SessionBumper"
        component={SessionBumper}
        schema={SessionBumperSchema}
        calculateMetadata={calculateBumperMetadata}
        durationInFrames={bumperDuration(defaultBumperProps)}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={defaultBumperProps}
      />
      {(["corner", "lamp", "paper", "neon", "vhs", "fader", "flap"] as const).map((idea) => (
        <Composition
          key={idea}
          id={`SessionBumper${idea[0].toUpperCase()}${idea.slice(1)}`}
          component={SessionBumper}
          schema={SessionBumperSchema}
          calculateMetadata={calculateBumperMetadata}
          durationInFrames={bumperDuration({ idea })}
          fps={30}
          width={1920}
          height={1080}
          defaultProps={{ ...defaultBumperProps, idea }}
        />
      ))}
      {/* Track Matte fallback: fill on the left, alpha as luma on the right,
          one opaque mp4. Only the duration comes from the bumper metadata. */}
      <Composition
        id="SessionBumperMatte"
        component={BumperMatte}
        schema={SessionBumperSchema}
        calculateMetadata={({ props }) => ({
          durationInFrames: bumperDuration(props),
          defaultOutName: bumperOutName(props).replace(".webm", "-matte.mp4"),
        })}
        durationInFrames={bumperDuration(defaultBumperProps)}
        fps={30}
        width={MATTE_WIDTH}
        height={MATTE_HEIGHT}
        defaultProps={defaultBumperProps}
      />
      {/* Contact sheet of either idea over a checkerboard, one still. */}
      <Composition
        id="SessionBumperStrip"
        component={BumperStrip}
        schema={BumperStripSchema}
        calculateMetadata={calculateStripMetadata}
        durationInFrames={1}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          idea: "door" as const,
          guestName: null,
          step: 10,
          columns: 4,
        }}
      />
      <Composition
        id="ArtistRecap"
        component={ArtistRecap}
        schema={ArtistRecapSchema}
        durationInFrames={ARTIST_RECAP_DURATION}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={recapProps}
      />
      {/* No photo, one session, nobody countable: exercises every fallback. */}
      <Composition
        id="ArtistRecapFallback"
        component={ArtistRecap}
        schema={ArtistRecapSchema}
        durationInFrames={ARTIST_RECAP_DURATION}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={recapFallbackProps}
      />
    </>
  );
};
