export interface Point {
  x: number;
  y: number;
}

export interface Line {
  id: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  selected?: boolean;
}

export interface Dimension {
  id: number;
  type: 'dist' | 'angle';
  p1: Point; // Start point (or first line point for angle)
  p2: Point; // End point (or second line point for angle)
  offsetPos: Point; // Text/Arc position
  // For angle optimization
  center?: Point;
  angleStart?: number;
  angleEnd?: number;
  selected?: boolean;
}

export interface SnapPoint extends Point {
  type: 'endpoint' | 'grid';
}

export type ToolMode = 
  | 'select' 
  | 'move'
  | 'pan' 
  | 'draw_poly' 
  | 'draw_fixed_h' 
  | 'draw_fixed_v' 
  | 'draw_fixed_a' 
  | 'trim' 
  | 'extend'
  | 'dim_dist'
  | 'dim_angle';