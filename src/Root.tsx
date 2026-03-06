import "./index.css";
import { Composition } from "remotion";
import { MyComposition } from "./Composition";
import {
  WeeklyLineup,
  WeeklyLineupSchema,
  getCompositionDuration,
  type WeeklyLineupProps,
} from "./WeeklyLineup";

const defaultArtists: WeeklyLineupProps["artists"] = [
  {
    artistName: "Denzo",
    artistImage: "https://i.imgur.com/nt2wsuD.png",
    genre: "DJ",
    eventDate: "Thu 5 Mar",
    eventTime: "19:00",
    purpose: "Radio: Denzo",
  },
  {
    artistName: "The Silintist",
    artistImage: null,
    genre: null,
    eventDate: "Fri 7 Mar",
    eventTime: "20:00",
    purpose: "Radio: Sudden Rave",
  },
];

export const RemotionRoot: React.FC = () => {
  return (
    <>
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
        durationInFrames={getCompositionDuration(defaultArtists.length)}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          weekLabel: "THIS WEEK",
          dateRange: "3 - 9 March",
          artists: defaultArtists,
        }}
      />
    </>
  );
};
