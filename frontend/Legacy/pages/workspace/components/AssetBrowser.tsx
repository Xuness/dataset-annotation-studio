import { BadgeCheck, History, Tags, Trash2, Unlink } from "lucide-react";
import { AssetBrowserPanel } from "./AssetBrowserPanel";
import type { AssetBrowserPanelProps } from "./assetBrowserTypes";

type Props = Omit<AssetBrowserPanelProps, "actions" | "historyAction" | "mode"> & {
  mode?: "assets" | "review";
  onReviewCheckedAnnotations: () => void;
  onEditCheckedTags: () => void;
  onDeleteCheckedAnnotations: () => void;
  onDeleteCheckedAssets: () => void;
  onOpenDeletionHistory: () => void;
  onCropChecked?: () => void;
};
export function AssetBrowser(props: Props) {
  const disabled = !props.checkedAssetIds.length || props.bulkActionPending;
  return (
    <AssetBrowserPanel
      {...props}
      mode={props.mode ?? "assets"}
      historyAction={
        <button
          type="button"
          className="asset-browser__history"
          title="素材删除与恢复记录"
          aria-label="素材删除与恢复记录"
          onClick={props.onOpenDeletionHistory}
        >
          <History size={14} />
        </button>
      }
      actions={
        <>
          {props.onCropChecked && (
            <button
              type="button"
              data-testid="asset-crop-checked"
              disabled={disabled}
              onClick={props.onCropChecked}
            >
              批量裁剪
            </button>
          )}
          <button type="button" disabled={disabled} onClick={props.onEditCheckedTags}>
            <Tags size={13} />
            编辑 Tags
          </button>
          <button type="button" disabled={disabled} onClick={props.onReviewCheckedAnnotations}>
            <BadgeCheck size={13} />
            标记已复核
          </button>
          <button type="button" disabled={disabled} onClick={props.onDeleteCheckedAnnotations}>
            <Unlink size={13} />
            删标注
          </button>
          <button
            type="button"
            className="is-danger"
            disabled={disabled}
            onClick={props.onDeleteCheckedAssets}
          >
            <Trash2 size={13} />
            删素材
          </button>
        </>
      }
    />
  );
}
