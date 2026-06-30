from __future__ import annotations

from langchain_core.language_models import BaseChatModel

PROVIDERS = {
    "openai": {"module": "langchain_openai", "class": "ChatOpenAI", "default_model": "gpt-4o"},
    "anthropic": {"module": "langchain_anthropic", "class": "ChatAnthropic", "default_model": "claude-sonnet-4-20250514"},
    "google": {"module": "langchain_google_genai", "class": "ChatGoogleGenerativeAI", "default_model": "gemini-2.0-flash"},
}


def get_chat_model(
    provider: str,
    api_key: str,
    model: str | None = None,
) -> BaseChatModel:
    info = PROVIDERS.get(provider)
    if info is None:
        raise ValueError(f"Unsupported provider: {provider}. Choose from: {list(PROVIDERS)}")

    import importlib
    mod = importlib.import_module(info["module"])
    cls = getattr(mod, info["class"])
    chosen_model = model or info["default_model"]

    if provider == "openai":
        return cls(api_key=api_key, model=chosen_model)
    elif provider == "anthropic":
        return cls(api_key=api_key, model=chosen_model)
    elif provider == "google":
        return cls(google_api_key=api_key, model=chosen_model)
    return cls(api_key=api_key, model=chosen_model)


def list_providers() -> list[dict]:
    return [
        {"id": k, "default_model": v["default_model"]}
        for k, v in PROVIDERS.items()
    ]
