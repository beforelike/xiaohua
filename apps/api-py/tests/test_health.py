"""健康检查接口测试"""

import pytest
from httpx import ASGITransport, AsyncClient

from src.main import app


@pytest.fixture
async def client():
    """创建测试客户端"""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.mark.asyncio
async def test_health_check(client: AsyncClient):
    """测试健康检查接口返回正确状态"""
    response = await client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["service"] == "xiaohua-api"
    assert data["version"] == "0.1.0"


@pytest.mark.asyncio
async def test_readiness_check(client: AsyncClient):
    """测试就绪检查接口"""
    response = await client.get("/api/health/ready")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] in {"ok", "not_ready"}
    assert isinstance(data["ready"], bool)
    assert "fooocus" in data


@pytest.mark.asyncio
async def test_request_id_header(client: AsyncClient):
    """测试请求 ID 中间件：自动生成 request ID"""
    response = await client.get("/api/health")
    assert "X-Request-ID" in response.headers
    assert len(response.headers["X-Request-ID"]) > 0


@pytest.mark.asyncio
async def test_custom_request_id(client: AsyncClient):
    """测试请求 ID 中间件：使用客户端提供的 request ID"""
    custom_id = "test-req-12345"
    response = await client.get("/api/health", headers={"X-Request-ID": custom_id})
    assert response.headers["X-Request-ID"] == custom_id
