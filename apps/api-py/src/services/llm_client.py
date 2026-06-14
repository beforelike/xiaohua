"""LLM 客户端

封装 OpenAI 兼容的 Chat Completions 接口，供命令解析、提示词增强等场景调用。
默认面向本地部署的兼容服务（如 vLLM / Ollama / LM Studio），符合项目离线本地化要求。

设计要点：
- 仅依赖已有的 httpx，不引入新依赖。
- 强制 JSON 输出（response_format=json_object），并对不支持该字段的服务做降级解析。
- 所有网络异常统一封装为 LLMError，调用方据此触发优雅降级（回退规则解析 / 返回中文错误）。
"""

import json
import logging
import re
from typing import Any

import httpx

from src.config import Settings, get_settings

logger = logging.getLogger(__name__)

# 从 ```json ... ``` 代码块中提取 JSON 的兜底正则
_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL)
_JSON_OBJECT_RE = re.compile(r"\{.*\}", re.DOTALL)


class LLMError(Exception):
    """LLM 调用异常（网络、超时、返回格式非法等）"""


def _extract_content(data: dict[str, Any]) -> str:
    """从 chat/completions 响应中提取 assistant 文本内容"""
    try:
        choices = data["choices"]
        message = choices[0]["message"]
        content = message.get("content")
    except (KeyError, IndexError, TypeError) as e:
        raise LLMError("LLM 返回结构异常：缺少 choices/message/content") from e

    if not isinstance(content, str) or not content.strip():
        raise LLMError("LLM 返回内容为空")
    return content


def _parse_json_content(content: str) -> dict[str, Any]:
    """将模型输出文本解析为 JSON 对象，兼容包裹在代码块或多余文本中的情况"""
    text = content.strip()

    # 1. 直接解析
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    # 2. 提取 ```json``` 代码块
    fence_match = _JSON_FENCE_RE.search(text)
    if fence_match:
        try:
            parsed = json.loads(fence_match.group(1))
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass

    # 3. 截取首个 { 到末个 } 的子串
    obj_match = _JSON_OBJECT_RE.search(text)
    if obj_match:
        try:
            parsed = json.loads(obj_match.group(0))
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass

    raise LLMError("无法从 LLM 返回中解析出合法 JSON 对象")


class LLMClient:
    """OpenAI 兼容的 Chat Completions 客户端"""

    def __init__(
        self,
        base_url: str,
        model: str,
        api_key: str = "",
        timeout_seconds: float = 20.0,
        temperature: float = 0.2,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.api_key = api_key
        self.timeout_seconds = timeout_seconds
        self.temperature = temperature

    @classmethod
    def from_settings(cls, settings: Settings | None = None) -> "LLMClient":
        """从全局配置构建客户端"""
        s = settings or get_settings()
        return cls(
            base_url=s.llm_base_url,
            model=s.llm_model,
            api_key=s.llm_api_key,
            timeout_seconds=s.llm_timeout_seconds,
            temperature=s.llm_temperature,
        )

    @property
    def is_configured(self) -> bool:
        """是否具备调用条件（已配置接口地址与模型）"""
        return bool(self.base_url and self.model)

    async def chat_json(
        self,
        system_prompt: str,
        user_prompt: str,
        *,
        temperature: float | None = None,
    ) -> dict[str, Any]:
        """请求 LLM 并返回解析后的 JSON 对象

        Args:
            system_prompt: 系统提示词
            user_prompt: 用户提示词
            temperature: 覆盖默认采样温度

        Returns:
            解析后的 JSON 字典

        Raises:
            LLMError: 未配置、网络异常、超时或返回格式非法
        """
        if not self.is_configured:
            raise LLMError("LLM 未配置（缺少 base_url 或 model）")

        payload: dict[str, Any] = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": self.temperature if temperature is None else temperature,
            "response_format": {"type": "json_object"},
        }
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        url = f"{self.base_url}/chat/completions"
        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                response = await client.post(url, json=payload, headers=headers)
                response.raise_for_status()
                data = response.json()
        except httpx.TimeoutException as e:
            raise LLMError(f"LLM 请求超时（超过 {self.timeout_seconds:.0f} 秒）") from e
        except httpx.HTTPStatusError as e:
            raise LLMError(
                f"LLM 服务返回错误状态码：{e.response.status_code}"
            ) from e
        except httpx.HTTPError as e:
            raise LLMError(f"LLM 请求失败：{e}") from e
        except json.JSONDecodeError as e:
            raise LLMError("LLM 响应不是合法 JSON") from e

        content = _extract_content(data)
        result = _parse_json_content(content)
        logger.debug("LLM 解析成功，返回字段: %s", list(result.keys()))
        return result
