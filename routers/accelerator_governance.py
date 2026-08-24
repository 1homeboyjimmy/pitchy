"""Route ownership for accelerator quotas and audit governance.

The endpoint implementations remain compatibility exports in
``routers.accelerators`` because existing integrations import them directly.
Keeping registration here lets the public router be decomposed without a risky
all-at-once rewrite of the established domain functions.
"""
from fastapi import APIRouter

from routers.accelerators import (
    assign_cohort_quota,
    assign_resident_quota,
    get_resident_quota,
    list_audit,
)


router = APIRouter(prefix="/api/accelerators", tags=["accelerator-governance"])
router.add_api_route(
    "/memberships/{membership_id}/quota",
    assign_resident_quota,
    methods=["PUT"],
)
router.add_api_route(
    "/cohorts/{cohort_id}/quota-template",
    assign_cohort_quota,
    methods=["PUT"],
)
router.add_api_route(
    "/memberships/{membership_id}/quota",
    get_resident_quota,
    methods=["GET"],
)
router.add_api_route(
    "/{accelerator_id}/audit",
    list_audit,
    methods=["GET"],
)
