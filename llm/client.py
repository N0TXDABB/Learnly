"""Client for an AI model running on this computer.

Two kinds of local servers are supported:
  * Ollama (native API, default http://127.0.0.1:11434)
  * Anything OpenAI-compatible: LM Studio (http://127.0.0.1:1234/v1), llama.cpp's
    llama-server, Jan, vLLM, LocalAI.
Nothing is sent to a cloud service.
"""

from __future__ import annotations

import base64
import json
import re
import time
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Callable

import httpx

from ..config import CHAT_MODEL_PREFERENCE, RECOMMENDED_CHAT_MODEL


class LLMError(Exception):
    """The model answered with an error or with something unusable."""


class LLMUnavailable(LLMError):
    """No local AI server is reachable, or no suitable model is installed."""


@dataclass
class ChatResult:
    content: str
    thinking: str = ""
    model: str = ""
    tokens: int | None = None
    seconds: float = 0.0


@dataclass
class ModelInfo:
    name: str
    size: int = 0
    capabilities: list[str] = field(default_factory=list)
    parameter_size: str = ""
    family: str = ""

    @property
    def is_embedding(self) -> bool:
        return "embedding" in self.capabilities and "completion" not in self.capabilities

    def as_dict(self) -> dict:
        return {
            "name": self.name,
            "size": self.size,
            "capabilities": self.capabilities,
            "parameter_size": self.parameter_size,
            "family": self.family,
            "kind": "embedding" if self.is_embedding else "chat",
            "vision": "vision" in self.capabilities,
        }


_VISION_NAME = re.compile(r"vl\b|vl-|vision|qwen3\.5|qwen3-vl|gemma-?3|llava|minicpm-v|pixtral|mistral-small-3", re.I)

_THINK_BLOCK = re.compile(r"<think>.*?</think>\s*", re.S)


def strip_think(text: str) -> tuple[str, str]:
    """Split Qwen-style <think>…</think> reasoning out of a reply. Returns (answer, thinking)."""
    thinking = "".join(m.group(0) for m in _THINK_BLOCK.finditer(text))
    answer = _THINK_BLOCK.sub("", text)
    if "<think>" in answer:  # reasoning never closed: the model ran out of room while thinking
        head, _, rest = answer.partition("<think>")
        thinking += rest
        answer = head
    answer = answer.replace("</think>", "")
    thinking = thinking.replace("<think>", "").replace("</think>", "").strip()
    return answer.strip(), thinking


class ThinkFilter:
    """Streaming version of strip_think: feed chunks, get (visible, thinking) pieces back."""

    def __init__(self) -> None:
        self._buf = ""
        self._inside = False

    def feed(self, chunk: str) -> tuple[str, str]:
        self._buf += chunk
        visible, thinking = [], []
        while self._buf:
            tag = "</think>" if self._inside else "<think>"
            idx = self._buf.find(tag)
            if idx >= 0:
                (thinking if self._inside else visible).append(self._buf[:idx])
                self._buf = self._buf[idx + len(tag):]
                self._inside = not self._inside
                continue
            # Keep a possible partial tag at the end for the next chunk.
            keep = 0
            for n in range(min(len(tag) - 1, len(self._buf)), 0, -1):
                if tag.startswith(self._buf[-n:]):
                    keep = n
                    break
            emit, self._buf = self._buf[: len(self._buf) - keep], self._buf[len(self._buf) - keep:]
            (thinking if self._inside else visible).append(emit)
            break
        return "".join(visible), "".join(thinking)

    def flush(self) -> tuple[str, str]:
        rest, self._buf = self._buf, ""
        return ("", rest) if self._inside else (rest, "")


def _image_mime(b64: str) -> str:
    if b64.startswith("iVBOR"):
        return "image/png"
    if b64.startswith("UklGR"):
        return "image/webp"
    if b64.startswith("R0lGOD"):
        return "image/gif"
    return "image/jpeg"


def _pick(installed: list[str], wanted: str, preference: list[str]) -> tuple[str, str]:
    """Choose a model. Returns (model or "", note for the user or "")."""

    def match(name: str) -> str:
        if name in installed:
            return name
        if ":" not in name:  # "qwen3-embedding" matches any tag of it
            for candidate in installed:
                if candidate.split(":")[0] == name:
                    return candidate
        if name + ":latest" in installed:
            return name + ":latest"
        return ""

    if wanted:
        found = match(wanted)
        if found:
            return found, ""
    for name in preference:
        found = match(name)
        if found:
            note = f"'{wanted}' isn't installed, so {found} is used instead." if wanted else ""
            return found, note
    return "", ""


