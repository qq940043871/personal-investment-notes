# -*- coding: utf-8 -*-
"""批量优化 Markdown 排版：补全代码块语言标识、压缩代码块外的连续空行。
仅做机械性排版调整，不改动任何正文内容、代码、表格数据。
"""
import os
import re
import sys


def detect_lang(code: str) -> str:
    """根据代码内容启发式判断语言，判断不了用 text。"""
    c = code.lower()
    if re.search(r'<!doctype|<html|<div|<body|<head|<span|<table|<p>|<style|<script', c):
        return 'html'
    if '<?xml' in c:
        return 'xml'
    if re.search(r'\b(def|class)\s+\w+|^\s*import\s+\w+|^\s*from\s+\w+\s+import|print\s*\(|return\s+', c, re.M):
        return 'python'
    if re.search(r'\bfunction\s+\w+|=>|console\.log|\bvar\s+\w+\s*=|\blet\s+\w+\s*=|\bconst\s+\w+\s*=|\brequire\s*\(', c):
        return 'javascript'
    if re.search(r'"[^"\n]+"\s*:', c) and '{' in c and '}' in c:
        return 'json'
    if re.search(r'^\s*(select|insert|update|delete|create|drop|alter)\s+\w+', c, re.M):
        return 'sql'
    if re.search(r'\bpublic\s+(class|static)|\bpackage\s+\w+|\bsystem\.out', c):
        return 'java'
    if re.search(r'^\s*(echo|grep|ls|cd|sudo|chmod|mkdir|cat|sed|awk|curl|wget|docker|git|npm|pip|python|java|mvn|kubectl)\s', c, re.M):
        return 'bash'
    return 'text'


def process(path: str) -> int:
    with open(path, 'r', encoding='utf-8', newline='') as f:
        lines = f.readlines()
    out = []
    in_code = False
    cur_sep = None
    for i, line in enumerate(lines):
        s = line.strip()
        if s.startswith('```'):
            if not in_code:
                # 开标签
                if re.fullmatch(r'`{3,}', s):
                    sep = s
                    # 取开标签后第一段非空内容作为代码，检测语言
                    j = i + 1
                    while j < len(lines) and lines[j].strip() == '':
                        j += 1
                    lang = 'text'
                    if j < len(lines) and lines[j].strip() != sep:
                        code_lines = []
                        k = j
                        while k < len(lines) and lines[k].strip() != sep:
                            code_lines.append(lines[k])
                            k += 1
                        lang = detect_lang('\n'.join(code_lines))
                    eol = '\r\n' if line.endswith('\r\n') else '\n'
                    out.append('```' + lang + eol)
                else:
                    # 已带语言标识，原样保留
                    sep = '```'
                    out.append(line)
                in_code = True
                cur_sep = sep
            else:
                # 代码块内：仅当分隔符与当前代码块一致时视为闭标签
                if s == cur_sep:
                    out.append(line)
                    in_code = False
                    cur_sep = None
                else:
                    out.append(line)
        else:
            if not in_code and line.strip() == '':
                # 代码块外：压缩连续空行（保留一个）
                if out and out[-1].strip() == '':
                    continue
            out.append(line)
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.writelines(out)
    return 0


if __name__ == '__main__':
    for fp in sys.argv[1:]:
        process(fp)
        print('processed:', os.path.basename(fp))
