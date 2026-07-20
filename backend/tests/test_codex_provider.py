import asyncio
from pathlib import Path
from types import SimpleNamespace

import pytest
from openai_codex import ApprovalMode, LocalImageInput, Sandbox, TextInput

from dataset_studio.modules.presets.models import (
    ProviderProfile,
    ProviderRequestOptions,
    ProviderType,
    ReasoningEffort,
)
from dataset_studio.modules.providers.codex import CodexProvider
from dataset_studio.modules.providers.codex_runtime import CodexRuntime
from dataset_studio.modules.providers.models import MultimodalRequest


class FakeTurnHandle:
    def __init__(self, response: str) -> None:
        self.response = response
        self.interrupted = asyncio.Event()

    async def run(self):
        return SimpleNamespace(
            id="turn-1",
            status="completed",
            error=None,
            final_response=self.response,
            items=[],
            usage=SimpleNamespace(last=SimpleNamespace(input_tokens=123, output_tokens=45)),
        )

    async def interrupt(self) -> None:
        self.interrupted.set()


class FakeThread:
    id = "thread-1"

    def __init__(self, handle: FakeTurnHandle) -> None:
        self.handle = handle
        self.inputs = None
        self.turn_options = None

    async def turn(self, inputs, **options):
        self.inputs = inputs
        self.turn_options = options
        return self.handle


class FakeCodexClient:
    def __init__(self, thread: FakeThread) -> None:
        self.thread = thread
        self.thread_options = None

    async def thread_start(self, **options):
        self.thread_options = options
        return self.thread


class FakeCodexRuntime:
    def __init__(self, client: FakeCodexClient, working_directory: Path) -> None:
        self._client = client
        self._working_directory = working_directory
        self.requested_effort = None

    def working_directory(self) -> Path:
        self._working_directory.mkdir(exist_ok=True)
        return self._working_directory

    async def require_chatgpt_account(self) -> None:
        return None

    async def client(self) -> FakeCodexClient:
        return self._client

    async def resolve_reasoning_effort(self, model_id: str, requested_effort: str | None):
        self.requested_effort = (model_id, requested_effort)
        return requested_effort


def _profile() -> ProviderProfile:
    return ProviderProfile(
        id="codex-profile",
        name="Codex",
        provider_type=ProviderType.CODEX,
        base_url="",
        model="gpt-example",
        temperature=0.2,
        max_output_tokens=4096,
        concurrency=1,
        timeout_seconds=30,
        request_options=ProviderRequestOptions(reasoning_effort=ReasoningEffort.HIGH),
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )


def _request(image_path: Path) -> MultimodalRequest:
    return MultimodalRequest(
        image_path=image_path,
        system_prompt="Return only the final annotation.",
        user_prompt="Annotate this image.",
        model="gpt-example",
        temperature=0.2,
        max_output_tokens=4096,
        timeout_seconds=30,
    )


@pytest.mark.asyncio
async def test_codex_provider_returns_exact_final_response_and_discards_thread(
    tmp_path: Path,
) -> None:
    image_path = tmp_path / "sample.png"
    image_path.write_bytes(b"image")
    expected = "\n<caption>quiet garden</caption>\n"
    handle = FakeTurnHandle(expected)
    thread = FakeThread(handle)
    client = FakeCodexClient(thread)
    runtime = FakeCodexRuntime(client, tmp_path / "codex-runtime")

    response = await CodexProvider(runtime).complete(_profile(), None, _request(image_path))

    assert response.content == expected
    assert response.input_tokens == 123
    assert response.output_tokens == 45
    assert runtime.requested_effort == ("gpt-example", "high")
    assert client.thread_options["developer_instructions"] == ("Return only the final annotation.")
    assert client.thread_options["ephemeral"] is True
    assert client.thread_options["approval_mode"] == ApprovalMode.deny_all
    assert client.thread_options["sandbox"] == Sandbox.read_only
    assert Path(client.thread_options["cwd"]).is_dir()
    assert isinstance(thread.inputs[0], TextInput)
    assert thread.inputs[0].text == "Annotate this image."
    assert isinstance(thread.inputs[1], LocalImageInput)
    assert thread.inputs[1].path == str(image_path.resolve())
    assert "output_schema" not in thread.turn_options


