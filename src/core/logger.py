import logfire
from src.app_config import get_app_config
from functools import lru_cache


@lru_cache
def initialise_logger():
    """initialise logger for monitoring system with pydantic logfire"""
    app_config = get_app_config()
    logfire.configure(
        send_to_logfire="if-token-present",
        token=app_config.pydantic_logfire_api_key,
        service_name=app_config.service_name or "xbrl-autopilot",
    )
    logfire.instrument_pydantic()
    logfire.instrument_system_metrics()
    logfire.info("logger.initialized", service=app_config.service_name or "xbrl-autopilot")
    return logfire


logger = initialise_logger()