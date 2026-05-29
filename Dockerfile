FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip wget \
    && pip3 install --break-system-packages piper-tts \
    && mkdir -p /app/voices/en/en_US/hfc_female/medium \
    && wget -q -O /app/voices/en/en_US/hfc_female/medium/en_US-hfc_female-medium.onnx \
       "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/hfc_female/medium/en_US-hfc_female-medium.onnx" \
    && wget -q -O /app/voices/en/en_US/hfc_female/medium/en_US-hfc_female-medium.onnx.json \
       "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/hfc_female/medium/en_US-hfc_female-medium.onnx.json" \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY *.js *.json ./
COPY public/ ./public/

ENV NODE_ENV=production
ENV PORT=3000
ENV PIPER_CMD=piper
ENV PIPER_MODEL=/app/voices/en/en_US/hfc_female/medium/en_US-hfc_female-medium.onnx
ENV LM_STUDIO_BASE_URL=http://10.0.1.1:1234/v1
ENV LM_STUDIO_MODEL=google/gemma-4-e2b
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/healthz >/dev/null || exit 1

CMD ["node", "server.js"]
