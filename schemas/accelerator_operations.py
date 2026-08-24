from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class RuntimeOverrideUpdate(BaseModel):
    scope_type: Literal["global", "accelerator", "cohort"]
    scope_id: int | None = Field(default=None, gt=0)
    module_key: str = Field(min_length=2, max_length=50)
    disabled: bool
    reason: str = Field(min_length=2, max_length=4000)
    expires_at: datetime | None = None

    @model_validator(mode="after")
    def validate_scope(self):
        if self.scope_type == "global" and self.scope_id is not None:
            raise ValueError("Для глобального выключателя scope_id не нужен")
        if self.scope_type != "global" and self.scope_id is None:
            raise ValueError("Для выбранной области нужен scope_id")
        self.module_key = self.module_key.strip()
        self.reason = self.reason.strip()
        return self
