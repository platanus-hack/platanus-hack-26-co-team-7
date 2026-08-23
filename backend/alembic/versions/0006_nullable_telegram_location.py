"""Make telegram location columns nullable for position-unavailable telegrams.

Revision ID: 0006_nullable_telegram_location
Revises: 0005_mobile_blood_rh_wire
"""
from alembic import op

revision = "0006_nullable_telegram_location"
down_revision = "0005_mobile_blood_rh_wire"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("gateway_sync_telegram_records", "lat", nullable=True)
    op.alter_column("gateway_sync_telegram_records", "lng", nullable=True)


def downgrade() -> None:
    op.execute("UPDATE gateway_sync_telegram_records SET lat = 0.0 WHERE lat IS NULL")
    op.execute("UPDATE gateway_sync_telegram_records SET lng = 0.0 WHERE lng IS NULL")
    op.alter_column("gateway_sync_telegram_records", "lat", nullable=False)
    op.alter_column("gateway_sync_telegram_records", "lng", nullable=False)
