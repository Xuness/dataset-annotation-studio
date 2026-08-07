import type {
  CapabilityCategoryContent,
  CapabilityLibraryCategoryId,
  CapabilityLibraryGroupId,
  CapabilityLibraryInventoryItem,
} from "./capabilityLibraryModel";
import { useCapabilityLibraryController } from "./useCapabilityLibraryController";

interface UseCapabilityCategoryControllerOptions {
  categoryId: CapabilityLibraryCategoryId;
  requestedGroupId: string | null;
  requestedResourceId: string | null;
  onCategoryChange(categoryId: CapabilityLibraryCategoryId): void;
  onGroupIdChange(groupId: CapabilityLibraryGroupId): void;
  onResourceIdChange(groupId: CapabilityLibraryGroupId, resourceId: string): void;
  onCreateResource(): void;
  onOpenWorkbench(resource: CapabilityLibraryInventoryItem): void;
  onReturnOverview(): void;
}

export function useCapabilityCategoryController({
  categoryId,
  requestedGroupId,
  requestedResourceId,
  onCategoryChange,
  onGroupIdChange,
  onResourceIdChange,
  onCreateResource,
  onOpenWorkbench,
  onReturnOverview,
}: UseCapabilityCategoryControllerOptions): CapabilityCategoryContent {
  const library = useCapabilityLibraryController({ onOpenCategory: onCategoryChange });
  const category =
    library.categories.find((candidate) => candidate.id === categoryId) ?? library.categories[0];
  const activeGroup =
    category.groups.find((group) => group.id === requestedGroupId) ??
    category.groups.find((group) => group.id === category.defaultGroupId) ??
    category.groups[0]!;
  const resources = category.inventory.filter((resource) => resource.groupId === activeGroup.id);
  const activeResource =
    resources.find((resource) => resource.id === requestedResourceId) ?? resources[0] ?? null;

  return {
    kind: "capability-category",
    status: library.status,
    categories: library.categories,
    category,
    groups: category.groups,
    activeGroupId: activeGroup.id,
    activeGroup,
    resources,
    activeResourceId: activeResource?.id ?? null,
    activeResource,
    createResourceLabel:
      category.id === "providers" && activeGroup.id === "connections" ? "新增 API 供应商" : null,
    message: library.message,
    selectCategory: library.openCategory,
    selectGroup: onGroupIdChange,
    selectResource: (resourceId) => onResourceIdChange(activeGroup.id, resourceId),
    openResource: (resourceId) => {
      const resource = resources.find((candidate) => candidate.id === resourceId);
      if (resource) onOpenWorkbench(resource);
    },
    createResource: onCreateResource,
    openActiveResource: () => {
      if (activeResource) onOpenWorkbench(activeResource);
    },
    returnOverview: onReturnOverview,
    refresh: library.refresh,
  };
}
