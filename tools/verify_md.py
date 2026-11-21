# -*- coding: utf-8 -*-
"""校验排版处理的安全性：对比备份与处理后文件，
确认被删除的行全部是空行，新增的行全部是代码块开标签（``` 开头）。
用法: python verify_md.py bak1 new1 bak2 new2 ...
"""
import difflib
import os
import sys


def compare(bak: str, new: str):
    with open(bak, 'r', encoding='utf-8', newline='') as f:
        bl = f.readlines()
    with open(new, 'r', encoding='utf-8', newline='') as f:
        nl = f.readlines()
    sm = difflib.SequenceMatcher(a=bl, b=nl, autojunk=False)
    removed, added = [], []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag in ('delete', 'replace'):
            removed.extend(bl[i1:i2])
        if tag in ('insert', 'replace'):
            added.extend(nl[j1:j2])
    ok = True
    for r in removed:
        # 允许删除空行，以及无语言开标签 ```（被替换为 ```lang）
        if r.strip() != '' and r.strip() != '```':
            ok = False
            print('  异常删除行:', repr(r[:100]))
    for a in added:
        if not a.strip().startswith('```'):
            ok = False
            print('  异常新增行:', repr(a[:100]))
    return ok, len(removed), len(added)


if __name__ == '__main__':
    pairs = sys.argv[1:]
    all_ok = True
    for i in range(0, len(pairs), 2):
        bak, new = pairs[i], pairs[i + 1]
        ok, r, a = compare(bak, new)
        print(f"{os.path.basename(new)} => 删除{r}行 新增{a}行 {'OK' if ok else '异常'}")
        if not ok:
            all_ok = False
    sys.exit(0 if all_ok else 1)
