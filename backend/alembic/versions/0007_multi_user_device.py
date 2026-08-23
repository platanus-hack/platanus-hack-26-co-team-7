"""Allow multiple users per device identity.

Revision ID: 0007_multi_user_device
Revises: 0006_nullable_telegram_location
"""
from alembic import op

revision = "0007_multi_user_device"
down_revision = "0006_nullable_telegram_location"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint(
        "uq_mobile_identity_device_identities_public_key",
        "mobile_identity_device_identities",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_mobile_identity_device_identities_user_key",
        "mobile_identity_device_identities",
        ["user_id", "key_id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_mobile_identity_device_identities_user_key",
        "mobile_identity_device_identities",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_mobile_identity_device_identities_public_key",
        "mobile_identity_device_identities",
        ["public_key"],
    )
