import { useEffect, useState } from "react";
import { CheckCircle2, LogIn, RefreshCw, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import {
  presetKeys,
  useCodexAccount,
  useCodexAuthMutations,
  useCodexLoginStatus,
} from "../../../features/presets/hooks";
import { openExternalUrl } from "../../../shared/desktop/openExternalUrl";
import { Button } from "../../../shared/ui/Button";
import { Spinner } from "../../../shared/ui/Spinner";

export function CodexConnectionPanel() {
  const queryClient = useQueryClient();
  const account = useCodexAccount(true);
  const mutations = useCodexAuthMutations();
  const [loginId, setLoginId] = useState<string | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const login = useCodexLoginStatus(loginId);

  useEffect(() => {
    if (login.data?.state === "succeeded") {
      void queryClient.invalidateQueries({ queryKey: presetKeys.codexAccount });
      setLoginId(null);
      setAuthUrl(null);
      setError(null);
    } else if (login.data?.state === "failed") {
      setError(login.data.error || "ChatGPT 登录没有成功完成。");
    } else if (login.data?.state === "cancelled") {
      setLoginId(null);
      setAuthUrl(null);
    }
  }, [login.data, queryClient]);

  async function startLogin() {
    setError(null);
    try {
      const started = await mutations.start.mutateAsync();
      setLoginId(started.login_id);
      setAuthUrl(started.auth_url);
      await openExternalUrl(started.auth_url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法启动 ChatGPT 登录。");
    }
  }

  async function cancelLogin() {
    if (!loginId) return;
    setError(null);
    try {
      await mutations.cancel.mutateAsync(loginId);
      setLoginId(null);
      setAuthUrl(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法取消登录。");
    }
  }

  const waiting = Boolean(loginId && !login.isError && login.data?.state !== "failed");
  const accountLabel = account.data?.uses_chatgpt
    ? "已通过 ChatGPT 登录"
    : account.data?.logged_in
      ? "当前不是 ChatGPT 登录"
      : "尚未登录 Codex";

  return (
    <section className="codex-connection form-field--wide">
      <div className="codex-connection__status">
        <span className={account.data?.uses_chatgpt ? "is-ready" : ""}>
          {account.isLoading ? (
            <Spinner />
          ) : account.data?.uses_chatgpt ? (
            <CheckCircle2 size={16} />
          ) : (
            <LogIn size={16} />
          )}
        </span>
        <div>
          <strong>{account.isError ? "无法读取 Codex 登录状态" : accountLabel}</strong>
          <small>
            {account.data?.uses_chatgpt
              ? [account.data.email, account.data.plan_type?.toUpperCase()]
                  .filter(Boolean)
                  .join(" · ")
              : account.data?.logged_in
                ? "请使用 ChatGPT 重新登录，避免消耗 Platform API 余额。"
                : "凭据由 Codex 管理，不会保存到本项目。"}
          </small>
        </div>
        <Button
          type="button"
          icon={<RefreshCw size={13} />}
          disabled={account.isFetching}
          onClick={() => void account.refetch()}
        >
          刷新
        </Button>
      </div>
      <div className="codex-connection__actions">
        <Button
          type="button"
          tone="primary"
          icon={mutations.start.isPending || waiting ? <Spinner /> : <LogIn size={13} />}
          disabled={mutations.start.isPending || waiting}
          onClick={() => void startLogin()}
        >
          {waiting ? "等待浏览器授权" : "使用 ChatGPT 登录"}
        </Button>
        {waiting ? (
          <Button
            type="button"
            icon={<X size={13} />}
            disabled={mutations.cancel.isPending}
            onClick={() => void cancelLogin()}
          >
            取消
          </Button>
        ) : null}
        {authUrl && waiting ? (
          <button
            type="button"
            className="codex-connection__link"
            onClick={() => void openExternalUrl(authUrl)}
          >
            再次打开授权页
          </button>
        ) : null}
      </div>
      {error || account.error || login.error ? (
        <p className="form-error">
          {error ||
            (account.error instanceof Error
              ? account.error.message
              : login.error instanceof Error
                ? login.error.message
                : "Codex 状态读取失败。")}
        </p>
      ) : null}
    </section>
  );
}
