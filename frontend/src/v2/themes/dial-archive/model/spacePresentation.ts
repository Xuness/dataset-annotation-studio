import { HOME_SPACES, type HomeSpace, type HomeSpaceId } from "../../../navigation/spaceRegistry";

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

export function getDialArchiveSpace(id: HomeSpaceId): DialArchiveSpace {
  const space = DIAL_ARCHIVE_SPACES.find((candidate) => candidate.id === id);
  if (!space) throw new Error(`Unknown dial archive space: ${id}`);
  return space;
}
