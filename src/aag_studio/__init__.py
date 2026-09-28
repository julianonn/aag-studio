def main() -> None:
    import uvicorn

    uvicorn.run("aag_studio.api:app", reload=True)
