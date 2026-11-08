from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache
from typing import Optional, Union
from pydantic import Field

class AppConfig(BaseSettings):
    pydantic_logfire_api_key: Optional[str] = Field(None, validation_alias="PYDANTIC_LOGFIRE_API_KEY")
    service_name: Optional[str] = Field("xbrl-autopilot", validation_alias="SERVICE_NAME")

    model_config = SettingsConfigDict(
        env_file=".env",
        env_ignore_empty=True,
        extra="ignore",
    )



@lru_cache
def get_app_config():
    return AppConfig()
