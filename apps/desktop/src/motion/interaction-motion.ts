export const INTERACTION_MOTION = Object.freeze({
  hoverMilliseconds: 100,
  pressMilliseconds: 75,
  selectionMilliseconds: 140,
  floatingMilliseconds: 140,
  tooltipMilliseconds: 120,
  paletteOpenMilliseconds: 190,
  paletteCloseMilliseconds: 160,
  contentMilliseconds: 150,
  notificationOpenMilliseconds: 180,
  notificationCloseMilliseconds: 150,
});

export const PROFESSIONAL_EASE = [0.22, 1, 0.36, 1] as const;

export function motionSeconds(milliseconds: number, reducedMotion: boolean): number {
  return reducedMotion ? 0.01 : milliseconds / 1_000;
}
