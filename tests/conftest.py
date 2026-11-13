from fastapi.testclient import TestClient
import pytest


def pytest_configure():
    import logfire

    configure = logfire.configure

    def configure_for_tests(*args, **kwargs):
        kwargs["send_to_logfire"] = False
        return configure(*args, **kwargs)

    logfire.configure = configure_for_tests
    logfire.instrument_system_metrics = lambda: None
    logfire.instrument_fastapi = lambda app: None


@pytest.fixture
def client():
    from api.app import app
    with TestClient(app) as e:
        yield e