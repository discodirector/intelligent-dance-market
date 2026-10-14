# Intelligent Dance Market ($IDM) — спецификация

> Название и тикер утверждены владельцем 15.10: **Intelligent Dance Market, $IDM**, пул IDM/IMD. Во внутренних идентификаторах кода (SequencerHook, swarm-sequencer) осталось рабочее имя.
> Хакатон: Identity MD Hackathon, приём заявок 7–21 октября 2026, подача на imdradar.site/hackathon.

## 1. Что строим (одной фразой)

Uniswap v4 хук на пуле `IDM/IMD`, внутри которого живёт **ончейн-секвенсор**: каждая сделка детерминированно мутирует 16-шаговый паттерн из 4 ударных дорожек и басовой линии, темп и лад зависят от рынка. Сайт играет текущее состояние хука вживую как IDM-трек, бот на VPS превращает состояние и события в видео-посты для X.

## 2. Ожидаемый результат к 21 октября

| # | Результат | Критерий готовности |
|---|---|---|
| R1 | Хук задеплоен **через IMD Protocol** на **Robinhood Chain (4663)** (`launch.open`, kind `univ4_hook`, пара с IMD) | Адрес хука и пула в explorer.imd.fun, свап реально меняет `state()` |
| R2 | Референсная реализация хука в `contracts/` (Foundry) | `forge test` зелёный, gas afterSwap ≤ 35k, test vectors в `spec/vectors.json` |
| R3 | Сайт-плеер `web/` | Открываешь — слышишь трек из ончейн-состояния, видишь сетку, мигание мутаций; режимы live / replay / demo |
| R4 | Тизер «как звучал пул IMD» (источник — пул IMD на Ethereum mainnet, там больше сделок; live-режим бота и сайта — Robinhood) | mp4 ≥ 30 с из реальных свапов пула IMD на Ethereum за последние 7 дней |
| R5 | Бот на VPS | Docker-сервис, генерирует пост (видео + подпись) по правилам; `DRY_RUN=true` по умолчанию, реальный постинг включается после ключей X |
| R6 | Заявка | X-аккаунт проекта, 5+ постов, подача на imdradar |

Stretch (если успеваем): R7 — «трек дня» через IMD oracle (`oracle.request` по расписанию → колбэк в хук фиксирует паттерн как релиз); R8 — рой IMD рендерит аудио-релиз (`job.open`, output Audio).

## 3. Модель состояния хука (каноническая, Solidity и TS обязаны совпадать бит в бит)

### 3.1 Константы
- `STEPS = 16`, `TRACKS = 4`: `0 kick`, `1 snare`, `2 hat`, `3 glitch`.
- Пороговые размеры сделки в IMD (18 decimals), immutable в конструкторе, дефолты:
  `T_HAT = 0.5`, `T_GLITCH = 5`, `T_SNARE = 25`, `T_KICK = 100` (≥ `T_KICK` — whale).
- `BPM_MIN = 90`, `BPM_MAX = 170`, `EMA_CAP = 3600` секунд.
- `PAGE = 64` — каждые 64 свапа новый `patternId` («страница»).

### 3.2 Упаковка
`slot0` (uint256), от младших бит:
| поле | бит |
|---|---|
| `pattern` uint64 — бит `track*16 + step` | 0–63 |
| `bass` uint64 — 16 ниблов, нибл `step`: 0 = пауза, 1..15 = ступень лада | 64–127 |
| `swapCount` uint32 | 128–159 |
| `lastTs` uint40 | 160–199 |
| `bpm` uint16 | 200–215 |
| `root` uint8 (0..11, 0 = C) | 216–223 |
| `mode` uint8 (0 Dorian, 1 Phrygian, 2 Lydian, 3 Locrian) | 224–231 |

