"""FastAPI app: serves the label set, and loads/saves graphs/*.json."""

import json
import threading
import time
from pathlib import Path

import yaml
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from aag_studio.rag import Graph, LabelSet, validate_rag

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
LABELS_PATH = REPO_ROOT / "labels.yaml"
GRAPHS_DIR = REPO_ROOT / "graphs"
FRONTEND_DIR = REPO_ROOT / "frontend"

_file_lock = threading.Lock()

app = FastAPI()


@app.middleware("http")
async def no_browser_cache(request, call_next):
    # Without this, the browser can reuse a stale cached copy of a static
    # file (frontend/*.js, vendor/*) indefinitely without even asking the
    # server, so an edit to those files silently doesn't take effect.
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-cache"
    return response


def _graph_path(name: str) -> Path:
    if "/" in name or "\\" in name or name in (".", ".."):
        raise HTTPException(status_code=400, detail=f"invalid graph name: {name}")
    return GRAPHS_DIR / f"{name}.json"


def _layout_path(name: str) -> Path:
    return _graph_path(name).with_suffix("").with_suffix(".layout.json")


def _read_layout(name: str) -> dict:
    path = _layout_path(name)
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError:
        return {}


def _write_layout(name: str, layout: dict) -> None:
    path = _layout_path(name)
    temp_path = path.with_suffix(".tmp")
    temp_path.write_text(json.dumps(layout, indent=2))
    temp_path.replace(path)


def _write_graph(name: str, text: str) -> None:
    path = _graph_path(name)
    temp_path = path.with_suffix(".tmp")
    temp_path.write_text(text)
    temp_path.replace(path)


@app.get("/api/labels")
def get_labels() -> dict:
    return yaml.safe_load(LABELS_PATH.read_text())


@app.get("/api/graphs")
def list_graphs() -> list[dict]:
    graphs = []
    for path in GRAPHS_DIR.glob("*.json"):
        if path.name.endswith(".layout.json"):
            continue
        graphs.append(
            {
                "name": path.stem,
                "created": _read_layout(path.stem).get("created", path.stat().st_ctime),
                "modified": path.stat().st_mtime,
            }
        )
    return sorted(graphs, key=lambda g: g["name"])


@app.get("/api/graphs/{name}")
def get_graph(name: str) -> dict:
    path = _graph_path(name)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"no such graph: {name}")
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=400, detail=f"Broken graph file '{path.name}': {exc}"
        )


@app.put("/api/graphs/{name}")
def put_graph(name: str, graph: Graph) -> dict:
    violations = validate_rag(graph, LabelSet.load(LABELS_PATH))
    if violations:
        raise HTTPException(status_code=400, detail=violations)
    is_new = not _graph_path(name).exists()
    with _file_lock:
        _write_graph(name, graph.model_dump_json(indent=2))
        if is_new:
            layout = _read_layout(name)
            layout.setdefault("created", time.time())
            _write_layout(name, layout)
    return {}


class RenameRequest(BaseModel):
    new_name: str


@app.post("/api/graphs/{name}/rename")
def rename_graph(name: str, body: RenameRequest) -> dict:
    old_path = _graph_path(name)
    new_path = _graph_path(body.new_name)
    if not old_path.exists():
        raise HTTPException(status_code=404, detail=f"no such graph: {name}")
    if new_path.exists():
        raise HTTPException(
            status_code=400, detail=f"graph already exists: {body.new_name}"
        )
    with _file_lock:
        old_path.rename(new_path)
        old_layout = _layout_path(name)
        if old_layout.exists():
            old_layout.rename(_layout_path(body.new_name))
    return {"name": body.new_name}


@app.delete("/api/graphs/{name}")
def delete_graph(name: str) -> dict:
    path = _graph_path(name)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"no such graph: {name}")
    with _file_lock:
        path.unlink()
        _layout_path(name).unlink(missing_ok=True)
    return {}


@app.get("/api/graphs/{name}/layout")
def get_layout(name: str) -> dict:
    path = _layout_path(name)
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=400, detail=f"Broken layout file '{path.name}': {exc}"
        )


@app.put("/api/graphs/{name}/layout")
def put_layout(name: str, layout: dict) -> dict:
    with _file_lock:
        existing = _read_layout(name)
        existing.update(layout)
        graph_path = _graph_path(name)
        if graph_path.exists():
            try:
                graph_data = json.loads(graph_path.read_text())
                valid_vertex_ids = {
                    vertex["id"] for vertex in graph_data.get("vertices", [])
                }
                valid_edge_ids = {edge["id"] for edge in graph_data.get("edges", [])}
                if "positions" in existing:
                    existing["positions"] = {
                        k: v
                        for k, v in existing["positions"].items()
                        if k in valid_vertex_ids
                    }
                if "sizes" in existing:
                    existing["sizes"] = {
                        k: v
                        for k, v in existing["sizes"].items()
                        if k in valid_vertex_ids
                    }
                if "edge_styles" in existing:
                    existing["edge_styles"] = {
                        k: v
                        for k, v in existing["edge_styles"].items()
                        if k in valid_edge_ids
                    }
                if "edge_endpoints" in existing:
                    existing["edge_endpoints"] = {
                        k: v
                        for k, v in existing["edge_endpoints"].items()
                        if k in valid_edge_ids
                    }
                if "edge_elbows" in existing:
                    existing["edge_elbows"] = {
                        k: v
                        for k, v in existing["edge_elbows"].items()
                        if k in valid_edge_ids
                    }
            except Exception:
                pass
        _write_layout(name, existing)
    return {}


@app.post("/api/validate")
def validate(graph: Graph) -> list[str]:
    return validate_rag(graph, LabelSet.load(LABELS_PATH))


@app.get("/graphs/{name}")
def frontend_graph_route(name: str) -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")


app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
