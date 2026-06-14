"""配置系统测试"""

from pathlib import Path

from src.config import (
    Settings,
    build_settings,
    list_presets,
    load_json_file,
    load_preset,
)


class TestLoadJsonFile:
    """测试 JSON 文件加载"""

    def test_load_existing_file(self, tmp_path: Path):
        """测试加载存在的 JSON 文件"""
        config_file = tmp_path / "test.json"
        config_file.write_text('{"key": "value"}', encoding="utf-8")
        result = load_json_file(config_file)
        assert result == {"key": "value"}

    def test_load_nonexistent_file(self, tmp_path: Path):
        """测试加载不存在的文件返回空字典"""
        result = load_json_file(tmp_path / "nonexistent.json")
        assert result == {}

    def test_load_invalid_json(self, tmp_path: Path):
        """测试加载无效 JSON 返回空字典"""
        bad_file = tmp_path / "bad.json"
        bad_file.write_text("not valid json {{{", encoding="utf-8")
        result = load_json_file(bad_file)
        assert result == {}

    def test_load_non_object_json(self, tmp_path: Path):
        """测试加载非对象 JSON 返回空字典"""
        array_file = tmp_path / "array.json"
        array_file.write_text("[1, 2, 3]", encoding="utf-8")
        result = load_json_file(array_file)
        assert result == {}


class TestLoadPreset:
    """测试预设加载"""

    def test_load_default_preset(self):
        """测试加载内置 default 预设"""
        preset = load_preset("default")
        assert "default_model" in preset
        assert preset["default_sampler"] == "dpmpp_2m_sde_gpu"

    def test_load_anime_preset(self):
        """测试加载 anime 预设"""
        preset = load_preset("anime")
        assert preset["default_cfg_scale"] == 7.0
        assert "SAI Anime" in preset["default_styles"]

    def test_load_realistic_preset(self):
        """测试加载 realistic 预设"""
        preset = load_preset("realistic")
        assert preset["default_steps"] == 40
        assert preset["default_performance"] == "Quality"

    def test_load_nonexistent_preset(self):
        """测试加载不存在的预设返回空字典"""
        preset = load_preset("nonexistent_preset_xyz")
        assert preset == {}


class TestListPresets:
    """测试预设列表"""

    def test_list_builtin_presets(self):
        """测试列出内置预设"""
        presets = list_presets()
        assert "default" in presets
        assert "anime" in presets
        assert "realistic" in presets

    def test_list_empty_dir(self, tmp_path: Path):
        """测试空目录返回空列表"""
        presets = list_presets(tmp_path)
        assert presets == []

    def test_list_nonexistent_dir(self, tmp_path: Path):
        """测试不存在的目录返回空列表"""
        presets = list_presets(tmp_path / "nonexistent")
        assert presets == []


class TestBuildSettings:
    """测试配置构建"""

    def test_default_settings(self):
        """测试默认配置值"""
        settings = build_settings()
        assert settings.port == 8000
        assert settings.default_steps == 30
        assert settings.default_sampler == "dpmpp_2m_sde_gpu"

    def test_cli_overrides(self):
        """测试 CLI 参数覆盖默认值"""
        settings = build_settings({"port": 9000, "debug": True})
        assert settings.port == 9000
        assert settings.debug is True

    def test_preset_override(self):
        """测试预设覆盖默认值"""
        settings = build_settings({"preset": "anime"})
        assert settings.default_cfg_scale == 7.0
        assert settings.default_steps == 25

    def test_cli_overrides_preset(self):
        """测试 CLI 参数优先于预设"""
        settings = build_settings({
            "preset": "anime",
            "default_steps": 50,
        })
        # CLI 值优先
        assert settings.default_steps == 50
        # 预设值仍生效
        assert settings.default_cfg_scale == 7.0


class TestSettings:
    """测试 Settings 模型"""

    def test_default_cors_origins(self):
        """测试默认 CORS 来源"""
        settings = Settings()
        assert "http://localhost:5173" in settings.cors_origins
        assert "http://localhost:3000" in settings.cors_origins

    def test_model_paths_default(self):
        """测试默认模型路径"""
        settings = Settings()
        assert settings.model_paths.checkpoints == "./models/checkpoints"
        assert settings.model_paths.loras == "./models/loras"
