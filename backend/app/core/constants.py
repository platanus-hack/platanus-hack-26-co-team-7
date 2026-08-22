"""Shared domain constants.

``H3_CELL_RESOLUTION`` cites openspec/DECISIONS.md (decision D1 of the
dashboard-web change): resolution 8 (~500 m cells) balances urban heatmap
granularity against privacy. Single source of documentation lives there;
importers must use this constant, never hardcode the value.
"""

H3_CELL_RESOLUTION = 8