`slot1` (uint256), от младших бит:
| поле | бит |
|---|---|
| `patternId` uint32 | 0–31 |
| `lastTick` int24 (two's complement в 24 битах) | 32–55 |
| `pressure` int32 | 56–87 |
| `intervalEma` uint32 (секунды) | 88–119 |
| `releaseCount` uint32 | 120–151 |

Начальное состояние (в `afterInitialize`): `pattern = 0x10100101` (kick на шагах 0,8 = биты 0,8; snare на шагах 4,12 = биты 20,28 — минимальный грув, чтобы пул «звучал» с первой секунды), `bass = 0`, `bpm = 128`, `root = 9` (A), `mode = 0`, `intervalEma = 600`.

### 3.3 Мутация в `afterSwap` (детерминированно)
1. `isBuy` = трейдер получил IDM (дельта IDM в пользу свопера > 0). `imdAmt = |дельта IMD|`.
2. `swapCount += 1`; `h = uint256(keccak256(abi.encodePacked(uint32 swapCount, int24 tick, uint64 block.number)))`, где `tick` — тик пула **после** свапа.
3. `track`: `imdAmt < T_HAT → 2`, `< T_GLITCH → 3`, `< T_SNARE → 1`, `< T_KICK → 0`, иначе whale → `0`.
4. `step = h % 16`. Buy → бит ставится, Sell → бит снимается.
5. Бас: `deg = 1 + (|tick| / 60) % 15`. Buy → `bass[step] = deg`. Sell → если `(h >> 8) & 1 == 0`, то `bass[step] = 0`, иначе без изменений.
6. Темп: `dt = min(now - lastTs, EMA_CAP)` (первый свап: `dt = intervalEma`); `intervalEma = (intervalEma*7 + dt) / 8`; `bpm = BPM_MAX - intervalEma*(BPM_MAX-BPM_MIN)/EMA_CAP`, кламп в `[BPM_MIN, BPM_MAX]`. Быстрый рынок = быстрый трек.
7. Давление: `pressure = pressure - pressure/16 + (isBuy ? +1000 : -1000)`. Лад: `pressure > 8000 → 2 Lydian`, `>= 0 → 0 Dorian`, `>= -8000 → 1 Phrygian`, иначе `3 Locrian`.
8. Whale: `root = (root + 7) % 12` (квинтовый круг) и `patternId += 1`, событие `Movement`.
9. Если `swapCount % PAGE == 0` → `patternId += 1`.
10. `lastTs = now`, `lastTick = tick`. Записать оба слота, эмитить события.

**Граничные случаи (утверждено 15.10):** `afterSwap` никогда не ревертит — ревертящий хук блокирует все свапы пула. `swapCount`, `patternId`, `releaseCount` переполняются по модулю 2^32 (unchecked; в TS `& 0xffffffff`). `pressure` самоограничен (|p| ≤ 16000), считается в int256. Неуказанные поля начального состояния (`lastTs`, `lastTick`, `pressure`, `patternId`, `releaseCount`) = 0. Первый свап определяется как `swapCount == 0` до инкремента, независимо от времени; тогда `dt = intervalEma`. Кламп `EMA_CAP` применяется только к рантайм-`dt`; если `now < lastTs`, `dt = 0`. Арифметика EMA/bpm в расширенных целых, результат приводится к ширине поля.

Никаких дополнительных комиссий, return-дельт, владельца, админ-функций, апгрейдов. Хук не трогает средства. Hook flags: `afterInitialize`, `afterSwap` (+ то, что требует фабрика IMD — выясняет R2).

### 3.4 События и view
```solidity
event Mutated(address indexed sender, uint32 indexed swapCount, uint8 track, uint8 step, bool on,
              uint8 bassNote, bool isBuy, uint128 imdAmount, int24 tick, uint256 slot0, uint256 slot1);
event Movement(uint32 indexed patternId, uint8 root, uint32 swapCount);
event TrackReleased(uint32 indexed releaseId, uint32 patternId, uint256 slot0, uint256 slot1);  // stretch R7
function state() external view returns (State memory);  // декодированная структура
function raw() external view returns (uint256 slot0, uint256 slot1);
```
`Mutated` несёт полный упакованный стейт — бот и сайт восстанавливают трек из одного лога без RPC-чтений.

### 3.5 Test vectors
`spec/vectors.json` — массив кейсов `{ before: {slot0, slot1}, input: {isBuy, imdAmt, tick, blockNumber, timestamp}, after: {slot0, slot1}, event: {...} }`, ≥ 40 кейсов, включая whale, границы порогов, отрицательные тики, первый свап, переполнение EMA, страницу 64. Генерируется из Foundry; TS-порт обязан проходить все.

## 4. Звук (`packages/synth`, `web/`)
- Чистый WebAudio, без сэмплов, детерминированно из стейта (одинаковый стейт → одинаковый звук; сид микро-таймингов = `patternId`).
- Голоса: kick (синус с pitch-sweep), snare (шум + тон), hat (HP-шум, короткий), glitch (FM-блипы, bitcrush, рэтчеты/статтеры по хэшу шага), bass (saw/FM + LPF, ноты = лад(`root`,`mode`)[deg]).
- IDM-характер: свинг и микро-сдвиги по шагам, редкие статтеры, лад меняет тембр (Locrian — грязнее).
- API: `renderToBuffer(state, bars) → AudioBuffer` (OfflineAudioContext), `createLivePlayer(ctx)` с `setState()` без щелчков на смене паттерна.
- Визуал (canvas): сетка 4×16 + строка баса, бегущий шаг, вспышка мутации, панель `bpm · root/mode · swap #N · page #M`. Эстетика: тёмная, моно-шрифт, терминально-машинная.
- Страница рендера `web/render.html?timeline=<url>` — без UI, экспортирует `window.__render({fps, seconds}) → Promise` для записи ботом.
- Режимы сайта: `live` (viem, адрес хука из конфига, подписка на `Mutated`), `replay` (JSON-таймлайн), `demo` (локальные случайные свапы через тот же TS-мутатор).

## 5. Бот (`packages/core`, `bot/`)
- `packages/core` — TS-порт §3 (`decode`, `encode`, `mutate`), проходит `spec/vectors.json`.
- `bot/replay` — выгружает свапы пула IMD/ETH на Ethereum mainnet из PoolManager `0x000000000004444c5dc75cB358380D2e3dE08A90` (событие `Swap`, poolId пула IMD) за N дней, прогоняет через `mutate` → `timeline.json`. Источник для тизера R4.
- `bot/render` — Playwright/Chromium открывает `render.html`, записывает кадры + аудио → ffmpeg → mp4 1080×1080 и 1920×1080, 20–45 с.
- `bot/caption` — Claude API (`claude-sonnet-5-5`), вход: строгий JSON фактов; выход ≤ 240 символов. Только факты из входа, никакой цены/«купи»/обещаний. Фоллбэк — шаблоны.
- `bot/post` — X API v2, загрузка видео chunked. `DRY_RUN=true` → пишет пост в `out/queue/<ts>/` (mp4 + caption.txt + facts.json).
- Правила постинга: снапшот каждые 6 ч; событие при `Movement`/whale (не чаще 1/ч); «трек дня» после релиза (R7); лимит 6 постов/сутки. До запуска хука — тизеры из replay.
- Деплой: Docker Compose на VPS `root@138.201.92.157` в `/opt/swarm-sequencer`. Не трогать другие сервисы и контейнеры на машине. Секреты только в `/opt/swarm-sequencer/.env`.

## 6. Интеграция с IMD (обязательная для квалификации)
1. Репо R2 публикуется на GitHub → `POST /requests/import` → `launch.open` kind `univ4_hook`, `pairWith: imd`, chain — **Robinhood Chain (chainId 4663)**, IMD на Robinhood `0x5f7bb59365ce557c26dbcaa4ee9d39a4b95b7127` (решение владельца, 15.10). Рой адаптирует, ревьюит, деплоит. Оплата 0.5 IMD подписывается кошельком владельца.
2. Stretch R7: `schedule.create` с `oracle.request` раз в сутки, ответ через Intake `0xa43e6f75ee006411f79ac1c84120606c2330de82` → `onOracleResult` в хуке (проверка `msg.sender == Intake`, `agreed >= quorum`, свежесть) → `TrackReleased`.
3. Все шаги роя (job id, ревью, аудит) — в README и постах: «built by the IMD swarm» = критерий «uses IMD».

## 7. Структура репо и владение
```
SPEC.md            — координатор
contracts/         — W1 (Codex, gpt-6-astra)
spec/vectors.json  — W1 пишет, остальные читают
swarm/BRIEF.md     — W1: англоязычный бриф для launch.open
packages/synth/    — W2 (Grok)
web/               — W2 (Grok)
packages/core/     — W3 (Claude)
bot/               — W3 (Claude)
package.json       — координатор (npm workspaces)
```
Правила: каждый пишет только в свои папки; не коммитит (коммиты делает координатор); не меняет SPEC.md — несогласие/вопрос через orchestration ask.

## 8. Риски
- Фабрика IMD может требовать свой шаблон хука → W1 изучает примеры `identity-md-launches` (launch-825, Pixel Pool, Marginalia) до написания кода.
- Призы платятся на адрес деплоера контракта, а при запуске через рой это кошелёк IMD → уточнить у @imdradar.
- Срок: запуск через рой занимает непредсказуемое время → `launch.open` подаём как только готов R2, не позже 18 октября.
- X API платный; бот работает в DRY_RUN до получения ключей.
