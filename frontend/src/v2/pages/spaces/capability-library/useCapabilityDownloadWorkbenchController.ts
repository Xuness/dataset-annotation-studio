import {
  useTagDictionaryDownloadActions,
  useTagDictionaryDownloadCenter,
  useTagDictionaryDownloadTasks,
} from "../../../../features/tagDictionaries/hooks";
import {
  useTaggerDownloadActions,
  useTaggerDownloadCenter,
  useTaggerDownloadTasks,
} from "../../../../features/taggers/hooks";
import type {
  TagDictionaryDownloadOffer,
  TagDictionaryDownloadTask,
  TaggerDownloadOffer,
  TaggerDownloadTask,
} from "../../../../shared/api/types";
import { openExternalUrl } from "../../../../shared/desktop/openExternalUrl";
import { formatBytes } from "../../../../shared/format/bytes";
import type {
  CapabilityDownloadCategoryId,
  CapabilityDownloadOfferItem,
  CapabilityDownloadTaskItem,
  CapabilityDownloadWorkbenchContent,
} from "./capabilityLibraryModel";

interface UseCapabilityDownloadWorkbenchControllerOptions {
  categoryId: CapabilityDownloadCategoryId;
  onReturnCategory(): void;
  onReturnOverview(): void;
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "下载中心当前不可用。";
}

function progress(bytesDownloaded: number, bytesTotal: number, status: string): number {
  if (status === "completed") return 100;
  if (bytesTotal <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((bytesDownloaded / bytesTotal) * 100)));
}

function taggerOffer(offer: TaggerDownloadOffer): CapabilityDownloadOfferItem {
  const state: CapabilityDownloadOfferItem["state"] = offer.installed_installation_id
    ? "installed"
    : offer.active_download_id
      ? "active"
      : "available";
  return {
    id: offer.plan_id,
    label: offer.name,
    detail: `${offer.adapter_name} // ${offer.model_version}`,
    description: offer.description,
    sourceLabel: offer.repo_id,
    revision: offer.revision,
    size: formatBytes(offer.download_size),
    licenseLabel: offer.gated ? `${offer.license_id} // GATED` : offer.license_id,
    state,
    canStart: state === "available",
    sourceUrl: offer.source_url,
    licenseUrl: offer.license_url,
  };
}

function dictionaryOffer(offer: TagDictionaryDownloadOffer): CapabilityDownloadOfferItem {
  const state: CapabilityDownloadOfferItem["state"] = offer.installed_installation_id
    ? "installed"
    : offer.active_download_id
      ? "active"
      : offer.download_mode === "manual"
        ? "manual"
        : "available";
  return {
    id: offer.offer_id,
    label: offer.name,
    detail: `${offer.adapter_id.toUpperCase()} // ${offer.source_version}`,
    description: offer.description,
    sourceLabel: offer.source_id,
    revision: offer.revision || offer.source_version,
    size: offer.download_size ? formatBytes(offer.download_size) : "MANUAL SOURCE",
    licenseLabel: `${offer.license_id} // ${offer.license_status.toUpperCase()}`,
    state,
    canStart: state === "available",
    sourceUrl: offer.source_url,
    licenseUrl: offer.license_url,
  };
}

function taggerTask(task: TaggerDownloadTask): CapabilityDownloadTaskItem {
  return {
    id: task.id,
    label: task.plan_name,
    detail: `${task.repo_id} // ${task.revision}`,
    status: task.status,
    progress: progress(task.bytes_downloaded, task.bytes_total, task.status),
    transferred: `${formatBytes(task.bytes_downloaded)} / ${formatBytes(task.bytes_total)}`,
    currentFile: task.current_file ?? null,
    error: task.error_message ?? null,
    canPause: task.can_pause,
    canResume: task.can_resume,
    canRemove: task.can_delete,
  };
}

function dictionaryTask(task: TagDictionaryDownloadTask): CapabilityDownloadTaskItem {
  return {
    id: task.id,
    label: task.offer_name,
    detail: `${task.source_id} // ${task.source_version}`,
    status: task.status,
    progress: progress(task.bytes_downloaded, task.bytes_total, task.status),
    transferred: `${formatBytes(task.bytes_downloaded)} / ${formatBytes(task.bytes_total)}`,
    currentFile: task.current_file ?? null,
    error: task.error_message ?? null,
    canPause: task.can_pause,
    canResume: task.can_resume,
    canRemove: task.can_delete,
  };
}

