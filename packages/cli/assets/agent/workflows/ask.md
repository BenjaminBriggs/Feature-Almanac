---
description: Answer "how does X work" from the almanac, citing IDs
argument-hint: "<question>"
input: the question
when: Use when asked how part of the app works, what it does on a platform, or which behaviour ID covers something.
---

Input: {{input}}

Answer the question in the input from the almanac.

1. Find the relevant entities: `almanac list --level behaviour --json`, then `almanac show <ref> --json` for each candidate (add `--platform <tag>` when the question is about one platform).
2. Answer in plain language, citing every behaviour you rely on by its full ID (`PD-1.2.3`), and say which platforms each part applies to.
3. If the almanac doesn't cover the question, say so plainly and don't guess from the code. Offer to check the code and add the missing behaviour.
