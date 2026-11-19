from fastapi import APIRouter
from ...responses import error_response,success_response
from src.constants import INDAS_OUTPUT_JSON_PATH, IND_AS_TAXONOMY_VDB
from src.utils.main_utils import load_json
from src.pipeline.recom_taxonomies_pipeline import RecommendationPipeline
from api.v1.schemas.indas_schema import RecommendSchema

recomm_pipeline = RecommendationPipeline()
router = APIRouter()


@router.get("/authority")
async def get_autherity():
    try:
        data = await load_json(path=INDAS_OUTPUT_JSON_PATH)
        return success_response(data=data)
    except FileNotFoundError as e:
        return error_response(message="file not found",status_code=500,errors=e)



@router.post("/recommend/")
async def recommend_taxonomies(payload:RecommendSchema):
    try:
        data = await recomm_pipeline.initiate(keys=1,collection=IND_AS_TAXONOMY_VDB,top_k=payload.top_k,filter=payload.filter)
        return success_response(data=data,message="taxonomies taged returned",status_code=200)
    except TimeoutError as e:
        return error_response(message="timeout",status_code=500,errors=e)
        
    