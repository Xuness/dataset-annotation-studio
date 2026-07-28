import { create } from "zustand";

import { LATEST_UPDATE_ANNOUNCEMENT, UPDATE_ANNOUNCEMENTS } from "./catalog";

export const UPDATE_ANNOUNCEMENT_READ_STORAGE_KEY = "dataset-studio.update-announcements.last-read";

function readStoredAnnouncementId(): string | null {
  if (typeof window === "undefined") return null;

  try {
    const storedId = window.localStorage.getItem(UPDATE_ANNOUNCEMENT_READ_STORAGE_KEY);
    return UPDATE_ANNOUNCEMENTS.some((announcement) => announcement.id === storedId)
      ? storedId
      : null;
  } catch {
    return null;
  }
}

function persistAnnouncementId(id: string) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(UPDATE_ANNOUNCEMENT_READ_STORAGE_KEY, id);
  } catch {
    // Reading announcements remains available for this session when storage is unavailable.
  }
}

interface UpdateAnnouncementReadState {
  lastReadAnnouncementId: string | null;
  markLatestAnnouncementRead: () => void;
}

export const useUpdateAnnouncementReadState = create<UpdateAnnouncementReadState>((set) => ({
  lastReadAnnouncementId: readStoredAnnouncementId(),
  markLatestAnnouncementRead: () => {
    const id = LATEST_UPDATE_ANNOUNCEMENT.id;
    persistAnnouncementId(id);
    set({ lastReadAnnouncementId: id });
  },
}));

export function useHasUnreadUpdateAnnouncement(): boolean {
  return useUpdateAnnouncementReadState(
    (state) => state.lastReadAnnouncementId !== LATEST_UPDATE_ANNOUNCEMENT.id,
  );
}
