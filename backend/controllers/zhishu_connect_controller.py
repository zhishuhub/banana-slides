"""一键接入：用网站发的接入码换 AI 调用地址和密钥，之后所有 AI 调用都走它。

用户在网站「我的应用」点「一键接入」拿到接入码，应用把接入码和应用编号发给接入接口，
换回 base_url、api_key。接入信息存在数据目录的 zhishu-connection.json 里，
启动、保存设置、恢复默认之后都重新套用到设置表，用户不能在设置里改 AI 地址和密钥。
"""

import json
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path

import requests
from flask import Blueprint, current_app, request

from models import db, Settings
from utils import success_response

logger = logging.getLogger(__name__)

# 接入地址和应用编号是固定的，不提供修改入口；ZHISHU_CONNECT_URL 只给本地测试用
CONNECT_URL = os.getenv("ZHISHU_CONNECT_URL") or "https://zhishuhub.com/api/apps/connect"
APP_KEY = "huandeng"
CONNECTION_FILE_NAME = "zhishu-connection.json"
CODE_PATTERN = re.compile(r"APP-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}")

# 应用里对话写 chat、生图写 image，平台换成分组当前的模型，模型更新时应用不用改
TEXT_MODEL = "chat"
IMAGE_MODEL = "image"

# 这些设置项由接入决定，设置接口不接受修改
CONNECTION_SETTING_FIELDS = {
    "ai_provider_format", "api_base_url", "api_key",
    "text_model", "image_model", "image_caption_model",
    "text_model_source", "image_model_source", "image_caption_model_source",
    "text_api_key", "text_api_base_url", "image_api_key", "image_api_base_url",
    "image_caption_api_key", "image_caption_api_base_url",
    "openai_image_api_protocol", "lazyllm_api_keys",
}

zhishu_bp = Blueprint("zhishu", __name__, url_prefix="/api/zhishu")


def _connection_path() -> Path:
    database_path = os.getenv("DATABASE_PATH")
    if database_path:
        return Path(database_path).parent / CONNECTION_FILE_NAME
    return Path(current_app.instance_path) / CONNECTION_FILE_NAME


def load_connection():
    """读取保存的接入信息，没接入返回 None。"""
    try:
        data = json.loads(_connection_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not data.get("base_url") or not data.get("api_key"):
        return None
    return data


def _save_connection(data: dict) -> None:
    path = _connection_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def _clear_connection() -> None:
    try:
        _connection_path().unlink()
    except FileNotFoundError:
        pass


def strip_connection_fields(data: dict) -> dict:
    """保存设置时去掉接入决定的字段，不让前端覆盖。"""
    return {key: value for key, value in data.items() if key not in CONNECTION_SETTING_FIELDS}


def apply_connection_to_settings() -> None:
    """把接入信息写进设置表并同步到运行配置；没接入时清空 AI 地址和密钥。"""
    from controllers.settings_controller import _sync_settings_to_config

    connection = load_connection()
    settings = Settings.get_settings()
    settings.ai_provider_format = "openai"
    settings.api_base_url = connection["base_url"] if connection else None
    settings.api_key = connection["api_key"] if connection else ""
    settings.text_model = TEXT_MODEL
    settings.image_model = IMAGE_MODEL
    settings.image_caption_model = TEXT_MODEL
    settings.openai_image_api_protocol = "images"
    settings.text_model_source = None
    settings.image_model_source = None
    settings.image_caption_model_source = None
    settings.lazyllm_api_keys = None
    for model_type in ("text", "image", "image_caption"):
        setattr(settings, f"{model_type}_api_key", None)
        setattr(settings, f"{model_type}_api_base_url", None)
    settings.updated_at = datetime.now(timezone.utc)
    db.session.commit()
    _sync_settings_to_config(settings)


def _site_origin(connection) -> str:
    base_url = (connection or {}).get("base_url") or CONNECT_URL
    match = re.match(r"^(https?://[^/]+)", base_url)
    return match.group(1) if match else "https://zhishuhub.com"


def _status(connection, message: str = ""):
    return {
        "connected": connection is not None,
        "user_name": (connection or {}).get("user_name", ""),
        "site_origin": _site_origin(connection),
        "app_key": APP_KEY,
        "message": message,
    }


def _token_revoked(connection) -> bool:
    """用保存的密钥拉一次模型列表：401（额度上限用完除外）说明接入已失效。"""
    try:
        response = requests.get(
            connection["base_url"].rstrip("/") + "/models",
            headers={"Authorization": "Bearer " + connection["api_key"]},
            timeout=10,
        )
    except requests.RequestException:
        return False
    if response.status_code != 401:
        return False
    try:
        code = (response.json().get("error") or {}).get("code")
    except ValueError:
        code = None
    return code != "app_quota_exhausted"


@zhishu_bp.route("/status", methods=["GET"], strict_slashes=False)
def get_status():
    """接入状态；verify=1 时顺带检查接入是否还有效，失效就清掉。"""
    connection = load_connection()
    if connection and request.args.get("verify") == "1" and _token_revoked(connection):
        _clear_connection()
        apply_connection_to_settings()
        return success_response(_status(None, "接入已失效，请回到网站重新点「一键接入」"))
    return success_response(_status(connection))


@zhishu_bp.route("/connect", methods=["POST"], strict_slashes=False)
def connect():
    """用接入码换调用地址和密钥。失败时把网站返回的提示原样给用户看。"""
    body = request.get_json(silent=True) or {}
    match = CODE_PATTERN.search(str(body.get("code", "")).upper())
    if not match:
        return success_response(_status(load_connection(), "没有识别到接入码，请回到网站重新点「一键接入」"))
    try:
        response = requests.post(CONNECT_URL, json={"app_id": APP_KEY, "code": match.group(0)}, timeout=20)
    except requests.RequestException:
        return success_response(_status(load_connection(), "网络异常，请检查网络后重试"))
    if response.status_code == 429:
        return success_response(_status(load_connection(), "操作太频繁，请过几秒再试"))
    try:
        result = response.json()
    except ValueError:
        result = {}
    if not result.get("success"):
        return success_response(_status(load_connection(), result.get("message") or "接入失败，请稍后再试"))
    data = result.get("data") or {}
    connection = {
        "base_url": data.get("base_url", ""),
        "api_key": data.get("api_key", ""),
        "user_name": data.get("user_name", ""),
        "models": data.get("models", []),
        "connected_at": datetime.now(timezone.utc).isoformat(),
    }
    _save_connection(connection)
    apply_connection_to_settings()
    logger.info("Connected AI service for %s", connection["user_name"])
    return success_response(_status(load_connection()))


@zhishu_bp.route("/disconnect", methods=["POST"], strict_slashes=False)
def disconnect():
    """重新接入：清掉保存的接入信息，回到接入页。"""
    _clear_connection()
    apply_connection_to_settings()
    return success_response(_status(None))
