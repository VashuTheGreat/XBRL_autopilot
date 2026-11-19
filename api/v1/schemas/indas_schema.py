from pydantic import BaseModel

class RecommendSchema(BaseModel):
    keys:list[str]
    filter:dict| None



