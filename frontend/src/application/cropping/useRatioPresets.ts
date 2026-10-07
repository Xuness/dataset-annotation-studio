import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createRatioPreset,
  deleteRatioPreset,
  listRatioPresets,
  updateRatioPreset,
} from "../../features/cropping/api";
import type { RatioPresetInput } from "../../shared/api/types";

export function useRatioPresets() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["crop-ratio-presets"], queryFn: listRatioPresets });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function mutate(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await client.invalidateQueries({ queryKey: ["crop-ratio-presets"] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  async function save(id: string | null, value: RatioPresetInput) {
    await mutate(async () => {
      if (id) await updateRatioPreset(id, value);
      else await createRatioPreset(value);
    });
  }
  async function remove(id: string) {
    await mutate(() => deleteRatioPreset(id));
  }
  return { query, busy, error, save, remove };
}
