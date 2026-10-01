# 19 - DevOps与CI/CD

> 如何实现持续交付

---

## 📖 概述

本章介绍持续集成、灰度发布、回滚机制。

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
