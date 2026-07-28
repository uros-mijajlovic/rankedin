FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
# Cloud Run provides $PORT
CMD exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}
