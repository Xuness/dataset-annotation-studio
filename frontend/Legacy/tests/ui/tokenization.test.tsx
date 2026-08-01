import { useMemo } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { useTokenCounts } from "../../../src/features/tokenization/hooks";
import { TokenCountBadges } from "../../pages/workspace/components/TokenizationControls";
import type {
  TokenCountRequest,
  TokenCountResponse,
  TokenizationProfileId,
} from "../../../src/shared/api/types";
import { countTokens } from "../../../src/features/tokenization/api";

vi.mock("../../../src/features/tokenization/api", () => ({
  countTokens: vi.fn(),
  getTokenizationProfiles: vi.fn(),
}));

function response(
  profileId: TokenizationProfileId,
  itemId: string,
  count: number,
): TokenCountResponse {
  if (profileId === "anima") {
    return {
      profile: {
        id: "anima",
        name: "Anima",
        description: "Anima tokenizer",
        metrics: [
          { id: "qwen3_0_6b", label: "Qwen3-0.6B", short_label: "Q3" },
          { id: "t5_v1_1_xxl", label: "T5 v1.1 XXL", short_label: "T5" },
        ],
      },
      items: [
        {
          id: itemId,
          metrics: [
            { metric_id: "qwen3_0_6b", count },
            { metric_id: "t5_v1_1_xxl", count: count + 2 },
          ],
        },
      ],
    };
  }
  return {
    profile: {
      id: profileId,
      name: profileId === "krea2" ? "Krea 2" : "T5",
      description: "Tokenizer profile",
      metrics:
        profileId === "krea2"
          ? [{ id: "qwen3_vl_4b", label: "Qwen3-VL-4B", short_label: "Q3-VL" }]
          : [{ id: "t5_v1_1_xxl", label: "T5 v1.1 XXL", short_label: "T5" }],
    },
    items: [
      {
        id: itemId,
        metrics: [
          {
            metric_id: profileId === "krea2" ? "qwen3_vl_4b" : "t5_v1_1_xxl",
            count,
          },
        ],
      },
    ],
  };
}

function CountHarness({
  profileId = "krea2",
  text,
}: {
  profileId?: TokenizationProfileId;
  text: string;
}) {
  const items = useMemo(() => [{ id: "description", text }], [text]);
  const query = useTokenCounts(profileId, items);
  return <TokenCountBadges profileId={profileId} itemId="description" query={query} />;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("token counting UI", () => {
  test("debounces edits and sends only the latest full text", async () => {
    vi.useFakeTimers();
    vi.mocked(countTokens).mockImplementation(async (request) =>
      response(request.profile_id, request.items[0].id, request.items[0].text.length),
    );
    const view = render(<CountHarness text="first draft" />);

    view.rerender(<CountHarness text="final caption" />);
    await act(async () => {
      vi.advanceTimersByTime(179);
    });
    expect(countTokens).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });

    expect(countTokens).toHaveBeenCalledTimes(1);
    expect(vi.mocked(countTokens).mock.calls[0][0]).toEqual({
      profile_id: "krea2",
      items: [{ id: "description", text: "final caption" }],
    });
    expect(screen.getByLabelText("Qwen3-VL-4B Token：13")).not.toBeNull();
  });

  test("aborts and ignores an older request when text changes", async () => {
    vi.useFakeTimers();
    const resolvers = new Map<string, (value: TokenCountResponse) => void>();
    vi.mocked(countTokens).mockImplementation(
      (request: TokenCountRequest) =>
        new Promise<TokenCountResponse>((resolve) => {
          resolvers.set(request.items[0].text, resolve);
        }),
    );
    const view = render(<CountHarness text="old text" />);

    await act(async () => {
      vi.advanceTimersByTime(180);
    });
    const firstSignal = vi.mocked(countTokens).mock.calls[0][1];

    view.rerender(<CountHarness text="new text" />);
    expect(firstSignal?.aborted).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(180);
    });
    await act(async () => {
      resolvers.get("new text")?.(response("krea2", "description", 12));
      await Promise.resolve();
    });
    expect(screen.getByLabelText("Qwen3-VL-4B Token：12")).not.toBeNull();

    await act(async () => {
      resolvers.get("old text")?.(response("krea2", "description", 99));
      await Promise.resolve();
    });
    expect(screen.queryByLabelText("Qwen3-VL-4B Token：99")).toBeNull();
    expect(screen.getByLabelText("Qwen3-VL-4B Token：12")).not.toBeNull();
  });

  test("renders both Anima tokenizer metrics without approximation marks", () => {
    render(
      <TokenCountBadges
        profileId="anima"
        itemId="description"
        query={{
          data: response("anima", "description", 1287),
          isPending: false,
          error: null,
        }}
      />,
    );

    expect(screen.getByLabelText("Qwen3-0.6B Token：1,287")).not.toBeNull();
    expect(screen.getByLabelText("T5 v1.1 XXL Token：1,289")).not.toBeNull();
    expect(screen.queryByText(/≈/)).toBeNull();
  });
});
