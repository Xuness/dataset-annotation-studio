import { HOME_SPACES, type HomeSpaceId } from "../navigation/spaceRegistry";

export function readInitialHomeSpaceId(search: string): HomeSpaceId | undefined {
  const requested = Number.parseInt(new URLSearchParams(search).get("s") ?? "", 10);
  if (!Number.isInteger(requested) || requested < 1 || requested > HOME_SPACES.length) {
    return undefined;
  }
  return HOME_SPACES[requested - 1].id;
}
