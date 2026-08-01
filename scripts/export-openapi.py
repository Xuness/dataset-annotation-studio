from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
BACKEND_SOURCE = REPOSITORY_ROOT / "backend" / "src"
sys.path.insert(0, str(BACKEND_SOURCE))

from dataset_studio.api.app import app  # noqa: E402


def serialized_openapi() -> str:
    return (
        json.dumps(app.openapi(), ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Export the backend OpenAPI contract.")
    parser.add_argument("output", type=Path)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Fail when the checked-in contract differs from the live FastAPI schema.",
    )
    args = parser.parse_args()

    output = args.output.resolve()
    generated = serialized_openapi()
    if args.check:
        if not output.is_file():
            print(f"OpenAPI contract is missing: {output}", file=sys.stderr)
            return 1
        if output.read_text(encoding="utf-8") != generated:
            print(
                "OpenAPI contract is stale. Run `pnpm --dir frontend api:generate`.",
                file=sys.stderr,
            )
            return 1
        print(f"OpenAPI contract is current: {output}")
        return 0

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(generated, encoding="utf-8", newline="\n")
    print(f"Wrote OpenAPI contract: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
