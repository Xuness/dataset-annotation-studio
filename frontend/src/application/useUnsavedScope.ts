import { useEffect } from "react";

import { useUnsavedChangesStore } from "../shared/store/unsavedChangesStore";

export function useUnsavedScope(scope: string, dirty: boolean): void {
  const setDirtyScope = useUnsavedChangesStore((state) => state.setDirtyScope);

  useEffect(() => {
    setDirtyScope(scope, dirty);
    return () => setDirtyScope(scope, false);
  }, [dirty, scope, setDirtyScope]);
}
