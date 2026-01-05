import { Line, Point, Circle } from './types';

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

// Line Segment and Circle Intersection
export const getLineCircleIntersection = (line: Line, circle: Circle): Point[] => {
  const p1 = { x: line.x1, y: line.y1 };
  const p2 = { x: line.x2, y: line.y2 };
  const c = { x: circle.cx, y: circle.cy };
  const r = circle.r;

  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;

  const t1 = p1.x - c.x;
  const t2 = p1.y - c.y;

  // Quadratic equation coefficients: At^2 + Bt + C = 0
  const A = dx * dx + dy * dy;
  const B = 2 * (dx * t1 + dy * t2);
  const C = t1 * t1 + t2 * t2 - r * r;

  const det = B * B - 4 * A * C;
  
  if (A <= 0.0000001 || det < 0) {
    // No intersection or invalid line
    return [];
  } else if (det === 0) {
    // One intersection (tangent)
    const t = -B / (2 * A);
    if (t >= 0 && t <= 1) {
       return [{ x: p1.x + t * dx, y: p1.y + t * dy }];
    }
  } else {
    // Two intersections
    const t1_val = (-B + Math.sqrt(det)) / (2 * A);
    const t2_val = (-B - Math.sqrt(det)) / (2 * A);
    const result: Point[] = [];
    if (t1_val >= 0 && t1_val <= 1) {
       result.push({ x: p1.x + t1_val * dx, y: p1.y + t1_val * dy });
    }
    if (t2_val >= 0 && t2_val <= 1) {
       result.push({ x: p1.x + t2_val * dx, y: p1.y + t2_val * dy });
    }
    return result;
  }
  return [];
};

// Circle and Circle Intersection
export const getCircleCircleIntersection = (c1: Circle, c2: Circle): Point[] => {
  const d2 = (c1.cx - c2.cx) ** 2 + (c1.cy - c2.cy) ** 2;
  const d = Math.sqrt(d2);

  if (d > c1.r + c2.r || d < Math.abs(c1.r - c2.r) || d === 0) {
    return []; // No intersection (separate, contained, or coincident)
  }

  const a = (c1.r ** 2 - c2.r ** 2 + d2) / (2 * d);
  const h = Math.sqrt(Math.max(0, c1.r ** 2 - a ** 2));
  
  const x2 = c1.cx + a * (c2.cx - c1.cx) / d;
  const y2 = c1.cy + a * (c2.cy - c1.cy) / d;

  return [
    {
      x: x2 + h * (c2.cy - c1.cy) / d,
      y: y2 - h * (c2.cx - c1.cx) / d
    },
    {
      x: x2 - h * (c2.cy - c1.cy) / d,
      y: y2 + h * (c2.cx - c1.cx) / d
    }
  ];
};