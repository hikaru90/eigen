import { describe, expect, it } from "vitest";
import { commandsToStrokes, sampleAlongKnots, simplifyPenStroke } from "./pen-stroke-from-text";

describe("pen stroke simplification", () => {
  it("keeps only endpoints on a straight stroke", () => {
    const strokes = commandsToStrokes(
      [
        { type: "M", x: 0, y: 0 },
        { type: "L", x: 100, y: 0 },
      ],
      4,
    );
    expect(strokes).toHaveLength(1);
    const knots = simplifyPenStroke(strokes[0], 48);
    expect(knots.length).toBeLessThanOrEqual(3);
    expect(knots.length).toBeGreaterThanOrEqual(2);
  });

  it("adds dots between corner knots on a long segment", () => {
    const knots = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const sampled = sampleAlongKnots(knots, 20);
    expect(sampled.length).toBeGreaterThan(2);
    expect(sampled[0]).toEqual(knots[0]);
    expect(sampled[sampled.length - 1]).toEqual(knots[1]);
  });

  it("keeps corners on a V shape", () => {
    const strokes = commandsToStrokes(
      [
        { type: "M", x: 0, y: 80 },
        { type: "L", x: 50, y: 0 },
        { type: "L", x: 100, y: 80 },
      ],
      4,
    );
    const knots = simplifyPenStroke(strokes[0], 72);
    expect(knots.length).toBeLessThanOrEqual(4);
    expect(knots.length).toBeGreaterThanOrEqual(3);
  });
});
