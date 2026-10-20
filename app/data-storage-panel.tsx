"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { Archive, Download, Eye, HardDrive, Loader2, Upload } from "lucide-react";
import type { AppData } from "@/lib/fat-loss";
import { localStorageUsage } from "@/lib/photo-storage";
import { backupCounts, inspectBackup, type PreparedBackup } from "@/lib/zip-backup";

export function formatBytes(bytes: number) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function DataStoragePanel({ data, isDemo, busy, progress, onExport, onRestore, onError, getCloudUsage }: {
  data: AppData; isDemo: boolean; busy: boolean; progress: string;
  onExport: () => Promise<void>;
  onRestore: (backup: PreparedBackup, recordsOnly: boolean) => Promise<boolean>;
  onError: (message: string) => void;
  getCloudUsage: () => Promise<Awaited<ReturnType<typeof localStorageUsage>>>;
}) {
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof localStorageUsage>> | null>(null);
  const [prepared, setPrepared] = useState<PreparedBackup | null>(null);
  const [filename, setFilename] = useState("");
  const [mode, setMode] = useState<"view" | "restore">("view");
  const [reading, setReading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let cancelled = false;
    async function updateUsage() {
      try {
        const stats = isDemo ? await localStorageUsage(data) : await getCloudUsage();
        if (!cancelled) setUsage(stats);
      } catch { if (!cancelled) setUsage(null); }
    }
    void updateUsage();
    return () => { cancelled = true; };
  }, [data, isDemo]); // eslint-disable-line react-hooks/exhaustive-deps

  async function readFile(file?: File) {
    if (!file) return;
    setReading(true);
    try {
      const result = await inspectBackup(file, file.name);
      setFilename(file.name);
      setPrepared(result);
    } catch (error) {
      onError(error instanceof Error ? error.message : "备份文件无法读取，现有记录未修改。");
    } finally { setReading(false); }
  }
  const quotaWarning = usage?.quota && usage.usage !== null && usage.usage / usage.quota > 0.85;
  return (
    <section className="border-t border-[#eadfcf] pt-5">
      <h3 className="flex items-center gap-2 text-lg font-bold"><HardDrive className="h-5 w-5" />数据存储使用情况</h3>
      <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3 text-sm sm:grid-cols-4">
        <div><dt className="text-[#667165]">记录数量</dt><dd className="mt-1 font-bold">{usage?.records ?? backupCounts(data).weights + backupCounts(data).meals + backupCounts(data).exercises + backupCounts(data).checkins + backupCounts(data).summaries} 条</dd></div>
        <div><dt className="text-[#667165]">关联照片</dt><dd className="mt-1 font-bold">{usage?.photoCount ?? backupCounts(data).photos} 张</dd></div>
        <div><dt className="text-[#667165]">照片存储</dt><dd className="mt-1 font-bold">{usage ? formatBytes(usage.photoBytes) : "正在统计"}</dd></div>
        <div><dt className="text-[#667165]">记录容量估计</dt><dd className="mt-1 font-bold">{usage ? formatBytes(usage.recordBytes) : "正在统计"}</dd></div>
      </dl>
      {isDemo && usage && <p className="mt-3 text-sm text-[#667165]">本地保存 {usage.storedPhotoCount} 份照片内容；删除关联后的照片仍保留，不会自动清理。{usage.quota ? `设备总用量约 ${formatBytes(usage.usage || 0)} / ${formatBytes(usage.quota)}。` : "设备暂未提供容量上限。"}</p>}
      {!isDemo && <p className="mt-3 text-sm text-[#667165]">云端保留 {usage?.storedPhotoCount ?? "待统计"} 份照片。未带大小信息的旧照片不计入容量估计；云端上限以项目配置为准，配额不足时上传会停止，不会自动删数据。</p>}
      {quotaWarning && <p role="alert" className="mt-3 border-l-4 border-amber-600 bg-amber-50 p-3 text-sm text-amber-900">设备存储接近容量上限，请先导出完整 ZIP 备份。历史记录和照片不会自动删除。</p>}
      <h3 className="mt-6 flex items-center gap-2 text-lg font-bold"><Archive className="h-5 w-5" />完整 ZIP 备份</h3>
      <p className="mt-2 text-sm leading-6 text-[#667165]">包含记录、个人设置、营养分析、AI 建议和实际照片文件。恢复采用合并方式，并先导出恢复前备份。</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button disabled={busy || reading} onClick={() => void onExport()} className="flex min-h-11 items-center gap-2 rounded-md border border-[#d9ccb8] bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50"><Download className="h-4 w-4" />导出完整 ZIP 备份</button>
        <button disabled={busy || reading} onClick={() => { setMode("restore"); fileInput.current?.click(); }} className="flex min-h-11 items-center gap-2 rounded-md border border-[#d9ccb8] bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50"><Upload className="h-4 w-4" />导入 ZIP 备份</button>
        <button disabled={busy || reading} onClick={() => { setMode("view"); fileInput.current?.click(); }} className="flex min-h-11 items-center gap-2 rounded-md border border-[#d9ccb8] bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50"><Eye className="h-4 w-4" />查看备份内容</button>
        <input ref={fileInput} aria-label="选择 ZIP 或旧 JSON 备份" type="file" accept=".zip,.json,application/zip,application/json" className="sr-only" onChange={(event) => { void readFile(event.target.files?.[0]); event.target.value = ""; }} />
      </div>
      <p className="mt-3 text-xs text-[#667165]">支持导入此前的 JSON 备份。完整 ZIP 可用 Windows、macOS 的常见解压工具打开。</p>
      {(reading || busy) && <p role="status" className="mt-3 flex items-center gap-2 text-sm text-[#315a3c]"><Loader2 className="h-4 w-4 animate-spin" />{reading ? "正在读取并校验备份，现有数据未修改" : progress || "正在处理备份"}</p>}
      {prepared && <BackupPreview backup={prepared} filename={filename} mode={mode} busy={busy} onCancel={() => { if (!busy) setPrepared(null); }} onRestore={async (recordsOnly) => { if (await onRestore(prepared, recordsOnly)) setPrepared(null); }} />}
    </section>
  );
}

