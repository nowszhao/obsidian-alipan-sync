# 🔄 Alipan Sync

## Introduction | 简介

This plugin enables two-way synchronization between Obsidian notes and Alipan (阿里云盘).

此插件允许您将 Obsidian 笔记与阿里云盘进行双向同步。

---

## ✨ Key Features | 主要特性

- 🔄 **Two-way Sync**: Efficiently synchronize your notes across devices
- ⚡ **Incremental Sync**: Fast updates that only transfer changed files, making large vaults sync quickly
- 🔐 **OAuth Authorization**: Connect to Alipan with simple OAuth authorization
- 📁 **Remote Explorer**: Visual file browser for remote file management
- 🔀 **Smart Conflict Resolution**:
  - Character-level comparison to automatically merge changes when possible
  - Option to use timestamp-based resolution (newest file wins)
- 🚀 **Loose Sync Mode**: Optimize performance for vaults with thousands of notes
- 📦 **Large File Handling**: Set size limits to skip large files for better performance
- 📊 **Sync Status Tracking**: Clear visual indicators of sync progress and completion
- 📝 **Detailed Logging**: Comprehensive logs for troubleshooting

<br>

- 🔄 **双向同步**: 高效地在多设备间同步笔记
- ⚡ **增量同步**: 只传输更改过的文件，使大型笔记库也能快速同步
- 🔐 **OAuth 授权**: 通过简单的 OAuth 授权连接阿里云盘
- 📁 **远端文件浏览器**: 远程文件管理的可视化界面
- 🔀 **智能冲突解决**:
  - 字符级比较自动合并可能的更改
  - 支持基于时间戳的解决方案（最新文件优先）
- 🚀 **宽松同步模式**: 优化对包含数千笔记的仓库的性能
- 📦 **大文件处理**: 设置大小限制以跳过大文件，提升性能
- 📊 **同步状态跟踪**: 清晰的同步进度和完成提示
- 📝 **详细日志**: 全面的故障排查日志

---

## 📥 Installation | 安装

### From Obsidian Community Plugins | 从社区插件安装

1. Open **Settings → Community plugins → Browse**
2. Search for **"Alipan Sync"**
3. Click **Install**, then **Enable**

<br>

1. 打开 **设置 → 第三方插件 → 浏览**
2. 搜索 **"Alipan Sync"**
3. 点击 **安装**，然后 **启用**

### Manual Installation | 手动安装

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/nowszhao/obsidian-alipan-sync/releases)
2. Create the folder `<vault>/.obsidian/plugins/alipan-sync/`
3. Place the downloaded files into this folder
4. Reload Obsidian and enable the plugin in Community plugins settings

<br>

1. 从 [最新发布](https://github.com/nowszhao/obsidian-alipan-sync/releases) 下载 `main.js`、`manifest.json` 和 `styles.css`
2. 创建文件夹 `<vault>/.obsidian/plugins/alipan-sync/`
3. 将下载的文件放入该文件夹
4. 重启 Obsidian，在第三方插件设置中启用插件

---

## ⚠️ Important Notes | 注意事项

- ⏳ Initial sync may take longer (especially with many files)
- 💾 Please backup before syncing

<br>

- ⏳ 首次同步可能需要较长时间 (文件比较多时)
- 💾 请在同步之前备份

---

## 🙏 Acknowledgment | 致谢

This project is forked from [Obsidian Nutstore Sync](https://github.com/nutstore/obsidian-nutstore-sync) (by [Nutstore / 坚果云](https://github.com/nutstore)), which provides WebDAV-based synchronization for Obsidian. We deeply appreciate the original authors and contributors for their excellent work in building the core sync framework.

This fork replaces the WebDAV/Nutstore backend with the Alipan (阿里云盘) Open API, enabling Alipan users to sync Obsidian vaults natively.

<br>

本项目 fork 自 [Obsidian Nutstore Sync](https://github.com/nutstore/obsidian-nutstore-sync)（由 [坚果云 / Nutstore](https://github.com/nutstore) 开发），该项目为 Obsidian 提供了基于 WebDAV 的同步功能。我们衷心感谢原作者和贡献者们构建了优秀的同步核心框架。

本 fork 将 WebDAV/坚果云后端替换为阿里云盘开放 API，使阿里云盘用户可以原生同步 Obsidian 笔记库。

---

## 📄 License | 许可证

This project is licensed under the [GNU AGPL-3.0 License](LICENSE), same as the original project.

本项目采用 [GNU AGPL-3.0 许可证](LICENSE)，与原始项目保持一致。
