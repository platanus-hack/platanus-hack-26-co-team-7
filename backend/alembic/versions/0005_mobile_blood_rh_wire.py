"""Normalize mobile blood Rh API values to enum names.

Revision ID: 0005_mobile_blood_rh_wire
Revises: 0004_device_signing
"""
from alembic import op

revision = "0005_mobile_blood_rh_wire"
down_revision = "0004_device_signing"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE mobile_identity_profiles SET blood_rh = 'POSITIVE' WHERE blood_rh = '+'")
    op.execute("UPDATE mobile_identity_profiles SET blood_rh = 'NEGATIVE' WHERE blood_rh = '-'")


def downgrade() -> None:
    op.execute("UPDATE mobile_identity_profiles SET blood_rh = '+' WHERE blood_rh = 'POSITIVE'")
    op.execute("UPDATE mobile_identity_profiles SET blood_rh = '-' WHERE blood_rh = 'NEGATIVE'")
