import {
  HOME_SPACES,
  type HomeSpace,
  type HomeSpaceId,
} from "../../../../../navigation/spaceRegistry";

export interface DialArchiveSpacePresentation {
  code: string;
  ghostLabel: string;
  separated: boolean;
  typeLabel: "PROD" | "SUPP";
}

export type DialArchiveSpace = HomeSpace & DialArchiveSpacePresentation;

const SPACE_PRESENTATION = {
  archive: {
    code: "ARC",
    ghostLabel: "ARCHIVE",
    separated: false,
    typeLabel: "PROD",
  },
  preparation: {
    code: "PRP",
    ghostLabel: "PREPARATION",
    separated: false,
    typeLabel: "PROD",
  },
  annotation: {
    code: "ANN",
    ghostLabel: "ANNOTATION",
    separated: false,
    typeLabel: "PROD",
  },
  quality: {
    code: "QAC",
    ghostLabel: "QUALITY",
    separated: false,
    typeLabel: "PROD",
  },
  delivery: {
    code: "DLV",
    ghostLabel: "DELIVERY",
    separated: false,
    typeLabel: "PROD",
  },
  capability: {
    code: "CAP",
    ghostLabel: "CAPABILITY",
    separated: true,
    typeLabel: "SUPP",
  },
} satisfies Record<HomeSpaceId, DialArchiveSpacePresentation>;

export const DIAL_ARCHIVE_SPACES: readonly DialArchiveSpace[] = Object.freeze(
  HOME_SPACES.map((space) => ({ ...space, ...SPACE_PRESENTATION[space.id] })),
);

export function readInitialSpaceIndex(search: string): number {
  const requested = Number.parseInt(new URLSearchParams(search).get("s") ?? "3", 10);
  if (!Number.isFinite(requested)) return 2;
  return Math.min(Math.max(requested, 1), DIAL_ARCHIVE_SPACES.length) - 1;
}
