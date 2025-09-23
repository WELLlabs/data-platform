from typing import Optional

from fastapi_users import schemas


class UserRead(schemas.BaseUser[schemas.uuid.UUID_ID]):
    full_name: Optional[str] = None


class UserCreate(schemas.BaseUserCreate):
    full_name: Optional[str] = None


