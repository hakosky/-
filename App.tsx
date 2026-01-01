import React, { useState, useRef, useCallback, useEffect } from 'react';
import { 
  MousePointer2, PenTool, Minus, MoveVertical, 
  Scissors, ArrowUpRight, Ruler, Eraser, Hand,
  Trash2, RotateCw, Undo2, Redo2, Maximize, Move,
  Circle as CircleIcon, ZoomIn, ZoomOut,
  Expand, 
  Save, FolderOpen,
  CloudUpload, CloudDownload, X, FileText, Check, Settings, Loader2
} from 'lucide-react';
import { createClient } from '@supabase/supabase-js';
import { ToolButton } from './components/ToolButton';
import { dist, getIntersection, getLineIntersection, distToSegment } from './utils';
import { GRID_SIZE, SNAP_RADIUS } from './constants';
import { Line, Circle, Point, Dimension, SnapPoint, ToolMode } from './types';

const WALLPAPER_SIZE = 5000;
// Project ID derived from user screenshot
const SUPABASE_PROJECT_URL = 'https://nwzxugpdrnthiuvwilxv.supabase.co';

const getToolName = (mode: ToolMode): string => {
  const names: Record<ToolMode, string> = {
    'select': '選取',
    'move': '移動線段',
    'pan': '平移',
    'draw_poly': '畫線',
    'draw_fixed_h': '水平線',
    'draw_fixed_v': '垂直線',
    'draw_fixed_a': '角度線',
    'draw_circle': '畫圓(直徑)',
    'trim': '修剪',
    'extend': '延伸',
    'dim_dist': '長度標註',
    'dim_angle': '角度標註'
  };
  return names[mode] || mode;
};

interface HistoryState {
  lines: Line[];
  circles: Circle[];
  dims: Dimension[];
}

interface SaveData {
  version: number;
  timestamp: number;
  data: HistoryState;
}

interface CloudFile {
  id: number;
  name: string;
  updated_at: string;
  data: SaveData;
}

