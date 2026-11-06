import uvicorn
from src.web.app import create_app
from src.core.logger import logger

app = create_app()

def dev():
    logger.info("🚀 Starting Multi-RAG development server with hot-reload", host="0.0.0.0", port=7860)
    uvicorn.run(
        "main:app", 
        host="0.0.0.0", 
        port=7860, 
        reload=True
    )

def start():
    logger.info("🚀 Starting Multi-RAG production server", host="0.0.0.0", port=7860)
    uvicorn.run(
        "main:app", 
        host="0.0.0.0", 
        port=7860, 
        reload=False
    )

if __name__ == "__main__":
    dev()