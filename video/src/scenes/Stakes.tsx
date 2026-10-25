import { Rise, Scene, useSpring } from "../components";
import { colors, fonts } from "../theme";

// Figures and sources as cited in the FinePrint README.
const STATS = [
  {
    value: 64,
    label: "of Blacksburg households rent their home",
    source: "U.S. Census Bureau, ACS 2020–2024, table B25003",
    color: colors.blue,
  },
  {
    value: 24,
    label: "of U.S. renters who recently moved got none of their deposit back",
    source: "Zillow Consumer Housing Trends Report 2024",
    color: colors.orange,
  },
];

const Stat: React.FC<{ stat: (typeof STATS)[number]; delay: number }> = ({
  stat,
  delay,
}) => {
  const p = useSpring(delay, 30);
  const count = Math.round(Math.min(p, 1) * stat.value);
  return (
    <div style={{ flex: 1 }}>
      <Rise delay={delay}>
        <div
          style={{
            fontSize: 200,
            fontWeight: 700,
            letterSpacing: -6,
            lineHeight: 1,
            color: stat.color,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {count}%
        </div>
        <div
          style={{
            marginTop: 28,
            fontSize: 44,
            lineHeight: 1.25,
            fontWeight: 500,
            maxWidth: 640,
          }}
        >
          {stat.label}
        </div>
      </Rise>
      <Rise delay={delay + 20}>
        <div
          style={{
            marginTop: 28,
            fontFamily: fonts.mono,
            fontSize: 18,
            color: colors.faint,
          }}
        >
          {stat.source}
        </div>
      </Rise>
    </div>
  );
};

export const Stakes: React.FC = () => (
  <Scene>
    <div
      style={{
        position: "absolute",
        inset: "0 200px",
        display: "flex",
        alignItems: "flex-start",
        paddingTop: 330,
        gap: 120,
      }}
    >
      <Stat stat={STATS[0]} delay={8} />
      <Stat stat={STATS[1]} delay={40} />
    </div>
  </Scene>
);
