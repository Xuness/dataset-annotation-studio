import { useEffect, useState } from "react";
import { Plus, Search, Star, X } from "lucide-react";

import { providerCapabilities } from "../../../../src/features/presets/providerCapabilities";
import type {
  ProviderModelConfig,
  ProviderModelSummary,
  ProviderType,
} from "../../../../src/shared/api/types";
import { Button } from "../../../shared/ui/Button";
import { OpenCodeGoModelPicker } from "./opencode-go/OpenCodeGoModelPicker";
import { ProviderModelPicker } from "./ProviderModelPicker";

interface ProviderModelsEditorProps {
  providerType: ProviderType;
  baseUrl: string;
  profileId?: string;
  apiKey: string;
  models: ProviderModelConfig[];
  defaultModelId: string;
  selectedModelId: string;
  onAdd: (modelId: string, summary?: ProviderModelSummary) => void;
  onRemove: (modelId: string) => void;
  onSelect: (modelId: string) => void;
  onSetDefault: (modelId: string) => void;
}

export function ProviderModelsEditor({
  providerType,
  baseUrl,
  profileId,
  apiKey,
  models,
  defaultModelId,
  selectedModelId,
  onAdd,
  onRemove,
  onSelect,
  onSetDefault,
}: ProviderModelsEditorProps) {
  const [modelDraft, setModelDraft] = useState("");
  const [showModelPicker, setShowModelPicker] = useState(false);
  const capabilities = providerCapabilities[providerType];
  const modelIds = models.map((model) => model.model_id);

  useEffect(() => {
    setModelDraft("");
    setShowModelPicker(false);
  }, [profileId, providerType]);

  function addDraft() {
    const modelId = modelDraft.trim();
    if (!modelId) return;
    onAdd(modelId);
    setModelDraft("");
  }

  function toggleCatalogModel(model: ProviderModelSummary) {
    if (modelIds.includes(model.id)) {
      onRemove(model.id);
    } else {
      onAdd(model.id, model);
    }
  }

  return (
    <>
      <div className="form-field form-field--wide">
        <span>添加模型</span>
        <div className="model-input-row">
          <input
            value={modelDraft}
            onChange={(event) => setModelDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              addDraft();
            }}
            placeholder="输入模型 ID 后添加"
          />
          <Button
            type="button"
            icon={<Plus size={13} />}
            disabled={
              !modelDraft.trim() || modelIds.includes(modelDraft.trim()) || models.length >= 100
            }
            onClick={addDraft}
          >
            添加
          </Button>
          {capabilities.modelCatalog ? (
            <Button
              type="button"
              icon={<Search size={13} />}
              onClick={() => setShowModelPicker((current) => !current)}
            >
              {capabilities.modelCatalog === "opencode_go" ? "选择模型" : "搜索模型"}
            </Button>
          ) : null}
        </div>
        <small className="provider-option-note">
          每个模型单独保存生成参数；默认模型只决定创建任务时的初始选择。
        </small>
      </div>

      <div className="provider-model-list form-field--wide">
        <header>
          <span>已保存模型</span>
          <small>{models.length} / 100</small>
        </header>
        <div>
          {models.map((model) => {
            const isDefault = defaultModelId === model.model_id;
            const isSelected = selectedModelId === model.model_id;
            return (
              <div
                key={model.model_id}
                className={[isDefault ? "is-default" : "", isSelected ? "is-selected" : ""].join(
                  " ",
                )}
              >
                <button
                  type="button"
                  className="provider-model-list__select"
                  aria-pressed={isSelected}
                  onClick={() => onSelect(model.model_id)}
                >
                  <code>{model.model_id}</code>
                  <small>{isSelected ? "正在编辑参数" : "编辑参数"}</small>
                </button>
                <button
                  type="button"
                  className="provider-model-list__default"
                  aria-label={isDefault ? "当前默认模型" : `将 ${model.model_id} 设为默认模型`}
                  aria-pressed={isDefault}
                  onClick={() => onSetDefault(model.model_id)}
                >
                  <Star size={13} fill={isDefault ? "currentColor" : "none"} />
                </button>
                <button
                  type="button"
                  className="provider-model-list__remove"
                  aria-label={`移除模型 ${model.model_id}`}
                  onClick={() => onRemove(model.model_id)}
                >
                  <X size={13} />
                </button>
              </div>
            );
          })}
          {!models.length ? <p>请至少添加一个模型。</p> : null}
        </div>
      </div>

      {showModelPicker && capabilities.modelCatalog ? (
        capabilities.modelCatalog === "opencode_go" ? (
          <OpenCodeGoModelPicker
            baseUrl={baseUrl}
            profileId={profileId}
            apiKey={apiKey}
            selectedModels={modelIds}
            onToggle={toggleCatalogModel}
            onClose={() => setShowModelPicker(false)}
          />
        ) : (
          <ProviderModelPicker
            providerType={providerType}
            baseUrl={baseUrl}
            profileId={profileId}
            apiKey={apiKey}
            selectedModels={modelIds}
            onToggle={toggleCatalogModel}
            onClose={() => setShowModelPicker(false)}
          />
        )
      ) : null}
    </>
  );
}
