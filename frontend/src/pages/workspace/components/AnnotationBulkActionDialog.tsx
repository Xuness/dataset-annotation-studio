import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  BadgeCheck,
  CircleAlert,
  FileText,
  Languages,
  Tags as TagsIcon,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";

import {
  useAnnotationBatchOptions,
  useDeleteAnnotations,
  useReviewAnnotations,
} from "../../../features/annotations/hooks";
import type {
  AnnotationBatchTargetOption,
  AnnotationChannel,
  AnnotationChannelTarget,
} from "../../../shared/api/types";
import { Button } from "../../../shared/ui/Button";
import { ModalLayer } from "../../../shared/ui/ModalLayer";
import { Spinner } from "../../../shared/ui/Spinner";

export type AnnotationBulkAction = "review" | "delete";

interface AnnotationBulkActionDialogProps {
  projectId: string;
  open: boolean;
  action: AnnotationBulkAction;
  assetIds: string[];
  blockedTarget: AnnotationChannelTarget | null;
  onClose: () => void;
}

const CHANNEL_ICONS: Record<AnnotationChannel, LucideIcon> = {
  existing_annotation: Archive,
  tags: TagsIcon,
  description: FileText,
  translation: Languages,
};

function targetKey(target: Pick<AnnotationChannelTarget, "channel" | "language">): string {
  return `${target.channel}:${target.language}`;
}

function optionKey(option: AnnotationBatchTargetOption): string {
  return targetKey({ channel: option.channel, language: option.language ?? "" });
}

