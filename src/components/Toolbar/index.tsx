import {
  FilePlus,
  Upload,
  Download,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Trash2,
  Gauge,
  Sparkles,
} from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';

export default function Toolbar() {
  const {
    frames,
    isPlaying,
    setIsPlaying,
    currentFrameIndex,
    setCurrentFrameIndex,
    setShowImportDialog,
    setShowExportDialog,
    playbackSpeed,
    setPlaybackSpeed,
    clearAll,
  } = useEditorStore();

  const handlePrevFrame = () => {
    const newIndex = currentFrameIndex > 0 ? currentFrameIndex - 1 : frames.length - 1;
    setCurrentFrameIndex(newIndex);
    useEditorStore.getState().setSelectedFrameIndex(newIndex);
  };

  const handleNextFrame = () => {
    const newIndex = currentFrameIndex < frames.length - 1 ? currentFrameIndex + 1 : 0;
    setCurrentFrameIndex(newIndex);
    useEditorStore.getState().setSelectedFrameIndex(newIndex);
  };

  const togglePlay = () => {
    if (frames.length === 0) return;
    setIsPlaying(!isPlaying);
  };

  return (
    <div className="h-14 bg-slate-900 border-b border-slate-700 flex items-center justify-between px-4 flex-shrink-0">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 mr-4">
          <Sparkles className="w-6 h-6 text-violet-400" />
          <span className="text-lg font-bold text-white tracking-tight font-mono">
            GIF Studio
          </span>
        </div>

        <button
          onClick={() => setShowImportDialog(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-sm font-medium transition-all hover:shadow-lg hover:shadow-violet-500/25"
        >
          <Upload className="w-4 h-4" />
          导入
        </button>

        <button
          onClick={() => clearAll()}
          disabled={frames.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
        >
          <FilePlus className="w-4 h-4" />
          新建
        </button>

        <button
          onClick={() => setShowExportDialog(true)}
          disabled={frames.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-all hover:shadow-lg hover:shadow-cyan-500/25"
        >
          <Download className="w-4 h-4" />
          导出 GIF
        </button>

        <button
          onClick={() => {
            if (frames.length > 0) {
              if (confirm('确定清空所有内容？')) clearAll();
            }
          }}
          disabled={frames.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors ml-2"
        >
          <Trash2 className="w-4 h-4" />
          清空
        </button>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1">
          <button
            onClick={handlePrevFrame}
            disabled={frames.length === 0}
            className="p-2 hover:bg-slate-700 disabled:opacity-50 text-slate-300 rounded-lg transition-colors"
          >
            <SkipBack className="w-5 h-5" />
          </button>

          <button
            onClick={togglePlay}
            disabled={frames.length === 0}
            className={`p-2.5 rounded-lg text-white transition-all disabled:opacity-50 ${
              isPlaying
                ? 'bg-orange-500 hover:bg-orange-400 hover:shadow-lg hover:shadow-orange-500/25'
                : 'bg-violet-600 hover:bg-violet-500 hover:shadow-lg hover:shadow-violet-500/25'
            }`}
          >
            {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
          </button>

          <button
            onClick={handleNextFrame}
            disabled={frames.length === 0}
            className="p-2 hover:bg-slate-700 disabled:opacity-50 text-slate-300 rounded-lg transition-colors"
          >
            <SkipForward className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center gap-2 bg-slate-800 px-3 py-1.5 rounded-lg">
          <Gauge className="w-4 h-4 text-cyan-400" />
          <select
            value={playbackSpeed}
            onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
            className="bg-transparent text-slate-200 text-sm outline-none cursor-pointer"
          >
            <option value={0.25} className="bg-slate-800">0.25x</option>
            <option value={0.5} className="bg-slate-800">0.5x</option>
            <option value={1} className="bg-slate-800">1x</option>
            <option value={1.5} className="bg-slate-800">1.5x</option>
            <option value={2} className="bg-slate-800">2x</option>
            <option value={4} className="bg-slate-800">4x</option>
          </select>
        </div>

        <div className="text-sm text-slate-400 font-mono">
          {frames.length > 0 ? (
            <span>
              <span className="text-violet-400">{currentFrameIndex + 1}</span>
              <span className="mx-1">/</span>
              <span>{frames.length}</span>
              <span className="ml-3 text-slate-500">帧</span>
            </span>
          ) : (
            <span className="text-slate-500">暂无帧</span>
          )}
        </div>
      </div>
    </div>
  );
}
