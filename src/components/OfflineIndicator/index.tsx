import { Wifi, WifiOff, RefreshCw, Cloud, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useOfflineStore } from '@/stores/offlineStore';

export default function OfflineIndicator() {
  const { networkStatus, syncStatus, syncPendingCount, manualSync } = useOfflineStore();

  const isOnline = networkStatus?.isOnline ?? true;

  const getSyncIcon = () => {
    switch (syncStatus) {
      case 'syncing':
        return <RefreshCw className="w-3.5 h-3.5 animate-spin" />;
      case 'error':
        return <AlertTriangle className="w-3.5 h-3.5" />;
      case 'success':
        return <CheckCircle2 className="w-3.5 h-3.5" />;
      default:
        return <Cloud className="w-3.5 h-3.5" />;
    }
  };

  const getSyncColor = () => {
    switch (syncStatus) {
      case 'syncing':
        return 'text-cyan-400';
      case 'error':
        return 'text-orange-400';
      case 'success':
        return 'text-emerald-400';
      default:
        return 'text-slate-400';
    }
  };

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}小时${minutes % 60}分`;
    if (minutes > 0) return `${minutes}分${seconds % 60}秒`;
    return `${seconds}秒`;
  };

  return (
    <div className="flex items-center gap-3">
      <div
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
          isOnline
            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
            : 'bg-orange-500/10 text-orange-400 border border-orange-500/20'
        }`}
        title={
          isOnline
            ? '已连接网络'
            : `离线模式 - 已持续${
                networkStatus?.since ? formatDuration(Date.now() - networkStatus.since) : ''
              }`
        }
      >
        {isOnline ? (
          <Wifi className="w-3.5 h-3.5" />
        ) : (
          <WifiOff className="w-3.5 h-3.5" />
        )}
        <span>{isOnline ? '在线' : '离线'}</span>
      </div>

      <button
        onClick={() => manualSync()}
        disabled={syncStatus === 'syncing' || !isOnline}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors border ${
          syncStatus === 'syncing' || !isOnline
            ? 'bg-slate-800 text-slate-500 border-slate-700 cursor-not-allowed'
            : `bg-slate-800/50 border-slate-700 hover:bg-slate-700 ${getSyncColor()}`
        }`}
        title={
          syncStatus === 'syncing'
            ? '正在同步...'
            : syncPendingCount > 0
            ? `${syncPendingCount} 个操作待同步 - 点击立即同步`
            : '点击手动同步'
        }
      >
        {getSyncIcon()}
        <span>
          {syncStatus === 'syncing'
            ? '同步中'
            : syncStatus === 'error'
            ? '同步失败'
            : syncStatus === 'success'
            ? '已同步'
            : syncPendingCount > 0
            ? `待同步 (${syncPendingCount})`
            : '已同步'}
        </span>
      </button>
    </div>
  );
}
