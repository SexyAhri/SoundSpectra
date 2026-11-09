import { createTimeline } from "animejs";

/** A seekable score: playback time is supplied by the lyric transport. */
export function foldedChoreography(
  start: number,
  end: number,
  nextStart = Infinity,
  previousStart = -Infinity,
  previousEnd = -Infinity,
) {
  const pose = { enter: 0, exit: 0 };
  const duration = Math.max(1, end - start);
  const lead = Math.max(
    1,
    Math.min(1050, duration * 0.55, (start - previousStart) * 0.6),
  );
  // Keep a visible handoff for contiguous lyric files, whose end usually equals next start.
  // Both lines finish exchanging position before the next line's reading period.
  const gap = Math.max(0, nextStart - end);
  const exitDuration = Math.min(580, duration * 0.24);
  const exitStart = end - Math.max(0, exitDuration - gap * 0.75);
  const settleStart = Math.max(
    start - lead,
    Math.min(previousEnd, start - Math.min(380, lead * 0.65)),
  );
  const timeline = createTimeline({ autoplay: false })
    .add(pose, { enter: [0, 1], duration: lead, ease: "inOutCubic" }, 0)
    .add(
      pose,
      { exit: [0, 1], duration: Math.max(1, exitDuration), ease: "inOutCubic" },
      exitStart - start + lead,
    );
  return {
    lead,
    tail: Math.min(gap * 0.75, exitDuration),
    settleStart,
    exitStart,
    evaluate(time: number) {
      timeline.seek(
        Math.max(0, Math.min(timeline.duration, time - start + lead)),
        true,
      );
      return pose;
    },
    dispose() {
      timeline.cancel();
    },
  };
}
