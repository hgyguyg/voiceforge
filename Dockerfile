# 造声 Voiceforge — HuggingFace Spaces (Docker SDK)
# 监听端口必须是 7860（HF Spaces 固定要求）。
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# 依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 代码 + 静态资源 + 已经造好的 47 张声音卡（DB + 音频）
COPY app ./app
COPY run.py .
COPY data ./data

# HF Spaces 要求容器监听 7860
EXPOSE 7860

CMD ["python", "run.py"]
