"""Feature modules of the single-process backend (openspec/architecture.md,
Componente 2). Each module owns its router and business logic; modules never
call each other directly or over HTTP — only through the shared DB (see
``app.core``)."""
