import { useState, useEffect } from 'react';
import { X, Download, Loader2, FileImage, Gauge, Palette, Sparkles } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';
import { exportGif, downloadBlob, type ExportProgress } from '@/utils/gifEncoder';
import { formatFileSize } from '@/utils/imageUtils';

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function ExportDialog({ open, onClose }: ExportDialogProps) {
  const { frames, captions, crop, exportConfig, setExportConfig } = useEditorStore();
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<ExportProgress>({ current: 0, total: 0, percent: 0 });
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setExporting(false);
      setProgress({ current: 0, total: 0, percent: 0 });
      setResultBlob(null);
      setError('');
    }
  }, [open]);

  if (!open) return null;

  const handleExport = async () => {
    setExporting(true);
    setError('');
    setResultBlob(null);
    try {
      const blob = await exportGif(frames, captions, crop, exportConfig, setProgress);
      setResultBlob(blob);
    } catch (err) {
      setError('导出失败，请重试');
      console.error(err);
    } finally {
      setExporting(false);
    }
  };

  const handleDownload = () => {
    if (resultBlob) {
      const filename = `gif-${Date.now()}.gif`;
      downloadBlob(resultBlob, filename);
    }
  };

  const estimatedSize = (() => {
    if (frames.length === 0) return 0;
    const { width, height } = exportConfig;
    const w = width || frames[0]?.width || 640;
    const h = height || frames[0]?.height || 480;
    const bitsPerPixel = Math.log2(exportConfig.colors);
    const rawBytes = (w * h * bitsPerPixel * frames.length) / 8;
    const compressionRatio = 1 / (exportConfig.quality / 50 + 0.5);
    return Math.round(rawBytes * compressionRatio * 0.3);
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-xl mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-violet-400" />
            导出 GIF
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-800/50 rounded-xl p-4">
              <div className="flex items-center gap-2 text-slate-400 text-xs mb-2">
                <FileImage className="w-4 h-4" />
                帧数
              </div>
              <div className="text-2xl font-bold text-white font-mono">{frames.length}</div>
            </div>
            <div className="bg-slate-800/50 rounded-xl p-4">
              <div className="flex items-center gap-2 text-slate-400 text-xs mb-2">
                <Gauge className="w-4 h-4" />
                预估大小
              </div>
              <div className="text-2xl font-bold text-cyan-400 font-mono">
                {formatFileSize(estimatedSize)}
              </div>
            </div>
          </div>

          <div className="space-y-4 bg-slate-800/30 rounded-xl p-4">
            <h3 className="text-sm font-medium text-slate-200 flex items-center gap-2">
              <Palette className="w-4 h-4 text-emerald-400" />
              导出参数
            </h3>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-slate-400">颜色数量</label>
                  <span className="text-xs text-slate-300 font-mono">{exportConfig.colors}</span>
                </div>
                <input
                  type="range"
                  min={2}
                  max={256}
                  step={1}
                  value={exportConfig.colors}
                  onChange={(e) => setExportConfig({ colors: Number(e.target.value) })}
                  className="w-full h-1 bg-slate-700 rounded-full appearance-none cursor-pointer accent-emerald-500"
                  disabled={exporting}
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-slate-400">质量</label>
                  <span className="text-xs text-slate-300 font-mono">{exportConfig.quality}%</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={100}
                  step={1}
                  value={exportConfig.quality}
                  onChange={(e) => setExportConfig({ quality: Number(e.target.value) })}
                  className="w-full h-1 bg-slate-700 rounded-full appearance-none cursor-pointer accent-emerald-500"
                  disabled={exporting}
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-slate-400">输出帧率 (FPS)</label>
                <span className="text-xs text-slate-300 font-mono">{exportConfig.fps}</span>
              </div>
              <input
                type="range"
                min={1}
                max={60}
                step={1}
                value={exportConfig.fps}
                onChange={(e) => setExportConfig({ fps: Number(e.target.value) })}
                className="w-full h-1 bg-slate-700 rounded-full appearance-none cursor-pointer accent-emerald-500"
                disabled={exporting}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-slate-400 block mb-1">输出宽度</label>
                <input
                  type="number"
                  value={exportConfig.width || frames[0]?.width || 0}
                  onChange={(e) => setExportConfig({ width: Number(e.target.value) })}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500"
                  min={1}
                  disabled={exporting}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">输出高度</label>
                <input
                  type="number"
                  value={exportConfig.height || frames[0]?.height || 0}
                  onChange={(e) => setExportConfig({ height: Number(e.target.value) })}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500"
                  min={1}
                  disabled={exporting}
                />
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={exportConfig.dither}
                onChange={(e) => setExportConfig({ dither: e.target.checked })}
                className="w-4 h-4 rounded border-slate-600 text-emerald-600 focus:ring-emerald-500 bg-slate-900"
                disabled={exporting}
              />
              <span className="text-sm text-slate-300">启用颜色抖动 (提升视觉效果)</span>
            </label>
          </div>

          {exporting && (
            <div className="bg-violet-500/10 rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-violet-300">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="text-sm font-medium">正在生成 GIF...</span>
                </div>
                <span className="text-sm text-violet-400 font-mono">{progress.percent}%</span>
              </div>
              <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-violet-500 to-cyan-500 transition-all duration-200"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
              {progress.total > 0 && (
                <p className="text-xs text-slate-400 text-center font-mono">
                  第 {progress.current} / {progress.total} 帧
                </p>
              )}
            </div>
          )}

          {resultBlob && !exporting && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-emerald-400 text-sm font-medium">导出成功!</span>
                <span className="text-emerald-300 font-mono text-lg font-bold">
                  {formatFileSize(resultBlob.size)}
                </span>
              </div>
              <button
                onClick={handleDownload}
                className="w-full flex items-center justify-center gap-2 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-medium transition-all hover:shadow-lg hover:shadow-emerald-500/25"
              >
                <Download className="w-5 h-5" />
                下载 GIF 文件
              </button>
            </div>
          )}

          {error && (
            <div className="text-orange-400 text-sm text-center bg-orange-500/10 py-3 px-4 rounded-xl">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-slate-700 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-medium transition-colors"
          >
            关闭
          </button>
          {!resultBlob && (
            <button
              onClick={handleExport}
              disabled={exporting || frames.length === 0}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-gradient-to-r from-violet-600 to-cyan-600 hover:from-violet-500 hover:to-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-medium transition-all hover:shadow-lg hover:shadow-violet-500/25"
            >
              {exporting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  导出中...
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5" />
                  开始导出
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
