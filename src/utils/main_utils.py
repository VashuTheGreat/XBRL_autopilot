import json


async def load_json(path:str):
    with open(path,"r",encoding='utf-8') as f:
        return json.load(f)


async def save_json(path:str,data):
    with open(path,"w", encoding='utf-8') as f:
        json.dump(data,f)


def to_chroma_metadata(concept: dict) -> dict:
    """
    ChromaDB only accepts primitive metadata (str, int, float, bool).
    Serializes nested dicts/lists to JSON strings for ChromaDB storage.
    """
    meta = {}
    for k, v in concept.items():
        if v is None:
            continue
        elif isinstance(v, (str, int, float, bool)):
            meta[k] = v
        elif isinstance(v, (dict, list)):
            meta[k] = json.dumps(v)
    return meta


def restore_metadata(meta: dict) -> dict:
    """
    Restores JSON-serialized strings back to native nested dicts and lists.
    """
    if not meta:
        return {}
    restored = {}
    for k, v in meta.items():
        if isinstance(v, str) and (v.startswith('{') or v.startswith('[')):
            try:
                restored[k] = json.loads(v)
            except Exception:
                restored[k] = v
        else:
            restored[k] = v
    return restored
