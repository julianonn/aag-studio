"""FastAPI app: serves the label set, and loads/saves graphs/*.json."""

import json
from pathlib import Path

import yaml
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

from aag_studio.rag import Graph, LabelSet, validate_rag

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
LABELS_PATH = REPO_ROOT / "labels.yaml"
GRAPHS_DIR = REPO_ROOT / "graphs"
FRONTEND_DIR = REPO_ROOT / "frontend"

app = FastAPI()


def _graph_path(name: str) -> Path:
    if "/" in name or "\\" in name or name in (".", ".."):
        raise HTTPException(status_code=400, detail=f"invalid graph name: {name}")
    return GRAPHS_DIR / f"{name}.json"


@app.get("/api/labels")
def get_labels() -> dict:
    return yaml.safe_load(LABELS_PATH.read_text())


@app.get("/api/graphs")
def list_graphs() -> list[str]:
    return sorted(path.stem for path in GRAPHS_DIR.glob("*.json"))


@app.get("/api/graphs/{name}")
def get_graph(name: str) -> dict:
    path = _graph_path(name)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"no such graph: {name}")
    return json.loads(path.read_text())


@app.put("/api/graphs/{name}")
def put_graph(name: str, graph: Graph) -> dict:
    violations = validate_rag(graph, LabelSet.load(LABELS_PATH))
    if violations:
        raise HTTPException(status_code=400, detail=violations)
    _graph_path(name).write_text(graph.model_dump_json(indent=2))
    return {}


@app.post("/api/validate")
def validate(graph: Graph) -> list[str]:
    return validate_rag(graph, LabelSet.load(LABELS_PATH))


app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
