FROM python:3.12-slim
WORKDIR /app
COPY . .
ENV ZHITU_HOST=0.0.0.0 ZHITU_PORT=8000 ZHITU_DATA_DIR=/data PYTHONUNBUFFERED=1
VOLUME ["/data"]
EXPOSE 8000
HEALTHCHECK CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/api/ready',timeout=3)"
CMD ["python", "server.py"]