export function useCapabilityDownloadWorkbenchController({
  categoryId,
  onReturnCategory,
  onReturnOverview,
}: UseCapabilityDownloadWorkbenchControllerOptions): CapabilityDownloadWorkbenchContent {
  const tagger = categoryId === "taggers";
  const taggerCenter = useTaggerDownloadCenter(tagger);
  const taggerTasks = useTaggerDownloadTasks(tagger);
  const dictionaryCenter = useTagDictionaryDownloadCenter(!tagger);
  const dictionaryTasks = useTagDictionaryDownloadTasks(!tagger);
  const taggerActions = useTaggerDownloadActions();
  const dictionaryActions = useTagDictionaryDownloadActions();
  const center = tagger ? taggerCenter : dictionaryCenter;
  const taskQuery = tagger ? taggerTasks : dictionaryTasks;
  const offers = tagger
    ? (taggerCenter.data?.offers ?? []).map(taggerOffer)
    : (dictionaryCenter.data?.offers ?? []).map(dictionaryOffer);
  const tasks = tagger
    ? (taggerTasks.data ?? taggerCenter.data?.tasks ?? []).map(taggerTask)
    : (dictionaryTasks.data ?? dictionaryCenter.data?.tasks ?? []).map(dictionaryTask);
  const pending = tagger
    ? taggerActions.create.isPending ||
      taggerActions.pause.isPending ||
      taggerActions.resume.isPending ||
      taggerActions.remove.isPending
    : dictionaryActions.create.isPending ||
      dictionaryActions.pause.isPending ||
      dictionaryActions.resume.isPending ||
      dictionaryActions.remove.isPending;
  const status: CapabilityDownloadWorkbenchContent["status"] =
    center.isPending || taskQuery.isPending
      ? "loading"
      : center.isError || taskQuery.isError
        ? "error"
        : "ready";
  const message = center.isError
    ? errorMessage(center.error)
    : taskQuery.isError
      ? errorMessage(taskQuery.error)
      : null;
  const findOffer = (offerId: string) => offers.find((offer) => offer.id === offerId);

  return {
    kind: "capability-download-workbench",
    status,
    categoryId,
    code: tagger ? "TAG" : "DIC",
    label: tagger ? "模型下载中心" : "词典下载中心",
    englishLabel: tagger ? "Tagger Download Center" : "Dictionary Download Center",
    description: tagger
      ? "浏览内置模型目录与 Hugging Face 来源，并管理可恢复的下载任务。"
      : "浏览在线词典目录与来源授权，并管理词典安装任务。",
    offers,
    tasks,
    pending,
    message,
    startOffer: async (offerId) => {
      const offer = findOffer(offerId);
      if (!offer?.canStart) return;
      if (tagger) {
        await taggerActions.create.mutateAsync({ planId: offerId, licenseAccepted: true });
      } else {
        await dictionaryActions.create.mutateAsync(offerId);
      }
    },
    pauseTask: async (taskId) => {
      if (tagger) await taggerActions.pause.mutateAsync(taskId);
      else await dictionaryActions.pause.mutateAsync(taskId);
    },
    resumeTask: async (taskId) => {
      if (tagger) await taggerActions.resume.mutateAsync(taskId);
      else await dictionaryActions.resume.mutateAsync(taskId);
    },
    removeTask: async (taskId) => {
      if (tagger) await taggerActions.remove.mutateAsync(taskId);
      else await dictionaryActions.remove.mutateAsync(taskId);
    },
    openSource: async (offerId) => {
      const offer = findOffer(offerId);
      if (offer?.sourceUrl) await openExternalUrl(offer.sourceUrl);
    },
    openLicense: async (offerId) => {
      const offer = findOffer(offerId);
      if (offer?.licenseUrl) await openExternalUrl(offer.licenseUrl);
    },
    refresh: () => {
      void Promise.all([center.refetch(), taskQuery.refetch()]);
    },
    returnCategory: onReturnCategory,
    returnOverview: onReturnOverview,
  };
}
