import { useState, useRef } from 'react';
import { X, Upload, FileImage, Film, Images, Loader2 } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';
import { decodeGif } from '@/utils/gifDecoder';
import { loadImageFromFile, imageElementToImageData, generateId } from '@/utils/imageUtils';
import { extractFramesFromVideo } from '@/utils/videoExtractor';
import type { Frame } from '@/types';
import { cn } from '@/lib/utils';

interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
}

type ImportMode = 'gif' | 'video' | 'images';

export default function ImportDialog({ open, onClose }: ImportDialogProps) {
  const setFrames = useEditorStore((s) => s.setFrames);
  const [mode, setMode] = useState<ImportMode>('gif');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [videoFps, setVideoFps] = useState(10);
  const [videoMaxFrames, setVideoMaxFrames] = useState(60);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const imagesInputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const resetInputs = () => {
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (videoInputRef.current) videoInputRef.current.value = '';
    if (imagesInputRef.current) imagesInputRef.current.value = '';
  };

  const handleGifImport = async (file: File) => {
    setLoading(true);
    setError('');
    setProgress(0);
    try {
      const frames = await decodeGif(file);
      setFrames(frames);
      onClose();
    } catch (err) {
      setError('GIF 解析失败，请确保文件格式正确');
      console.error(err);
    } finally {
      setLoading(false);
      resetInputs();
    }
  };

  const handleVideoImport = async (file: File) => {
    setLoading(true);
    setError('');
    setProgress(0);
    try {
      const frames = await extractFramesFromVideo(file, {
        fps: videoFps,
        maxFrames: videoMaxFrames,
        onProgress: setProgress,
      });
      setFrames(frames);
      onClose();
    } catch (err) {
      setError('视频帧提取失败，请尝试其他文件');
      console.error(err);
    } finally {
      setLoading(false);
      resetInputs();
    }
  };

  const handleImagesImport = async (files: FileList) => {
    setLoading(true);
    setError('');
    setProgress(0);
    try {
      const fileArray = Array.from(files).sort((a, b) => a.name.localeCompare(b.name));
      const frames: Frame[] = [];

      for (let i = 0; i < fileArray.length; i++) {
        const file = fileArray[i];
        try {
          const img = await loadImageFromFile(file);
          const imageData = imageElementToImageData(img);
          frames.push({
            id: generateId(),
            imageData,
            delay: 100,
            width: imageData.width,
            height: imageData.height,
            disposalMethod: 2,
          });
          setProgress(Math.round(((i + 1) / fileArray.length) * 100));
          URL.revokeObjectURL(img.src);
        } catch (e) {
          console.warn('Skipping invalid image:', file.name);
        }
      }

      if (frames.length === 0) {
        setError('未找到有效的图片文件');
        return;
      }

      setFrames(frames);
      onClose();
    } catch (err) {
      setError('图片导入失败');
      console.error(err);
    } finally {
      setLoading(false);
      resetInputs();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (mode === 'gif') {
      handleGifImport(files[0]);
    } else if (mode === 'video') {
      handleVideoImport(files[0]);
    } else if (mode === 'images') {
      handleImagesImport(files);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold text-white">导入素材</h2>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div className="grid grid-cols-3 gap-2">
            {[
              { key: 'gif', label: 'GIF 文件', icon: FileImage, accept: '.gif' },
              { key: 'video', label: '视频文件', icon: Film, accept: '.mp4,.webm,.mov,.avi' },
              { key: 'images', label: '图片序列', icon: Images, accept: 'image/*' },
            ].map((item) => (
              <button
                key={item.key}
                onClick={() => setMode(item.key as ImportMode)}
                className={cn(
                  'flex flex-col items-center gap-2 py-4 px-2 rounded-xl border-2 transition-all',
                  mode === item.key
                    ? 'border-violet-500 bg-violet-500/10 text-violet-300'
                    : 'border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600 hover:text-slate-300'
                )}
              >
                <item.icon className="w-6 h-6" />
                <span className="text-xs font-medium">{item.label}</span>
              </button>
            ))}
          </div>

          {mode === 'video' && (
            <div className="bg-slate-800/50 rounded-xl p-4 space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-slate-400">提取帧率 (FPS)</label>
                  <span className="text-xs text-slate-300 font-mono">{videoFps}</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={30}
                  value={videoFps}
                  onChange={(e) => setVideoFps(Number(e.target.value))}
                  className="w-full h-1 bg-slate-700 rounded-full appearance-none cursor-pointer accent-violet-500"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-slate-400">最大帧数</label>
                  <span className="text-xs text-slate-300 font-mono">{videoMaxFrames}</span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={300}
                  step={10}
                  value={videoMaxFrames}
                  onChange={(e) => setVideoMaxFrames(Number(e.target.value))}
                  className="w-full h-1 bg-slate-700 rounded-full appearance-none cursor-pointer accent-violet-500"
                />
              </div>
            </div>
          )}

          <div
            onClick={() => {
              if (mode === 'gif') fileInputRef.current?.click();
              else if (mode === 'video') videoInputRef.current?.click();
              else imagesInputRef.current?.click();
            }}
            className="border-2 border-dashed border-slate-600 hover:border-violet-500 rounded-xl p-8 text-center cursor-pointer transition-colors group"
          >
            {loading ? (
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="w-10 h-10 text-violet-400 animate-spin" />
                <div className="text-slate-300">正在处理... {progress}%</div>
                <div className="w-full max-w-xs h-2 bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-violet-500 transition-all duration-200"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            ) : (
              <>
                <Upload className="w-10 h-10 text-slate-500 group-hover:text-violet-400 mx-auto mb-3 transition-colors" />
                <p className="text-slate-300 mb-1">点击选择文件或拖拽到此处</p>
                <p className="text-xs text-slate-500">
                  {mode === 'gif' && '支持 .gif 格式'}
                  {mode === 'video' && '支持 .mp4, .webm, .mov, .avi 格式'}
                  {mode === 'images' && '支持 PNG, JPG, WebP 等图片格式，可多选'}
                </p>
              </>
            )}
          </div>

          {error && (
            <div className="text-orange-400 text-sm text-center bg-orange-500/10 py-2 px-3 rounded-lg">
              {error}
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".gif"
            className="hidden"
            onChange={handleFileChange}
            disabled={loading}
          />
          <input
            ref={videoInputRef}
            type="file"
            accept=".mp4,.webm,.mov,.avi,video/*"
            className="hidden"
            onChange={handleFileChange}
            disabled={loading}
          />
          <input
            ref={imagesInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileChange}
            disabled={loading}
          />
        </div>
      </div>
    </div>
  );
}
