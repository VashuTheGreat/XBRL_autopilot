from fastapi import FastAPI
from api.routes import (
    taxonomies
)


app = FastAPI()


app.include_router(router=taxonomies.router,prefix="/api/v1/taxonomies")