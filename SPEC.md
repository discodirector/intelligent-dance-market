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

### 3.1 Константы (обновлено 15.10: v2)
- `STEPS = 16`, `TRACKS = 4`: `0 kick`, `1 snare`, `2 hat`, `3 glitch`.
- Immutable пороги в IMD (18 decimals): `T_HAT = 0.5`, `T_GLITCH = 5`, `T_SNARE = 25`, `T_KICK = 100`. В **v2** абсолютным остаётся whale-порог `imdAmt >= T_KICK`; остальные три сохранены в ABI для совместимости с v1.
- `BPM_MIN = 72`, `BPM_MAX = 118`, `EMA_CAP = 900` секунд; `PAGE = 64`.
- **v2 relative:** `hatBelow = -8`, `glitchBelow = 10`, `snareBelow = 25`; EMA размера клампится между `L(0.01 IMD)` и `L(T_KICK)`.
- **v2 accumulation:** лестница `hat → glitch → snare → kick`, buy fallback `scan`, sell `up` только до snare, sell fallback `none`.
- **v2 heat/drop:** `SAT_BITS = 48`, `HEAT_MAX = 16`, `SILENCE_RESET_SEC = 3600`, sell cooling `1`, нагрев на no-op buy включён. Число 56 в старом stress-отчёте не является правилом v2: каноничен `DEFAULT_DROP_RULES` из TS.

### 3.2 Упаковка (обновлено 15.10: v2)
`slot0` (uint256), от младших бит; раскладка v1 сохранена:

| поле | бит |
|---|---|
| `pattern` uint64 — бит `track*16 + step` | 0–63 |
| `bass` uint64 — 16 ниблов, нибл `step`: 0 = пауза, 1..15 = ступень лада | 64–127 |
| `swapCount` uint32 | 128–159 |
| `lastTs` uint40 | 160–199 |
| `bpm` uint16 | 200–215 |
| `root` uint8 (0..11, 0 = C) | 216–223 |
| `mode` uint8 (0 Dorian, 1 Phrygian, 2 Lydian, 3 Locrian) | 224–231 |
| свободно | 232–255 |

`slot1` (uint256), от младших бит:

