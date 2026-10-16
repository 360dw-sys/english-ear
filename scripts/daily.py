"""Ночной конвейер English Ear.

1. Берёт следующий сценарий из content/queue.json
2. Озвучивает его британским голосом через ElevenLabs
3. Добавляет отрывок в clips.json
4. Шлёт уведомление в Telegram

Секреты репозитория: ELEVENLABS_API_KEY, TELEGRAM_TOKEN, TELEGRAM_CHAT_ID (последний необязателен).
"""
import datetime
import json
import math
import os
import subprocess
import sys
import urllib.parse
import urllib.request

APP_URL = "https://360dw-sys.github.io/english-ear/"
# Британские голоса из общей библиотеки ElevenLabs, по очереди
VOICES = [
    ("JBFqnCBsd6RMkjVDRZzb", "George"),
    ("Xb7hH8MSUJpSbSDYk0k2", "Alice"),
    ("onwK4e9ZLuTAKqWW03F9", "Daniel"),
    ("pFZP5JQG7iQjIQuC4Bku", "Lily"),
]
MODEL = os.environ.get("ELEVENLABS_MODEL", "eleven_multilingual_v2")


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def dump(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def telegram(text):
    token = os.environ.get("TELEGRAM_TOKEN", "").strip()
    if not token:
        print("TELEGRAM_TOKEN не задан, уведомление пропущено")
        return
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip()

    def call(method, **params):
        data = urllib.parse.urlencode(params).encode() if params else None
        with urllib.request.urlopen(f"https://api.telegram.org/bot{token}/{method}", data=data, timeout=30) as r:
            return json.load(r)

    if not chat_id:
        call("deleteWebhook")
        ups = [u for u in call("getUpdates").get("result", []) if u.get("message")]
        if not ups:
            print("Напиши боту любое сообщение и запусти ещё раз")
            return
        chat_id = str(ups[-1]["message"]["chat"]["id"])
        print(f"id чата: {chat_id}")
    call("sendMessage", chat_id=chat_id, text=text, disable_web_page_preview="true")
    print("Telegram: отправлено")


def tts(text, voice_id, out_path):
    key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if not key:
        sys.exit("Нет секрета ELEVENLABS_API_KEY")
    body = json.dumps({
        "text": text,
        "model_id": MODEL,
        "voice_settings": {"stability": 0.4, "similarity_boost": 0.75, "style": 0.35, "use_speaker_boost": True, "speed": 1.08},
    }).encode()
    req = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128",
        data=body,
        headers={"xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r, open(out_path, "wb") as f:
            f.write(r.read())
    except urllib.error.HTTPError as e:
        sys.exit(f"ElevenLabs ответил ошибкой {e.code}: {e.read()[:300]!r}")


def duration(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return float(out)


def main():
    queue = load("content/queue.json")
    clips = load("clips.json")
    items = queue.get("items", [])
    if not items:
        telegram(f"🎧 English Ear: очередь сценариев пуста, нужен новый запас.\n{APP_URL}")
        return

    item = items.pop(0)
    today = datetime.date.today().isoformat()
    n = len(clips.get("clips", []))
    voice_id, voice_name = VOICES[n % len(VOICES)]
    os.makedirs("audio", exist_ok=True)
    path = f"audio/{today}-{item['id']}.mp3"
    tts(item["text"], voice_id, path)
    dur = math.ceil(duration(path))

    clip = {
        "id": f"{today}-{item['id']}",
        "date": today,
        "title": item["title"],
        "speaker": f"{voice_name}, британский голос ElevenLabs",
        "accent": "британский",
        "topic": item.get("topic", ""),
        "level": item.get("level", 3),
        "audio": path,
        "start": 0,
        "end": dur,
        "why": "Оригинальный разговорный текст с британскими словечками и проглатываниями, озвучен ночью специально для тебя.",
        "transcript": item["text"],
        "focus": item.get("focus", []),
        "reductions": item.get("reductions", []),
    }
    clips.setdefault("clips", []).append(clip)
    clips["updated"] = today
    dump("clips.json", clips)
    dump("content/queue.json", queue)
    print(f"Готово: {clip['id']}, {dur} сек, голос {voice_name}, в очереди осталось {len(items)}")

    left = f"\n\nВ запасе ещё {len(items)} сценариев." if len(items) <= 3 else ""
    telegram(
        "🎧 English Ear: отрывок дня готов\n\n"
        f"{clip['title']}\n{voice_name} · {dur} сек · {clip['topic']}\n\n"
        f"10 минут, один уровень за раз.\n{APP_URL}{left}"
    )


if __name__ == "__main__":
    main()
