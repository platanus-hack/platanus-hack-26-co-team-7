"""Add durable event activation audit and revision metadata.

Revision ID: 0003_event_activation
Revises: 0002_mobile_identity_sync
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0003_event_activation"
down_revision = "0002_mobile_identity_sync"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("events", sa.Column("activation_revision", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("events", sa.Column("activation_source", sa.String(length=32)))
    op.execute("UPDATE events SET activation_revision = 1, activation_source = 'legacy' WHERE closed_at IS NULL")
    op.create_table(
        "event_activations",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("event_id", sa.String(), sa.ForeignKey("events.event_id", ondelete="CASCADE"), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("source_key", sa.String(length=256), nullable=False),
        sa.Column("actor_id", sa.String()),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("audit_metadata", postgresql.JSONB(), nullable=False),
        sa.Column("activated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("source", "source_key", name="uq_event_activations_source_key"),
    )


def downgrade() -> None:
    op.drop_table("event_activations")
    op.drop_column("events", "activation_source")
    op.drop_column("events", "activation_revision")