export function AnnotationBulkActionDialog({
  projectId,
  open,
  action,
  assetIds,
  blockedTarget,
  onClose,
}: AnnotationBulkActionDialogProps) {
  const assetIdsKey = assetIds.join("\u0000");
  const options = useAnnotationBatchOptions(projectId, assetIds, open);
  const review = useReviewAnnotations(projectId);
  const remove = useDeleteAnnotations(projectId);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const busy = review.isPending || remove.isPending;
  const blockedKey = blockedTarget ? targetKey(blockedTarget) : null;

  useEffect(() => {
    if (!open) return;
    setSelectedKeys(new Set());
    setActionError(null);
    setNotice(null);
  }, [action, assetIdsKey, open]);

  const selectableOptions = useMemo(
    () =>
      (options.data?.targets ?? []).filter(
        (option) =>
          optionKey(option) !== blockedKey && (action === "delete" || option.reviewable_count > 0),
      ),
    [action, blockedKey, options.data?.targets],
  );
  const allSelectableSelected =
    selectableOptions.length > 0 &&
    selectableOptions.every((option) => selectedKeys.has(optionKey(option)));
  const selectedOptions = (options.data?.targets ?? []).filter((option) =>
    selectedKeys.has(optionKey(option)),
  );
  const blockedOption = options.data?.targets.find((option) => optionKey(option) === blockedKey);

  function toggleOption(key: string) {
    setNotice(null);
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    setNotice(null);
    setSelectedKeys(
      allSelectableSelected
        ? new Set()
        : new Set(selectableOptions.map((option) => optionKey(option))),
    );
  }

  async function executeAction() {
    if (!selectedOptions.length) return;
    const targets = selectedOptions.map<AnnotationChannelTarget>((option) => ({
      channel: option.channel,
      language: option.language ?? "",
    }));
    setActionError(null);
    setNotice(null);
    try {
      if (action === "review") {
        const result = await review.mutateAsync({ assetIds, targets });
        setNotice(
          `已复核 ${result.reviewed_count} 个标注文档；${result.already_reviewed_count} 个原本已复核，${result.missing_count} 个目标位置没有活动标注。`,
        );
      } else {
        const result = await remove.mutateAsync({ assetIds, targets });
        setNotice(
          `已删除 ${result.deleted_count} 个活动标注通道；${result.missing_count} 张图片没有所选类别的活动标注。`,
        );
      }
      setSelectedKeys(new Set());
    } catch (reason) {
      setActionError(
        reason instanceof Error
          ? reason.message
          : action === "review"
            ? "批量复核标注失败。"
            : "批量删除标注失败。",
      );
    }
  }

  function close() {
    if (!busy) onClose();
  }

  const title = action === "review" ? "选择要复核的标注" : "选择要删除的标注";
  const actionLabel = action === "review" ? "标记所选类别" : "删除所选类别";

  return (
    <ModalLayer
      open={open}
      onClose={close}
      backdropClassName="annotation-bulk-backdrop"
      panelClassName="annotation-bulk-dialog"
      labelledBy="annotation-bulk-title"
      initialFocusSelector="[data-annotation-bulk-close]"
    >
      <header>
        <div>
          <span className="eyebrow">Annotation scope</span>
          <h2 id="annotation-bulk-title">{title}</h2>
        </div>
        <button
          type="button"
          data-annotation-bulk-close=""
          aria-label="关闭"
          disabled={busy}
          onClick={close}
        >
          <X size={17} />
        </button>
      </header>

      <div className="annotation-bulk-dialog__intro">
        <p>
          已选择 <strong>{assetIds.length}</strong> 张图片。
          {action === "review"
            ? " 勾选要标记为人工复核的当前版本；不会修改标注内容。"
            : " 勾选要删除的当前标注类别；删除修订会写入数据库，历史版本仍会保留。"}
        </p>
        <small>仅列出所选图片中实际存在的类别；翻译按语言独立选择。</small>
      </div>

      <div className="annotation-bulk-dialog__toolbar">
        <strong>标注类别</strong>
        {selectableOptions.length ? (
          <button type="button" disabled={busy} onClick={toggleAll}>
            {allSelectableSelected ? "取消全选" : "全选可操作项"}
          </button>
        ) : null}
      </div>

      <div className="annotation-bulk-dialog__body">
        {options.isLoading ? (
          <div className="annotation-bulk-dialog__empty">
            <Spinner label="读取标注类别" />
            <p>正在汇总所选图片的活动标注…</p>
          </div>
        ) : options.isError ? (
          <div className="annotation-bulk-dialog__empty is-error">
            <CircleAlert size={22} />
            <p>
              {options.error instanceof Error
                ? options.error.message
                : "无法读取可操作的标注类别。"}
            </p>
            <Button onClick={() => void options.refetch()}>重试</Button>
          </div>
        ) : options.data?.targets.length ? (
          <div className="annotation-bulk-options">
            {options.data.targets.map((option) => {
              const key = optionKey(option);
              const blocked = key === blockedKey;
              const alreadyReviewed = action === "review" && option.reviewable_count === 0;
              const disabled = busy || blocked || alreadyReviewed;
              const Icon = CHANNEL_ICONS[option.channel];
              return (
                <label
                  key={key}
                  className={`annotation-bulk-option ${disabled ? "is-disabled" : ""} ${
                    selectedKeys.has(key) ? "is-selected" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedKeys.has(key)}
                    disabled={disabled}
                    onChange={() => toggleOption(key)}
                  />
                  <span className="annotation-bulk-option__icon">
                    <Icon size={17} />
                  </span>
                  <span className="annotation-bulk-option__content">
                    <strong>
                      {option.channel === "translation" ? "翻译" : option.display_name}
                    </strong>
                    <small>
                      {action === "review" ? (
                        <>
                          {option.reviewable_count
                            ? `${option.reviewable_count} 个待复核`
                            : "当前版本均已复核"}
                          {option.reviewed_count ? ` · ${option.reviewed_count} 个已复核` : ""}
                          {option.stale_count ? ` · ${option.stale_count} 张图片已变化` : ""}
                        </>
                      ) : (
                        `${option.active_count} 张图片存在`
                      )}
                    </small>
                  </span>
                  {option.language ? (
                    <span className="annotation-bulk-option__language">{option.language}</span>
                  ) : null}
                </label>
              );
            })}
          </div>
        ) : (
          <div className="annotation-bulk-dialog__empty">
            <FileText size={22} />
            <p>所选图片当前没有活动标注。</p>
          </div>
        )}
      </div>

      {blockedTarget && blockedOption ? (
        <p className="annotation-bulk-message is-warning">
          <CircleAlert size={14} />
          {`当前编辑器中的“${blockedOption.display_name}”有未保存修改，该类别暂不可批量操作。请先保存或放弃修改。`}
        </p>
      ) : null}
      {notice ? <p className="annotation-bulk-dialog__notice">{notice}</p> : null}
      {actionError ? (
        <p className="annotation-bulk-message is-error">
          <CircleAlert size={14} />
          {actionError}
        </p>
      ) : null}

      <footer>
        <Button disabled={busy} onClick={close}>
          关闭
        </Button>
        <Button
          tone={action === "delete" ? "danger" : "primary"}
          icon={
            busy ? (
              <Spinner />
            ) : action === "review" ? (
              <BadgeCheck size={14} />
            ) : (
              <Trash2 size={14} />
            )
          }
          disabled={!selectedOptions.length || busy}
          onClick={() => void executeAction()}
        >
          {actionLabel}
        </Button>
      </footer>
    </ModalLayer>
  );
}
