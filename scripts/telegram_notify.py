"""Утреннее уведомление English Ear в Telegram.

Токен бота и id чата берутся из секретов репозитория (TELEGRAM_TOKEN, TELEGRAM_CHAT_ID).
Если id чата не задан, скрипт берёт его из последнего сообщения, которое ты написал боту.
"""
import json
import os
import sys
import urllib.parse
import urllib.request

APP_URL = "https://360dw-sys.github.io/english-ear/"
token = os.environ.get("TELEGRAM_TOKEN", "").strip()
chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip()


def call(method, **params):
    url = f"https://api.telegram.org/bot{token}/{method}"
    data = urllib.parse.urlencode(params).encode() if params else None
    with urllib.request.urlopen(url, data=data, timeout=30) as r:
        return json.load(r)


if not token:
    sys.exit("Нет секрета TELEGRAM_TOKEN в настройках репозитория")

if not chat_id:
    call("deleteWebhook")
    updates = call("getUpdates").get("result", [])
    chats = [u.get("message", {}).get("chat", {}).get("id") for u in updates if u.get("message")]
    chats = [c for c in chats if c]
    if not chats:
        sys.exit("Напиши боту любое сообщение в Telegram и запусти workflow ещё раз")
    chat_id = str(chats[-1])
    print(f"Найден id чата: {chat_id}. Можно сохранить его в секрет TELEGRAM_CHAT_ID")

clips = json.load(open("clips.json", encoding="utf-8")).get("clips", [])
clips.sort(key=lambda c: c.get("date", ""), reverse=True)
if clips:
    c = clips[0]
    text = (
        "🎧 English Ear: отрывок дня готов\n\n"
        f"{c['title']}\n{c.get('speaker', '')} · {c['end'] - c['start']} сек\n\n"
        "10 минут, один уровень за раз.\n"
        f"Открыть: {APP_URL}"
    )
else:
    text = f"🎧 English Ear: новых отрывков пока нет, можно добавить свой.\n{APP_URL}"

res = call("sendMessage", chat_id=chat_id, text=text, disable_web_page_preview="true")
print("Отправлено" if res.get("ok") else res)