const App: React.FC = () => {
  const [lines, setLines] = useState<Line[]>([]);
  const [circles, setCircles] = useState<Circle[]>([]);
  const [dims, setDims] = useState<Dimension[]>([]);
  const [mode, setMode] = useState<ToolMode>('select');
  const [message, setMessage] = useState("歡迎使用 CAD 工具");
  
  // History State
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryState[]>([]);

  // Viewport State
  const [scale, setScale] = useState(0.4);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [lastMousePos, setLastMousePos] = useState<Point>({ x: 0, y: 0 });

  // Interaction State
  const [mousePos, setMousePos] = useState<Point>({ x: 0, y: 0 });
  const [snapPos, setSnapPos] = useState<SnapPoint | null>(null);
  const [interactionPoints, setInteractionPoints] = useState<Point[]>([]);
  const [selectedLinesForTool, setSelectedLinesForTool] = useState<Line[]>([]); 
  
  // Dragging State
  const [draggingLine, setDraggingLine] = useState<Line | null>(null);
  const [draggingCircle, setDraggingCircle] = useState<Circle | null>(null);
  const [dragOriginalLine, setDragOriginalLine] = useState<Line | null>(null);
  const [dragOriginalCircle, setDragOriginalCircle] = useState<Circle | null>(null);
  const [dragStartPos, setDragStartPos] = useState<Point | null>(null);
  const [dragAnchor, setDragAnchor] = useState<'start' | 'end' | null>(null);
  const [hasMoved, setHasMoved] = useState(false);

  // Multi-touch
  const pointers = useRef<Map<number, { x: number; y: number; type: string }>>(new Map());
  const prevPinchDist = useRef<number | null>(null);
  const prevPinchCenter = useRef<Point | null>(null);
  const [isTouchMoveEnabled, setIsTouchMoveEnabled] = useState(false);

  // File Input Ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Parameters
  const [paramLength, setParamLength] = useState<string>("1000");
  const [paramAngle, setParamAngle] = useState<string>("45");
  
  const svgRef = useRef<SVGSVGElement>(null);

  // --- Cloud / Supabase State ---
  const [showCloudModal, setShowCloudModal] = useState(false);
  const [cloudMode, setCloudMode] = useState<'save' | 'load'>('save');
  const [cloudFiles, setCloudFiles] = useState<CloudFile[]>([]);
  const [cloudFileName, setCloudFileName] = useState("");
  const [supabaseKey, setSupabaseKey] = useState<string>(() => localStorage.getItem('cad_supabase_key') || '');
  const [isLoadingCloud, setIsLoadingCloud] = useState(false);
  
  // Initialize Supabase Client dynamically
  const getSupabase = () => {
    if (!supabaseKey) return null;
    return createClient(SUPABASE_PROJECT_URL, supabaseKey);
  };

  useEffect(() => {
    if (supabaseKey) {
      localStorage.setItem('cad_supabase_key', supabaseKey);
    }
  }, [supabaseKey]);

  const clearSupabaseKey = () => {
    setSupabaseKey('');
    localStorage.removeItem('cad_supabase_key');
  };

  // --- History Management ---
  const saveToHistory = useCallback(() => {
    setHistory(prev => [...prev, { lines, circles, dims }]);
    setRedoStack([]); 
  }, [lines, circles, dims]);

  const undo = useCallback(() => {
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    setRedoStack(prev => [...prev, { lines, circles, dims }]);
    setLines(previous.lines);
    setCircles(previous.circles);
    setDims(previous.dims);
    setHistory(prev => prev.slice(0, -1));
    setMessage("已返回上一步");
  }, [history, lines, circles, dims]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setHistory(prev => [...prev, { lines, circles, dims }]);
    setLines(next.lines);
    setCircles(next.circles);
    setDims(next.dims);
    setRedoStack(prev => prev.slice(0, -1));
    setMessage("已重做");
  }, [redoStack, lines, circles, dims]);

  // --- Local Save / Load ---
  const handleSave = () => {
    const saveData: SaveData = {
      version: 1,
      timestamp: Date.now(),
      data: { lines, circles, dims }
    };
    const blob = new Blob([JSON.stringify(saveData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const date = new Date();
    const dateStr = `${date.getFullYear()}${(date.getMonth()+1).toString().padStart(2,'0')}${date.getDate().toString().padStart(2,'0')}`;
    const timeStr = `${date.getHours().toString().padStart(2,'0')}${date.getMinutes().toString().padStart(2,'0')}`;
    link.href = url;
    link.download = `drawing_${dateStr}_${timeStr}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setMessage("檔案已下載");
  };

  const handleLoadClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const jsonContent = event.target?.result as string;
        const parsed: SaveData = JSON.parse(jsonContent);
        if (parsed.data && Array.isArray(parsed.data.lines)) {
          saveToHistory();
          setLines(parsed.data.lines);
          setCircles(parsed.data.circles || []);
          setDims(parsed.data.dims || []);
          setInteractionPoints([]);
          setSelectedLinesForTool([]);
          setDraggingLine(null);
          setDraggingCircle(null);
          setMessage("檔案讀取成功");
        } else {
          setMessage("錯誤：檔案格式不符");
        }
      } catch (err) {
        console.error(err);
        setMessage("錯誤：無法解析檔案");
      }
    };
    reader.readAsText(file);
  };

  // --- Cloud Logic ---

  const fetchCloudFiles = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    setIsLoadingCloud(true);
    const { data, error } = await supabase
      .from('drawings')
      .select('id, name, updated_at, data')
      .order('updated_at', { ascending: false });
    
    if (error) {
      console.error('Cloud load error:', error);
      if (error.message && (error.message.includes("Invalid API key") || error.code === 'PGRST301')) {
         alert("API Key 無效或過期。請確認您輸入的是 Supabase 'anon' public key。\n已清除錯誤的 Key，請重新輸入。");
         clearSupabaseKey();
      } else {
         setMessage("雲端讀取失敗: " + error.message);
      }
    } else {
      setCloudFiles(data as CloudFile[]);
    }
    setIsLoadingCloud(false);
  }, [supabaseKey]); // Depend on key change

  // Auto-refresh file list when key is provided or mode changes to load
  useEffect(() => {
    if (showCloudModal && cloudMode === 'load' && supabaseKey) {
      fetchCloudFiles();
    }
  }, [showCloudModal, cloudMode, supabaseKey, fetchCloudFiles]);

  const handleCloudSaveClick = () => {
    setCloudMode('save');
    setShowCloudModal(true);
    // Suggest a default name
    const date = new Date();
    setCloudFileName(`Drawing_${date.getFullYear()}${(date.getMonth()+1).toString().padStart(2,'0')}${date.getDate()}`);
  };

  const handleCloudLoadClick = () => {
    setCloudMode('load');
    setShowCloudModal(true);
  };

  const performCloudSave = async () => {
    const supabase = getSupabase();
    if (!supabase) {
        alert("請先輸入 Supabase Anon Key");
        return;
    }
    if (!cloudFileName.trim()) {
        alert("請輸入檔案名稱");
        return;
    }

    setIsLoadingCloud(true);
    const saveData: SaveData = {
      version: 1,
      timestamp: Date.now(),
      data: { lines, circles, dims }
    };

    const { error } = await supabase
        .from('drawings')
        .upsert({ 
            name: cloudFileName, 
            data: saveData,
            updated_at: new Date().toISOString()
        }, { onConflict: 'name' });

    setIsLoadingCloud(false);

    if (error) {
        console.error("Upload error", error);
        if (error.message && error.message.includes("Invalid API key")) {
             alert("API Key 無效。請確認您輸入的是 Supabase 'anon' public key。\n(通常以 eyJ 開頭的長字串)\n\n系統已清除錯誤的 Key，請重新輸入。");
             clearSupabaseKey();
        } else {
             alert("上傳失敗: " + error.message + "\n(請確認是否已關閉 RLS)");
        }
    } else {
        setMessage("雲端儲存成功");
        setShowCloudModal(false);
    }
  };

  const performCloudLoad = (file: CloudFile) => {
     if (file.data && Array.isArray(file.data.data.lines)) {
          saveToHistory();
          setLines(file.data.data.lines);
          setCircles(file.data.data.circles || []);
          setDims(file.data.data.dims || []);
          setInteractionPoints([]);
          setSelectedLinesForTool([]);
          setDraggingLine(null);
          setDraggingCircle(null);
          setMessage(`已讀取: ${file.name}`);
          setShowCloudModal(false);
     } else {
         alert("檔案格式損毀");
     }
  };

  // Global Key Handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // If modal is open, don't trigger shortcuts
      if (showCloudModal) return;

      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
        redo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'o') {
        e.preventDefault();
        handleLoadClick();
        return;
      }

      if (e.key === 'Escape') {
        if (draggingLine || draggingCircle) {
          setDraggingLine(null);
          setDraggingCircle(null);
          setDragAnchor(null);
          setDragOriginalLine(null);
          setDragOriginalLine(null);
          setDragOriginalCircle(null);
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
           const hasSelection = lines.some(l => l.selected) || dims.some(d => d.selected) || circles.some(c => c.selected);
           if (hasSelection) {
             saveToHistory();
             setLines(prev => prev.filter(l => !l.selected));
             setCircles(prev => prev.filter(c => !c.selected));
             setDims(prev => prev.filter(d => !d.selected));
             setMessage("已刪除物件");
           }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, interactionPoints, selectedLinesForTool, draggingLine, draggingCircle, history, redoStack, undo, redo, lines, circles, dims, saveToHistory, showCloudModal]);

  // Coordinate System
  const screenToWorld = useCallback((clientX: number, clientY: number): Point => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const rect = svgRef.current.getBoundingClientRect();
    return {
      x: (clientX - rect.left - offset.x) / scale,
      y: (clientY - rect.top - offset.y) / scale
    };
  }, [offset, scale]);

  const getSnappedPos = useCallback((worldPos: Point, excludeId?: number): SnapPoint => {
    let closest: SnapPoint | null = null;
    let minD = SNAP_RADIUS / scale;

    lines.forEach(line => {
      if (excludeId && line.id === excludeId) return; 
      const points: Point[] = [{x: line.x1, y: line.y1}, {x: line.x2, y: line.y2}];
      points.forEach(p => {
        const d = dist(worldPos, p);
        if (d < minD) { 
          minD = d; 
          closest = { ...p, type: 'endpoint' }; 
        }
      });
    });

    circles.forEach(circle => {
       if (excludeId && circle.id === excludeId) return;
       const d = dist(worldPos, {x: circle.cx, y: circle.cy});
       if (d < minD) {
         minD = d;
         closest = { x: circle.cx, y: circle.cy, type: 'center' };
       }
    });

    for (let i = 0; i < lines.length; i++) {
        const l1 = lines[i];
        if (excludeId && l1.id === excludeId) continue;
        for (let j = i + 1; j < lines.length; j++) {
            const l2 = lines[j];
            if (excludeId && l2.id === excludeId) continue;

            const int = getIntersection(l1, l2);
            if (int) {
                if (int.t >= -0.001 && int.t <= 1.001 && int.u >= -0.001 && int.u <= 1.001) {
                     const p = {x: int.x, y: int.y};
                     const d = dist(worldPos, p);
                     if (d < minD) {
                         minD = d;
                         closest = { ...p, type: 'intersection' };
                     }
                }
            }
        }
    }

    if (closest) return closest;
    
    return {
      x: Math.round(worldPos.x / GRID_SIZE) * GRID_SIZE,
      y: Math.round(worldPos.y / GRID_SIZE) * GRID_SIZE,
      type: 'grid'
    };
  }, [lines, circles, scale]);

  const handleManualZoom = (delta: number) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    
    const newScale = Math.min(Math.max(scale + delta, 0.1), 10);
    const worldX = (centerX - offset.x) / scale;
    const worldY = (centerY - offset.y) / scale;

    setScale(newScale);
    setOffset({
      x: centerX - worldX * newScale,
      y: centerY - worldY * newScale
    });
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (!svgRef.current) return;
    if (mode === 'move') return;

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

  const getCircleAtPos = (pos: Point) => {
    return circles.find(circle => {
      const d = dist(pos, {x: circle.cx, y: circle.cy});
      return Math.abs(d - circle.r) < 10 / scale;
    });
  };

  const getDimensionAtPos = (pos: Point) => {
    return dims.find(d => {
      if (d.type === 'dist') {
        const l = dist(d.p1, d.p2);
        if(l === 0) return false;
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

  const performTrim = (targetLine: Line, clickPos: Point) => {
    const tValues: number[] = [0, 1];
    
    lines.forEach(other => {
      if (other.id === targetLine.id) return;
      
      const intersection = getIntersection(targetLine, other);
      if (intersection) {
        tValues.push(intersection.t);
      }
    });
    
    tValues.sort((a, b) => a - b);
    const uniqueT: number[] = [];
    if(tValues.length > 0) uniqueT.push(tValues[0]);
    for(let i=1; i<tValues.length; i++) {
        if(tValues[i] - tValues[i-1] > 0.001) {
            uniqueT.push(tValues[i]);
        }
    }

    const dx = targetLine.x2 - targetLine.x1;
    const dy = targetLine.y2 - targetLine.y1;
    const len2 = dx * dx + dy * dy;
    
    let tClick = 0;
    if (len2 > 0) {
       tClick = ((clickPos.x - targetLine.x1) * dx + (clickPos.y - targetLine.y1) * dy) / len2;
    }
    tClick = Math.max(0, Math.min(1, tClick));

    let tStart = -1;
    let tEnd = -1;
    
    for (let i = 0; i < uniqueT.length - 1; i++) {
        if (tClick >= uniqueT[i] - 0.001 && tClick <= uniqueT[i+1] + 0.001) {
            tStart = uniqueT[i];
            tEnd = uniqueT[i+1];
            break;
        }
    }
    
    if (tStart === -1) return;

    saveToHistory();
    const newLines = lines.filter(l => l.id !== targetLine.id);
    
    if (tStart > 0.001) {
       newLines.push({
         ...targetLine,
         id: Date.now() + Math.random(),
         x2: targetLine.x1 + tStart * dx,
         y2: targetLine.y1 + tStart * dy,
         selected: false
       });
    }
    
    if (tEnd < 0.999) {
       newLines.push({
         ...targetLine,
         id: Date.now() + 1 + Math.random(),
         x1: targetLine.x1 + tEnd * dx,
         y1: targetLine.y1 + tEnd * dy,
         selected: false
       });
    }
    
    setLines(newLines);
    setMessage("線段已修剪");
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    (e.target as Element).setPointerCapture(e.pointerId);

    if (e.button === 2) return; 

    const worldPos = screenToWorld(e.clientX, e.clientY);
    const currentPos = getSnappedPos(worldPos);
    setSnapPos(currentPos);

    if (isTouchMoveEnabled && pointers.current.size > 1) {
      setIsPanning(false);
      return;
    }

    if ((e.button === 1 && mode !== 'move') || mode === 'pan') {
      setIsPanning(true);
      setLastMousePos({ x: e.clientX, y: e.clientY });
      return;
    }

    if (mode === 'select' || mode === 'move') {
      const clickedLine = getLineAtPos(worldPos);
      const clickedCircle = !clickedLine ? getCircleAtPos(worldPos) : null;
      const clickedDim = (mode === 'select' && !clickedLine && !clickedCircle) ? getDimensionAtPos(worldPos) : null;
      
      if (clickedLine) {
        setDraggingLine(clickedLine);
        setDragStartPos(currentPos); 
        setDragOriginalLine({ ...clickedLine });
        setHasMoved(false);
        
        if (mode === 'select') {
           setLines(lines.map(l => ({ ...l, selected: l.id === clickedLine.id })));
           setCircles(circles.map(c => ({ ...c, selected: false })));
           setDims(dims.map(d => ({ ...d, selected: false })));
        } else {
           if (!clickedLine.selected) {
             setLines(prev => prev.map(l => ({ ...l, selected: l.id === clickedLine.id })));
           }
        }
        
        let anchorFound = false;
        if (mode === 'select' || mode === 'move') {
            const snapThreshold = 10 / scale;
            const d1 = dist(worldPos, {x: clickedLine.x1, y: clickedLine.y1});
            const d2 = dist(worldPos, {x: clickedLine.x2, y: clickedLine.y2});
            if (d1 < snapThreshold) {
              setDragAnchor('start');
              setMessage(`拖曳端點 (起點)`);
              anchorFound = true;
            } else if (d2 < snapThreshold) {
              setDragAnchor('end');
              setMessage(`拖曳端點 (終點)`);
              anchorFound = true;
            }
        }

        if (!anchorFound) {
            setDragAnchor(null);
            setMessage(mode === 'move' ? "精確移動" : "移動線段");
        }

      } else if (clickedCircle) {
        setDraggingCircle(clickedCircle);
        setDragStartPos(currentPos);
        setDragOriginalCircle({ ...clickedCircle });
        setHasMoved(false);
        
        if (mode === 'select') {
           setLines(lines.map(l => ({ ...l, selected: false })));
           setCircles(circles.map(c => ({ ...c, selected: c.id === clickedCircle.id })));
           setDims(dims.map(d => ({ ...d, selected: false })));
           setMessage(`移動圓形`);
        } else {
            if (!clickedCircle.selected) {
               setCircles(prev => prev.map(c => ({ ...c, selected: c.id === clickedCircle.id })));
            }
            setMessage(`精確移動`);
        }

      } else if (clickedDim && mode === 'select') {
        setLines(lines.map(l => ({ ...l, selected: false })));
        setCircles(circles.map(c => ({ ...c, selected: false })));
        setDims(dims.map(d => ({ ...d, selected: d.id === clickedDim.id })));
        setMessage(`已選取標註`);
      } else {
        if (mode === 'select') {
            setLines(lines.map(l => ({ ...l, selected: false })));
            setCircles(circles.map(c => ({ ...c, selected: false })));
            setDims(dims.map(d => ({ ...d, selected: false })));
            setMessage("就緒");
        }
        if (mode === 'move') {
            const hasSel = lines.some(l => l.selected) || circles.some(c => c.selected);
            if (hasSel) {
               setDraggingLine({ id: -1 } as Line);
               setDragStartPos(currentPos);
               setHasMoved(false);
               setDragAnchor(null);
            }
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
      if (interactionPoints.length === 0) {
        setInteractionPoints([currentPos]);
        setMessage("請移動滑鼠選擇方向，再次點擊確認");
      } else {
        saveToHistory();
        const start = interactionPoints[0];
        const len = parseFloat(paramLength) || 0;
        let x2 = start.x;
        let y2 = start.y;
        
        if (mode === 'draw_fixed_h') {
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
    } else if (mode === 'draw_circle') {
      saveToHistory();
      const diameter = parseFloat(paramLength) || 0;
      const radius = diameter / 2;
      setCircles([...circles, {
        id: Date.now(),
        cx: currentPos.x,
        cy: currentPos.y,
        r: radius,
        selected: false
      }]);
      setMessage("圓形已建立");
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
             p1, p2,
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
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    const activePointers = Array.from(pointers.current.values()) as { x: number; y: number; type: string }[];
    const touchPointers = activePointers.filter(p => p.type === 'touch');

    if (touchPointers.length === 2) {
       if (isPanning) setIsPanning(false);
       if (mode === 'move') return; 

       const p1 = touchPointers[0];
       const p2 = touchPointers[1];
       const currentDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
       const currentCenter = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

       if (prevPinchDist.current !== null && prevPinchCenter.current !== null) {
          if (!svgRef.current) return;
          const rect = svgRef.current.getBoundingClientRect();
          const factor = currentDist / prevPinchDist.current;
          const newScale = Math.min(Math.max(scale * factor, 0.1), 10);
          const prevCenterRelX = prevPinchCenter.current.x - rect.left;
          const prevCenterRelY = prevPinchCenter.current.y - rect.top;
          const worldX = (prevCenterRelX - offset.x) / scale;
          const worldY = (prevCenterRelY - offset.y) / scale;
          const currentCenterRelX = currentCenter.x - rect.left;
          const currentCenterRelY = currentCenter.y - rect.top;
          
          const newOffset = {
             x: currentCenterRelX - worldX * newScale,
             y: currentCenterRelY - worldY * newScale
          };

          setScale(newScale);
          setOffset(newOffset);
       }
       prevPinchDist.current = currentDist;
       prevPinchCenter.current = currentCenter;
       return; 
    }

    const worldPos = screenToWorld(e.clientX, e.clientY);
    setMousePos(worldPos);
    
    const currentSnap = getSnappedPos(worldPos, draggingLine?.id || draggingCircle?.id);
    setSnapPos(currentSnap);

    if (isPanning && pointers.current.size === 1) {
      setOffset(prev => ({ 
        x: prev.x + (e.clientX - lastMousePos.x), 
        y: prev.y + (e.clientY - lastMousePos.y) 
      }));
      setLastMousePos({ x: e.clientX, y: e.clientY });
    }

    if ((draggingLine || draggingCircle) && dragStartPos) {
      if (!hasMoved) {
        saveToHistory();
        setHasMoved(true);
      }
      const dx = currentSnap.x - dragStartPos.x;
      const dy = currentSnap.y - dragStartPos.y;

      if (draggingLine) {
          if (dragAnchor && (mode === 'select' || mode === 'move') && dragOriginalLine) {
            setLines(prev => prev.map(l => {
              if (l.id !== draggingLine.id) return l;
              let newX1 = dragOriginalLine.x1, newY1 = dragOriginalLine.y1, newX2 = dragOriginalLine.x2, newY2 = dragOriginalLine.y2;
              if (dragAnchor === 'start') {
                newX1 = dragOriginalLine.x1 + dx; newY1 = dragOriginalLine.y1 + dy;
              } else {
                newX2 = dragOriginalLine.x2 + dx; newY2 = dragOriginalLine.y2 + dy;
              }
              return { ...l, x1: newX1, y1: newY1, x2: newX2, y2: newY2 };
            }));
          } else {
            if (dx !== 0 || dy !== 0) {
                if (dragOriginalLine && draggingLine.id !== -1) {
                    setLines(prev => prev.map(l => 
                        (l.id === draggingLine.id) 
                          ? { ...l, x1: dragOriginalLine.x1 + dx, y1: dragOriginalLine.y1 + dy, x2: dragOriginalLine.x2 + dx, y2: dragOriginalLine.y2 + dy } 
                          : l
                    ));
                } else {
                    if (draggingLine.id === -1) {
                         const iDx = currentSnap.x - dragStartPos.x;
                         const iDy = currentSnap.y - dragStartPos.y;
                         if (iDx !== 0 || iDy !== 0) {
                             setLines(prev => prev.map(l => l.selected ? { ...l, x1: l.x1 + iDx, y1: l.y1 + iDy, x2: l.x2 + iDx, y2: l.y2 + iDy } : l));
                             setCircles(prev => prev.map(c => c.selected ? { ...c, cx: c.cx + iDx, cy: c.cy + iDy } : c));
                             setDragStartPos(currentSnap); 
                         }
                    }
                }
            }
          }
      } else if (draggingCircle && dragOriginalCircle) {
           if (dx !== 0 || dy !== 0) {
               setCircles(prev => prev.map(c => 
                  (c.id === draggingCircle.id)
                    ? { ...c, cx: dragOriginalCircle.cx + dx, cy: dragOriginalCircle.cy + dy }
                    : c
               ));
           }
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const touchPointers = (Array.from(pointers.current.values()) as { x: number; y: number; type: string }[]).filter(p => p.type === 'touch');
    if (touchPointers.length < 2) {
       prevPinchDist.current = null;
       prevPinchCenter.current = null;
    }
    
    (e.target as Element).releasePointerCapture(e.pointerId);
    setIsPanning(false);
    setDraggingLine(null);
    setDraggingCircle(null);
    setDragAnchor(null);
    setDragOriginalLine(null);
    setDragOriginalCircle(null);
    setHasMoved(false);
    if(mode === 'select' || mode === 'move') setMessage("就緒");
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setDraggingLine(null);
    setDraggingCircle(null);
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

  const handleToolChange = (newMode: ToolMode) => {
    setIsTouchMoveEnabled(false);

    // Clear any existing selection when switching tools
    setLines(prev => prev.map(l => ({ ...l, selected: false })));
    setCircles(prev => prev.map(c => ({ ...c, selected: false })));
    setDims(prev => prev.map(d => ({ ...d, selected: false })));

    if (mode === newMode) {
      setMode('select');
      setInteractionPoints([]);
      setSelectedLinesForTool([]);
      setMessage("已切換至選取模式");
    } else {
      setMode(newMode);
      setInteractionPoints([]);
      setSelectedLinesForTool([]);
      setMessage(`工具：${getToolName(newMode)}`);
    }
  };

  const deleteSelected = () => {
    const linesChanged = lines.some(l => l.selected);
    const circlesChanged = circles.some(c => c.selected);
    const dimsChanged = dims.some(d => d.selected);
    if (linesChanged || circlesChanged || dimsChanged) {
      saveToHistory();
      setLines(lines.filter(l => !l.selected));
      setCircles(circles.filter(c => !c.selected));
      setDims(dims.filter(d => !d.selected));
      setMessage("已刪除選取物件");
    } else {
      setMessage("無選取物件");
    }
  };

  const clearCanvas = () => {
    if(lines.length === 0 && circles.length === 0 && dims.length === 0) return;
    saveToHistory();
    setLines([]);
    setCircles([]);
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
  };

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
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
        accept=".json" 
        className="hidden" 
      />
      
      {/* Top Toolbar */}
      <div className="h-16 bg-white border-b border-slate-200 flex items-center px-4 shadow-sm z-20 justify-between">
        <div className="flex items-center space-x-2">
          <div className="flex space-x-1 mr-4 border-r pr-4 border-slate-200">
             <button onClick={handleSave} className="p-2 flex flex-col items-center justify-center border rounded w-16 h-16 text-[10px] transition-all duration-200 bg-white hover:bg-slate-50 text-slate-600 border-slate-200 shadow-sm">
                <Save size={18} className="mb-1" />
                <span className="text-center leading-tight">存檔</span>
             </button>
             <button onClick={handleLoadClick} className="p-2 flex flex-col items-center justify-center border rounded w-16 h-16 text-[10px] transition-all duration-200 bg-white hover:bg-slate-50 text-slate-600 border-slate-200 shadow-sm">
                <FolderOpen size={18} className="mb-1" />
                <span className="text-center leading-tight">讀檔</span>
             </button>
          </div>

          <div className="flex space-x-1 mr-4 border-r pr-4 border-slate-200">
             <button onClick={undo} disabled={history.length === 0} className={`p-2 flex flex-col items-center justify-center border rounded w-16 h-16 text-[10px] transition-all duration-200 ${history.length === 0 ? 'opacity-50 cursor-not-allowed bg-slate-50' : 'bg-white hover:bg-slate-50 text-slate-600 border-slate-200 shadow-sm'}`}>
                <Undo2 size={18} className="mb-1" />
                <span className="text-center leading-tight">回復</span>
             </button>
             <button onClick={redo} disabled={redoStack.length === 0} className={`p-2 flex flex-col items-center justify-center border rounded w-16 h-16 text-[10px] transition-all duration-200 ${redoStack.length === 0 ? 'opacity-50 cursor-not-allowed bg-slate-50' : 'bg-white hover:bg-slate-50 text-slate-600 border-slate-200 shadow-sm'}`}>
                <Redo2 size={18} className="mb-1" />
                <span className="text-center leading-tight">重做</span>
             </button>
          </div>

          <div className="flex space-x-1 mr-4 border-r pr-4 border-slate-200">
             <ToolButton id="select" currentMode={mode} icon={MousePointer2} label="選取" onClick={handleToolChange} />
             <ToolButton id="move" currentMode={mode} icon={Move} label="移動線段" onClick={handleToolChange} />
             <button onClick={deleteSelected} className="p-2 flex flex-col items-center justify-center border rounded w-16 h-16 text-[10px] transition-all duration-200 bg-white hover:bg-rose-50 text-rose-600 border-slate-200 hover:border-rose-200 shadow-sm">
                <Trash2 size={18} className="mb-1" />
                <span className="text-center leading-tight">刪除</span>
             </button>
             <button onClick={clearCanvas} className="p-2 flex flex-col items-center justify-center border rounded w-16 h-16 text-[10px] transition-all duration-200 bg-white hover:bg-rose-50 text-rose-600 border-slate-200 hover:border-rose-200 shadow-sm">
                <Eraser size={18} className="mb-1" />
                <span className="text-center leading-tight">清空</span>
             </button>
          </div>
          
          <div className="flex space-x-1">
             <ToolButton id="dim_dist" currentMode={mode} icon={Ruler} label="長度標註" onClick={handleToolChange} />
             <ToolButton id="dim_angle" currentMode={mode} icon={RotateCw} label="角度標註" onClick={handleToolChange} />
          </div>
        </div>

        <div className="flex-1 flex justify-center">
             <span className="text-indigo-600 font-bold text-sm bg-indigo-50 px-4 py-2 rounded-full border border-indigo-100">
               {message}
             </span>
        </div>

        <div className="flex items-center space-x-4">
             <div className="flex items-center space-x-2">
                
                {/* Supabase Cloud Buttons */}
                <button onClick={handleCloudSaveClick} title="儲存至雲端" className="p-2 flex flex-col items-center justify-center border rounded w-16 h-16 text-[10px] transition-all duration-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200 shadow-sm">
                  <CloudUpload size={18} className="mb-1" />
                  <span className="text-center leading-tight">雲端存檔</span>
                </button>
                <button onClick={handleCloudLoadClick} title="從雲端讀取" className="p-2 flex flex-col items-center justify-center border rounded w-16 h-16 text-[10px] transition-all duration-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200 shadow-sm mr-2">
                  <CloudDownload size={18} className="mb-1" />
                  <span className="text-center leading-tight">雲端讀取</span>
                </button>

                <button 
                  onClick={() => {
                    if (!isTouchMoveEnabled && mode === 'move') { setMode('select'); setMessage('已切換至選取模式'); }
                    setIsTouchMoveEnabled(!isTouchMoveEnabled);
                  }}
                  className={`p-2 flex flex-col items-center justify-center border rounded w-16 h-16 text-[10px] transition-all duration-200 ${isTouchMoveEnabled ? 'bg-indigo-600 text-white border-indigo-700 shadow-inner' : 'bg-white hover:bg-slate-50 text-slate-500 border-slate-200 hover:border-slate-300 shadow-sm'}`}
                >
                  <Expand size={18} className="mb-1" />
                  <span className="text-center leading-tight">桌布移動</span>
                </button>

                <div className="flex flex-col items-end">
                  <label className="text-[9px] uppercase font-bold text-slate-400">長度/直徑</label>
                  <input type="number" value={paramLength} onChange={e => setParamLength(e.target.value)} className="w-[4.5rem] border border-slate-300 rounded text-sm px-2 h-7 focus:outline-none focus:border-indigo-500 text-right" />
                </div>
                <div className="flex flex-col items-end">
                  <label className="text-[9px] uppercase font-bold text-slate-400">角度</label>
                  <input type="number" value={paramAngle} onChange={e => setParamAngle(e.target.value)} className="w-16 border border-slate-300 rounded text-sm px-2 h-7 focus:outline-none focus:border-indigo-500 text-right" />
                </div>
             </div>
             <div className="h-8 w-px bg-slate-200 mx-2"></div>
             <div className="flex items-center space-x-1">
                <button onClick={() => handleManualZoom(-0.1)} className="p-1 hover:bg-slate-100 rounded text-slate-600 active:bg-slate-200 transition-colors">
                   <ZoomOut size={16} />
                </button>
                <span className="font-mono text-xs text-slate-500 w-12 text-center select-none">
                  {Math.round(scale * 100)}%
                </span>
                <button onClick={() => handleManualZoom(0.1)} className="p-1 hover:bg-slate-100 rounded text-slate-600 active:bg-slate-200 transition-colors">
                   <ZoomIn size={16} />
                </button>
             </div>
        </div>
      </div>

      {/* Cloud Modal */}
      {showCloudModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-96 transform transition-all scale-100 opacity-100">
             
             {/* Modal Header */}
             <div className="flex justify-between items-center mb-4">
               <h3 className="text-lg font-bold text-slate-800 flex items-center">
                 {cloudMode === 'save' ? <CloudUpload size={20} className="mr-2 text-indigo-600"/> : <CloudDownload size={20} className="mr-2 text-indigo-600"/>}
                 {cloudMode === 'save' ? '儲存至雲端' : '雲端檔案列表'}
               </h3>
               <button onClick={() => setShowCloudModal(false)} className="text-slate-400 hover:text-slate-600">
                 <X size={20} />
               </button>
             </div>

             {/* API Key Config Section */}
             <div className="mb-4 p-3 bg-slate-50 border border-slate-200 rounded text-sm">
                <div className="flex justify-between items-center mb-1">
                   <p className="text-slate-700 font-bold flex items-center">
                      <Settings size={14} className="mr-1"/> 
                      API Key 設定
                   </p>
                   {supabaseKey && (
                      <button 
                        onClick={() => {
                          setSupabaseKey('');
                          localStorage.removeItem('cad_supabase_key');
                        }} 
                        className="text-xs text-indigo-600 hover:underline"
                      >
                        重新輸入
                      </button>
                   )}
                </div>
                
                {!supabaseKey ? (
                   <>
                     <p className="text-slate-500 text-xs mb-2">請輸入 Supabase <b>Anon / Public Key</b> (長字串，非資料庫密碼)</p>
                     <input 
                        type="password" 
                        placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6..." 
                        className="w-full border border-slate-300 rounded px-2 py-1 text-xs font-mono"
                        onChange={(e) => setSupabaseKey(e.target.value)}
                        autoFocus
                     />
                   </>
                ) : (
                   <div className="flex items-center text-green-600 text-xs">
                      <Check size={12} className="mr-1" /> 已儲存 API Key
                   </div>
                )}
             </div>

             {/* Content */}
             <div className="space-y-4">
               {supabaseKey ? (
                 <>
                   {cloudMode === 'save' ? (
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">檔案名稱</label>
                        <input 
                          type="text" 
                          value={cloudFileName} 
                          onChange={e => setCloudFileName(e.target.value)} 
                          className="w-full border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
                          placeholder="請輸入名稱"
                        />
                        <div className="flex justify-end mt-4 space-x-2">
                           <button onClick={() => setShowCloudModal(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded">取消</button>
                           <button onClick={performCloudSave} disabled={isLoadingCloud} className="px-4 py-2 text-sm bg-indigo-600 text-white hover:bg-indigo-700 rounded shadow-sm flex items-center">
                             {isLoadingCloud ? <Loader2 className="animate-spin mr-1" size={14} /> : <Save size={14} className="mr-1"/>}
                             {isLoadingCloud ? '儲存中...' : '儲存'}
                           </button>
                        </div>
                      </div>
                   ) : (
                      <div className="max-h-60 overflow-y-auto border border-slate-100 rounded bg-slate-50 min-h-[100px]">
                        {isLoadingCloud ? (
                          <div className="p-4 text-center text-slate-400 text-sm flex items-center justify-center">
                            <Loader2 className="animate-spin mr-2" size={16} /> 載入中...
                          </div>
                        ) : cloudFiles.length === 0 ? (
                          <div className="p-4 text-center text-slate-400 text-sm">尚無檔案 (請確認 API Key 或 RLS 設定)</div>
                        ) : (
                          <ul className="divide-y divide-slate-100">
                             {cloudFiles.map(file => (
                               <li key={file.id} onClick={() => performCloudLoad(file)} className="p-3 hover:bg-white cursor-pointer transition-colors flex items-center justify-between group">
                                  <div className="flex items-center overflow-hidden">
                                     <div className="w-8 h-8 bg-indigo-50 rounded flex items-center justify-center text-indigo-400 mr-3 flex-shrink-0">
                                        <FileText size={16} />
                                     </div>
                                     <div className="min-w-0">
                                        <h4 className="font-medium text-slate-700 text-sm truncate">{file.name}</h4>
                                        <p className="text-xs text-slate-400">{new Date(file.updated_at).toLocaleDateString()}</p>
                                     </div>
                                  </div>
                                  <Check size={16} className="text-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                               </li>
                             ))}
                          </ul>
                        )}
                      </div>
                   )}
                 </>
               ) : (
                 <div className="text-center text-slate-400 py-4 text-sm">
                   請先輸入 API Key 才能存取雲端。
                 </div>
               )}
             </div>
          </div>
        </div>
      )}

      {/* Workspace */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar: Draw Tools */}
        <div className="w-20 bg-white border-r border-slate-200 flex flex-col items-center py-4 space-y-3 z-10 shadow-lg overflow-y-auto">
          <ToolButton id="pan" currentMode={mode} icon={Hand} label="平移" onClick={handleToolChange} />
          <div className="w-12 h-px bg-slate-200 my-1" />
          <ToolButton id="draw_poly" currentMode={mode} icon={PenTool} label="畫線" onClick={handleToolChange} />
          <ToolButton id="draw_fixed_h" currentMode={mode} icon={Minus} label="水平線" onClick={handleToolChange} />
          <ToolButton id="draw_fixed_v" currentMode={mode} icon={MoveVertical} label="垂直線" onClick={handleToolChange} />
          <ToolButton id="draw_fixed_a" currentMode={mode} icon={ArrowUpRight} label="角度線" onClick={handleToolChange} />
          <ToolButton id="draw_circle" currentMode={mode} icon={CircleIcon} label="畫圓" onClick={handleToolChange} />
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
            onPointerCancel={handlePointerUp}
            onContextMenu={handleContextMenu}
          >
            <defs>
              <pattern id="grid" width={GRID_SIZE} height={GRID_SIZE} patternUnits="userSpaceOnUse">
                <circle cx={1} cy={1} r={1} fill="#94a3b8" opacity={0.4} />
              </pattern>
            </defs>
            
            <g transform={`translate(${offset.x}, ${offset.y}) scale(${scale})`}>
              {/* Wallpaper Background */}
              <rect x={0} y={0} width={WALLPAPER_SIZE} height={WALLPAPER_SIZE} fill="white" />
              <rect x={0} y={0} width={WALLPAPER_SIZE} height={WALLPAPER_SIZE} fill="url(#grid)" />
              <rect x={0} y={0} width={WALLPAPER_SIZE} height={WALLPAPER_SIZE} fill="none" stroke="#cbd5e1" strokeWidth={2/scale} />

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
                  <line 
                    x1={line.x1} y1={line.y1} 
                    x2={line.x2} y2={line.y2} 
                    stroke="transparent" 
                    strokeWidth={12 / scale} 
                    className={`${mode === 'trim' ? 'cursor-alias hover:stroke-rose-500/20' : (mode === 'extend' ? 'cursor-alias hover:stroke-indigo-500/20' : 'cursor-pointer')}`}
                  />
                </g>
              ))}

              {/* Draw Circles */}
              {circles.map(circle => (
                <g key={circle.id} className="group">
                   <circle
                     cx={circle.cx}
                     cy={circle.cy}
                     r={circle.r}
                     stroke={circle.selected ? "#4f46e5" : "#0f172a"}
                     strokeWidth={1.5 / scale}
                     fill="transparent"
                     className="transition-colors duration-100"
                   />
                   <circle
                     cx={circle.cx}
                     cy={circle.cy}
                     r={circle.r}
                     stroke="transparent"
                     strokeWidth={12 / scale}
                     fill="transparent"
                     className="cursor-pointer"
                   />
                   {(circle.selected || mode === 'draw_poly') && (
                      <circle cx={circle.cx} cy={circle.cy} r={2/scale} fill="#f43f5e" opacity={0.5} />
                   )}
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
              
              {mode === 'draw_circle' && snapPos && (
                 <circle cx={snapPos.x} cy={snapPos.y} r={(parseFloat(paramLength) || 0) / 2} stroke="#4f46e5" strokeWidth={1/scale} fill="none" opacity={0.5} strokeDasharray={`${4/scale},${2/scale}`} />
              )}

              {snapPos && (
                <g transform={`translate(${snapPos.x}, ${snapPos.y})`}>
                  {snapPos.type === 'intersection' ? (
                     <g stroke="#f43f5e" strokeWidth={2/scale}>
                        <line x1={-6/scale} y1={-6/scale} x2={6/scale} y2={6/scale} />
                        <line x1={6/scale} y1={-6/scale} x2={-6/scale} y2={6/scale} />
                     </g>
                  ) : (
                    <rect 
                      x={-4 / scale} y={-4 / scale} 
                      width={8 / scale} height={8 / scale} 
                      fill="none" 
                      stroke={snapPos.type === 'endpoint' || snapPos.type === 'center' ? "#f43f5e" : "#4f46e5"} 
                      strokeWidth={2 / scale} 
                    />
                  )}
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