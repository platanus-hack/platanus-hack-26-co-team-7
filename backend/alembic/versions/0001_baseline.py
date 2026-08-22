"""Create the initial Replica schema, including private mobile credentials.

Revision ID: 0001_baseline
Revises:
Create Date: 2026-08-22
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "events",
        sa.Column("event_id", sa.String(), primary_key=True),
        sa.Column("event_type", sa.String(32), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("closed_at", sa.DateTime(timezone=True)),
        sa.Column("closed_reason", sa.String(32)),
        sa.CheckConstraint("(closed_at IS NULL) = (closed_reason IS NULL)", name="ck_events_closed_pairing"),
    )
    op.create_table(
        "persons",
        sa.Column("user_id", sa.String(), primary_key=True),
        sa.Column("full_name", sa.String(), nullable=False),
        sa.Column("doc_type", sa.String(8), nullable=False),
        sa.Column("doc_number", sa.String(), nullable=False),
        sa.Column("birth_date", sa.Date(), nullable=False),
        sa.Column("blood_type", sa.String(4), nullable=False),
        sa.Column("blood_rh", sa.String(8), nullable=False),
        sa.Column("allergies", postgresql.JSONB(), nullable=False),
        sa.Column("chronic_conditions", postgresql.JSONB(), nullable=False),
        sa.Column("medications", postgresql.JSONB()),
        sa.Column("disability", sa.String(16), nullable=False),
        sa.Column("is_pregnant", sa.Boolean(), nullable=False),
        sa.Column("weight_kg", sa.Integer()),
        sa.Column("eps", sa.String()),
        sa.Column("question_id", sa.String(), nullable=False),
        sa.Column("answer_hash", sa.String(64), nullable=False),
        sa.Column("device_secret", sa.String(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("doc_type", "doc_number", name="uq_persons_document"),
    )
    op.create_table(
        "emergency_contacts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.String(), sa.ForeignKey("persons.user_id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("phone", sa.String(), nullable=False),
        sa.Column("relationship", sa.String(), nullable=False),
        sa.UniqueConstraint("user_id", "phone", name="uq_emergency_contacts_person_phone"),
    )
    op.create_table(
        "user_credentials",
        sa.Column("user_id", sa.String(), sa.ForeignKey("persons.user_id", ondelete="CASCADE"), primary_key=True),
        sa.Column("password_hash", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_table(
        "refresh_sessions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.String(), sa.ForeignKey("persons.user_id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_refresh_sessions_user_id", "refresh_sessions", ["user_id"])
    op.create_table(
        "telegrams",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("event_id", sa.String(), sa.ForeignKey("events.event_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("user_id", sa.String(), sa.ForeignKey("persons.user_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("event_type", sa.String(32), nullable=False),
        sa.Column("lat", sa.Float()),
        sa.Column("lng", sa.Float()),
        sa.Column("origin_ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("severity", sa.Integer(), nullable=False),
        sa.Column("hop", sa.Integer(), nullable=False),
        sa.Column("ttl", sa.Integer(), nullable=False),
        sa.Column("origin_device", sa.String(), nullable=False),
        sa.Column("hmac_signature", sa.String()),
        sa.Column("question_id", sa.String()),
        sa.Column("answer_hash", sa.String(64)),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("(lat IS NULL) = (lng IS NULL)", name="ck_telegrams_location_pairing"),
        sa.CheckConstraint("severity BETWEEN 1 AND 5", name="ck_telegrams_severity"),
        sa.CheckConstraint("hop >= 0", name="ck_telegrams_hop_nonneg"),
        sa.CheckConstraint("ttl > 0", name="ck_telegrams_ttl_positive"),
    )
    op.create_index("ix_telegrams_event_id", "telegrams", ["event_id"])
    op.create_index("ix_telegrams_user_id", "telegrams", ["user_id"])
    op.create_index("ix_telegrams_received_at", "telegrams", ["received_at"])
    op.create_table(
        "telegram_hops",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("telegram_id", sa.Uuid(), sa.ForeignKey("telegrams.id", ondelete="CASCADE"), nullable=False),
        sa.Column("peer_id", sa.String(), nullable=False),
        sa.Column("hop_at_peer", sa.Integer(), nullable=False),
        sa.Column("seen_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("telegram_id", "peer_id", "hop_at_peer", name="uq_telegram_hops_unique_leg"),
    )
    op.create_index("ix_telegram_hops_telegram_id", "telegram_hops", ["telegram_id"])
    op.create_table(
        "cases",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("event_id", sa.String(), sa.ForeignKey("events.event_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("user_id", sa.String(), sa.ForeignKey("persons.user_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("current_status", sa.String(16), nullable=False),
        sa.Column("last_telegram_id", sa.Uuid(), sa.ForeignKey("telegrams.id", ondelete="SET NULL")),
        sa.Column("priority_rank", sa.Integer(), nullable=False),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("closed_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("event_id", "user_id", name="uq_cases_event_person"),
    )
    op.create_table(
        "families",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.String(), sa.ForeignKey("persons.user_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("contact", sa.String(), nullable=False),
        sa.Column("ws_token", sa.String(), nullable=False, unique=True),
        sa.Column("last_notified_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_families_contact", "families", ["contact"])
    op.create_table(
        "evidence_chunks",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("telegram_id", sa.Uuid(), sa.ForeignKey("telegrams.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("total_chunks", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("storage_url", sa.String(), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.CheckConstraint("chunk_index >= 0 AND total_chunks >= 1 AND chunk_index < total_chunks", name="ck_evidence_chunks_chunk_bounds"),
        sa.UniqueConstraint("telegram_id", "kind", "chunk_index"),
    )
    op.create_table(
        "reports",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("event_id", sa.String(), sa.ForeignKey("events.event_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("source", sa.String(16), nullable=False),
        sa.Column("content", postgresql.JSONB(), nullable=False),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_reports_event_id_generated_at", "reports", ["event_id", "generated_at"])
    op.create_table(
        "received_cells",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("event_id", sa.String(), sa.ForeignKey("events.event_id", ondelete="CASCADE"), nullable=False),
        sa.Column("h3_index", sa.String(15), nullable=False),
        sa.Column("window_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("window_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("person_count", sa.Integer(), nullable=False),
        sa.Column("intensity", sa.Float(), nullable=False),
        sa.CheckConstraint("window_start < window_end", name="ck_received_cells_window"),
        sa.CheckConstraint("person_count >= 0", name="ck_received_cells_count_nonneg"),
        sa.CheckConstraint("intensity >= 0", name="ck_received_cells_intensity_nonneg"),
        sa.UniqueConstraint("event_id", "h3_index", "window_start"),
    )
    op.create_index("ix_received_cells_event_h3", "received_cells", ["event_id", "h3_index"])


def downgrade() -> None:
    op.drop_table("received_cells")
    op.drop_table("reports")
    op.drop_table("evidence_chunks")
    op.drop_table("families")
    op.drop_table("cases")
    op.drop_table("telegram_hops")
    op.drop_table("telegrams")
    op.drop_table("refresh_sessions")
    op.drop_table("user_credentials")
    op.drop_table("emergency_contacts")
    op.drop_table("persons")
    op.drop_table("events")
