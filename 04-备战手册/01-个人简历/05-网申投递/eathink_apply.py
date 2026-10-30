# -*- coding: utf-8 -*-
"""
eathink 招聘报名自动填写脚本（http://hr.eathink.com.cn:8089/）

用法：
    1) 干跑（查岗位/校验/打印报文，不提交）：
       python eathink_apply.py
    2) 上传照片（真正会传到服务器，但不提交报名表）：
       python eathink_apply.py --photo "D:\\photos\\me.jpg"
    3) 上传照片并提交报名：
       python eathink_apply.py --photo "D:\\photos\\me.jpg" --submit

接口逆向自页面 JS（pages-zhaopin-zhaopin）：
    GET  /prod-api/hr/getHrConfig   取岗位列表与报名状态
    POST /prod-api/doc/api/upload   上传个人照片（multipart，字段名 file）
    POST /prod-api/hr/saveYpry      提交报名（JSON = hr + edus + works + zplx）
"""

import argparse
import json
import mimetypes
import re
import sys
import uuid
from urllib import request as urlreq
from urllib.error import HTTPError

SERVER = "http://hr.eathink.com.cn:8089"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ApplyScript/1.0"

# ======================================================================
# ★ 个人信息（按 BOSS 直聘文字稿整理，标了【填我】的必须改，否则拒绝提交）
# ======================================================================
BASIC = {
    "xm":     "【填我：姓名】",
    "xb":     "男",                      # 男 / 女
    "csrq":   "【填我：1987-01-01】",    # 出生日期 YYYY-MM-DD（岗位要求 40 岁及以下）
    "mz":     "汉族",
    "zzmm":   "群众",                    # 群众 / 中共党员 / 民主党派
    "hyzk":   "【填我：已婚】",          # 未婚 / 已婚 / 离异
    "jg":     "【填我：籍贯，如河南郑州】",
    "jtzz":   "【填我：家庭住址】",
    "sfzh":   "【填我：身份证号18位】",  # 也作为照片上传的 businessId
    "sjh":    "【填我：手机号】",
    "dzyx":   "【填我：电子邮箱】",
    "gznx":   "13",                     # 工作年限（BOSS 稿：13 年）
    "wy":     "【填我：外语及水平，如 英语CET-4】",
    "jz":     "C1",                     # C1 / 无 / C2 / 其他C类 / B类 / A类
    "jjlxr":  "【填我：紧急联系人】",
    "jjlxrsjh": "【填我：紧急联系人手机号】",
    "zyzsjzc": "PMP项目管理认证",        # 重要证书及职称
}

# 岗位：脚本会先从 getHrConfig 拉取列表做模糊匹配；匹配不到就打印列表退出
TARGET_JOB = "后端开发工程师"
TIAOJI = "同意"   # 同意调剂 / 不同意

# 受教育情况 —— 页面要求「从高中教育填起」，高中一段自己补真实信息
EDUS = [
    {
        "kssj": "【填我：高中开始，如2006-09】",
        "jzsj": "【填我：高中结束，如2009-06】",
        "xx":   "【填我：高中学校名】",
        "zy":   "普通高中",
        "xl":   "高中",
        "xw":   "高中",
        "sfqrz": "是",   # 是否全日制：是 / 否
    },
    {
        "kssj": "2009-09",
        "jzsj": "2013-06",
        "xx":   "郑州大学",
        "zy":   "软件工程",
        "xl":   "本科",
        "xw":   "学士",
        "sfqrz": "是",
    },
]