@pytest.mark.asyncio
async def test_codex_provider_accepts_text_only_request(tmp_path: Path) -> None:
    handle = FakeTurnHandle("<caption>译文</caption>")
    thread = FakeThread(handle)
    runtime = FakeCodexRuntime(FakeCodexClient(thread), tmp_path / "codex-runtime")
    request = _request(tmp_path / "unused.png")
    request = MultimodalRequest(
        image_path=None,
        system_prompt=request.system_prompt,
        user_prompt=request.user_prompt,
        model=request.model,
        temperature=request.temperature,
        max_output_tokens=request.max_output_tokens,
        timeout_seconds=request.timeout_seconds,
    )

    response = await CodexProvider(runtime).complete(_profile(), None, request)

    assert response.content == "<caption>译文</caption>"
    assert len(thread.inputs) == 1
    assert isinstance(thread.inputs[0], TextInput)


class BlockingTurnHandle(FakeTurnHandle):
    async def run(self):
        await asyncio.Event().wait()


@pytest.mark.asyncio
async def test_codex_provider_interrupts_turn_when_request_is_cancelled(tmp_path: Path) -> None:
    image_path = tmp_path / "sample.png"
    image_path.write_bytes(b"image")
    handle = BlockingTurnHandle("unused")
    runtime = FakeCodexRuntime(FakeCodexClient(FakeThread(handle)), tmp_path / "codex-runtime")
    task = asyncio.create_task(
        CodexProvider(runtime).complete(_profile(), None, _request(image_path))
    )
    await asyncio.sleep(0)

    task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await task
    await asyncio.wait_for(handle.interrupted.wait(), timeout=1)


class FakeRuntimeClient:
    def __init__(self) -> None:
        self.closed = False
        self.login_handle = FakeLoginHandle()

    async def __aenter__(self):
        return self

    async def close(self) -> None:
        self.closed = True

    async def account(self):
        chatgpt = SimpleNamespace(type="chatgpt", email="user@example.com", plan_type="plus")
        return SimpleNamespace(
            account=SimpleNamespace(root=chatgpt),
            requires_openai_auth=True,
        )

    async def models(self):
        return SimpleNamespace(
            data=[
                SimpleNamespace(
                    id="vision",
                    model="vision",
                    display_name="Vision",
                    description="Image model",
                    input_modalities=["text", "image"],
                    default_reasoning_effort="medium",
                    supported_reasoning_efforts=[
                        SimpleNamespace(reasoning_effort="medium"),
                        SimpleNamespace(reasoning_effort="max"),
                        SimpleNamespace(reasoning_effort="ultra"),
                    ],
                ),
                SimpleNamespace(
                    id="text",
                    model="text",
                    display_name="Text",
                    description="Text-only model",
                    input_modalities=["text"],
                    default_reasoning_effort="low",
                    supported_reasoning_efforts=[],
                ),
            ]
        )

    async def login_chatgpt(self):
        return self.login_handle


class FakeLoginHandle:
    login_id = "login-1"
    auth_url = "https://example.test/codex-login"

    def __init__(self) -> None:
        self.completed = asyncio.Event()
        self.cancelled = False

    async def wait(self):
        await self.completed.wait()
        return SimpleNamespace(success=True, error=None)

    async def cancel(self) -> None:
        self.cancelled = True
        self.completed.set()


@pytest.mark.asyncio
async def test_codex_runtime_maps_account_and_image_model_catalog() -> None:
    client = FakeRuntimeClient()
    runtime = CodexRuntime(client_factory=lambda: client)
    working_directory = runtime.working_directory()
    try:
        account = await runtime.account_status()
        models = await runtime.search_models("vision", 10)
        default_effort = await runtime.resolve_reasoning_effort("vision", None)
    finally:
        await runtime.close()

    assert account.logged_in is True
    assert account.uses_chatgpt is True
    assert account.plan_type == "plus"
    assert [model.id for model in models] == ["vision"]
    assert models[0].reasoning_efforts == ["medium", "max"]
    assert default_effort == "medium"
    assert client.closed is True
    assert not working_directory.exists()


@pytest.mark.asyncio
async def test_codex_runtime_tracks_browser_login_without_exposing_tokens() -> None:
    client = FakeRuntimeClient()
    runtime = CodexRuntime(client_factory=lambda: client)
    try:
        started = await runtime.start_chatgpt_login()
        same_attempt = await runtime.start_chatgpt_login()
        pending = await runtime.login_status(started.login_id)
        client.login_handle.completed.set()
        await asyncio.sleep(0)
        completed = await runtime.login_status(started.login_id)
    finally:
        await runtime.close()

    assert started.auth_url == "https://example.test/codex-login"
    assert same_attempt == started
    assert pending.state == "pending"
    assert completed.state == "succeeded"
