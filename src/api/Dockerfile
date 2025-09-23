FROM python:3.13.7
RUN pip install uv
WORKDIR /code
COPY .python-version pyproject.toml uv.lock .
RUN uv sync
COPY ./ ./
CMD ["uv", "run", "main.py"]