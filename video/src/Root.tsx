import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { AbsoluteFill, Audio, Composition, interpolate, Sequence, staticFile } from "remotion";
import { Captions } from "./Captions";
import { Sheet } from "./Sheet";
import { Close } from "./scenes/Close";
import { Hook } from "./scenes/Hook";
import {
  ASK_FRAMES,
  AskFootage,
  DELETE_FRAMES,
  DeleteFootage,
  LEASE_FRAMES,
  LeaseFootage,
  MOVE_IN_FRAMES,
  MoveInFootage,
} from "./scenes/Footage";
import { Safety } from "./scenes/Safety";
import { Stakes } from "./scenes/Stakes";
import { Title } from "./scenes/Title";
import { FPS, HEIGHT, WIDTH } from "./theme";
import { linesFor, sceneLength } from "./timeline";

const s = (seconds: number) => Math.round(seconds * FPS);
const TRANSITION = 15;
const MUSIC_VOLUME = 0.32;
const MUSIC_UNDER_VOICE = 0.38; // music level while someone is speaking, relative to MUSIC_VOLUME
const VOICE_VOLUME = 1;

type SceneDef = {
  id: string;
  frames: number;
  el: React.ReactNode;
  captionArea?: React.CSSProperties;
  captionAlign?: "center" | "left";
};

// Beside the phone, under the headline.
const BESIDE_PHONE: React.CSSProperties = { left: 860, right: 140, bottom: "auto", top: 700 };

const BASE: SceneDef[] = [
  { id: "Hook", frames: s(10.5), el: <Hook /> },
  { id: "Stakes", frames: s(7), el: <Stakes /> },
  { id: "Title", frames: 80, el: <Title /> },
  { id: "MoveIn", frames: MOVE_IN_FRAMES, el: <MoveInFootage />, captionArea: BESIDE_PHONE, captionAlign: "left" },
  {
    id: "Lease",
    frames: LEASE_FRAMES,
    el: <LeaseFootage />,
    // Under the stage list.
    captionArea: { ...BESIDE_PHONE, top: 905 },
    captionAlign: "left",
  },
  { id: "Ask", frames: ASK_FRAMES, el: <AskFootage />, captionArea: BESIDE_PHONE, captionAlign: "left" },
  { id: "Safety", frames: s(5), el: <Safety /> },
  { id: "Delete", frames: DELETE_FRAMES, el: <DeleteFootage />, captionArea: BESIDE_PHONE, captionAlign: "left" },
  { id: "Close", frames: s(16), el: <Close /> },
];

const SCENES = BASE.map((sc) => ({ ...sc, frames: sceneLength(sc.id, sc.frames) }));

const STARTS = SCENES.map((_, i) =>
  SCENES.slice(0, i).reduce((n, sc) => n + sc.frames - TRANSITION, 0),
);
const TOTAL = STARTS[STARTS.length - 1] + SCENES[SCENES.length - 1].frames;

// Where the voice is, in video frames, for ducking the music.
const SPEECH = SCENES.flatMap((sc, i) => linesFor(sc.id).map((l) => [STARTS[i] + l.from, STARTS[i] + l.to]));

const speaking = (f: number) =>
  Math.max(
    0,
    ...SPEECH.map(([a, b]) =>
      interpolate(f, [a - 10, a, b, b + 14], [0, 1, 1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      }),
    ),
  );

const WithCaptions: React.FC<{ scene: SceneDef }> = ({ scene }) => {
  const lines = linesFor(scene.id);
  return (
    <AbsoluteFill>
      {scene.el}
      <Captions cues={lines} area={scene.captionArea} align={scene.captionAlign} />
      {lines.map(
        (l) =>
          l.file && (
            <Sequence key={l.file} from={l.from} layout="none">
              <Audio src={staticFile(`vo/${l.file}`)} volume={VOICE_VOLUME} />
            </Sequence>
          ),
      )}
    </AbsoluteFill>
  );
};

const Demo: React.FC = () => (
  <AbsoluteFill>
    <TransitionSeries>
      {SCENES.flatMap((sc, i) => [
        ...(i > 0
          ? [
              <TransitionSeries.Transition
                key={`${sc.id}-t`}
                presentation={fade()}
                timing={linearTiming({ durationInFrames: TRANSITION })}
              />,
            ]
          : []),
        <TransitionSeries.Sequence key={sc.id} durationInFrames={sc.frames}>
          <WithCaptions scene={sc} />
        </TransitionSeries.Sequence>,
      ])}
    </TransitionSeries>
    <Audio
      src={staticFile("music-bed.wav")}
      volume={(f) =>
        MUSIC_VOLUME *
        (1 - (1 - MUSIC_UNDER_VOICE) * speaking(f)) *
        interpolate(f, [0, s(2), TOTAL - s(4), TOTAL], [0, 1, 1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      }
    />
  </AbsoluteFill>
);

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="Sheet" component={Sheet as any} durationInFrames={1} fps={FPS} width={1960} height={1010} defaultProps={{ clip: "c01", times: [0] }} />
    <Composition id="FinePrintDemo" component={Demo} durationInFrames={TOTAL} fps={FPS} width={WIDTH} height={HEIGHT} />
    {SCENES.map((sc) => (
      <Composition
        key={sc.id}
        id={sc.id}
        component={() => <WithCaptions scene={sc} />}
        durationInFrames={sc.frames}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
    ))}
  </>
);
