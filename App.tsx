import React, { useState, useRef, useCallback, useEffect } from 'react';
import { 
  MousePointer2, PenTool, Minus, MoveVertical, 
  Scissors, ArrowUpRight, Ruler, Eraser, Hand,
  Trash2, RotateCw, Undo2, Redo2, Maximize, Move
} from 'lucide-react';
import { ToolButton } from './components/ToolButton';
import { dist, getIntersection, getLineIntersection, distToSegment } from './utils';
import { GRID_SIZE, SNAP_RADIUS } from './constants';
import { Line, Point, Dimension, SnapPoint, ToolMode } from './types';

const getToolName = (mode: ToolMode): string => {
  const names: Record<ToolMode, string> = {
    'select': '選取',
    'move': '移動',
    'pan': '平移',
    'draw_poly': '畫線',
    'draw_fixed_h': '水平線',
    'draw_fixed_v': '垂直線',
    'draw_fixed_a': '角度線',
    'trim': '修剪',
    'extend': '延伸',
    'dim_dist': '長度標註',
    'dim_angle': '角度標註'
  };
  return names[mode] || mode;
};

interface HistoryState {
  lines: Line[];
  dims: Dimension[];
}

const App: React.FC = () => {
  const [lines, setLines] = useState<Line[]>([]);
  const [dims, setDims] = useState<Dimension[]>([]);
  const [mode, setMode] = useState<ToolMode>('select');
  const [message, setMessage] = useState("歡迎使用 CAD 工具");
  
  // History State
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryState[]>([]);

  // Viewport State
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [lastMousePos, setLastMousePos] = useState<Point>({ x: 0, y: 0 });

  // Interaction State
  const [mousePos, setMousePos] = useState<Point>({ x: 0, y: 0 });
  const [snapPos, setSnapPos] = useState<SnapPoint | null>(null);
  const [interactionPoints, setInteractionPoints] = useState<Point[]>([]);
  const [selectedLinesForTool, setSelectedLinesForTool] = useState<Line[]>([]); 
  const [draggingLine, setDraggingLine] = useState<Line | null>(null);
  const [dragStartPos, setDragStartPos] = useState<Point | null>(null);
  const [dragAnchor, setDragAnchor] = useState<'start' | 'end' | null>(null);
  const [hasMoved, setHasMoved] = useState(false);

  // Parameters
  const [paramLength, setParamLength] = useState<string>("100");
  const [paramAngle, setParamAngle] = useState<string>("45");
  
  const svgRef = useRef<SVGSVGElement>(null);

  // --- History Management ---
  const saveToHistory = useCallback(() => {
    setHistory(prev => [...prev, { lines, dims }]);
    setRedoStack([]); 
  }, [lines, dims]);

  const undo = useCallback(() => {
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    setRedoStack(prev => [...prev, { lines, dims }]);
    setLines(previous.lines);
    setDims(previous.dims);
    setHistory(prev => prev.slice(0, -1));
    setMessage("已返回上一步");
  }, [history, lines, dims]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setHistory(prev => [...prev, { lines, dims }]);
    setLines(next.lines);
    setDims(next.dims);
    setRedoStack(prev => prev.slice(0, -1));
    setMessage("已重做");
  }, [redoStack, lines, dims]);

  // Global Key Handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
        redo();
        return;
      }

      if (e.key === 'Escape') {
        if (draggingLine) {
          setDraggingLine(null);
          setDragAnchor(null);
        }
        if (interactionPoints.length > 0 || selectedLinesForTool.length > 0) {
          setInteractionPoints([]);
          setSelectedLinesForTool([]);
          setMessage("操作已取消");
        } else if (mode !== 'select') {
          setMode('select');
          setMessage("切換至選取工具");
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (mode === 'select' || mode === 'move') {
           const hasSelection = lines.some(l => l.selected) || dims.some(d => d.selected);
           if (hasSelection) {
             saveToHistory();
             setLines(prev => prev.filter(l => !l.selected));
             setDims(prev => prev.filter(d => !d.selected));
             setMessage("已刪除物件");
           }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, interactionPoints, selectedLinesForTool, draggingLine, history, redoStack, undo, redo, lines, dims, saveToHistory]);

  // Coordinate System
  const screenToWorld = useCallback((clientX: number, clientY: number): Point => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const rect = svgRef.current.getBoundingClientRect();
    return {
      x: (clientX - rect.left - offset.x) / scale,
      y: (clientY - rect.top - offset.y) / scale
    };
  }, [offset, scale]);

  const getSnappedPos = useCallback((worldPos: Point, excludeLineId?: number): SnapPoint => {
    let closest: SnapPoint | null = null;
    let minD = SNAP_RADIUS / scale;

    lines.forEach(line => {
      if (excludeLineId && line.id === excludeLineId) return; 

      const points: Point[] = [{x: line.x1, y: line.y1}, {x: line.x2, y: line.y2}];
      points.forEach(p => {
        const d = dist(worldPos, p);
        if (d < minD) { 
          minD = d; 
          closest = { ...p, type: 'endpoint' }; 
        }
      });
    });

    if (closest) return closest;
    
    return {
      x: Math.round(worldPos.x / GRID_SIZE) * GRID_SIZE,
      y: Math.round(worldPos.y / GRID_SIZE) * GRID_SIZE,
      type: 'grid'
    };
  }, [lines, scale]);

  const handleWheel = (e: React.WheelEvent) => {
    if (!svgRef.current) return;
    e.preventDefault();
    const zoomDelta = -e.deltaY * 0.001;
    const newScale = Math.min(Math.max(scale + zoomDelta, 0.1), 10);
    
    const rect = svgRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    
    const worldX = (mx - offset.x) / scale;
    const worldY = (my - offset.y) / scale;

    setScale(newScale);
    setOffset({
      x: mx - worldX * newScale,
      y: my - worldY * newScale
    });
  };

  const getLineAtPos = (pos: Point) => {
    return lines.find(line => {
      return distToSegment(pos, {x: line.x1, y: line.y1}, {x: line.x2, y: line.y2}) < 10 / scale;
    });
  };

  const getDimensionAtPos = (pos: Point) => {
    return dims.find(d => {
      if (d.type === 'dist') {
        const angle = Math.atan2(d.p2.y - d.p1.y, d.p2.x - d.p1.x);
        const l = dist(d.p1, d.p2);
        const ux = (d.p2.x - d.p1.x) / l;
        const uy = (d.p2.y - d.p1.y) / l;
        const vx = -uy;
        const vy = ux;
        const h = (d.offsetPos.x - d.p1.x) * vx + (d.offsetPos.y - d.p1.y) * vy;
        
        const b1x = d.p1.x + vx * h;
        const b1y = d.p1.y + vy * h;
        const b2x = d.p2.x + vx * h;
        const b2y = d.p2.y + vy * h;

        if (distToSegment(pos, {x: b1x, y: b1y}, {x: b2x, y: b2y}) < 10/scale) return true;
        if (dist(pos, {x: (b1x+b2x)/2, y: (b1y+b2y)/2}) < 20/scale) return true;
      } else if (d.type === 'angle') {
        if (dist(pos, d.offsetPos) < 20/scale) return true;
      }
      return false;
    });
  };

  const performExtend = (targetLine: Line, clickPos: Point) => {
    const d1 = dist(clickPos, {x: targetLine.x1, y: targetLine.y1});
    const d2 = dist(clickPos, {x: targetLine.x2, y: targetLine.y2});
    
    const extendEnd = d2 < d1; 
    const startPt = extendEnd ? {x: targetLine.x1, y: targetLine.y1} : {x: targetLine.x2, y: targetLine.y2};
    const endPt = extendEnd ? {x: targetLine.x2, y: targetLine.y2} : {x: targetLine.x1, y: targetLine.y1};
    
    const dx = endPt.x - startPt.x;
    const dy = endPt.y - startPt.y;
    const len = Math.sqrt(dx*dx + dy*dy);
    if(len === 0) return;
    const ux = dx/len;
    const uy = dy/len;

    let closestInt: Point | null = null;
    let minDist = Infinity;

    lines.forEach(other => {
      if(other.id === targetLine.id) return;
      const int = getLineIntersection(targetLine, other);
      if(!int) return; 

      const vecX = int.x - endPt.x;
      const vecY = int.y - endPt.y;
      const dot = vecX * ux + vecY * uy;
      
      if (dot > 0.001) { 
         const distToOtherSeg = distToSegment(int, {x: other.x1, y: other.y1}, {x: other.x2, y: other.y2});
         if(distToOtherSeg < 0.01) {
            const d = dist(endPt, int);
            if(d < minDist) {
              minDist = d;
              closestInt = int;
            }
         }
      }
    });

    if (closestInt) {
      saveToHistory();
      setLines(prev => prev.map(l => {
        if (l.id !== targetLine.id) return l;
        if (extendEnd) return { ...l, x2: closestInt!.x, y2: closestInt!.y };
        else return { ...l, x1: closestInt!.x, y1: closestInt!.y };
      }));
      setMessage("線段已延伸");
    } else {
      setMessage("前方無可延伸邊界");
    }
  };

  // Interaction Logic (Pointer Events)
  const handlePointerDown = (e: React.PointerEvent) => {
    // Prevent default touch actions (scrolling) managed by CSS touch-none, 
    // but explicit prevention can help in some browsers
    if (e.pointerType === 'touch') {
      // e.preventDefault(); // React synthetic event might not need this if touch-action is set
    }
    
    if (e.button === 2) return; 

    // Pointer event has clientX/Y just like MouseEvent
    const worldPos = screenToWorld(e.clientX, e.clientY);
    const currentPos = snapPos || worldPos;

    if (e.button === 1 || mode === 'pan') {
      setIsPanning(true);
      setLastMousePos({ x: e.clientX, y: e.clientY });
      // Capture pointer to track outside window
      (e.target as Element).setPointerCapture(e.pointerId);
      return;
    }

    if (mode === 'select' || mode === 'move') {
      const clickedLine = getLineAtPos(worldPos);
      const clickedDim = (mode === 'select' && !clickedLine) ? getDimensionAtPos(worldPos) : null;
      
      if (clickedLine) {
        setDraggingLine(clickedLine);
        setDragStartPos(currentPos); 
        setHasMoved(false);
        (e.target as Element).setPointerCapture(e.pointerId);

        // Selection
        if (mode === 'select') {
           setLines(lines.map(l => ({ ...l, selected: l.id === clickedLine.id })));
           setDims(dims.map(d => ({ ...d, selected: false })));
        } else {
           if (!clickedLine.selected) {
             setLines(prev => prev.map(l => ({ ...l, selected: l.id === clickedLine.id })));
           }
        }
        
        // Anchor Detection
        if (mode === 'select') {
            const snapThreshold = 10 / scale;
            const d1 = dist(worldPos, {x: clickedLine.x1, y: clickedLine.y1});
            const d2 = dist(worldPos, {x: clickedLine.x2, y: clickedLine.y2});
            if (d1 < snapThreshold) {
              setDragAnchor('start');
              setMessage(`拖曳端點 (起點)`);
            } else if (d2 < snapThreshold) {
              setDragAnchor('end');
              setMessage(`拖曳端點 (終點)`);
            } else {
              setDragAnchor(null);
              setMessage(`移動線段`);
            }
        } else {
           setDragAnchor(null);
           setMessage(`精確移動: 拖曳至目標點`);
        }

      } else if (clickedDim && mode === 'select') {
        setLines(lines.map(l => ({ ...l, selected: false })));
        setDims(dims.map(d => ({ ...d, selected: d.id === clickedDim.id })));
        setMessage(`已選取標註`);
      } else {
        if (mode === 'select') {
            setLines(lines.map(l => ({ ...l, selected: false })));
            setDims(dims.map(d => ({ ...d, selected: false })));
            setMessage("就緒");
        }
        if (mode === 'move' && lines.some(l => l.selected)) {
            setDraggingLine({ id: -1 } as Line); 
            setDragStartPos(currentPos);
            setHasMoved(false);
            setDragAnchor(null);
            (e.target as Element).setPointerCapture(e.pointerId);
        }
      }
    } else if (mode === 'draw_poly') {
      if (interactionPoints.length === 0) {
        setInteractionPoints([currentPos]);
        setMessage("請選擇終點");
      } else {
        saveToHistory();
        const start = interactionPoints[0];
        setLines([...lines, { 
          id: Date.now(), 
          x1: start.x, 
          y1: start.y, 
          x2: currentPos.x, 
          y2: currentPos.y, 
          selected: false 
        }]);
        setInteractionPoints([currentPos]);
        setMessage("線段已建立");
      }
    } else if (mode === 'draw_fixed_h' || mode === 'draw_fixed_v') {
      // 2-step process: Click start, Move to choose dir, Click to confirm
      if (interactionPoints.length === 0) {
        setInteractionPoints([currentPos]);
        setMessage("請移動滑鼠選擇方向，再次點擊確認");
      } else {
        saveToHistory();
        const start = interactionPoints[0];
        const len = parseFloat(paramLength) || 0;
        let x2 = start.x;
        let y2 = start.y;
        
        // Calculate final endpoint based on mouse direction relative to start
        if (mode === 'draw_fixed_h') {
           // Use worldPos for direction check to be intuitive
           const dir = worldPos.x >= start.x ? 1 : -1;
           x2 = start.x + len * dir;
        } else {
           const dir = worldPos.y >= start.y ? 1 : -1;
           y2 = start.y + len * dir;
        }

        setLines([...lines, { 
          id: Date.now(), 
          x1: start.x, 
          y1: start.y, 
          x2, 
          y2, 
          selected: false 
        }]);
        setInteractionPoints([]);
        setMessage("固定線段已建立");
      }
    } else if (mode === 'draw_fixed_a') {
      saveToHistory();
      const len = parseFloat(paramLength);
      const r = (-parseFloat(paramAngle) * Math.PI) / 180;
      const x2 = currentPos.x + len * Math.cos(r);
      const y2 = currentPos.y + len * Math.sin(r);
      setLines([...lines, { 
        id: Date.now(), 
        x1: currentPos.x, 
        y1: currentPos.y, 
        x2, 
        y2, 
        selected: false 
      }]);
      setMessage("角度線已建立");
    } else if (mode === 'dim_dist') {
      if (interactionPoints.length < 2) {
        setInteractionPoints([...interactionPoints, currentPos]);
        setMessage(interactionPoints.length === 0 ? "請選擇第一點" : "請選擇標註偏移位置");
      } else {
        saveToHistory();
        const p1 = interactionPoints[0];
        const p2 = interactionPoints[1];
        setDims([...dims, { 
          id: Date.now(), 
          type: 'dist', 
          p1, 
          p2, 
          offsetPos: currentPos 
        }]);
        setInteractionPoints([]);
        setMessage("標註已建立");
      }
    } else if (mode === 'dim_angle') {
       if (selectedLinesForTool.length === 0) {
        const l1 = getLineAtPos(worldPos);
        if (l1) {
          setSelectedLinesForTool([l1]);
          setMessage("請選擇第二條線");
        }
      } else if (selectedLinesForTool.length === 1) {
        const l2 = getLineAtPos(worldPos);
        if (l2 && l2.id !== selectedLinesForTool[0].id) {
          setSelectedLinesForTool([...selectedLinesForTool, l2]);
          setMessage("請選擇標註位置");
        }
      } else {
        const l1 = selectedLinesForTool[0];
        const l2 = selectedLinesForTool[1];
        const intersection = getLineIntersection(l1, l2);
        if (intersection) {
           saveToHistory();
           
           const p1 = dist({x: l1.x1, y: l1.y1}, intersection) > dist({x: l1.x2, y: l1.y2}, intersection) 
              ? {x: l1.x1, y: l1.y1} : {x: l1.x2, y: l1.y2};
           const p2 = dist({x: l2.x1, y: l2.y1}, intersection) > dist({x: l2.x2, y: l2.y2}, intersection) 
              ? {x: l2.x1, y: l2.y1} : {x: l2.x2, y: l2.y2};

           setDims([...dims, {
             id: Date.now(),
             type: 'angle',
             p1, // corrected p1
             p2, // corrected p2
             offsetPos: currentPos,
             center: intersection
           }]);
           setMessage("角度標註已建立");
        } else {
           setMessage("錯誤：線段平行");
        }
        setSelectedLinesForTool([]);
      }
    } else if (mode === 'extend') {
      const clickedLine = getLineAtPos(worldPos);
      if (clickedLine) {
        performExtend(clickedLine, worldPos);
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const worldPos = screenToWorld(e.clientX, e.clientY);
    setMousePos(worldPos);
    
    const currentSnap = getSnappedPos(worldPos, draggingLine?.id);
    setSnapPos(currentSnap);

    if (isPanning) {
      setOffset(prev => ({ 
        x: prev.x + (e.clientX - lastMousePos.x), 
        y: prev.y + (e.clientY - lastMousePos.y) 
      }));
      setLastMousePos({ x: e.clientX, y: e.clientY });
    }

    if (draggingLine && dragStartPos) {
      if (!hasMoved) {
        saveToHistory();
        setHasMoved(true);
      }

      if (dragAnchor && mode === 'select') {
        // Stretching endpoint (Select Mode Only)
        setLines(prev => prev.map(l => {
          if (l.id !== draggingLine.id) return l;
          let newX1 = l.x1, newY1 = l.y1, newX2 = l.x2, newY2 = l.y2;
          const targetX = currentSnap.x;
          const targetY = currentSnap.y;
          if (dragAnchor === 'start') {
            newX1 = targetX; newY1 = targetY;
          } else {
            newX2 = targetX; newY2 = targetY;
          }
          return { ...l, x1: newX1, y1: newY1, x2: newX2, y2: newY2 };
        }));
      } else {
        // Moving whole line
        const dx = currentSnap.x - dragStartPos.x;
        const dy = currentSnap.y - dragStartPos.y;
        
        if (dx !== 0 || dy !== 0) {
            setLines(prev => prev.map(l => 
              (l.selected || l.id === draggingLine.id) 
                ? { ...l, x1: l.x1 + dx, y1: l.y1 + dy, x2: l.x2 + dx, y2: l.y2 + dy } 
                : l
            ));
            setDragStartPos(currentSnap);
        }
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    (e.target as Element).releasePointerCapture(e.pointerId);
    setIsPanning(false);
    setDraggingLine(null);
    setDragAnchor(null);
    setHasMoved(false);
    if(mode === 'select' || mode === 'move') setMessage("就緒");
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setDraggingLine(null);
    setInteractionPoints([]);
    setSelectedLinesForTool([]);
    if ((mode === 'draw_poly' || mode === 'draw_fixed_h' || mode === 'draw_fixed_v') && interactionPoints.length > 0) {
      setInteractionPoints([]);
      setMessage("畫線已結束");
    } else {
      setMode('select');
      setMessage("已切換至選取模式");
    }
  };

  const performTrim = (targetLine: Line, clickPos: Point) => {
    saveToHistory();
    let pts: {t: number, p: Point}[] = [
      { t: 0, p: { x: targetLine.x1, y: targetLine.y1 } }, 
      { t: 1, p: { x: targetLine.x2, y: targetLine.y2 } }
    ];

    lines.forEach(other => {
      if (other.id === targetLine.id) return;
      const res = getIntersection(targetLine, other);
      if (res && res.t > 0.001 && res.t < 0.999 && res.u >= 0 && res.u <= 1) {
        pts.push({ t: res.t, p: { x: res.x, y: res.y } });
      }
    });

    pts.sort((a, b) => a.t - b.t);

    const dx = targetLine.x2 - targetLine.x1;
    const dy = targetLine.y2 - targetLine.y1;
    const tClick = ((clickPos.x - targetLine.x1) * dx + (clickPos.y - targetLine.y1) * dy) / (dx * dx + dy * dy);
    
    const nextLines: Line[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      if (!(tClick >= pts[i].t && tClick <= pts[i + 1].t)) {
        nextLines.push({ 
          id: Date.now() + Math.random(), 
          x1: pts[i].p.x, 
          y1: pts[i].p.y, 
          x2: pts[i + 1].p.x, 
          y2: pts[i + 1].p.y,
          selected: false 
        });
      }
    }
    setLines(lines.filter(l => l.id !== targetLine.id).concat(nextLines));
    setMessage("線段已修剪");
  };

  const handleToolChange = (newMode: ToolMode) => {
    setMode(newMode);
    setInteractionPoints([]);
    setSelectedLinesForTool([]);
    setMessage(`工具：${getToolName(newMode)}`);
  };

  const deleteSelected = () => {
    const linesChanged = lines.some(l => l.selected);
    const dimsChanged = dims.some(d => d.selected);
    
    if (linesChanged || dimsChanged) {
      saveToHistory();
      setLines(lines.filter(l => !l.selected));
      setDims(dims.filter(d => !d.selected));
      setMessage("已刪除選取物件");
    } else {
      setMessage("無選取物件");
    }
  };

  const clearCanvas = () => {
    if(lines.length === 0 && dims.length === 0) return;
    saveToHistory();
    setLines([]);
    setDims([]);
    setInteractionPoints([]);
    setSelectedLinesForTool([]);
    setMode('select');
    setMessage("畫布已清空");
  };

  const getAngleDisplay = (d: Dimension) => {
    if (!d.center) return null;
    const a1 = Math.atan2(d.p1.y - d.center.y, d.p1.x - d.center.x);
    const a2 = Math.atan2(d.p2.y - d.center.y, d.p2.x - d.center.x);
    let deg = Math.abs((a1 - a2) * 180 / Math.PI);
    if (deg > 180) deg = 360 - deg;
    return Math.round(deg * 10) / 10 + "°";
  }

  // Calculate preview end point for drawing tools
  let previewEnd: Point | null = null;
  if (interactionPoints.length > 0) {
    if (mode === 'draw_poly') {
       previewEnd = snapPos || mousePos;
    } else if (mode === 'draw_fixed_h') {
       const len = parseFloat(paramLength) || 0;
       const dir = mousePos.x >= interactionPoints[0].x ? 1 : -1;
       previewEnd = { x: interactionPoints[0].x + len * dir, y: interactionPoints[0].y };
    } else if (mode === 'draw_fixed_v') {
       const len = parseFloat(paramLength) || 0;
       const dir = mousePos.y >= interactionPoints[0].y ? 1 : -1;
       previewEnd = { x: interactionPoints[0].x, y: interactionPoints[0].y + len * dir };
    }
  }

  return (
    <div className="flex flex-col h-screen bg-slate-50 overflow-hidden select-none font-sans text-slate-700">
      
      {/* Top Toolbar */}
      <div className="h-16 bg-white border-b border-slate-200 flex items-center px-4 shadow-sm z-20 justify-between">
        
        {/* Left: Common Operations & Measure */}
        <div className="flex items-center space-x-2">
          <div className="flex space-x-1 mr-4 border-r pr-4 border-slate-200">
             <button 
                onClick={undo}
                disabled={history.length === 0}
                className={`p-2 flex flex-col items-center justify-center border rounded w-16 h-16 text-[10px] transition-all duration-200 ${history.length === 0 ? 'opacity-50 cursor-not-allowed bg-slate-50' : 'bg-white hover:bg-slate-50 text-slate-600 border-slate-200 shadow-sm'}`}
             >
                <Undo2 size={18} className="mb-1" />
                <span className="text-center leading-tight">回復</span>
             </button>
             <button 
                onClick={redo}
                disabled={redoStack.length === 0}
                className={`p-2 flex flex-col items-center justify-center border rounded w-16 h-16 text-[10px] transition-all duration-200 ${redoStack.length === 0 ? 'opacity-50 cursor-not-allowed bg-slate-50' : 'bg-white hover:bg-slate-50 text-slate-600 border-slate-200 shadow-sm'}`}
             >
                <Redo2 size={18} className="mb-1" />
                <span className="text-center leading-tight">重做</span>
             </button>
          </div>

          <div className="flex space-x-1 mr-4 border-r pr-4 border-slate-200">
             <ToolButton id="select" currentMode={mode} icon={MousePointer2} label="選取" onClick={handleToolChange} />
             <ToolButton id="move" currentMode={mode} icon={Move} label="移動" onClick={handleToolChange} />
             <button 
                onClick={deleteSelected}
                className="p-2 flex flex-col items-center justify-center border rounded w-16 h-16 text-[10px] transition-all duration-200 bg-white hover:bg-rose-50 text-rose-600 border-slate-200 hover:border-rose-200 shadow-sm"
             >
                <Trash2 size={18} className="mb-1" />
                <span className="text-center leading-tight">刪除</span>
             </button>
             <button 
                onClick={clearCanvas}
                className="p-2 flex flex-col items-center justify-center border rounded w-16 h-16 text-[10px] transition-all duration-200 bg-white hover:bg-rose-50 text-rose-600 border-slate-200 hover:border-rose-200 shadow-sm"
             >
                <Eraser size={18} className="mb-1" />
                <span className="text-center leading-tight">清空</span>
             </button>
          </div>
          
          <div className="flex space-x-1">
             <ToolButton id="dim_dist" currentMode={mode} icon={Ruler} label="長度標註" onClick={handleToolChange} />
             <ToolButton id="dim_angle" currentMode={mode} icon={RotateCw} label="角度標註" onClick={handleToolChange} />
          </div>
        </div>

        {/* Center: Message */}
        <div className="flex-1 flex justify-center">
             <span className="text-indigo-600 font-bold text-sm bg-indigo-50 px-4 py-2 rounded-full border border-indigo-100">
               {message}
             </span>
        </div>

        {/* Right: Params & Zoom */}
        <div className="flex items-center space-x-4">
             <div className="flex items-center space-x-2">
                <div className="flex flex-col items-end">
                  <label className="text-[9px] uppercase font-bold text-slate-400">長度</label>
                  <input 
                    type="number" 
                    value={paramLength} 
                    onChange={e => setParamLength(e.target.value)} 
                    className="w-16 border border-slate-300 rounded text-sm px-2 h-7 focus:outline-none focus:border-indigo-500 text-right" 
                  />
                </div>
                <div className="flex flex-col items-end">
                  <label className="text-[9px] uppercase font-bold text-slate-400">角度</label>
                  <input 
                    type="number" 
                    value={paramAngle} 
                    onChange={e => setParamAngle(e.target.value)} 
                    className="w-16 border border-slate-300 rounded text-sm px-2 h-7 focus:outline-none focus:border-indigo-500 text-right" 
                  />
                </div>
             </div>
             <div className="h-8 w-px bg-slate-200 mx-2"></div>
             <span className="font-mono text-xs text-slate-500">
               {Math.round(scale * 100)}%
             </span>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar: Draw Tools */}
        <div className="w-20 bg-white border-r border-slate-200 flex flex-col items-center py-4 space-y-3 z-10 shadow-lg overflow-y-auto">
          <ToolButton id="pan" currentMode={mode} icon={Hand} label="平移" onClick={handleToolChange} />
          <div className="w-12 h-px bg-slate-200 my-1" />
          <ToolButton id="draw_poly" currentMode={mode} icon={PenTool} label="畫線" onClick={handleToolChange} />
          <ToolButton id="draw_fixed_h" currentMode={mode} icon={Minus} label="水平線" onClick={handleToolChange} />
          <ToolButton id="draw_fixed_v" currentMode={mode} icon={MoveVertical} label="垂直線" onClick={handleToolChange} />
          <ToolButton id="draw_fixed_a" currentMode={mode} icon={ArrowUpRight} label="角度線" onClick={handleToolChange} />
          <div className="w-12 h-px bg-slate-200 my-1" />
          <ToolButton id="trim" currentMode={mode} icon={Scissors} label="修剪" onClick={handleToolChange} />
          <ToolButton id="extend" currentMode={mode} icon={Maximize} label="延伸" onClick={handleToolChange} />
        </div>

        {/* Canvas Area */}
        <div className="flex-1 bg-slate-100 relative overflow-hidden" onWheel={handleWheel}>
          <svg 
            ref={svgRef} 
            className={`w-full h-full block touch-none ${mode === 'pan' || isPanning ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'}`}
            onPointerDown={handlePointerDown} 
            onPointerMove={handlePointerMove} 
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            onContextMenu={handleContextMenu}
          >
            <defs>
              <pattern id="grid" width={GRID_SIZE * scale} height={GRID_SIZE * scale} patternUnits="userSpaceOnUse">
                <circle cx={1 * scale} cy={1 * scale} r={1 * scale} fill="#94a3b8" opacity={0.4} />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
            
            <g transform={`translate(${offset.x}, ${offset.y}) scale(${scale})`}>
              {/* Draw Lines */}
              {lines.map(line => (
                <g 
                  key={line.id} 
                  className="group"
                  onPointerDown={(e) => {
                    if (mode === 'trim') {
                      e.stopPropagation();
                      performTrim(line, screenToWorld(e.clientX, e.clientY));
                    }
                  }}
                >
                  <line 
                    x1={line.x1} y1={line.y1} 
                    x2={line.x2} y2={line.y2} 
                    stroke={selectedLinesForTool.find(l => l.id === line.id) ? "#f43f5e" : (line.selected ? "#4f46e5" : "#0f172a")} 
                    strokeWidth={1.5 / scale} 
                    strokeLinecap="round" 
                    className="transition-colors duration-100"
                  />
                  {/* Invisible Hit Area (Thicker) */}
                  <line 
                    x1={line.x1} y1={line.y1} 
                    x2={line.x2} y2={line.y2} 
                    stroke="transparent" 
                    strokeWidth={12 / scale} 
                    className={`${mode === 'trim' ? 'cursor-alias hover:stroke-rose-500/20' : (mode === 'extend' ? 'cursor-alias hover:stroke-indigo-500/20' : 'cursor-pointer')}`}
                  />
                </g>
              ))}

              {/* Draw Dimensions */}
              {dims.map(d => {
                if (d.type === 'angle' && d.center) {
                    const radius = dist(d.center, d.offsetPos);
                    const degText = getAngleDisplay(d);
                    const isSel = d.selected;
                    const strokeColor = isSel ? "#4f46e5" : "#f43f5e";
                    
                    return (
                        <g key={d.id} className="pointer-events-none select-none">
                            <circle cx={d.center.x} cy={d.center.y} r={radius} stroke={strokeColor} strokeWidth={1/scale} fill="none" opacity={0.3} strokeDasharray={`${4/scale},${2/scale}`} />
                             <line x1={d.center.x} y1={d.center.y} x2={d.offsetPos.x} y2={d.offsetPos.y} stroke={strokeColor} strokeWidth={0.5/scale} strokeDasharray={`${4/scale},${2/scale}`} />
                            <text 
                                x={d.offsetPos.x} 
                                y={d.offsetPos.y} 
                                fontSize={12/scale} 
                                fill={strokeColor} 
                                textAnchor="middle" 
                                dominantBaseline="middle"
                                className="font-mono font-bold"
                            >
                                {degText}
                            </text>
                        </g>
                    )
                }

                // Dist dim
                const angle = Math.atan2(d.p2.y - d.p1.y, d.p2.x - d.p1.x);
                const l = dist(d.p1, d.p2);
                const ux = (d.p2.x - d.p1.x) / l;
                const uy = (d.p2.y - d.p1.y) / l;
                const vx = -uy;
                const vy = ux;
                const h = (d.offsetPos.x - d.p1.x) * vx + (d.offsetPos.y - d.p1.y) * vy; 
                
                const b1x = d.p1.x + vx * h;
                const b1y = d.p1.y + vy * h;
                const b2x = d.p2.x + vx * h;
                const b2y = d.p2.y + vy * h;

                let textAngle = angle * 180 / Math.PI;
                if (textAngle > 90) textAngle -= 180;
                if (textAngle < -90) textAngle += 180;

                const isSel = d.selected;
                const strokeColor = isSel ? "#4f46e5" : "#f43f5e";
                const helperColor = isSel ? "#818cf8" : "#94a3b8";

                return (
                  <g key={d.id} className="pointer-events-none select-none">
                    <line x1={d.p1.x} y1={d.p1.y} x2={b1x} y2={b1y} stroke={helperColor} strokeWidth={0.5 / scale} strokeDasharray={`${4/scale},${2/scale}`} />
                    <line x1={d.p2.x} y1={d.p2.y} x2={b2x} y2={b2y} stroke={helperColor} strokeWidth={0.5 / scale} strokeDasharray={`${4/scale},${2/scale}`} />
                    <line x1={b1x} y1={b1y} x2={b2x} y2={b2y} stroke={strokeColor} strokeWidth={1 / scale} />
                    <text 
                      x={(b1x + b2x) / 2} 
                      y={(b1y + b2y) / 2} 
                      fontSize={12 / scale} 
                      fill={strokeColor} 
                      textAnchor="middle" 
                      dominantBaseline="middle"
                      transform={`rotate(${textAngle}, ${(b1x + b2x) / 2}, ${(b1y + b2y) / 2}) translate(0, ${-8/scale})`}
                      className="font-mono font-bold"
                    >
                      {Math.round(l)}
                    </text>
                  </g>
                );
              })}

              {/* Interaction Preview */}
              {interactionPoints.length > 0 && previewEnd && (
                <line 
                  x1={interactionPoints[0].x} y1={interactionPoints[0].y} 
                  x2={previewEnd.x} y2={previewEnd.y} 
                  stroke="#4f46e5" 
                  strokeWidth={1.5 / scale} 
                  strokeDasharray={`${6/scale},${3/scale}`} 
                  opacity={0.7}
                />
              )}
              {interactionPoints.length === 2 && mode === 'dim_dist' && (
                <line 
                  x1={interactionPoints[0].x} y1={interactionPoints[0].y} 
                  x2={interactionPoints[1].x} y2={interactionPoints[1].y} 
                  stroke="#f43f5e" 
                  strokeWidth={1.5 / scale} 
                  strokeDasharray={`${6/scale},${3/scale}`} 
                  opacity={0.5} 
                />
              )}
              {selectedLinesForTool.length === 2 && mode === 'dim_angle' && (
                  <circle cx={getLineIntersection(selectedLinesForTool[0], selectedLinesForTool[1])?.x || 0} cy={getLineIntersection(selectedLinesForTool[0], selectedLinesForTool[1])?.y || 0} r={dist(getLineIntersection(selectedLinesForTool[0], selectedLinesForTool[1]) || {x:0,y:0}, mousePos)} stroke="#f43f5e" strokeWidth={1/scale} fill="none" opacity={0.3} strokeDasharray={`${4/scale},${2/scale}`} />
              )}

              {/* Snap Marker */}
              {snapPos && (
                <g transform={`translate(${snapPos.x}, ${snapPos.y})`}>
                  <rect 
                    x={-4 / scale} y={-4 / scale} 
                    width={8 / scale} height={8 / scale} 
                    fill="none" 
                    stroke={snapPos.type === 'endpoint' ? "#f43f5e" : "#4f46e5"} 
                    strokeWidth={2 / scale} 
                  />
                </g>
              )}
            </g>
          </svg>
          
          <div className="absolute bottom-4 left-6 pointer-events-none opacity-50 text-[10px] text-slate-500">
             <p>左鍵：操作 | 右鍵/ESC：取消/停止 | 中鍵：平移 | 滾輪：縮放</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;