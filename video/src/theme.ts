import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

const inter = loadInter("normal", {
  weights: ["400", "500", "600", "700"],
  subsets: ["latin"],
});
const mono = loadMono("normal", { weights: ["400", "500"], subsets: ["latin"] });

export const fonts = {
  sans: inter.fontFamily,
  mono: mono.fontFamily,
};

// iOS dark-mode system colors, matching the app's severity tokens (spec §11).
export const colors = {
  bg: "#0B0D12",
  surface: "#151922",
  surfaceRaised: "#1C2130",
  border: "rgba(255,255,255,0.08)",
  text: "#F2F4F8",
  muted: "#8A93A6",
  faint: "#4A5162",
  red: "#FF453A",
  orange: "#FF9F0A",
  blue: "#0A84FF",
  green: "#30D158",
  highlight: "rgba(255,159,10,0.32)",
};

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
