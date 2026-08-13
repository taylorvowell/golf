"""The hosted analyzer worker.

This package is the seam between job delivery (queue, HTTP, CLI — later steps of the
analyzer-service track) and the pipeline library (`swingsage.pipeline`). It contains no
queue, storage or database code yet — `worker.py` consumes a versioned job-spec JSON and
runs the pipeline, nothing more.
"""