function BackupPreview({ backup, filename, mode, busy, onCancel, onRestore }: {
  backup: PreparedBackup; filename: string; mode: "view" | "restore"; busy: boolean; onCancel: () => void; onRestore: (recordsOnly: boolean) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [recordsOnly, setRecordsOnly] = useState(false);
  const [previews, setPreviews] = useState<string[]>([]);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    const urls = [...backup.photos.values()].slice(0,4).map((blob) => URL.createObjectURL(blob));
    const timer = window.setTimeout(() => setPreviews(urls),0);
    return () => { window.clearTimeout(timer); element?.close(); urls.forEach((url) => URL.revokeObjectURL(url)); };
  }, [backup]);
  const counts = backupCounts(backup.data);
  return (
    <dialog ref={dialog} aria-labelledby="backup-preview-title" onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }} className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-lg border border-[#eadfcf] bg-white p-5 text-[#25342f] backdrop:bg-black/40">
      <h3 id="backup-preview-title" className="text-lg font-bold">{mode === "view" ? "查看备份内容" : "确认合并恢复"}</h3>
      <p className="mt-2 break-all text-sm text-[#667165]">{filename}</p>
      <p className="mt-1 text-sm text-[#667165]">{backup.manifest ? `V2 ZIP · ${new Date(backup.manifest.exported_at).toLocaleString("zh-CN")}` : "V1 JSON 兼容备份"}</p>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <dt>体重 / 饮食</dt><dd>{counts.weights} / {counts.meals} 条</dd>
        <dt>运动 / 打卡</dt><dd>{counts.exercises} / {counts.checkins} 条</dd>
        <dt>AI 总结</dt><dd>{counts.summaries} 条</dd>
        <dt>照片文件</dt><dd>{backup.photos.size} / {counts.photos} 张</dd>
        {Boolean(backup.retainedPhotos?.size) && <><dt>保留的未关联照片</dt><dd>{backup.retainedPhotos!.size} 份</dd></>}
        <dt>校验状态</dt><dd>{backup.format === "zip" ? "文件清单、SHA-256、关联校验通过" : "JSON 记录格式通过"}</dd>
      </dl>
      {previews.length > 0 && <div className="mt-4 grid grid-cols-4 gap-2">{previews.map((url) => <img key={url} src={url} alt="备份餐食照片预览" className="aspect-square w-full rounded object-cover" />)}</div>}
      {backup.manifest && <details className="mt-4 text-sm"><summary className="cursor-pointer font-semibold">文件清单（{backup.manifest.files.length} 个）</summary><ul className="mt-2 max-h-40 overflow-auto text-xs text-[#667165]">{backup.manifest.files.map((file) => <li key={file.path} className="break-all py-1">{file.path} · {formatBytes(file.bytes)}</li>)}</ul></details>}
      {backup.warnings.map((warning) => <p key={warning} className="mt-3 text-sm leading-6 text-amber-800">{warning}</p>)}
      {mode === "restore" && <>
        <p className="mt-4 text-sm leading-6 text-[#667165]">原有未重复记录与照片会保留。相同日期的体重、打卡、总结以及相同 ID 的记录采用备份内容，个人设置也会恢复。确认后先导出当前完整备份，再开始恢复。</p>
        {backup.missingImageIds.length > 0 && <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={recordsOnly} onChange={(event) => setRecordsOnly(event.target.checked)} className="mt-1" />仅合并记录，忽略此 JSON 未包含的照片文件；保留已有照片</label>}
      </>}
      <div className="mt-5 flex flex-wrap justify-end gap-3">
        <button autoFocus disabled={busy} onClick={onCancel} className="min-h-11 rounded-md border border-[#d9ccb8] px-4 py-2 text-sm font-semibold disabled:opacity-50">{mode === "view" ? "关闭" : "取消"}</button>
        {mode === "restore" && <button disabled={busy || (backup.missingImageIds.length > 0 && !recordsOnly)} onClick={() => void onRestore(recordsOnly)} className="flex min-h-11 items-center gap-2 rounded-md bg-[#4f8d5f] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}合并恢复</button>}
      </div>
    </dialog>
  );
}