| поле | бит |
|---|---|
| `patternId` uint32 | 0–31 |
| `lastTick` int24 (two's complement в 24 битах) | 32–55 |
| `pressure` int32 | 56–87 |
| `intervalEma` uint32 (секунды) | 88–119 |
| `releaseCount` uint32, резерв R7, не изменяется | 120–151 |
| **`sizeLogEma` uint16, добавлено 15.10** | **152–167** |
| **`heat` uint8, добавлено 15.10** | **168–175** |
| **`trackNo` uint16, добавлено 15.10** | **176–191** |
| свободно | 192–255 |

Начальное состояние v2: `pattern = 0x10100101` (kick 0,8; snare 4,12), `bass = 0`, `bpm = 96`, `root = 9` (A), `mode = 0`, `intervalEma = 600`, **`sizeLogEma = L(5 IMD) = 993`**. Остальные поля = 0. Дополнительных storage-слотов нет. Старый развёрнутый хук и его replays продолжают использовать v1; TS `mutate/encode/decode` без options и Solidity `initial/mutate` сохраняют v1. Новый хук вызывает `initialV2/mutateV2`; TS соответствует `V2_RULES/V2_SLOTS`.

### 3.3 Мутация в `afterSwap` (обновлено 15.10: v2)
1. `isBuy` = свопер получил IDM (дельта IDM > 0), `imdAmt = |дельта IMD|`; используются фактическая дельта и тик **после** свапа. До остальных действий: если `now >= lastTs` и `now-lastTs >= 3600`, `heat = 0`. При 3599 секундах нагрев сохраняется; обратный ход часов ничего не охлаждает.
2. `first = swapCount == 0` до инкремента; `swapCount = (swapCount+1) mod 2^32`; `h = uint256(keccak256(abi.encodePacked(uint32 swapCount, int24 tick, uint64 block.number)))`; `step = h % 16`.
3. **Relative:** `L(0)=0`; иначе `m=msb(imdAmt)`, `f=(m>=4 ? imdAmt>>(m-4) : imdAmt<<(4-m)) & 15`, `L=m*16+f`. До обновления EMA вычисляется signed `r=L-sizeLogEma`: `r<-8 → hat`, `r<10 → glitch`, `r<25 → snare`, иначе kick. Whale определяется только абсолютным `T_KICK` и обходит relative/accumulation.
4. **Accumulation, только non-whale:** если classified-бит отличается от `isBuy`, просто записать его. Иначе buy ставит первый свободный бит выше по лестнице на том же шаге; sell снимает первый установленный выше, **только до snare**, kick такой sell не трогает. Если buy дошёл до верха, искать ближайший свободный шаг на исходной classified-дорожке вперёд по кругу (1..15); полная строка → no-op. Для sell без кандидата → no-op. `fromTrack` = исходный класс, `track/writeStep` = место записи; `promoted` также означает spill на другой шаг. `Mutated.step` всегда остаётся hash-шагом для баса, `on = isBuy` даже при no-op.
5. **Heat, только non-whale:** buy после записи добавляет 1 (saturating 255), если `popcount(pattern)>=48` **или** pattern не изменился. Sell уменьшает heat на 1 с насыщением в 0. Whale не меняет heat после silence-reset.
6. Бас на hash-шаге: `deg=1+(abs(int256(tick))/60)%15`. Buy записывает deg; sell при `((h>>8)&1)==0` очищает нибл. `bassNote` события берётся после этого действия, **до thinning на track completion**.
7. Темп: для first `dt=intervalEma`, иначе при обратных часах 0, иначе `min(now-lastTs,900)`. `intervalEma=floor((intervalEma*7+dt)/8)`; `bpm=clamp(118-floor(intervalEma*46/900),72,118)`. Давление: `pressure=pressure-trunc(pressure/16)+(isBuy ? 1000 : -1000)`; mode: `>8000 → 2`, `>=0 → 0`, `>=-8000 → 1`, иначе 3.
8. **Whale, поведение v1 сохранено:** вместо шагов 3–5 заменить всю дорожку `dropTrack=(h>>16)%4`. Sell очищает её. Buy пишет евклидов ритм: `k=3+(h>>24)%6`, `rot=(h>>32)%16`; бит `(i+rot)%16` установлен iff `(i*k)%16<k` для `i=0..15`. Бас выполняется обычно. `root=(root+7)%12`, `patternId+=1`, `Movement`, затем `Drop`; `Mutated.track=dropTrack`. Идентичность Movement фиксируется до возможного дальнейшего completion.
9. Если `swapCount%64==0`, `patternId+=1`. Затем `lastTs=now`, `lastTick=tick`; `sizeLogEma=floor((7*sizeLogEma+clamp(L,L(0.01 IMD),L(T_KICK)))/8)` **на каждом свапе, включая whale**.
10. **Track completion:** если `heat>=16`, сохранить `snapshot=encode(state)` **после** page/EMA/timestamps, **до** reset. Затем `root=(root+7)%12`, `patternId+=1`, `trackNo=(trackNo+1) mod 2^16`; `pattern=dropSeed(h)`, `bass &= 0x000f000f000f000f` (оставить четвертные якоря 0,4,8,12), `heat=0`. Событие `TrackComplete` несёт старые слоты, но **новые** `trackNo/patternId/root/seed`. Номер внутри snapshot = предыдущий trackNo.
11. Записать финальные два слота один раз. События по порядку: whale `Movement/Drop` (если есть), `Accumulated` (если есть), `TrackComplete` (если есть), `Mutated` с финальными слотами. `TrackReleased/releaseCount` зарезервированы и не задействованы.

**Curated dropSeed:** kick выбирается из `[0x0101,0x0401,0x0481,0x0901,0x4141,0x1111]` индексом `((h>>64)&255)%6`; snare из `[0x1010,0x1090,0x1410,0x9010]` индексом `(h>>72)&3`; hat — Euclid с `k=3+((h>>76)&3)`, `rot=(h>>80)&15`; `g=(h>>84)&31`, glitch = `g>=16 ? 1<<(g&15) : 0`. Итог `kick | snare<<16 | hat<<32 | glitch<<48`: 26 112 допустимых комбинаций, 7..14 ударов.

**Граничные случаи (15.10):** корректный callback не должен блокировать свапы арифметическим revert. Авторизация PoolManager и привязка пула остаются обязательными; неверные вызовы отклоняются. Счётчики swapCount/patternId переполняются modulo 2^32, trackNo modulo 2^16. releaseCount не изменяется. Pressure считается в int256 и сам ограничен при достижимом состоянии (|p|≤16000). EMA и bpm считаются в расширенных целых; min int24 безопасен благодаря widening до abs. Первым считается swapCount=0 до инкремента, включая timestamp=0 и wrap. Произвольный packed heat=255 насыщается и затем сбрасывается; нет unchecked uint8-инкремента 255→0. Все циклы ограничены; scan использует rotate + поиск младшего свободного бита.

Хук immutable: без владельца, админ-функций, апгрейдов, комиссий и return-дельт; не трогает средства. Flags `0x3040`: `beforeInitialize`, `afterInitialize`, `afterSwap`. Новый v2 требует отдельного деплоя; обновление исходников не меняет старый хук.

### 3.4 События и view (обновлено 15.10: v2)
```solidity
event Mutated(address indexed sender, uint32 indexed swapCount, uint8 track, uint8 step, bool on,
              uint8 bassNote, bool isBuy, uint128 imdAmount, int24 tick, uint256 slot0, uint256 slot1);
event Movement(uint32 indexed patternId, uint8 root, uint32 swapCount);
event Drop(uint32 indexed swapCount, uint8 track, bool fill, uint16 mask);
event Accumulated(uint32 indexed swapCount, uint8 fromTrack, uint8 writeStep, bool promoted, bool noop);
event TrackComplete(uint16 indexed trackNo, uint32 patternId, uint8 root,
                    uint256 slot0, uint256 slot1, uint32 swapCount, uint64 seed);
event TrackReleased(uint32 indexed releaseId, uint32 patternId, uint256 slot0, uint256 slot1); // резерв R7
function state() external view returns (State memory);
function raw() external view returns (uint256 slot0, uint256 slot1);
```
Сигнатура `Mutated` сохранена. `Accumulated` эмитится только при `promoted || noop` у non-whale; его отсутствие означает `fromTrack=track`, `writeStep=step`, `promoted=false`, `noop=false`. Это позволяет корректно рисовать spill и no-op, сохраняя bass/hash step; отдельный лог имеет дополнительную стоимость газа на таких свапах. `TrackComplete` включает seed, поэтому все поля TS TrackComplete доступны из одного события. Финальный стейт берётся из `Mutated`; законченный трек — из snapshot в `TrackComplete`. Индексаторы старого хука остаются на v1 ABI/слотах.

### 3.5 Test vectors (обновлено 15.10: v2)
`spec/vectors.json` сохраняет v1. `spec/vectors-v2.json` генерируется Foundry из `mutateV2` и содержит имена кейсов, before/input/after и **все** поля TS event (включая fromTrack/promoted/writeStep/noop и TrackComplete snapshot/seed). Schema расширена аддитивно. TS отдельно прогоняет обе версии; отсутствие v2-файла считается ошибкой. Набор v2 покрывает границы relative, все сочетания занятости колонок, подъём/scan и sell-правило, нагрев/насыщение 48, no-op heat, 3599/3600, sell cooling, whale/page/drop interplay, wraps и непрерывную последовательность нескольких треков.

## 4. Звук (`packages/synth`, `web/`)
- Чистый WebAudio, без сэмплов, детерминированно из стейта (одинаковый стейт → одинаковый звук; сид микро-таймингов = `patternId`).
- Голоса и тембры задаёт жанр эпохи (§4.1): у каждого жанра свой кит, бас, пэд/лид и обработка.
- IDM-характер: свинг и микро-сдвиги по шагам, редкие статтеры и рэтчеты; их частоту задаёт жанр.
- API: `renderToBuffer(state, bars) → AudioBuffer` (OfflineAudioContext), `createLivePlayer(ctx)` с `setState()` без щелчков на смене паттерна.
- Визуал (canvas): сетка 4×16 + строка баса, бегущий шаг, вспышка мутации, панель `bpm · root/mode · swap #N · page #M`. Эстетика: тёмная, моно-шрифт, терминально-машинная.
- Страница рендера `web/render.html?timeline=<url>` — без UI, экспортирует `window.__render({fps, seconds}) → Promise` для записи ботом.
- Режимы сайта: `live` (viem, адрес хука из конфига, подписка на `Mutated`), `replay` (JSON-таймлайн), `demo` (локальные случайные свапы через тот же TS-мутатор).

### 4.2 Затухание без сделок (только синт, добавлено 15.10)
- `idle = now − lastTs` (в live — реальное время; в replay/render — виртуальное время воспроизведения, детерминированно).
- `< 10 мин` — полный трек. `10–30 мин` — прореживание: сначала глитч и хэт плавно уходят, затем снейр. `30–60 мин` — остаются пэд, бас и тихая бочка. `> 60 мин` — дрон: пэд, приглушённый бас, мягкий пульс бочки и тянущийся тон (корень + квинта, вступает с 40 мин); на 3–10 dB тише полного трека, но всегда отчётливо слышен.
- Первый свап после паузы — мгновенный возврат всех голосов с коротким филлом/райзером на ближайшей доле.
- Стадия затухания видна в UI и доступна боту (`idleStage`).

### 4.1 Эпохи и жанры (обновлено 16.10: жанры вместо эр)
- **Эпоха** = `floor(patternId / 4)`. `patternId` растёт каждые 64 свапа, на каждом ките и на каждом дропе трека, так что эпоха длится не больше 256 свапов. Вычисляется из ончейн-стейта, контракт не меняется.
- Каждая эпоха получает один из 10 **жанров** (обновлено 18.10). Эпохи идут циклами, в каждом цикле каждый жанр звучит один раз. Первый цикл (эпохи 0–9) — порядок владельца: Liquid DnB, Wonky, Trip-hop, Lofi House, Future Garage, Electro, Ambient Drone, Ambient IDM, Dub Techno, Acid. Каждый следующий цикл — детерминированная перетасовка по хэшу, без повтора жанра и без A-B-A на стыке циклов.
- **Стили** (`packages/synth/src/styles.ts`): у каждого жанра 3 стиля, появление жанра играет один стиль всю эпоху. Появления жанра идут по стилям строго по кругу в порядке владельца: Liquid — Keys, Soulful, Atmospheric; Wonky — Dilla Swing, Brainfeeder, Glitch-hop; Trip-hop — Bristol Dark, Cinematic, Rhodes Break; Lofi House — Raw Rave, Sample Chop, Dusty Keys; Future Garage — Dark Sub, Rain Atmos, Vocal Chops; Electro — Alien Rave, Cold 808, Client_03; Ambient Drone — Wall, Dark Low, Overtone Pulse; Ambient IDM — Tape Haze, Tape Keys, Crystal; Dub Techno — Lucidflow, Ixtlan, The Moment; Acid — 303 Floor, Acid House, Slow Rubber.
  - История жанров заморожена: жанр прошлой эпохи не меняется никогда. Пул меняется только добавлением записи с будущей эпохи. Тест `packages/synth/test/eras.test.ts` фиксирует жанры эпох 0–4095.
- **Жанры** (диапазон темпа): Dub Techno (117–124 по стилям; Brickman / Lucidflow), Electro (118–130), Acid (120–132), Ambient IDM (84–100), Ambient Drone (60–80), Liquid DnB (170–176), Future Garage (130–138), Trip-hop (84–96), Lofi House (118–124), Wonky (80–94; бит-сцена: Dilla, Brainfeeder, Prefuse 73). До запуска набор менялся (16.10: убраны Hypnotic Techno и Braindance; Techstep и Romanian House попробованы и убраны; 18.10: добавлен Wonky, убран Industrial, задан порядок первого цикла и стилей, история жанров перезакреплена), после запуска только через `ERA_SCHEDULE`.
- **Принципы:**
  - чейн управляет ритмом и тембром, а не высотой нот;
  - одна тоника на появление жанра (одна из четырёх тоник жанра, по хэшу эпохи) и маленький набор нот; тональность внутри появления не меняется;
  - не больше 4 слоёв одновременно;
  - аккорды меняются только в Ambient IDM, Liquid DnB, Trip-hop, Lofi House и Wonky (в Wonky — прогрессия из четырёх минорных/дорийских септ- и нона-аккордов на эпоху): от рынка не зависят;
  - мелодия есть только в Ambient IDM, в Liquid DnB (фраза или аккордовые стабы на слабые доли), в стабах Lofi House и Electro в вокальных чопах Future Garage и в Wonky (арпеджио и «стеклянные» блики Brainfeeder, вокальные чопы Glitch-hop — только ноты текущего аккорда); ритм этих партий задан фигурой на эпоху, чейн задаёт только плотность.
- **Ончейн → звук:**
  - тик пула → фильтры и тембр (один «оборот» на ~1500 тиков, то есть по уровню цены, а не на каждый свап);
  - давление продаж → темнее, больше пространства; давление покупок → драйв;
  - биты баса → ритм баса; высоту выбирает жанр из своего набора нот;
  - киты и дроп трека → удары и смена секции;
  - ончейн-темп 72–118 → линейно в диапазон жанра.
  - `root` и `mode` из стейта синт не использует.
- **Вариативность внутри жанра** по хэшу эпохи: тоника, фигуры стабов, наборы нот 303, лид-патчи, фразы, пары аккордов. Варианты внутри жанра можно добавлять после запуска: жанр эпохи от этого не меняется.
- Переход между жанрами — кроссфейд в 1 такт, без щелчков. Название жанра и номер эпохи — в UI.
- Описание по жанрам и что слушать: `sim/genres/NOTES.md`. Рендер эскизов: `node web/scripts/genre-sketches.mjs`; три появления одного жанра подряд: `node web/scripts/genre-variety.mjs --only <id>`.

### 4.3 Аранжировка: стейт — это ручки, а не партитура (добавлено 15.10)
- Проблема прямого чтения сетки: серия одинаковых свапов забивает одну дорожку (16 снейров подряд), трек превращается в кашу. Контракт не меняется; меняется только интерпретация (`packages/synth/src/arrange.ts`, чистая детерминированная функция `arrange(state, bar)`).
- Ончейн-сетка задаёт **ручки**: плотность каждой дорожки = число включённых шагов (0–16), энергия = общая плотность / 64. Конкретные биты выбирают вариант фигуры (хэш слова дорожки), так что каждый свап по-прежнему меняет звучание.
- **Правила музыкальности** (голоса играют только результат):
  - бочка: всегда на шаге 0; размер фигуры 2–6 ударов по плотности, фигуры из курированной таблицы; 0 бит → брейк без бочки;
  - снейр: всегда бэкбит 5/13 (шаги 4 и 12), затем до 4 тихих гоуст-нот, на каждом 4-м такте — подводка-ролл;
  - хэт: равномерное (евклидово) распределение 4–12 ударов, акцент на офбитах; на каждом 8-м такте вторая половина такта пустая;
  - глитч: не больше 3 орнаментов, только на свободных от бочки/бэкбита шагах, предпочтительно на собственных битах цепочки;
  - бас: до 6 нот из ончейн-позиций (приоритет сильных долей и совпадения с бочкой), позиции нот — это ритм, высоту выбирает жанр из своего набора нот (§4.1).
- **Насыщение вместо накопления**: повтор одного действия доводит ручку до края и упирается (16 бит снейра = бэкбит + 4 гоуста).
- **Фразировка**: счётчик тактов воспроизведения (`bar`) добавляет движение даже при неподвижном стейте — филл каждые 4 такта, брейк хэтов каждые 8.
- Визуал показывает ту же аранжировку, что звучит; ончейн-биты — вспышкой мутации.
- Стенд: `npx tsx web/scripts/stress.ts` (50 одинаковых покупок каждого размера, 50 продаж, только киты, один тик, случайная смесь — проверка правил) и `node web/scripts/stress-render.mjs` (WAV для прослушивания в `sim/stress/`).

### 4.4 Форма трека, подложка, мотив (добавлено 15.10)
- **Форма** — 32 такта по счётчику тактов воспроизведения (`sectionAt(bar)`): `intro` 1–8 (пэд + подложка, бочка вполсилы, закрытый фильтр; хэты и бас со 2-й половины), `build` 9–16 (вступают снейр, хэты, глитч, бас; фильтр открывается; мотив со 13-го такта), `full` 17–24 (всё, гоусты снейра), `breakdown` 25–28 (без бочки и снейра: пэд, подложка, мотив с эхом), `rebuild` 29–32 (полутемп бочки, затем полный; ролл снейра в 32-м такте). Рынок задаёт плотность внутри части; форма решает, какие слои звучат.
- **Подложка** — тянущийся тон на тонике жанра (корень + квинта); звучит только в простое (§4.2).
- **Мотив** — двухтактовая фраза «вопрос — ответ» на эпоху (`patternId / 4`): ритм из 5 шаблонов, ноты из набора нот жанра над его тоникой, ответ разрешается в тонику, каждый 4-й такт — вариация хвоста на терцию выше. Играет только в Ambient IDM (и как редкие стабы Electro). У Liquid DnB свои фразы и стабы (§4.1).
- **Микс**: ударные −1.7 dB, общий lowpass по форме (≈420 Гц … 16 кГц).
- **Клипы бота** начинают форму с 11-го такта (`barOffset = 10`), чтобы ~32 с видео попадали из нарастания в кульминацию; на сайте PLAY начинает с intro. Текущая часть видна в UI (`FULL 19/32`).
- Детерминизм оффлайн-рендера: больше двух входов на одном узле суммируются в непредсказуемом порядке — голоса складываются попарно (`MixChain` или цепочка `sum`).

### 4.5 Лид-патчи (добавлено 15.10)
- Мотив играет не голый осциллятор, а патч (`packages/synth/src/leads.ts`): стек осцилляторов с детюном/октавами (в т.ч. узкие пульсы через PeriodicWave), FM-модулятор с затухающим индексом, фильтр со своей огибающей или две форманты, ADSR, вибрато с задержкой, глайд от предыдущей ноты, щелчок высоты на атаке, шум дыхания/смычка, tanh-драйв.
- 14 патчей: Supersaw, Reese, PWM Lead, FM Electric Piano, Tape Flute, Pluck, Acid Lead, Glass Bell, Warm Keys, Mellow Lead, Formant Vox, Melodica, Chip Pulse, Bowed Drone. Играют только жанры с мелодией (`ERA_LEADS`): Ambient IDM (FM Electric Piano, Tape Flute, Glass Bell), Electro (Glass Bell, PWM Lead, Pluck), Liquid DnB (Warm Keys, Mellow Lead), Lofi House (Warm Keys), Future Garage (Formant Vox — вокальные чопы). Эпоха выбирает один патч, так что два появления жанра звучат по-разному.
- Детерминизм: на любом AudioParam не больше одного модулирующего входа (вибрато и FM складываются в отдельном узле), голоса суммируются попарно.
- Галерея для прослушивания: `node web/scripts/lead-gallery.mjs` → `sim/stress/leads/<жанр>-<патч>.wav` (кульминация, 16 с) + проверка детерминизма каждого патча.

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
