import { create } from "zustand";

/**
 * Session-scoped view state keyed by an arbitrary scope string (usually a
 * project id, optionally combined with a page mode). State survives component
 * unmounts and route changes, but is intentionally not persisted to storage:
 * restarting the application returns every scope to its defaults.
 */
export interface ScopedViewStateStore<T extends object> {
  useValue: (scope: string) => T;
  get: (scope: string) => T;
  patch: (scope: string, update: Partial<T> | ((current: T) => Partial<T>)) => void;
  reset: (scope: string) => void;
}

export function createScopedViewState<T extends object>(
  createDefault: (scope: string) => T,
): ScopedViewStateStore<T> {
  // Defaults are cached per scope so selectors return a stable reference for
  // scopes that have never been patched.
  const defaults = new Map<string, T>();
  const defaultFor = (scope: string): T => {
    let value = defaults.get(scope);
    if (value === undefined) {
      value = createDefault(scope);
      defaults.set(scope, value);
    }
    return value;
  };

  const useStore = create<{ scopes: Record<string, T> }>(() => ({ scopes: {} }));

  const get = (scope: string): T => useStore.getState().scopes[scope] ?? defaultFor(scope);

  return {
    useValue: (scope) => useStore((state) => state.scopes[scope] ?? defaultFor(scope)),
    get,
    patch: (scope, update) =>
      useStore.setState((state) => {
        const current = state.scopes[scope] ?? defaultFor(scope);
        const applied = typeof update === "function" ? update(current) : update;
        const changed = Object.keys(applied).some(
          (key) => !Object.is(current[key as keyof T], applied[key as keyof T]),
        );
        if (!changed) return state;
        return { scopes: { ...state.scopes, [scope]: { ...current, ...applied } } };
      }),
    reset: (scope) => {
      defaults.delete(scope);
      useStore.setState((state) => {
        if (!(scope in state.scopes)) return state;
        const scopes = { ...state.scopes };
        delete scopes[scope];
        return { scopes };
      });
    },
  };
}
