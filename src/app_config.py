from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache
from typing import Optional
from pydantic import Field

DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b"


class AppConfig(BaseSettings):
    pydantic_logfire_api_key: Optional[str] = Field(None, validation_alias="PYDANTIC_LOGFIRE_API_KEY")
    service_name: Optional[str] = Field("xbrl-autopilot", validation_alias="SERVICE_NAME")

    # AI (Groq). Dev: from .env. Packaged app: injected by Electron main from safeStorage.
    groq_api_key: Optional[str] = Field(None, validation_alias="GROQ_API_KEY")
    groq_model: str = Field(DEFAULT_GROQ_MODEL, validation_alias="GROQ_MODEL")

    # Sidecar runtime (set by Electron main when it spawns us).
    xap_port: int = Field(7860, validation_alias="XAP_PORT")
    xap_token: Optional[str] = Field(None, validation_alias="XAP_TOKEN")

    model_config = SettingsConfigDict(
        env_file=".env",
        env_ignore_empty=True,
        extra="ignore",
    )


@lru_cache
def get_app_config():
    return AppConfig()
