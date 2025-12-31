import React from 'react';
import { LucideIcon } from 'lucide-react';
import { ToolMode } from '../types';

interface ToolButtonProps {
  id: ToolMode;
  currentMode: ToolMode;
  icon: LucideIcon;
  label: string;
  onClick: (id: ToolMode) => void;
}

export const ToolButton: React.FC<ToolButtonProps> = ({ id, currentMode, icon: Icon, label, onClick }) => (
  <button 
    onClick={() => onClick(id)} 
    className={`p-2 flex flex-col items-center justify-center border rounded w-16 h-16 text-[10px] transition-all duration-200 ${
      currentMode === id 
        ? 'bg-indigo-600 text-white border-indigo-700 shadow-inner' 
        : 'bg-white hover:bg-slate-50 text-slate-500 border-slate-200 hover:border-slate-300 shadow-sm'
    }`}
  >
    <Icon size={18} className="mb-1" />
    <span className="text-center leading-tight">{label}</span>
  </button>
);
