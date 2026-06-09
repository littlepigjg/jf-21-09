import { useRef } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Copy, Trash2, Plus, Clock, GripVertical } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';
import { imageDataToDataURL } from '@/utils/imageUtils';
import { cn } from '@/lib/utils';

interface SortableFrameItemProps {
  id: string;
  index: number;
}

function SortableFrameItem({ id, index }: SortableFrameItemProps) {
  const {
    frames,
    selectedFrameIndex,
    setSelectedFrameIndex,
    setCurrentFrameIndex,
    duplicateFrame,
    deleteFrame,
    setFrameDelay,
  } = useEditorStore();

  const frame = frames[index];
  const isSelected = index === selectedFrameIndex;
  const thumbnailRef = useRef<HTMLCanvasElement>(null);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleClick = () => {
    setSelectedFrameIndex(index);
    setCurrentFrameIndex(index);
  };

  const renderThumbnail = () => {
    const canvas = thumbnailRef.current;
    if (!canvas || !frame) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.putImageData(frame.imageData, 0, 0);
  };

  requestAnimationFrame(renderThumbnail);

  if (!frame) return null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={handleClick}
      className={cn(
        'group relative flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-all border-2',
        isSelected
          ? 'bg-violet-600/20 border-violet-500 shadow-lg shadow-violet-500/20'
          : 'bg-slate-800/50 border-transparent hover:bg-slate-700/50 hover:border-slate-600',
        isDragging && 'opacity-50 z-50'
      )}
    >
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-slate-500 hover:text-slate-300 transition-colors touch-none"
      >
        <GripVertical className="w-4 h-4" />
      </div>

      <div className="relative flex-shrink-0">
        <canvas
          ref={thumbnailRef}
          width={frame.width}
          height={frame.height}
          className="w-16 h-16 object-contain rounded bg-slate-900"
          style={{ imageRendering: 'pixelated' }}
        />
        <div className="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full bg-violet-600 text-white text-xs font-bold flex items-center justify-center shadow-md">
          {index + 1}
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 text-xs text-slate-400 mb-1">
          <Clock className="w-3 h-3" />
          <span className="font-mono">{frame.delay}ms</span>
        </div>
        <input
          type="range"
          min="10"
          max="5000"
          step="10"
          value={frame.delay}
          onChange={(e) => setFrameDelay(index, Number(e.target.value))}
          onClick={(e) => e.stopPropagation()}
          className="w-full h-1 bg-slate-700 rounded-full appearance-none cursor-pointer accent-violet-500"
        />
      </div>

      <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => {
            e.stopPropagation();
            duplicateFrame(index);
          }}
          className="p-1 hover:bg-slate-600 text-slate-400 hover:text-cyan-400 rounded transition-colors"
          title="复制帧"
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            deleteFrame(index);
          }}
          className="p-1 hover:bg-slate-600 text-slate-400 hover:text-orange-400 rounded transition-colors"
          title="删除帧"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

export default function FramePanel() {
  const { frames, addFrame, selectedFrameIndex, moveFrame } = useEditorStore();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = frames.findIndex((f) => f.id === active.id);
      const newIndex = frames.findIndex((f) => f.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        moveFrame(oldIndex, newIndex);
      }
    }
  };

  return (
    <div className="w-72 bg-slate-900/50 border-r border-slate-700 flex flex-col flex-shrink-0">
      <div className="p-3 border-b border-slate-700 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-200">帧列表</h3>
        <span className="text-xs text-slate-500 font-mono">{frames.length} 帧</span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {frames.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-500 text-sm py-8">
            <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center mb-3">
              <Plus className="w-8 h-8 text-slate-600" />
            </div>
            <p>暂无帧</p>
            <p className="text-xs text-slate-600 mt-1">点击导入按钮添加素材</p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={frames.map((f) => f.id)}
              strategy={verticalListSortingStrategy}
            >
              {frames.map((frame, index) => (
                <SortableFrameItem key={frame.id} id={frame.id} index={index} />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>

      <div className="p-2 border-t border-slate-700 space-y-2">
        <button
          onClick={() => addFrame(undefined, selectedFrameIndex)}
          disabled={frames.length === 0}
          className="w-full flex items-center justify-center gap-1.5 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-slate-200 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          添加空白帧
        </button>
      </div>
    </div>
  );
}
