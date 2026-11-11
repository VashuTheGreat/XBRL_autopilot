from pydantic import BaseModel, Field

# base64 of a 64 MB workbook; client files are a few MB (DGPL .xls 0.8 MB, HPL .xlsx 8 MB)
MAX_BASE64_CHARS = 90_000_000


class ReadWorkbookRequest(BaseModel):
    fileName: str = Field(max_length=260)
    contentBase64: str = Field(max_length=MAX_BASE64_CHARS)
