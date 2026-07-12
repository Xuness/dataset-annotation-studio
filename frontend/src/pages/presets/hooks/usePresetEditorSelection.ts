import { useEffect, useMemo, useRef, useState } from "react";

interface PresetRecord {
  id: string;
}

export function usePresetEditorSelection<T extends PresetRecord>(
  items: T[] | undefined,
  createSignal: number,
) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const handledCreateSignal = useRef(createSignal);
  const selected = useMemo(
    () => (isCreating ? null : (items?.find((item) => item.id === selectedId) ?? null)),
    [isCreating, items, selectedId],
  );

  useEffect(() => {
    if (isCreating) return;
    if (!items?.length) {
      if (selectedId) setSelectedId(null);
      return;
    }
    if (!selectedId || !items.some((item) => item.id === selectedId)) {
      setSelectedId(items[0].id);
    }
  }, [isCreating, items, selectedId]);

  useEffect(() => {
    if (createSignal === handledCreateSignal.current) return;
    handledCreateSignal.current = createSignal;
    setIsCreating(true);
    setSelectedId(null);
  }, [createSignal]);

  return {
    selected,
    selectedId,
    isCreating,
    select(id: string) {
      setIsCreating(false);
      setSelectedId(id);
    },
    clear() {
      setIsCreating(false);
      setSelectedId(null);
    },
  };
}
