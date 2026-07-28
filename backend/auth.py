"""Firebase ID-token verification. On Cloud Run the Admin SDK uses the service
account's Application Default Credentials — no key file needed."""
import firebase_admin
from firebase_admin import auth as fb_auth
from fastapi import Header, HTTPException

firebase_admin.initialize_app()


def verify(authorization: str = Header(None)):
    """FastAPI dependency: returns the decoded token (uid, email, name)."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1]
    try:
        decoded = fb_auth.verify_id_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")
    return {"uid": decoded["uid"], "email": decoded.get("email"), "name": decoded.get("name")}
