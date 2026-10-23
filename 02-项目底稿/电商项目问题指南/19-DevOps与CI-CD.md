# 19 - DevOps与CI/CD

> 如何实现持续交付

---

## 📖 概述

本章介绍持续集成、灰度发布、回滚机制。

---

## 个人经验锚点

| 分类 | 内容 |
|------|------|
| **真实做过** | **GitLab CI/CD** 落地：多模块 Java 微服务的编译、单元测试、镜像构建、推送与部署流水线；多环境（dev/test/prod）配置隔离与发布；Docker 镜像化交付、版本回滚 |
| **通用方案/行业知识** | 基于 Argo Rollouts / Flagger 的自动化金丝雀与渐进式发布、A/B 分流、自动化回滚分析（analysis 模板）—— 属行业通行方案，本人未在生产落地过完整的自动金丝雀发布体系 |

> 下方金丝雀示例为「行业参考」写法，用于对齐概念；本人实际用的是 GitLab CI/CD + 手动灰度 + 快速回滚。

---

## 🔄 一、灰度发布

### 1.1 金丝雀发布

```
┌─────────────────────────────────────────┐
│              流量分配                      │
│                                          │
│   新版本(10%) ───► 10%的用户             │
│                                          │
│   旧版本(90%) ───► 90%的用户             │
│                                          │
│   监控指标：                            │
│   ├── 错误率                           │
│   ├── 响应时间                          │
│   └── 业务指标                           │
└─────────────────────────────────────────┘
```

---

## 🔙 二、回滚机制

```yaml
# Argo Rollouts 配置
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: order-service
spec:
  strategy:
    canary:
      steps:
      - setWeight: 10
      - pause: {duration: 10m}
      - setWeight: 30
      - pause: {duration: 10m}
      analysis:
        templates:
        - templateName: success-rate
```

---

## 🔗 相关章节

- [容器化与K8S](./20-容器化与K8S.md)
- [监控与日志](./21-监控与日志.md)

---

*上一页：[合规与审计](./18-合规与审计.md) | 下一页：[容器化与K8S](./20-容器化与K8S.md)*
