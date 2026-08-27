"""Ground-truth annotation schemas, evaluators and golden-set tooling.

This package is internal evaluation infrastructure - nothing in it ships to a
client, and nothing in the analyzer pipeline imports it. Labels live beside the
clips they describe (gitignored, like the footage); the label MANIFEST and this
code are committed.
"""
