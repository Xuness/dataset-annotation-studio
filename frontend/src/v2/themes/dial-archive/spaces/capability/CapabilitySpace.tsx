import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CapabilitySpaceContent } from "../../../../pages/spaces/spacePageModel";
import { CapabilityObjectSheet } from "./CapabilityObjectSheet";
import { CapabilityWorld } from "./CapabilityWorld";

interface CapabilitySpaceProps {
  content: CapabilitySpaceContent;
}

export function CapabilitySpace({ content }: CapabilitySpaceProps) {
  const [focusedBranchId, setFocusedBranchId] = useState<string | null>(
    content.activeObject?.branchId ?? null,
  );
  const [editorDirty, setEditorDirty] = useState(false);
  const editorDirtyRef = useRef(false);
  const previousDistrictId = useRef(content.activeDistrictId);

  const updateEditorDirty = useCallback(
    (dirty: boolean) => {
      editorDirtyRef.current = dirty;
      setEditorDirty(dirty);
      content.setEditorDirty(dirty);
    },
    [content.setEditorDirty],
  );

  const confirmDiscard = useCallback(() => {
    if (!editorDirtyRef.current) return true;
    if (!window.confirm("当前能力配置尚未保存。放弃修改并切换节点吗？")) return false;
    updateEditorDirty(false);
    return true;
  }, [updateEditorDirty]);

  useEffect(() => {
    if (content.activeObject) {
      setFocusedBranchId(content.activeObject.branchId);
    } else if (previousDistrictId.current !== content.activeDistrictId) {
      setFocusedBranchId(null);
    }
    previousDistrictId.current = content.activeDistrictId;
  }, [content.activeDistrictId, content.activeObject]);

  useEffect(() => {
    updateEditorDirty(false);
  }, [content.activeObjectId, updateEditorDirty]);

  useEffect(() => () => content.setEditorDirty(false), [content.setEditorDirty]);

  const guardedContent = useMemo(
    () => ({
      ...content,
      selectDistrict: (districtId: Parameters<typeof content.selectDistrict>[0]) => {
        if (confirmDiscard()) content.selectDistrict(districtId);
      },
      selectObject: (object: Parameters<typeof content.selectObject>[0]) => {
        if (confirmDiscard()) content.selectObject(object);
      },
      returnOverview: () => {
        if (confirmDiscard()) content.returnOverview();
      },
      closeObject: () => {
        if (confirmDiscard()) content.closeObject();
      },
    }),
    [confirmDiscard, content],
  );

  return (
    <section
      className={`dial-archive-capability${content.activeObject ? " has-workplane" : ""}`}
      aria-label="能力库"
    >
      <CapabilityWorld
        content={guardedContent}
        focusedBranchId={focusedBranchId}
        onFocusBranch={setFocusedBranchId}
      />
      {content.activeObject ? (
        <CapabilityObjectSheet
          object={content.activeObject}
          editor={content.activeEditor}
          dirty={editorDirty}
          onDirtyChange={updateEditorDirty}
          onClose={content.closeObject}
        />
      ) : null}
    </section>
  );
}
