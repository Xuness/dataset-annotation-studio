import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import type {
  TokenCountRequest,
  TokenCountRequestItem,
  TokenCountResponse,
  TokenizationProfileId,
} from "../../shared/api/types";
import { countTokens, getTokenizationProfiles } from "./api";

const TOKEN_COUNT_DEBOUNCE_MS = 180;

interface TokenCountState {
  signature: string;
  data: TokenCountResponse | undefined;
  pending: boolean;
  error: Error | null;
}

export interface TokenCountQuery {
  data: TokenCountResponse | undefined;
  isPending: boolean;
  error: Error | null;
}

function requestError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error("Token 计数失败。");
}

export function useTokenizationProfiles() {
  return useQuery({
    queryKey: ["tokenization", "profiles"],
    queryFn: ({ signal }) => getTokenizationProfiles(signal),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useTokenCounts(
  profileId: TokenizationProfileId,
  items: readonly TokenCountRequestItem[],
  enabled = true,
): TokenCountQuery {
  const signature = JSON.stringify({ profile_id: profileId, items });
  const requestSerial = useRef(0);
  const [state, setState] = useState<TokenCountState>({
    signature: "",
    data: undefined,
    pending: false,
    error: null,
  });

  useEffect(() => {
    requestSerial.current += 1;
    const serial = requestSerial.current;
    if (!enabled || items.length === 0) {
      setState({
        signature,
        data: undefined,
        pending: false,
        error: null,
      });
      return;
    }

    const controller = new AbortController();
    const request = JSON.parse(signature) as TokenCountRequest;
    const timer = window.setTimeout(() => {
      setState({
        signature,
        data: undefined,
        pending: true,
        error: null,
      });
      void countTokens(request, controller.signal)
        .then((data) => {
          if (requestSerial.current !== serial) return;
          setState({
            signature,
            data,
            pending: false,
            error: null,
          });
        })
        .catch((reason: unknown) => {
          if (controller.signal.aborted || requestSerial.current !== serial) return;
          setState({
            signature,
            data: undefined,
            pending: false,
            error: requestError(reason),
          });
        });
    }, TOKEN_COUNT_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, items.length, signature]);

  const settled = state.signature === signature;
  return {
    data: enabled && settled ? state.data : undefined,
    isPending: enabled && items.length > 0 && (!settled || state.pending),
    error: enabled && settled ? state.error : null,
  };
}
