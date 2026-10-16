"""Ночной конвейер English Ear: живая британская речь из подкастов.

1. Выбирает подкаст по очереди и находит его RSS через каталог Apple Podcasts
2. Берёт свежий выпуск, которого ещё не было
3. Скачивает аудио, распознаёт кусок в середине бесплатной моделью Whisper прямо на сервере
4. Выбирает живой фрагмент 35...55 секунд, который начинается и заканчивается на границе фразы
5. Сохраняет ссылку на оригинальное аудио, таймкоды и расшифровку (само аудио не копируется)
6. Если есть GEMINI_API_KEY, добавляет разбор конструкций и проглатываний по русски
7. Шлёт уведомление в Telegram

Секреты: TELEGRAM_TOKEN (обязательно для уведомления), TELEGRAM_CHAT_ID и GEMINI_API_KEY (необязательно).
"""
import datetime
import json
import os
import random
import re
import subprocess
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

APP_URL = "https://360dw-sys.github.io/english-ear/"
UA = {"User-Agent": "Mozilla/5.0 EnglishEar/1.0 (personal listening trainer)"}


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def dump(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def get(url, timeout=60):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


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


def find_feed(podcast):
    q = urllib.parse.urlencode({"term": podcast["search"], "entity": "podcast", "limit": 5, "country": "GB"})
    res = json.loads(get(f"https://itunes.apple.com/search?{q}"))
    for r in res.get("results", []):
        name = (r.get("collectionName", "") + " " + r.get("artistName", "")).lower()
        if podcast.get("exclude") and podcast["exclude"] in name:
            continue
        if podcast["must"] in name and r.get("feedUrl"):
            return r["feedUrl"], r.get("collectionName")
    return None, None


def episodes(feed_url):
    root = ET.fromstring(get(feed_url))
    out = []
    for item in root.iter("item"):
        enc = item.find("enclosure")
        if enc is None or "audio" not in (enc.get("type") or "audio"):
            continue
        out.append({
            "title": (item.findtext("title") or "").strip(),
            "url": enc.get("url"),
            "guid": (item.findtext("guid") or enc.get("url")).strip(),
            "link": (item.findtext("link") or "").strip(),
        })
    return out[:8]


def ffprobe_duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                         capture_output=True, text=True, check=True).stdout.strip()
    return float(out)


def transcribe(path, offset, length):
    from faster_whisper import WhisperModel
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", str(offset), "-t", str(length), "-i", path,
                    "-ac", "1", "-ar", "16000", "window.wav"], check=True)
    model = WhisperModel("small.en", device="cpu", compute_type="int8")
    segs, _ = model.transcribe("window.wav", word_timestamps=True, vad_filter=True, language="en")
    words = []
    for s in segs:
        for w in s.words or []:
            words.append({"w": w.word, "s": w.start + offset, "e": w.end + offset, "p": w.probability})
    return words


def pick_span(words, lo=35, hi=55):
    """Ищем отрывок, который начинается после конца предложения и заканчивается точкой."""
    ends = [i for i, w in enumerate(words) if re.search(r"[.?!]$", w["w"].strip())]
    best = None
    for a in [-1] + ends:
        start_i = a + 1
        if start_i >= len(words):
            continue
        t0 = words[start_i]["s"]
        for b in ends:
            if b <= start_i:
                continue
            dur = words[b]["e"] - t0
            if dur < lo:
                continue
            if dur > hi:
                break
            chunk = words[start_i:b + 1]
            # без длинных пауз и с хорошей уверенностью распознавания
            gaps = max((chunk[k + 1]["s"] - chunk[k]["e"] for k in range(len(chunk) - 1)), default=0)
            conf = sum(w["p"] for w in chunk) / len(chunk)
            wpm = len(chunk) / dur * 60
            if gaps > 2.5 or conf < 0.7:
                continue
            score = wpm + conf * 40
            if best is None or score > best[0]:
                best = (score, start_i, b, wpm)
            break
    if not best:
        return None
    _, i, j, wpm = best
    chunk = words[i:j + 1]
    text = re.sub(r"\s+", " ", "".join(w["w"] for w in chunk)).strip()
    return {"start": max(0, int(chunk[0]["s"] - 0.3)), "end": int(chunk[-1]["e"] + 1), "text": text, "wpm": round(wpm)}


