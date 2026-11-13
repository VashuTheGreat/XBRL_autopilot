import sys
from typing import Any


def error_message_detail(error: Exception | str, error_detail: Any) -> str:
    """Format detailed error message with filename and line number."""
    if hasattr(error_detail, "exc_info"):
        _, _, exc_tb = error_detail.exc_info()
    elif isinstance(error_detail, tuple) and len(error_detail) == 3:
        _, _, exc_tb = error_detail
    else:
        exc_tb = sys.exc_info()[2]

    if exc_tb is not None:
        file_name = exc_tb.tb_frame.f_code.co_filename
        line_number = exc_tb.tb_lineno
        return f"Error in [{file_name}] at line [{line_number}]: {str(error)}"
    return str(error)


class MyException(Exception):
    """Standard project exception preserving traceback context."""

    def __init__(self, error_message: Exception | str, error_detail: Any = sys):
        super().__init__(str(error_message))
        self.error_message = error_message_detail(error_message, error_detail=error_detail)

    def __str__(self) -> str:
        return self.error_message
