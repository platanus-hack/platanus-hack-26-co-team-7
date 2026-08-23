"""Add immutable device identities and event-scoped gateway state.

Revision ID: 0004_device_signing
Revises: 0003_event_activation
"""

from alembic import op
import sqlalchemy as sa

revision = "0004_device_signing"
down_revision = "0003_event_activation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mobile_identity_device_identities",
        sa.Column("key_id", sa.String(64), primary_key=True),
        sa.Column("public_key", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), sa.ForeignKey("mobile_identity_profiles.user_id", ondelete="SET NULL")),
        sa.Column("registered_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("public_key", name="uq_mobile_identity_device_identities_public_key"),
    )
    op.create_index("ix_mobile_identity_device_identities_user_id", "mobile_identity_device_identities", ["user_id"])

    op.drop_constraint("gateway_sync_telegram_records_user_id_fkey", "gateway_sync_telegram_records", type_="foreignkey")
    op.add_column("gateway_sync_telegram_records", sa.Column("key_id", sa.String(64)))
    op.add_column("gateway_sync_telegram_records", sa.Column("signature", sa.String()))
    op.create_index("ix_gateway_sync_records_key_id", "gateway_sync_telegram_records", ["key_id"])
    op.drop_column("gateway_sync_telegram_records", "hmac_signature")
    op.drop_column("mobile_identity_profiles", "device_secret")

    # Evolve the canonical state table in place. Existing states whose last telegram
    # identifies an event become event-scoped; states without that evidence remain
    # nullable legacy rows instead of being guessed, dropped, or recreated.
    op.add_column("gateway_sync_person_states", sa.Column("event_id", sa.String(), sa.ForeignKey("events.event_id", ondelete="CASCADE")))
    op.execute(
        "UPDATE gateway_sync_person_states state SET event_id = record.event_id "
        "FROM gateway_sync_telegram_records record "
        "WHERE state.last_telegram_id = record.id"
    )
    op.execute("CREATE SEQUENCE gateway_sync_person_states_id_seq")
    op.add_column(
        "gateway_sync_person_states",
        sa.Column("id", sa.Integer(), server_default=sa.text("nextval('gateway_sync_person_states_id_seq')"), nullable=False),
    )
    op.execute("ALTER SEQUENCE gateway_sync_person_states_id_seq OWNED BY gateway_sync_person_states.id")
    op.drop_constraint("gateway_sync_person_states_pkey", "gateway_sync_person_states", type_="primary")
    op.create_primary_key("gateway_sync_person_states_pkey", "gateway_sync_person_states", ["id"])
    op.create_unique_constraint("uq_gateway_sync_person_states_event_user", "gateway_sync_person_states", ["event_id", "user_id"])
    op.create_index("ix_gateway_sync_person_states_user_id", "gateway_sync_person_states", ["user_id"])


def downgrade() -> None:
    raise RuntimeError("Device signing migration is intentionally irreversible.")
