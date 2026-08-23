"""Add isolated private mobile identity and gateway-sync tables.

Revision ID: 0002_mobile_identity_sync
Revises: 0001_baseline
Create Date: 2026-08-22
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0002_mobile_identity_sync"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mobile_identity_profiles",
        sa.Column("user_id", sa.String(), primary_key=True),
        sa.Column("full_name", sa.String(), nullable=False),
        sa.Column("doc_type", sa.String(8), nullable=False),
        sa.Column("doc_number", sa.String(), nullable=False),
        sa.Column("birth_date", sa.Date(), nullable=False),
        sa.Column("blood_type", sa.String(4), nullable=False),
        sa.Column("blood_rh", sa.String(8), nullable=False),
        sa.Column("allergies", postgresql.JSONB(), nullable=False),
        sa.Column("chronic_conditions", postgresql.JSONB(), nullable=False),
        sa.Column("medications", postgresql.JSONB(), nullable=False),
        sa.Column("disability", sa.String(16), nullable=False),
        sa.Column("is_pregnant", sa.Boolean(), nullable=False),
        sa.Column("weight_kg", sa.Integer()),
        sa.Column("eps", sa.String()),
        sa.Column("question_id", sa.String(), nullable=False),
        sa.Column("answer_hash", sa.String(64), nullable=False),
        sa.Column("device_secret", sa.String(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("doc_type", "doc_number", name="uq_mobile_identity_profiles_document"),
    )
    op.create_table(
        "mobile_identity_emergency_contacts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.String(), sa.ForeignKey("mobile_identity_profiles.user_id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("phone", sa.String(), nullable=False),
        sa.Column("relationship", sa.String(), nullable=False),
        sa.UniqueConstraint("user_id", "phone", name="uq_mobile_identity_contacts_user_phone"),
    )
    op.create_table(
        "mobile_identity_credentials",
        sa.Column("user_id", sa.String(), sa.ForeignKey("mobile_identity_profiles.user_id", ondelete="CASCADE"), primary_key=True),
        sa.Column("password_hash", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_table(
        "mobile_identity_refresh_sessions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.String(), sa.ForeignKey("mobile_identity_profiles.user_id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_mobile_identity_refresh_sessions_user_id", "mobile_identity_refresh_sessions", ["user_id"])
    op.create_table(
        "gateway_sync_telegram_records",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("event_id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), sa.ForeignKey("mobile_identity_profiles.user_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("gateway_user_id", sa.String(), sa.ForeignKey("mobile_identity_profiles.user_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("event_type", sa.String(32), nullable=False),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lng", sa.Float(), nullable=False),
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
        sa.CheckConstraint("severity BETWEEN 1 AND 5", name="ck_gateway_sync_records_severity"),
        sa.CheckConstraint("hop >= 0", name="ck_gateway_sync_records_hop_nonneg"),
        sa.CheckConstraint("ttl >= 0", name="ck_gateway_sync_records_ttl_nonneg"),
    )
    op.create_index("ix_gateway_sync_records_event_id", "gateway_sync_telegram_records", ["event_id"])
    op.create_index("ix_gateway_sync_records_user_id", "gateway_sync_telegram_records", ["user_id"])
    op.create_index("ix_gateway_sync_records_gateway_user_id", "gateway_sync_telegram_records", ["gateway_user_id"])
    op.create_table(
        "gateway_sync_person_states",
        sa.Column("user_id", sa.String(), sa.ForeignKey("mobile_identity_profiles.user_id", ondelete="CASCADE"), primary_key=True),
        sa.Column("current_status", sa.String(16), nullable=False),
        sa.Column("last_telegram_id", sa.Uuid(), sa.ForeignKey("gateway_sync_telegram_records.id", ondelete="SET NULL")),
        sa.Column("emergency_status", sa.String(16)),
        sa.Column("emergency_lat", sa.Float()),
        sa.Column("emergency_lng", sa.Float()),
        sa.Column("emergency_timestamp", sa.DateTime(timezone=True)),
        sa.Column("safe_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )


def downgrade() -> None:
    op.drop_table("gateway_sync_person_states")
    op.drop_index("ix_gateway_sync_records_gateway_user_id", table_name="gateway_sync_telegram_records")
    op.drop_index("ix_gateway_sync_records_user_id", table_name="gateway_sync_telegram_records")
    op.drop_index("ix_gateway_sync_records_event_id", table_name="gateway_sync_telegram_records")
    op.drop_table("gateway_sync_telegram_records")
    op.drop_index("ix_mobile_identity_refresh_sessions_user_id", table_name="mobile_identity_refresh_sessions")
    op.drop_table("mobile_identity_refresh_sessions")
    op.drop_table("mobile_identity_credentials")
    op.drop_table("mobile_identity_emergency_contacts")
    op.drop_table("mobile_identity_profiles")
