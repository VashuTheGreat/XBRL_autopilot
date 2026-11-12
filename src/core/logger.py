import sys
from functools import lru_cache
import logfire
from src.app_config import get_app_config


@lru_cache
def initialise_logger():
    """initialise logger for monitoring system with pydantic logfire"""
    app_config = get_app_config()
    logfire.configure(
        send_to_logfire="if-token-present",
        token=app_config.pydantic_logfire_api_key,
        service_name=app_config.service_name or "xbrl-autopilot",
    )
    # In frozen PyInstaller bundles, source files are not on disk, so inspect.getsource in instrument_pydantic fails
    if not getattr(sys, "frozen", False):
        try:
            logfire.instrument_pydantic()
        except Exception:
            pass
    try:
        logfire.instrument_system_metrics()
    except Exception:
        pass
    logfire.info("logger.initialized", service=app_config.service_name or "xbrl-autopilot")
    return logfire


logger = initialise_logger()