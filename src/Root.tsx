import "./index.css";
import { Composition, type CalculateMetadataFunction } from "remotion";
import { MyComposition } from "./Composition";
import {
  WeeklyLineup,
  WeeklyLineupSchema,
  getCompositionDuration,
  type WeeklyLineupProps,
} from "./WeeklyLineup";

const calculateWeeklyMetadata: CalculateMetadataFunction<WeeklyLineupProps> = ({
  props,
}) => {
  return {
    durationInFrames: getCompositionDuration(props.artists.length),
  };
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
        calculateMetadata={calculateWeeklyMetadata}
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
