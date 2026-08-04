import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type {
  AnnotationStageAsset,
  AnnotationStageContent,
} from "../../../../../../pages/spaces/spacePageModel";
import { ANNOTATION_STAGE_LAYOUT } from "../model/annotationStageLayout";

export interface StageAssetWalk {
  active: boolean;
  direction: -1 | 1;
  previousAsset: AnnotationStageAsset | null;
  previousIndex: number;
  serial: number;
}

interface StageAssetFocus {
  asset: AnnotationStageAsset | null;
  index: number;
}

/**
 * 汇聚走片意图并驱动一次可取消的视觉编排。连续输入基于意图索引推进，
 * 不等待路由把上一张素材重新渲染完，因此不会在高速输入时重复旧目标。
 */
export function useStageAssetNavigation(content: AnnotationStageContent, reducedMotion: boolean) {
  const {
    currentAsset,
    currentIndex,
    selectAsset: commitAsset,
    sequence: { assets, hasMore, loadMore },
  } = content;
  const intentIndexRef = useRef(currentIndex);
  const pendingAssetIdRef = useRef<string | null>(null);
  const visualFocusRef = useRef<StageAssetFocus>({
    asset: currentAsset,
    index: currentIndex,
  });
  const [visualFocus, setVisualFocus] = useState<StageAssetFocus>(visualFocusRef.current);
  const serialRef = useRef(0);
  const timerRef = useRef(0);
  const [walk, setWalk] = useState<StageAssetWalk>({
    active: false,
    direction: 1,
    previousAsset: null,
    previousIndex: -1,
    serial: 0,
  });

  const presentFocus = useCallback(
    (next: StageAssetFocus) => {
      const previous = visualFocusRef.current;
      if (previous.asset?.id === next.asset?.id) {
        visualFocusRef.current = next;
        setVisualFocus(next);
        return;
      }

      visualFocusRef.current = next;
      setVisualFocus(next);
      window.clearTimeout(timerRef.current);
      serialRef.current += 1;
      const serial = serialRef.current;
      const direction: -1 | 1 = next.index >= previous.index ? 1 : -1;
      if (reducedMotion || !previous.asset || !next.asset) {
        setWalk({
          active: false,
          direction,
          previousAsset: null,
          previousIndex: previous.index,
          serial,
        });
        return;
      }

      setWalk({
        active: true,
        direction,
        previousAsset: previous.asset,
        previousIndex: previous.index,
        serial,
      });
      timerRef.current = window.setTimeout(() => {
        setWalk((currentWalk) =>
          currentWalk.serial === serial
            ? { ...currentWalk, active: false, previousAsset: null }
            : currentWalk,
        );
      }, ANNOTATION_STAGE_LAYOUT.motion.assetWalkDurationMs);
    },
    [reducedMotion],
  );

  const selectIndex = useCallback(
    (requestedIndex: number) => {
      if (assets.length === 0) return;
      const index = Math.min(assets.length - 1, Math.max(0, requestedIndex));
      const asset = assets[index];
      const routeNeedsUpdate = asset.id !== currentAsset?.id || pendingAssetIdRef.current !== null;
      intentIndexRef.current = index;
      pendingAssetIdRef.current = asset.id;
      presentFocus({ asset, index });
      if (routeNeedsUpdate) commitAsset(asset.id);
      else pendingAssetIdRef.current = null;
    },
    [assets, commitAsset, currentAsset?.id, presentFocus],
  );

  const selectAsset = useCallback(
    (assetId: string) => {
      const index = assets.findIndex((asset) => asset.id === assetId);
      if (index >= 0) selectIndex(index);
    },
    [assets, selectIndex],
  );

  const stepAsset = useCallback(
    (offset: number) => {
      if (!Number.isFinite(offset) || offset === 0) return;
      if (assets.length === 0) return;
      const intended = intentIndexRef.current;
      const base = intended >= 0 && intended < assets.length ? intended : currentIndex;
      const next = Math.min(assets.length - 1, Math.max(0, base + Math.trunc(offset)));
      if (next === base) {
        if (next === assets.length - 1 && hasMore) loadMore();
        return;
      }
      selectIndex(next);
    },
    [assets, currentIndex, hasMore, loadMore, selectIndex],
  );

  useLayoutEffect(() => {
    const pendingAssetId = pendingAssetIdRef.current;
    const current = { asset: currentAsset, index: currentIndex };
    if (pendingAssetId && pendingAssetId !== current.asset?.id) {
      // 路由可能短暂提交较早的请求；视觉层继续服从最新意图，避免反向闪回。
      return;
    }
    intentIndexRef.current = current.index;
    pendingAssetIdRef.current = null;
    presentFocus(current);
  }, [currentAsset, currentIndex, presentFocus]);

  useEffect(() => {
    const pendingAssetId = pendingAssetIdRef.current;
    if (pendingAssetId && !assets.some((asset) => asset.id === pendingAssetId)) {
      pendingAssetIdRef.current = null;
      intentIndexRef.current = currentIndex;
    }
  }, [assets, currentIndex]);
  useEffect(
    () => () => {
      window.clearTimeout(timerRef.current);
    },
    [],
  );

  return {
    walk,
    visualAsset: visualFocus.asset,
    visualIndex: visualFocus.index,
    selectAsset,
    stepAsset,
  };
}