class LocalAI:
    def __init__(self, settings: Callable[[], dict], transport: httpx.AsyncBaseTransport | None = None):
        self._settings = settings
        self._transport = transport
        self._client: httpx.AsyncClient | None = None
        self._client_key: tuple | None = None
        self._status: tuple[float, dict] | None = None
        self._retired_clients: list[httpx.AsyncClient] = []
        self.last_activity: dict = {}

    # -- plumbing --------------------------------------------------------
    @property
    def provider(self) -> str:
        return self._settings().get("ai_provider", "ollama")

    @property
    def base_url(self) -> str:
        return str(self._settings().get("ai_base_url", "")).rstrip("/")

    def _http(self) -> httpx.AsyncClient:
        s = self._settings()
        timeout = float(s.get("ai_timeout_s", 300))
        key = (self.base_url, timeout)
        if self._client is None or self._client_key != key:
            old = self._client
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                transport=self._transport,
                timeout=httpx.Timeout(timeout, connect=5.0, write=30.0, pool=10.0),
                trust_env=False,  # a local server must not be sent through a proxy
            )
            self._client_key = key
            if old is not None:  # settings changed; close the old client on shutdown
                self._retired_clients.append(old)
        return self._client

    async def close(self) -> None:
        clients = self._retired_clients + ([self._client] if self._client is not None else [])
        self._client = None
        self._retired_clients = []
        for client in clients:
            await client.aclose()

    def invalidate(self) -> None:
        self._status = None

    def _server_name(self) -> str:
        return "Ollama" if self.provider == "ollama" else "the local AI server"

    async def _request(self, method: str, path: str, **kw) -> httpx.Response:
        try:
            resp = await self._http().request(method, path, **kw)
        except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
            raise LLMUnavailable(f"Can't reach {self._server_name()} at {self.base_url}. Is it running?") from exc
        except httpx.TimeoutException as exc:
            raise LLMError("The local model took too long to answer. Try a smaller model or a shorter request.") from exc
        except httpx.HTTPError as exc:
            raise LLMUnavailable(f"Connection to {self._server_name()} failed: {exc}") from exc
        if resp.status_code >= 400:
            raise self._http_error(resp)
        return resp

    def _http_error(self, resp: httpx.Response) -> LLMError:
        try:
            body = resp.json()
            message = body.get("error") if isinstance(body, dict) else str(body)
            if isinstance(message, dict):
                message = message.get("message", str(message))
        except ValueError:
            message = resp.text[:300]
        message = str(message or f"HTTP {resp.status_code}")
        if resp.status_code == 404 and "not found" in message.lower():
            return LLMUnavailable(f"The model isn't installed: {message}")
        return LLMError(f"{self._server_name()} returned an error: {message}")

    # -- models ----------------------------------------------------------
    async def version(self) -> str:
        if self.provider == "ollama":
            resp = await self._request("GET", "/api/version")
            return resp.json().get("version", "")
        await self._request("GET", "/models")
        return "openai-compatible"

    async def list_models(self) -> list[ModelInfo]:
        if self.provider == "ollama":
            data = (await self._request("GET", "/api/tags")).json()
            models = []
            for m in data.get("models", []):
                name = m.get("name") or m.get("model", "")
                details = m.get("details") or {}
                caps = list(m.get("capabilities") or [])
                if not caps:
                    caps = await self._ollama_capabilities(name, details)
                models.append(
                    ModelInfo(
                        name=name,
                        size=int(m.get("size") or 0),
                        capabilities=caps,
                        parameter_size=details.get("parameter_size", ""),
                        family=details.get("family", ""),
                    )
                )
            return models
        data = (await self._request("GET", "/models")).json()
        models = []
        for m in data.get("data", []):
            name = m.get("id", "")
            if "embed" in name.lower():
                caps = ["embedding"]
            else:
                # OpenAI-compatible servers don't report capabilities; guess photo support from the name.
                caps = ["completion"] + (["vision"] if _VISION_NAME.search(name) else [])
            models.append(ModelInfo(name=name, capabilities=caps))
        return models

    async def _ollama_capabilities(self, name: str, details: dict) -> list[str]:
        """Older Ollama versions leave capabilities out of /api/tags; /api/show has them."""
        try:
            data = (await self._request("POST", "/api/show", json={"model": name})).json()
            caps = data.get("capabilities")
            if caps:
                return list(caps)
        except LLMError:
            pass
        family = (details.get("family") or "").lower()
        if "embed" in name.lower() or family in {"bert", "nomic-bert"}:
            return ["embedding"]
        return ["completion"]

    async def status(self, force: bool = False) -> dict:
        if not force and self._status and time.monotonic() - self._status[0] < 10:
            return self._status[1]
        s = self._settings()
        result: dict[str, Any] = {
            "ok": False,
            "reachable": False,
            "provider": self.provider,
            "base_url": self.base_url,
            "version": "",
            "chat_model": "",
            "vision": False,
            "thinking": False,
            "models": [],
            "issues": [],
        }
        try:
            result["version"] = await self.version()
            result["reachable"] = True
            models = await self.list_models()
        except LLMError as exc:
            result["issues"].append(str(exc))
            self._status = (time.monotonic(), result)
            return result
        result["models"] = [m.as_dict() for m in models]
        chat_names = [m.name for m in models if not m.is_embedding]
        chat, note = _pick(chat_names, s.get("chat_model", ""), CHAT_MODEL_PREFERENCE)
        if not chat and chat_names:
            chat = chat_names[0]
            if s.get("chat_model"):
                note = f"'{s['chat_model']}' isn't installed, so {chat} is used instead."
        if note:
            result["issues"].append(note)
        if not chat:
            pull = f"ollama pull {RECOMMENDED_CHAT_MODEL}" if self.provider == "ollama" else "load a chat model in LM Studio"
            result["issues"].append(f"No chat model is installed yet. To add one: {pull}")
        info = {m.name: m for m in models}
        result["chat_model"] = chat
        if chat:
            result["vision"] = "vision" in info[chat].capabilities
            result["thinking"] = "thinking" in info[chat].capabilities
            if not result["vision"] and self.provider == "ollama":
                result["issues"].append(
                    f"{chat} can't read photos. For photo questions and photos of notes: ollama pull {RECOMMENDED_CHAT_MODEL}")
        result["ok"] = bool(chat)
        self._status = (time.monotonic(), result)
        return result

    async def _chat_model(self) -> tuple[str, dict]:
        status = await self.status()
        if not status["reachable"]:
            raise LLMUnavailable(status["issues"][0] if status["issues"] else "The local AI isn't running.")
        if not status["chat_model"]:
            raise LLMUnavailable(next((i for i in status["issues"] if "chat model" in i), "No chat model is installed."))
        return status["chat_model"], status

    # -- chat ------------------------------------------------------------
    def _ollama_payload(self, messages, model, status, *, think, schema, temperature, top_p, top_k,
                        presence_penalty, max_tokens, num_ctx, stream) -> dict:
        options: dict[str, Any] = {"temperature": temperature, "num_predict": max_tokens}
        if top_p is not None:
            options["top_p"] = top_p
        if top_k is not None:
            options["top_k"] = top_k
        if presence_penalty is not None:
            options["presence_penalty"] = presence_penalty
        if num_ctx:
            options["num_ctx"] = num_ctx
        payload: dict[str, Any] = {"model": model, "messages": messages, "stream": stream, "options": options, "keep_alive": "15m"}
        if status.get("thinking"):
            payload["think"] = bool(think)
        if schema is not None:
            payload["format"] = schema
        return payload

    def _openai_messages(self, messages: list[dict]) -> list[dict]:
        out = []
        for m in messages:
            images = m.get("images") or []
            if images:
                parts: list[dict] = [{"type": "text", "text": m.get("content", "")}]
                for img in images:
                    parts.append({"type": "image_url", "image_url": {"url": f"data:{_image_mime(img)};base64,{img}"}})
                out.append({"role": m["role"], "content": parts})
            else:
                out.append({"role": m["role"], "content": m.get("content", "")})
        return out

    def _openai_payload(self, messages, model, *, schema, temperature, top_p, presence_penalty, max_tokens, stream) -> dict:
        payload: dict[str, Any] = {
            "model": model,
            "messages": self._openai_messages(messages),
            "stream": stream,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if top_p is not None:
            payload["top_p"] = top_p
        if presence_penalty is not None:
            payload["presence_penalty"] = presence_penalty
        if schema is not None:
            payload["response_format"] = {"type": "json_schema", "json_schema": {"name": "result", "schema": schema, "strict": False}}
        return payload

    async def chat(
        self,
        messages: list[dict],
        *,
        think: bool = False,
        schema: dict | None = None,
        temperature: float = 0.7,
        top_p: float | None = 0.8,
        top_k: int | None = 20,
        presence_penalty: float | None = None,
        max_tokens: int = 1024,
        num_ctx: int | None = 8192,
    ) -> ChatResult:
        model, status = await self._chat_model()
        started = time.monotonic()
        if self.provider == "ollama":
            payload = self._ollama_payload(
                messages, model, status, think=think, schema=schema, temperature=temperature, top_p=top_p,
                top_k=top_k, presence_penalty=presence_penalty, max_tokens=max_tokens, num_ctx=num_ctx, stream=False,
            )
            data = (await self._request("POST", "/api/chat", json=payload)).json()
            message = data.get("message") or {}
            content, inline_thinking = strip_think(message.get("content") or "")
            thinking = (message.get("thinking") or "") + inline_thinking
            tokens = data.get("eval_count")
        else:
            payload = self._openai_payload(
                messages, model, schema=schema, temperature=temperature, top_p=top_p,
                presence_penalty=presence_penalty, max_tokens=max_tokens, stream=False,
            )
            try:
                data = (await self._request("POST", "/chat/completions", json=payload)).json()
            except LLMError:
                if schema is None:
                    raise
                payload.pop("response_format", None)  # some servers don't do structured output
                data = (await self._request("POST", "/chat/completions", json=payload)).json()
            choice = (data.get("choices") or [{}])[0].get("message") or {}
            content, inline_thinking = strip_think(choice.get("content") or "")
            thinking = (choice.get("reasoning_content") or "") + inline_thinking
            tokens = (data.get("usage") or {}).get("completion_tokens")
        seconds = time.monotonic() - started
        self.last_activity = {"at": time.time(), "model": model, "tokens": tokens, "seconds": round(seconds, 2)}
        return ChatResult(content=content, thinking=thinking, model=model, tokens=tokens, seconds=seconds)

    async def chat_stream(
        self,
        messages: list[dict],
        *,
        think: bool = False,
        temperature: float = 0.7,
        top_p: float | None = 0.8,
        top_k: int | None = 20,
        presence_penalty: float | None = None,
        max_tokens: int = 2048,
        num_ctx: int | None = 8192,
    ) -> AsyncIterator[dict]:
        """Yield {"type": "token"|"thinking", "text": str} pieces, then {"type": "done", ...}."""
        model, status = await self._chat_model()
        started = time.monotonic()
        filt = ThinkFilter()
        count = 0
        if self.provider == "ollama":
            payload = self._ollama_payload(
                messages, model, status, think=think, schema=None, temperature=temperature, top_p=top_p,
                top_k=top_k, presence_penalty=presence_penalty, max_tokens=max_tokens, num_ctx=num_ctx, stream=True,
            )
            path = "/api/chat"
        else:
            payload = self._openai_payload(
                messages, model, schema=None, temperature=temperature, top_p=top_p,
                presence_penalty=presence_penalty, max_tokens=max_tokens, stream=True,
            )
            path = "/chat/completions"
        try:
            async with self._http().stream("POST", path, json=payload) as resp:
                if resp.status_code >= 400:
                    await resp.aread()
                    raise self._http_error(resp)
                async for line in resp.aiter_lines():
                    line = line.strip()
                    if not line:
                        continue
                    if self.provider == "ollama":
                        try:
                            data = json.loads(line)
                        except ValueError:
                            continue
                        if data.get("error"):
                            raise LLMError(f"Ollama returned an error: {data['error']}")
                        message = data.get("message") or {}
                        thinking_piece = message.get("thinking") or ""
                        content_piece = message.get("content") or ""
                        done = bool(data.get("done"))
                    else:
                        if not line.startswith("data:"):
                            continue
                        body = line[5:].strip()
                        if body == "[DONE]":
                            break
                        try:
                            data = json.loads(body)
                        except ValueError:
                            continue
                        delta = ((data.get("choices") or [{}])[0].get("delta")) or {}
                        thinking_piece = delta.get("reasoning_content") or ""
                        content_piece = delta.get("content") or ""
                        done = False
                    if thinking_piece:
                        yield {"type": "thinking", "text": thinking_piece}
                    if content_piece:
                        visible, hidden = filt.feed(content_piece)
                        if hidden:
                            yield {"type": "thinking", "text": hidden}
                        if visible:
                            count += 1
                            yield {"type": "token", "text": visible}
                    if done:
                        break
        except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
            raise LLMUnavailable(f"Can't reach {self._server_name()} at {self.base_url}. Is it running?") from exc
        except httpx.TimeoutException as exc:
            raise LLMError("The local model took too long to answer.") from exc
        visible, hidden = filt.flush()
        if hidden:
            yield {"type": "thinking", "text": hidden}
        if visible:
            yield {"type": "token", "text": visible}
        seconds = time.monotonic() - started
        self.last_activity = {"at": time.time(), "model": model, "tokens": count, "seconds": round(seconds, 2)}
        yield {"type": "done", "model": model, "seconds": round(seconds, 2)}

    # -- model downloads (Ollama only) ----------------------------------
    async def pull(self, model: str) -> AsyncIterator[dict]:
        if self.provider != "ollama":
            raise LLMError("Downloading models from here only works with Ollama. Use LM Studio's own model browser.")
        try:
            async with self._http().stream("POST", "/api/pull", json={"model": model, "stream": True}, timeout=None) as resp:
                if resp.status_code >= 400:
                    await resp.aread()
                    raise self._http_error(resp)
                async for line in resp.aiter_lines():
                    if line.strip():
                        try:
                            yield json.loads(line)
                        except ValueError:
                            continue
        except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
            raise LLMUnavailable(f"Can't reach Ollama at {self.base_url}. Is it running?") from exc
        self.invalidate()


def encode_image(data: bytes) -> str:
    return base64.b64encode(data).decode()
