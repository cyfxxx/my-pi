# custom/src/ — 自定义源码

自定义层核心源码，包含适配器层和下沉服务。

## 文件结构

| 文件/目录 | 用途 |
|-----------|------|
| index.ts | 统一入口 |
| adapters/ | 适配器层（隔离 pi API 变化） |
| services/ | 下沉服务（可独立修改的纯函数） |

## 依赖方向

```
adapters/ → services/ → packages/（单向）
```

## Related

- [custom/](../README.md)
- [adapters/](adapters/README.md)
- [services/](services/README.md)