def analyse(text):
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        return [], []
    prompt = (
        "Ты преподаватель английского для русскоязычного ученика уровня B2, цель C1. Вот расшифровка 40 секунд живой "
        "британской речи:\n\n" + text + "\n\n"
        "Верни только JSON без пояснений: {\"focus\": [{\"phrase\": \"...\", \"note\": \"...\"}], "
        "\"reductions\": [{\"written\": \"...\", \"heard\": \"...\", \"why\": \"...\"}]}. "
        "focus: 3 до 5 полезных разговорных конструкций или идиом из текста, note по русски, коротко. "
        "reductions: 3 до 5 мест, где в быстрой британской речи слова сливаются или проглатываются, why по русски, коротко. "
        "Не используй тире и дефисы как знаки препинания в русском тексте."
    )
    body = json.dumps({"contents": [{"parts": [{"text": prompt}]}],
                       "generationConfig": {"responseMimeType": "application/json"}}).encode()
    model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}",
        data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            out = json.load(r)
        data = json.loads(out["candidates"][0]["content"]["parts"][0]["text"])
        return data.get("focus", [])[:5], data.get("reductions", [])[:5]
    except Exception as e:  # разбор необязателен, без него отрывок всё равно публикуется
        print("Разбор Gemini пропущен:", e)
        return [], []


def main():
    sources = load("content/sources.json")["podcasts"]
    history = load("content/history.json")
    clips = load("clips.json")
    used = set(history.get("used", []))
    n = len(clips.get("clips", []))
    order = sources[n % len(sources):] + sources[:n % len(sources)]

    for pod in order:
        try:
            feed, name = find_feed(pod)
            if not feed:
                print("Не нашёл RSS:", pod["search"]); continue
            fresh = [e for e in episodes(feed) if e["guid"] not in used and e["url"]]
            if not fresh:
                print("Нет новых выпусков:", name); continue
            ep = fresh[0]
            print("Беру:", name, "|", ep["title"])
            with open("ep.mp3", "wb") as f:
                f.write(get(ep["url"], timeout=600))
            total = ffprobe_duration("ep.mp3")
            if total < 300:
                used.add(ep["guid"]); continue
            # окно в середине выпуска, подальше от рекламы и вступления
            offset = int(total * random.uniform(0.25, 0.6))
            words = transcribe("ep.mp3", offset, 180)
            span = pick_span(words)
            if not span:
                print("Не нашёл чистый фрагмент, пробую следующий подкаст")
                used.add(ep["guid"]); continue
            focus, reductions = analyse(span["text"])
            today = datetime.date.today().isoformat()
            mm = lambda t: f"{t // 60}:{t % 60:02d}"
            clip = {
                "id": f"{today}-{abs(hash(ep['guid'])) % 100000}",
                "date": today,
                "title": ep["title"][:90],
                "speaker": name,
                "accent": "британский",
                "topic": pod["topic"],
                "level": 4 if span["wpm"] >= 190 else 3,
                "audio": ep["url"],
                "start": span["start"],
                "end": span["end"],
                "why": f"Живая речь, фрагмент с {mm(span['start'])} выпуска, темп около {span['wpm']} слов в минуту.",
                "transcript": span["text"],
                "auto_transcript": True,
                "episode_link": ep["link"],
                "focus": focus,
                "reductions": reductions,
            }
            clips.setdefault("clips", []).append(clip)
            clips["updated"] = today
            used.add(ep["guid"])
            history["used"] = sorted(used)
            dump("clips.json", clips)
            dump("content/history.json", history)
            print(f"Готово: {clip['end'] - clip['start']} сек, {span['wpm']} слов/мин")
            telegram(
                "🎧 English Ear: отрывок дня готов\n\n"
                f"{name}\n«{clip['title']}»\n{clip['end'] - clip['start']} сек · темп {span['wpm']} слов/мин\n\n"
                f"10 минут, один уровень за раз.\n{APP_URL}"
            )
            return
        except Exception as e:
            print("Ошибка с подкастом", pod["search"], ":", e)
            continue
    history["used"] = sorted(used)
    dump("content/history.json", history)
    telegram(f"🎧 English Ear: сегодня не удалось найти чистый фрагмент, завтра попробую снова.\n{APP_URL}")
    sys.exit(1)


if __name__ == "__main__":
    main()