# 工作经历（由近及远；xsrs=下属人数，允许 0）
WORKS = [
    {
        "kssj": "2015-07",
        "jzsj": "至今",
        "dwmc": "【填我：公司全名】",
        "rzgw": "技术经理（架构负责人）",
        "xsrs": 20,
        "gzzz": ("负责B2B大宗商品交易平台（12+微服务）与DS数据服务中心的架构设计与研发管理。"
                 "主导C撮合引擎+Java微服务异构架构治理与DS防腐层建设；落地Saga+状态机+事件溯源"
                 "分布式一致性方案，运行3年零资金差错；完成冬储3倍流量容量规划与限流熔断削峰，"
                 "连续两季零P0故障，核心接口响应200ms内。带20人团队，通过On-call机制、技术债台账"
                 "与契约治理，将被动响应占比由45%降至15%。近期主导AI智能服务平台前期建设，"
                 "完成Dify vs自研底座选型、MinerU文档解析改造与向量库落地，支撑3条业务线知识库接入。"),
        "lzyy": "【填我：离职原因，如 寻求更大技术挑战】",
        "lzqxc": "【填我：离职前薪酬】",
    },
    {
        "kssj": "2013-07",
        "jzsj": "2015-06",
        "dwmc": "【填我：公司全名】",
        "rzgw": "Java开发工程师",
        "xsrs": 0,
        "gzzz": ("参与清算平台（交易对账、资金清算、净额结算、保证金管理）与GIS系统后端开发，"
                 "日处理交易10万+笔，在资金场景中建立数据精确性优先的工程习惯。"),
        "lzyy": "【填我：离职原因】",
        "lzqxc": "【填我：离职前薪酬】",
    },
]

# ======================================================================

PLACEHOLDER = re.compile(r"【填我[:：]")

REQUIRED = ["gw", "tiaoji", "xm", "xb", "grzp", "csrq", "mz", "hyzk", "jg", "jtzz",
            "gznx", "wy", "sfzh", "sjh", "dzyx", "zzmm", "jz"]


def http_json(path, method="GET", data=None, headers=None):
    req = urlreq.Request(SERVER + path, method=method)
    req.add_header("User-Agent", UA)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    body = None
    if data is not None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        req.add_header("Content-Type", "application/json")
    with urlreq.urlopen(req, body, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def upload_photo(photo_path, sfzh):
    """multipart 上传照片，返回服务器文件名（存入 hr.grzp）。"""
    with open(photo_path, "rb") as f:
        content = f.read()
    mime = mimetypes.guess_type(photo_path)[0] or "image/jpeg"
    fname = photo_path.replace("\\", "/").split("/")[-1]
    boundary = "----wb" + uuid.uuid4().hex

    parts = []
    form_fields = [
        ("catalogCode", "A11A01A0101"),
        ("businessId", sfzh),
        ("nodeCode", "A11A01A01"),
        ("formCode", uuid.uuid4().hex),
        ("businessCode", "zhaopin"),
    ]
    for k, v in form_fields:
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode("utf-8"))
    parts.append(
        (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{fname}"\r\n'
         f'Content-Type: {mime}\r\n\r\n').encode("utf-8") + content + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode("utf-8"))
    body = b"".join(parts)

    req = urlreq.Request(SERVER + "/prod-api/doc/api/upload", data=body, method="POST")
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    req.add_header("User-Agent", UA)
    with urlreq.urlopen(req, timeout=60) as resp:
        result = json.loads(resp.read().decode("utf-8"))
    if not result.get("message"):
        raise RuntimeError(f"上传失败，服务器返回：{result}")
    return result["message"]


def validate_idcard(sfzh):
    if not re.fullmatch(r"\d{17}[\dXx]", sfzh):
        return False
    w = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
    code = "10X98765432"
    return code[sum(int(a) * b for a, b in zip(sfzh[:17], w)) % 11] == sfzh[17].upper()


def validate_phone(p):
    return bool(re.fullmatch(r"1\d{10}", p))


