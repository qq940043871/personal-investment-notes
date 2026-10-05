#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""校验生成的 HTML 派生件质量。"""
import glob
import io
import os
import re
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

files = sorted(glob.glob(os.path.join(ROOT, "**", "*.pptx"), recursive=True))
files = [f for f in files if "_build" not in f]

total_issues = 0
for src in files:
    out = os.path.splitext(src)[0] + ".html"
    if not os.path.exists(out):
        print(f"[FAIL] 未生成: {os.path.basename(out)}")
        total_issues += 1
        continue
    h = open(out, encoding="utf-8").read()

    secs = len(re.findall(r'<section class="slide"', h))
    toc = len(re.findall(r'<a href="#s\d+">', h))
    h2 = len(re.findall(r"<h2>", h))
    h3 = len(re.findall(r"<h3>", h))
    tbl = len(re.findall(r"<table>", h))
    # 页码残留：正文里出现裸 "3 / 24"
    pagenum = len(re.findall(r">\s*\d+\s*/\s*\d+\s*<", h))
    # 乱码检测：常见的中文乱码片段
    mojibake = len(re.findall(r"[�]|锟斤拷|\?\?\?", h))
    # 未闭合标签粗查
    unclosed = h.count("<section") - h.count("</section>")

    issues = []
    if secs != toc:
        issues.append(f"目录条目({toc})≠ 页面数({secs})")
    if pagenum:
        issues.append(f"页码残留 {pagenum} 处")
    if mojibake:
        issues.append(f"乱码 {mojibake} 处")
    if unclosed:
        issues.append(f"section未闭合 {unclosed}")
    if secs == 0:
        issues.append("无内容")

    total_issues += len(issues)
    flag = "OK " if not issues else "WARN"
    print(
        f"[{flag}] {os.path.basename(out)[:40]:42s} 页={secs:3d} h2={h2:3d} "
        f"h3={h3:3d} 表={tbl:2d} {' | '.join(issues)}"
    )

print(f"\n问题总数: {total_issues}")