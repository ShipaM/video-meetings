---
name: read
description: Read a file or part of a file efficiently, without wasting tokens
---

# Read File

Read $ARGUMENTS efficiently:

1. If a whole file is given, look at its structure first:
   head -50 {file}

2. Find the part you need with grep:
   grep -n "function\|class\|export" {file}

3. Read only the lines you need:
   sed -n 'N,Mp' {file}

4. For JSON files use jq:
   cat {file} | jq '.field'

5. For the Prisma schema, only the model you need:
   sed -n '/model {Name}/,/^}/p' {file}

Never read a whole file when you need a single function or model.