def validate_email(e):
    return bool(re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", e))


def check_config():
    bad = []
    for k, v in BASIC.items():
        if PLACEHOLDER.search(str(v)):
            bad.append(k)
    for edu in EDUS:
        for k, v in edu.items():
            if PLACEHOLDER.search(str(v)):
                bad.append(f"EDUS[{edu.get('xx', '?')}].{k}")
    for w in WORKS:
        for k, v in w.items():
            if isinstance(v, str) and PLACEHOLDER.search(v):
                bad.append(f"WORKS[{w.get('dwmc', '?')}].{k}")
    if bad:
        print("以下字段还没填（【填我】占位符），提交前必须补齐：")
        for b in bad:
            print("  -", b)
        return False
    if not validate_idcard(BASIC["sfzh"]):
        print("身份证号校验失败（18位 + 校验码）:", BASIC["sfzh"])
        return False
    if not validate_phone(BASIC["sjh"]):
        print("手机号格式错误:", BASIC["sjh"])
        return False
    if not validate_email(BASIC["dzyx"]):
        print("邮箱格式错误:", BASIC["dzyx"])
        return False
    return True


def fetch_config():
    data = http_json("/prod-api/hr/getHrConfig")
    d = data.get("data") or data
    status = d.get("status")
    posts = (d.get("post") or "").split(",")
    return status, [p.strip() for p in posts if p.strip()]


def match_job(posts):
    for p in posts:
        if TARGET_JOB in p or p in TARGET_JOB:
            return p
    return None


def build_payload(grzp, gw):
    hr = dict(BASIC)
    hr.update({"gw": gw, "tiaoji": TIAOJI, "grzp": grzp, "zplx": "1"})
    return {"**hr**": hr, "edus": EDUS, "works": WORKS}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--photo", help="个人照片路径（jpg/png）")
    ap.add_argument("--submit", action="store_true", help="真正提交报名（默认只干跑）")
    args = ap.parse_args()

    # 1. 拉配置：报名是否截止 + 岗位列表
    print(f"== 读取招聘配置 {SERVER}/prod-api/hr/getHrConfig ...")
    status, posts = fetch_config()
    print("   报名状态 status =", status, "（1=开放，其他=截止或未开放）")
    print("   开放岗位：", " / ".join(posts) if posts else "（无）")
    if status != "1":
        print("!! 报名未开放或已截止，脚本终止。")
        return
    gw = match_job(posts)
    if not gw:
        print(f"!! 岗位列表里没匹配到「{TARGET_JOB}」，请改脚本里的 TARGET_JOB。")
        return
    print("   目标岗位：", gw)

    # 2. 校验本地配置
    if not check_config():
        print("\n补齐脚本顶部 BASIC / EDUS / WORKS 里的【填我】后重跑。")
        return

    # 3. 照片
    grzp = ""
    if args.photo:
        print("== 上传照片:", args.photo)
        grzp = upload_photo(args.photo, BASIC["sfzh"])
        print("   上传成功，文件名 =", grzp, "（预览：", SERVER + "/upload/" + grzp, "）")
    else:
        print("!! 未提供照片（--photo），报名表必填个人照片，干跑继续。")

    # 4. 组装并输出报文
    payload = build_payload(grzp, gw)
    real = {**payload["**hr**"], "edus": payload["edus"], "works": payload["works"]}
    print("\n== 提交报文预览（POST /prod-api/hr/saveYpry）==")
    print(json.dumps(real, ensure_ascii=False, indent=2))

    if not args.submit:
        print("\n[干跑模式] 未提交。确认无误后加 --submit 真正提交。")
        return
    if not grzp:
        print("\n!! 没有照片不能提交（页面必填 grzp）。加 --photo 后重试。")
        return

    print("\n== 提交报名 ...")
    resp = http_json("/prod-api/hr/saveYpry", method="POST", data=real,
                     headers={"Content-Type": "application/json"})
    print("   服务器返回：", json.dumps(resp, ensure_ascii=False))
    if resp.get("code") == 200:
        print("✔ 报名成功，请等待通知。")
    else:
        print("✘ 提交失败：", resp.get("message"))


if __name__ == "__main__":
    main()
