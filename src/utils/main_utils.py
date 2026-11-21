import json
import pickle
from pathlib import Path
from src.core.logger import logger


async def load_json(path: str | Path):
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    logger.debug("utils.json_loaded", path=str(path))
    return data


async def save_json(path: str | Path, data):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(data, f)
    logger.debug("utils.json_saved", path=str(path))


def to_chroma_metadata(concept: dict) -> dict:
    """
    ChromaDB / Vector store only accepts primitive metadata (str, int, float, bool).
    Serializes nested dicts/lists to JSON strings for vector DB storage.
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
        if isinstance(v, str) and (v.startswith("{") or v.startswith("[")):
            try:
                restored[k] = json.loads(v)
            except Exception:
                restored[k] = v
        else:
            restored[k] = v
    return restored


class _PortablePathUnpickler(pickle.Unpickler):
    """Loads pickles made on another OS: a pickled PosixPath / WindowsPath becomes this OS's Path.

    The committed BM25 index (db/*.pkl) is built on Linux; without this Windows fails with
    "cannot instantiate 'PosixPath' on your system".
    """

    def find_class(self, module: str, name: str):
        if module.startswith("pathlib") and name in ("PosixPath", "WindowsPath"):
            return Path
        return super().find_class(module, name)


async def load_object(file_path: str | Path):
    with open(file_path, "rb") as f:
        obj = _PortablePathUnpickler(f).load()
    logger.debug("utils.object_loaded", file_path=str(file_path))
    return obj


async def save_object(file_path: str | Path, object: object):
    path = Path(file_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f:
        pickle.dump(object, f)
    logger.debug("utils.object_saved", file_path=str(file_path))


async def save_xml(file_path: str | Path, content: str):
    path = Path(file_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    logger.debug("utils.xml_saved", file_path=str(file_path))


async def load_xml(file_path: str | Path) -> str:
    path = Path(file_path)
    with open(path, "r", encoding="utf-8") as f:
        data = f.read()
    logger.debug("utils.xml_loaded", file_path=str(file_path))
    return data


async def save_file(file_path: str | Path, content: bytes):
    path = Path(file_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f:
        f.write(content)
    logger.debug("utils.file_saved", file_path=str(file_path))


async def load_file(file_path: str | Path) -> bytes:
    path = Path(file_path)
    with open(path, "rb") as f:
        data = f.read()
    logger.debug("utils.file_loaded", file_path=str(file_path))
    return data

