import { withDefaultLaneTurns } from './intersection';
import type { ArmConfig, IntersectionConfig } from './types';

function arm(inLanes: number, outLanes: number, [L, S, R]: [number, number, number]): ArmConfig {
  return { enabled: true, inLanes, outLanes, laneTurns: [], demand: { L, S, R } };
}

const OFF: ArmConfig = { enabled: false, inLanes: 1, outLanes: 1, laneTurns: [], demand: { L: 0, S: 0, R: 0 } };

export const PRESETS: readonly IntersectionConfig[] = [
  withDefaultLaneTurns({
    name: 'Balanced 4-way',
    arms: {
      N: arm(2, 2, [120, 400, 100]),
      E: arm(2, 2, [120, 400, 100]),
      S: arm(2, 2, [120, 400, 100]),
      W: arm(2, 2, [120, 400, 100]),
    },
  }),
  withDefaultLaneTurns({
    name: 'Main road × side road',
    arms: {
      N: arm(3, 2, [150, 900, 120]),
      E: arm(1, 1, [60, 150, 60]),
      S: arm(3, 2, [150, 900, 120]),
      W: arm(1, 1, [60, 150, 60]),
    },
  }),
  withDefaultLaneTurns({
    name: 'T-junction',
    arms: {
      N: { ...OFF },
      E: arm(2, 2, [200, 500, 0]),
      S: arm(2, 1, [250, 0, 150]),
      W: arm(2, 2, [0, 500, 150]),
    },
  }),
];
