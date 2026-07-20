from __future__ import annotations

from dataset_studio.modules.providers.config import (
    OpenCodeGoModelOptions,
    ProviderExecutionProfile,
    ProviderType,
)
from dataset_studio.modules.providers.models import (
    MultimodalRequest,
    ProviderRequestError,
    ProviderResponse,
)
from dataset_studio.modules.providers.opencode_go import (
    anthropic_messages,
    chat_completions,
)
from dataset_studio.modules.providers.opencode_go.model_specs import (
    OpenCodeGoTransport,
    get_model_spec,
)


class OpenCodeGoProvider:
    async def complete(
        self,
        profile: ProviderExecutionProfile,
        credential: str | None,
        request: MultimodalRequest,
    ) -> ProviderResponse:
        if profile.provider_type != ProviderType.OPENCODE_GO:
            raise ProviderRequestError("OpenCode Go Provider 收到了其它供应商的配置。")
        if not credential:
            raise ProviderRequestError("当前 OpenCode Go 配置尚未保存 API Key。")
        spec = get_model_spec(profile.model_id)
        if spec is None:
            raise ProviderRequestError(
                f"OpenCode Go 模型 {profile.model_id} 尚未登记协议规格；"
                "为避免误用协议，本次请求已停止。"
            )
        if request.image_path is not None and "image" not in spec.input_modalities:
            raise ProviderRequestError(f"OpenCode Go 模型 {profile.model_id} 不支持图像输入。")
        if profile.model.max_output_tokens > spec.max_output_tokens:
            raise ProviderRequestError(
                f"OpenCode Go 模型 {profile.model_id} 的最大输出为 {spec.max_output_tokens} Token。"
            )
        options = profile.model.protocol_options
        if not isinstance(options, OpenCodeGoModelOptions):
            raise ProviderRequestError("OpenCode Go Provider 收到了其它协议的模型参数。")
        effort = options.reasoning_effort
        if effort is not None and effort not in spec.reasoning_efforts:
            raise ProviderRequestError(
                f"OpenCode Go 模型 {profile.model_id} 不支持推理强度 {effort.value}。"
            )
        if spec.transport == OpenCodeGoTransport.CHAT_COMPLETIONS:
            return await chat_completions.complete(spec, profile, credential, request)
        if spec.transport == OpenCodeGoTransport.ANTHROPIC_MESSAGES:
            return await anthropic_messages.complete(spec, profile, credential, request)
        raise ProviderRequestError(f"OpenCode Go 模型 {profile.model_id} 的传输协议无法识别。")
