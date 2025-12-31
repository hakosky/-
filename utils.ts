import { Line, Point } from './types';

export const dist = (p1: Point, p2: Point): number => Math.hypot(p2.x - p1.x, p2.y - p1.y);

// Point to Line Segment distance
export const distToSegment = (p: Point, v: Point, w: Point): number => {
  const l2 = Math.pow(dist(v, w), 2);
  if (l2 === 0) return dist(p, v);
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  const projection = { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) };
  return dist(p, projection);
};

// Segment intersection (t, u must be within 0-1)
export const getIntersection = (l1: Line, l2: Line): { x: number; y: number; t: number; u: number } | null => {
  const x1 = l1.x1, y1 = l1.y1, x2 = l1.x2, y2 = l1.y2;
  const x3 = l2.x1, y3 = l2.y1, x4 = l2.x2, y4 = l2.y2;
  
  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(den) < 0.0001) return null;
  
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / den;
  
  return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1), t, u };
};

// Infinite line intersection
export const getLineIntersection = (l1: Line, l2: Line): Point | null => {
  const x1 = l1.x1, y1 = l1.y1, x2 = l1.x2, y2 = l1.y2;
  const x3 = l2.x1, y3 = l2.y1, x4 = l2.x2, y4 = l2.y2;
  
  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(den) < 0.0001) return null; // Parallel
  
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
  
  return { 
    x: x1 + t * (x2 - x1), 
    y: y1 + t * (y2 - y1) 
  };
};

export const getAngleFromThreePoints = (center: Point, p1: Point, p2: Point): number => {
  const a1 = Math.atan2(p1.y - center.y, p1.x - center.x);
  const a2 = Math.atan2(p2.y - center.y, p2.x - center.x);
  let diff = (a2 - a1) * 180 / Math.PI;
  if (diff < 0) diff += 360;
  return diff;
};