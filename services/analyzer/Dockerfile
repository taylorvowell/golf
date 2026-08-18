# The analyzer worker image — code + pinned pip deps ONLY.
#
# Model assets are NEVER image layers (they are retrained/overwritten locally, so a layer
# would version them silently). They are fetched at container start by the entrypoint, from
# the checksummed manifest in service/models.py, into these paths — mount them as volumes so
# a restart is free:
#   -v <models>:/app/models         pose_landmarker_heavy.task (MediaPipe, public URL)
#   -v <runs>:/app/runs             fine-tuned club-head weights (best.pt — PRIVATE; set
#                                   SWINGSAGE_CLUB_WEIGHTS_URL, see `pnpm --filter web
#                                   models:publish`)
#   -v <cache>:/root/.cache/rtmlib  RTMW/RTMPose onnx (~430 MB, public MMPose URLs)
#
# SWINGSAGE_MODEL_GROUPS (default "pose,club") states which of those this deployment needs.
# A missing or hash-mismatched asset stops the container before it can serve a job.
#
# Python 3.13 matches the dev venv (3.13.7). The torch cu126 wheels install from the extra
# index pinned in requirements.txt and run on CPU-only hosts too — one faithful image, host
# decision deferred (docs/HANDOFF.md "Decide the analyzer worker host").
#
# Build from the REPO ROOT (context carries packages/schema/schemas; see /.dockerignore):
#   docker build -f services/analyzer/Dockerfile -t swingsage-analyzer:dev .
FROM python:3.13-slim

# ffmpeg: required system dep (video.py/render.py resolve it with shutil.which).
# libgl1/libglib2.0-0: opencv runtime links. libportaudio2: sounddevice, a mediapipe dep.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libgl1 libglib2.0-0 libportaudio2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Deps first for layer caching; rtmlib is --no-deps BY DESIGN — its metadata requires the
# CPU-only `onnxruntime` distribution, which must never sit next to onnxruntime-gpu
# (see requirements.txt header for the incident this prevents).
COPY services/analyzer/requirements.txt services/analyzer/requirements-dev.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir --no-deps rtmlib==0.0.16 \
    && pip install --no-cache-dir -r requirements-dev.txt

# The shared contract schemas — the SAME files the TypeScript types generate from, shipped
# so producer-side validation stays ACTIVE in the image (contract.py refuses to write an
# artifact it cannot validate when jsonschema is installed).
COPY packages/schema/schemas/ /app/schemas/
ENV SWINGSAGE_SCHEMA_DIR=/app/schemas

COPY services/analyzer/swingsage/ swingsage/
COPY services/analyzer/scoring_config/ scoring_config/
COPY services/analyzer/scripts/ scripts/
COPY services/analyzer/service/ service/
COPY services/analyzer/tests/ tests/

RUN chmod +x service/entrypoint.sh

# Every command goes through the model bootstrap first. The suite needs no model on disk, so
# it opts out rather than downloading 480 MB:
#   docker run --rm -e SWINGSAGE_SKIP_MODEL_BOOTSTRAP=1 swingsage-analyzer:dev \
#       python -m pytest tests
ENTRYPOINT ["service/entrypoint.sh"]

# Default: run one job spec (see service/worker.py).
CMD ["python", "-m", "service.worker", "-"]
