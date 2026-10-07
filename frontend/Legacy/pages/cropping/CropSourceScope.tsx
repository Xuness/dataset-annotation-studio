import type { AssetFolderSummary } from "../../../src/shared/api/types";
import type { CropWorkbenchController } from "../../../src/application/cropping/useCropWorkbench";

export function CropSourceScope({
  controller: c,
  checkedCount,
  total,
  folders,
}: {
  controller: CropWorkbenchController;
  checkedCount: number;
  total: number;
  folders: AssetFolderSummary[];
}) {
  return (
    <div className="crop-browser-scope">
      <div className="crop-browser-scope-heading">
        <strong>处理范围</strong>
        <small data-testid="crop-sidebar-counts">
          {c.sources.length} 张源图 · {c.pending} 个待生成区域
        </small>
      </div>
      <div className="crop-browser-scope-buttons">
        <button
          type="button"
          data-testid="crop-scope-all"
          aria-pressed={c.state.scope === "all"}
          disabled={c.busy}
          onClick={() => c.patch({ scope: "all" })}
        >
          当前项目<small>{total} 张素材</small>
        </button>
        <button
          type="button"
          data-testid="crop-scope-selected"
          aria-pressed={c.state.scope === "selected"}
          disabled={c.busy}
          onClick={() => c.patch({ scope: "selected" })}
        >
          工作台选中<small>{checkedCount} 张勾选</small>
        </button>
      </div>
      <details>
        <summary>其他范围与筛选</summary>
        <label className="form-field">
          <span>源图片范围</span>
          <select
            data-testid="crop-source-scope"
            value={c.state.scope}
            disabled={c.busy}
            onChange={(event) => {
              const scope = event.target.value;
              if (
                scope === "all" ||
                scope === "selected" ||
                scope === "filtered" ||
                scope === "folder"
              )
                c.patch({ scope });
            }}
          >
            <option value="selected">工作台选中</option>
            <option value="all">当前有效项目范围</option>
            <option value="filtered">左栏当前筛选结果</option>
            <option value="folder">指定目录</option>
          </select>
        </label>
        {c.state.scope === "folder" && (
          <label className="form-field">
            <span>处理目录</span>
            <select
              data-testid="crop-source-folder"
              value={c.state.folder}
              disabled={c.busy}
              onChange={(event) => c.patch({ folder: event.target.value })}
            >
              <option value="">选择目录</option>
              {folders
                .filter((folder) => folder.path)
                .map((folder) => (
                  <option key={folder.path} value={folder.path}>
                    {folder.path}
                  </option>
                ))}
            </select>
          </label>
        )}
        <small>
          {c.sourceState.fromFocusedAsset
            ? "当前使用单图入口素材，勾选操作可重新指定范围。"
            : "点击仅浏览，勾选加入选中范围；项目范围排除已有裁剪结果。"}
        </small>
      </details>
    </div>
  );
}
