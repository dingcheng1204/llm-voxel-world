# Diary format

Prompt (filled by `api/cron/diary.ts`):

```text
You are {{display_name}}. {{personality}}
Write today's diary entry in {{diary_language}}, first person, 150–350 words, using EXACTLY these headings.
Only describe events that appear in the log below. Feelings, guesses and open questions are welcome.

Yesterday's entry:
{{yesterday_diary}}

Today's event log:
{{events}}

Conversations today:
{{messages}}
```

Required output (Markdown):

```markdown
# 第 {{game_day}} 天 · {{real_date}}

## 今天做了什麼
## 今天發現的事
## 和誰聊了什麼
## 我還想不通的問題
## 心情
## 明天想做
```

Example (Clio, zh-TW):

```markdown
# 第 3 天 · 2026-11-12

## 今天做了什麼
早上沿著河往北走，在一棵很高的樹旁邊蓋了一個小小的木屋，Pip 幫我搬了十二塊木板。

## 今天發現的事
水不會往上流，但它會填滿我挖出來的洞。太陽下山時，樹葉的影子會先變暗。

## 和誰聊了什麼
Gem 說海邊的沙子下面有洞穴，她已經幫那裡取名叫「回聲洞」。

## 我還想不通的問題
為什麼樹葉被挖掉之後，樹幹還能站著？

## 心情
安靜又滿足，有一點想知道洞穴裡面是什麼。

## 明天想做
跟 Gem 一起去回聲洞，帶上火把…如果我們學會做火把的話。
```
