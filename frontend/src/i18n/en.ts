// Английский словарь. Ключ — исходная русская строка (см. i18n/t.ts).
// Покрытие наращивается проходами: непереведённое остаётся русским, а не
// превращается в идентификатор на экране.
//
// Проход 1: шапка/футер/меню, лендинг, экран «открой с компьютера», экраны
// входа-регистрации-восстановления, тексты ошибок API.
// Дальше: профиль, соло-ритуал, дуэль, турнир и скрамбл дня, правила/приватность.

export const EN: Record<string, string> = {
  // --- шапка, футер, меню ---
  Войти: "Log in",
  Регистрация: "Sign up",
  Профиль: "Profile",
  Настройки: "Settings",
  Выйти: "Log out",
  "Настройки появятся позже.": "Settings are coming later.",
  Правила: "Rules",
  "Данные и приватность": "Data and privacy",
  "Язык интерфейса": "Interface language",
  "Кубки: {n}": "Cups: {n}",
  Русский: "Русский",
  English: "English",

  // --- лендинг ---
  "Дуэли по сборке кубика. Судит камера.": "Cube duels. The camera is the judge.",
  "Показываешь кубик в камеру — браузер сам проверяет скрамбл, ловит старт и стоп по рукам и подтверждает сборку. Ни живого судьи, ни «поверь на слово».":
    "Show the cube to your camera: the browser checks the scramble itself, catches the start and stop from your hands, and confirms the solve. No human judge, no «take my word for it».",
  "Создать аккаунт": "Create an account",
  "Попробовать соло без аккаунта": "Try solo without an account",
  "Нужен компьютер с камерой и обычный комнатный свет. Видео не покидает браузер.":
    "You need a computer with a camera and ordinary room light. Video never leaves your browser.",
  "Сборка идёт с компьютера: нужна камера, кубик и обе руки на столе. С телефона можно почитать правила и завести аккаунт.":
    "Solving happens on a computer: it needs a camera, a cube and both hands on the table. From a phone you can read the rules and create an account.",

  "Как проходит сборка": "How a solve goes",
  "Показываешь собранный кубик": "Show the solved cube",
  "Браузер запоминает цвета именно твоего кубика — до скрамбла, чтобы таймер нельзя было взвести заранее.":
    "The browser learns the colours of your particular cube — before the scramble, so the timer cannot be armed in advance.",
  "Скрамбл выдаёт сервер": "The server issues the scramble",
  "Мешаешь по пошаговым картинкам или по нотации и показываешь результат — он сверяется с эталоном.":
    "Scramble it step by step from pictures or notation and show the result — it is checked against the expected state.",
  "Две руки на стол — старт": "Both hands on the table — start",
  "Отпустил руки — время пошло. В дуэли старт синхронный, его даёт сервер обоим.":
    "Lift your hands and the clock runs. In a duel the start is synchronous and comes from the server for both players.",
  "Руки на стол — стоп": "Hands on the table — stop",
  "Показываешь кубик в камеру, сборка подтверждается, время записывается в историю.":
    "Show the cube to the camera, the solve is confirmed and the time goes into your history.",
  "Правила целиком: что засчитывается, а что DNF": "Full rules: what counts and what is a DNF",

  "Где соревноваться": "Where to compete",
  "Соло-тренировка": "Solo practice",
  "Весь ритуал целиком, без аккаунта. Сборки сохраняются, если войти.":
    "The whole ritual, no account needed. Solves are saved once you log in.",
  "Дуэль по ссылке": "Duel by link",
  "Создаёшь комнату, кидаешь ссылку другу — старт синхронный, скрамбл один на двоих.":
    "Create a room, send a friend the link — synchronous start, one shared scramble.",
  "Челлендж недели": "Weekly challenge",
  "Общий скрамбл на неделю, одна попытка.": "One shared scramble for the week, one attempt.",
  "Скрамбл дня": "Daily scramble",
  "Общий скрамбл на сутки, одна попытка.": "One shared scramble for the day, one attempt.",
  "● идёт запись": "● recording now",

  "Честно и без слежки": "Honest, and no tracking",
  "Скрамбл генерит сервер": "The server generates the scramble",
  "— не браузер, так что подсмотреть его заранее нельзя.":
    "— not the browser, so it cannot be peeked at in advance.",
  "Видео остаётся у тебя": "The video stays with you",
  "— кадры с камеры обрабатываются прямо в браузере и никуда не отправляются.":
    "— camera frames are processed in the browser and never sent anywhere.",
  "Мест и рейтинга пока нет": "There are no places or ratings yet",
  "— времена сейчас заявляет клиент, поэтому таблицы показывают участников без номеров. Рейтинг появится, когда заработает серверная проверка.":
    "— times are currently self-reported, so the boards list participants without positions. Ratings arrive when server-side verification does.",
  "Готов?": "Ready?",
  "Аккаунт нужен для дуэлей, челленджа недели и истории сборок. Соло работает и без него.":
    "An account is needed for duels, the weekly challenge and solve history. Solo works without one.",
  "У меня уже есть аккаунт": "I already have an account",

  // --- дашборд ---
  "С чего начнём?": "Where do we start?",
  "Соло — на разогрев, дуэль — на соперника, челлендж и скрамбл дня — на общем скрамбле.":
    "Solo to warm up, a duel for an opponent, the weekly and daily challenges on a shared scramble.",
  "Общий скрамбл, одна попытка — без турнирной таблицы.":
    "One shared scramble, one attempt — no ranked table.",
  "Общий скрамбл на сутки, одна попытка — без турнирной таблицы.":
    "One shared scramble for the day, one attempt — no ranked table.",
  "Создай комнату и пришли ссылку сопернику — старт синхронный, один общий скрамбл.":
    "Create a room and send your opponent the link — synchronous start, one shared scramble.",
  "Создаю комнату…": "Creating the room…",
  "Не удалось создать дуэль. Попробуй ещё раз.": "Could not create the duel. Try again.",
  "Тема: {theme}": "Theme: {theme}",
  светлая: "light",
  тёмная: "dark",
  "Замер точности (dev)": "Accuracy run (dev)",

  // --- экран «открой с компьютера» ---
  "Сборку судит камера компьютера": "A computer camera judges the solve",
  "Ритуал Cubr держится на камере: браузер смотрит, как ты мешаешь кубик, ловит старт и стоп по рукам на столе и подтверждает сборку. С телефона так не выйдет — руки заняты кубиком, а камера смотрит куда угодно, только не на стол.":
    "The Cubr ritual runs on the camera: the browser watches you scramble, catches the start and stop from your hands on the table, and confirms the solve. A phone cannot do that — your hands are busy with the cube and the camera points anywhere but the table.",
  "Открой этот адрес на ноутбуке или компьютере с камерой:":
    "Open this address on a laptop or desktop with a camera:",
  "Скопировать ссылку": "Copy the link",
  "Ссылка скопирована": "Link copied",
  "На главную": "Home",
  "Всё равно открыть здесь": "Open it here anyway",

  // --- вход и регистрация ---
  Вход: "Log in",
  "Войди, чтобы сохранять сборки и рекорды.": "Log in to keep your solves and records.",
  Почта: "Email",
  Пароль: "Password",
  "Вхожу…": "Logging in…",
  "Вход через Google": "Continue with Google",
  "Не удалось войти. Попробуй ещё раз.": "Could not log in. Try again.",
  "Вход прошёл, но не удалось загрузить профиль. Попробуй обновить.":
    "Logged in, but the profile could not be loaded. Try refreshing.",
  "Забыли пароль?": "Forgot your password?",
  "Создай аккаунт, чтобы сохранять сборки.": "Create an account to keep your solves.",
  Никнейм: "Nickname",
  "Создаю…": "Creating…",
  Зарегистрироваться: "Sign up",
  "Не удалось зарегистрироваться.": "Could not sign up.",
  "Подтвердите почту": "Confirm your email",
  "подтвердите почту": "confirm your email",
  "Мы отправили письмо со ссылкой подтверждения.":
    "We have sent an email with a confirmation link.",
  "Подтверждение почты": "Email confirmation",
  "Подтверждаю…": "Confirming…",
  "В ссылке нет токена. Открой ссылку из письма целиком.":
    "The link has no token. Open the full link from the email.",
  "Сброс пароля": "Password reset",
  "Укажи почту — пришлём ссылку для сброса.": "Enter your email and we will send a reset link.",
  "Отправить ссылку": "Send the link",
  "Отправляю…": "Sending…",
  "если адрес есть…": "if the address exists…",
  "Придумай новый пароль для аккаунта.": "Choose a new password for your account.",
  "Новый пароль": "New password",
  "Повтори пароль": "Repeat the password",
  "Пароли не совпадают.": "The passwords do not match.",
  "Сохранить пароль": "Save the password",
  "Сохраняю…": "Saving…",
  "Пароль обновлён": "Password updated",
  "Не удалось сбросить пароль.": "Could not reset the password.",
  "Завершаю вход…": "Finishing the login…",
  "Доступ к Google-аккаунту не был предоставлен.": "Access to the Google account was not granted.",
  "Не удалось войти через Google. Попробуй ещё раз.": "Could not log in with Google. Try again.",
  "Сессия входа устарела. Попробуй войти заново.":
    "The login session has expired. Try logging in again.",
  "Загрузка…": "Loading…",

  // --- ошибки API (api/client.ts) ---
  "Неверная почта или пароль.": "Wrong email or password.",
  "Почта не подтверждена. Проверь письмо или запроси новое.":
    "Email is not confirmed. Check your inbox or request a new letter.",
  "Пользователь с такой почтой уже зарегистрирован.": "An account with this email already exists.",
  "Пароль слишком простой. Минимум 8 символов.": "The password is too weak. At least 8 characters.",
  "Ссылка сброса недействительна или устарела. Запроси новую.":
    "The reset link is invalid or expired. Request a new one.",
  "Ссылка подтверждения недействительна или устарела.":
    "The confirmation link is invalid or expired.",
  "Почта уже подтверждена. Можно входить.": "Email is already confirmed. You can log in.",
  "Достигнут лимит: можно хранить не больше 5 кубиков. Удали лишний, чтобы добавить новый.":
    "Limit reached: at most 5 cubes can be stored. Delete one to add another.",
  "Такое имя не подходит. Выбери другое.": "That name is not allowed. Pick another one.",
  "Это имя зарезервировано за сервисом. Выбери другое.":
    "That name is reserved by the service. Pick another one.",
  "В имени можно использовать буквы, цифры, пробел, дефис, точку и подчёркивание.":
    "A name may contain letters, digits, spaces, hyphens, dots and underscores.",
  "Имя слишком короткое: минимум 2 символа.": "The name is too short: at least 2 characters.",
  "Слишком много попыток. Подожди немного и попробуй снова.":
    "Too many attempts. Wait a moment and try again.",
  "Не удалось связаться с сервером. Проверь интернет.":
    "Could not reach the server. Check your connection.",
  "Ошибка на сервере. Попробуй ещё раз чуть позже.": "Server error. Try again a little later.",
  "Сервер сейчас недоступен. Попробуй через минуту.":
    "The server is unavailable right now. Try again in a minute.",
  "Сервер не ответил вовремя. Попробуй ещё раз.": "The server did not answer in time. Try again.",
  "Что-то пошло не так. Попробуй ещё раз.": "Something went wrong. Try again.",

  // --- добито в проходе 1 ---
  "Нет аккаунта?": "No account yet?",
  "Вернуться ко входу": "Back to login",
  "Перейти ко входу": "Go to login",
  "Войти с новым паролем": "Log in with the new password",
  "Готово. Теперь войди с новым паролем.": "Done. Now log in with the new password.",
  "Если аккаунт существует и не подтверждён — новое письмо отправлено.":
    "If the account exists and is unconfirmed, a new letter has been sent.",
  "Отправить письмо с подтверждением ещё раз": "Send the confirmation email again",
  "Отправить письмо ещё раз": "Send the email again",
  "Письмо отправлено ещё раз.": "The email has been sent again.",
  "Открой письмо на адрес": "Open the email sent to",
  "и перейди по ссылке. После подтверждения сможешь войти.":
    "and follow the link. Once confirmed, you can log in.",
  "Почта подтверждена. Теперь можно войти.": "Email confirmed. You can log in now.",
  "Ссылка подтверждения недействительна или устарела. Войди и запроси новое письмо.":
    "The confirmation link is invalid or expired. Log in and request a new letter.",
  "Если этот адрес зарегистрирован, мы отправили на него ссылку для сброса пароля. Проверь почту.":
    "If that address is registered, we have sent it a password reset link. Check your inbox.",
  "Регистрируясь, ты соглашаешься с": "By signing up you agree to the",
  правилами: "rules",
  "обработкой данных": "data processing terms",
  и: "and",
  или: "or",
  "Открываю Google…": "Opening Google…",
  "Не удалось начать вход через Google.": "Could not start the Google login.",

  // --- проход 2: профиль, кубики, бейджи, график ---
  "Загрузка профиля…": "Loading the profile…",
  "Без ника": "No nickname",
  "Почта не подтверждена": "Email not confirmed",
  Рекорды: "Records",
  "Лучшая сборка": "Best single",
  "Лучший Ao5": "Best Ao5",
  Кубки: "Cups",
  "Аватар {name}": "{name}'s avatar",
  "Текущий Ao5 (последние {n} попыток):": "Current Ao5 (last {n} attempts):",
  "пока нет": "not yet",

  "Формат времени": "Time format",
  "Минуты : секунды": "Minutes : seconds",
  Секунды: "Seconds",

  "Ссылка на аватар": "Avatar URL",
  "Публичное имя в турнире": "Public name on the boards",
  "Не задано — покажем как «Аноним»": "Not set — shown as «Anonymous»",
  "Это имя увидят другие участники турнира в таблице недели. Оставь поле пустым — и там будет стоять «Аноним».":
    "Other players see this name on the weekly board. Leave it empty and it will read «Anonymous» there.",
  Сохранить: "Save",
  Сохранено: "Saved",
  "Не удалось сохранить изменения.": "Could not save the changes.",

  // витрина
  Витрина: "Showcase",
  "Метод сборки": "Solving method",
  "Не указан": "Not set",
  "Слоями (начинающий)": "Layer by layer (beginner)",
  Другой: "Other",
  "Собираю с года": "Solving since",
  "Сохранить витрину": "Save the showcase",
  "Не удалось сохранить витрину.": "Could not save the showcase.",
  "Метод и год начала — для себя: публичных профилей в Cubr нет, на таблицах видно только публичное имя.":
    "The method and starting year are for you alone: Cubr has no public profiles, and the boards show only your public name.",
  "с {year} года · первый год": "since {year} · first year",
  "с {year} года · {years} {word}": "since {year} · {years} {word}",
  год: "year",
  года: "years",
  лет: "years",
  "Год — это четыре цифры.": "A year is four digits.",
  "Год не может быть в будущем.": "The year cannot be in the future.",

  // цели
  Цель: "Goal",
  "Цель: {milestone}": "Goal: {milestone}",
  "Цель: все рубежи взяты": "Goal: every milestone reached",
  "Появится после первой засчитанной сборки — рубеж подбирается по твоему рекорду.":
    "It appears after your first counted solve — the milestone is picked from your record.",
  "Рекорд: {best}.": "Record: {best}.",
  "До рубежа {gap} по личному рекорду ({best}).":
    "{gap} to the milestone by your personal best ({best}).",
  "Рекорд ровно на рубеже ({best}) — нужно быстрее.":
    "Your record sits exactly on the milestone ({best}) — you need to go faster.",
  "Первый рубеж ещё не пробит — как только уложишься, появится счётчик стабильности.":
    "No milestone broken yet — the consistency counter shows up once you get under one.",
  "{target} подряд ниже {milestone} — рубеж держится.":
    "{target} in a row under {milestone} — the milestone holds.",
  "{done} из {target} подряд ниже {milestone}.": "{done} of {target} in a row under {milestone}.",

  // история и график
  "История сборок": "Solve history",
  "Загружаю историю…": "Loading the history…",
  "Не удалось загрузить историю.": "Could not load the history.",
  Повторить: "Retry",
  Когда: "When",
  Время: "Time",
  Статус: "Status",
  Засчитано: "Counted",
  Отклонено: "Rejected",
  "Прогресс времени": "Time progress",
  "за последние сборки": "over the latest solves",
  "График времени сборок за последние сборки": "Chart of solve times over the latest solves",
  "Пока недостаточно засчитанных сборок для графика. Собери кубик в соло-режиме — прогресс появится здесь.":
    "Not enough counted solves for a chart yet. Solve a cube in solo mode and the progress will show up here.",
  "Пока нет сохранённых сборок. Собери кубик в соло-режиме — результат появится здесь.":
    "No saved solves yet. Solve a cube in solo mode and the result will show up here.",
  "К соло-тренировке →": "To solo practice →",

  // бейджи
  Бейджи: "Badges",
  "Загружаю бейджи…": "Loading the badges…",
  "Не удалось загрузить бейджи.": "Could not load the badges.",

  // кубики
  "Мои кубики": "My cubes",
  "Загружаю кубики…": "Loading the cubes…",
  "Пока нет кубиков. Зарегистрируй свой, чтобы Cubr узнавал его цвета.":
    "No cubes yet. Register yours so Cubr recognises its colours.",
  "Добавить кубик": "Add a cube",
  Название: "Name",
  "Название не может быть пустым.": "The name cannot be empty.",
  "Например, MoYu основной": "For example, main MoYu",
  "Заметка (необязательно)": "Note (optional)",
  "магнитный, для соревнований…": "magnetic, for competitions…",
  Переименовать: "Rename",
  Отмена: "Cancel",
  Удалить: "Delete",
  "Сделать основным": "Make it primary",
  "Сделать основным кубиком": "Make this the primary cube",
  "(основной)": "(primary)",
  основной: "primary",
  "Удалить кубик «{name}»? Сборки на нём сохранятся.":
    "Delete the cube «{name}»? Solves made with it are kept.",
  "Не удалось переименовать.": "Could not rename it.",
  "Не удалось сделать основным.": "Could not make it primary.",
  "Не удалось удалить.": "Could not delete it.",
  "Кубик добавлен.": "Cube added.",
  "Кубик удалён.": "Cube deleted.",

  // мастер регистрации кубика
  "Снимаем грани": "Capturing the faces",
  "Включить камеру": "Turn the camera on",
  "Поднеси собранный кубик к камере: снимем цвет каждой из 6 граней, чтобы Cubr узнавал именно твой кубик.":
    "Hold the solved cube up to the camera: we capture the colour of each of the 6 faces so Cubr recognises your particular cube.",
  "Снять заново": "Capture again",
  "Так Cubr запомнил твой кубик": "This is how Cubr remembers your cube",
  "Профиль снят автоматически с 6 граней — выбирать ничего не нужно.":
    "The profile is captured automatically from the 6 faces — there is nothing to pick.",
  "Цвет-профиль кубика": "Cube colour profile",
  "Придумай название — так проще отличать кубики.":
    "Give it a name — that makes cubes easier to tell apart.",
  "Сначала сними все 6 граней.": "Capture all 6 faces first.",
  "Сохранить кубик": "Save the cube",
  "Не удалось сохранить кубик.": "Could not save the cube.",

  // --- проход 2: ритуальные экраны (соло, дуэль, турнир, скрамбл дня, онбординг) ---
  "Соло — сборка": "Solo — a solve",
  "← На главную": "← Home",
  "← Назад": "← Back",
  "← назад": "← back",
  "← к инструкции": "← back to the walkthrough",
  "дальше →": "next →",
  Далее: "Next",
  Начать: "Start",
  "Ещё раз": "Again",
  Обновить: "Refresh",
  "Попробовать снова": "Try again",
  Пропустить: "Skip",
  Продолжить: "Continue",
  Ты: "You",
  Соперник: "Opponent",
  Звук: "Sound",
  "Без звука": "Muted",

  // соло-ритуал
  "Генерирую скрамбл…": "Generating the scramble…",
  "Не удалось загрузить генератор скрамблов (проверь интернет):":
    "Could not load the scramble generator (check your connection):",
  "Запускаю камеру…": "Starting the camera…",
  "Ищу руки в кадре…": "Looking for your hands…",
  "Готово к таймеру": "Ready for the timer",
  "Идёт сборка": "Solving",
  "Проверка сборки": "Checking the solve",
  "Сбор не засчитан": "The solve was not counted",
  "Собери показанный разброс и покажи 6 граней — сверю с эталоном, потом взведу таймер.":
    "Apply the scramble shown and present all 6 faces — I check it against the expected state, then arm the timer.",
  "Останови время — покажи 6 граней собранного кубика, я подтвержу сборку.":
    "Stop the clock — show all 6 faces of the solved cube and I confirm the solve.",
  "Проверить сборку (6 граней)": "Check the solve (6 faces)",
  "Подтвердить сборку (6 граней)": "Confirm the solve (6 faces)",
  "Калибровка цветов": "Colour calibration",
  "Использовать сохранённый профиль": "Use the saved profile",
  "Подстроить под свет (одна белая грань)": "Adjust to the light (one white face)",
  "Перекалибровать по 6 граням": "Recalibrate from 6 faces",
  "Твой кубик готов": "Your cube is ready",
  "Эталон скрамбла не готов — обнови скрамбл на экране инструкции.":
    "The expected scramble state is not ready — refresh the scramble on the walkthrough screen.",
  "Сохраняю результат…": "Saving the result…",
  "Результат сохранён в профиль.": "The result is saved to your profile.",
  "Не удалось сохранить результат на сервере.": "Could not save the result on the server.",
  ", чтобы сохранить его.": ", to keep it.",
  ", чтобы сохранять результаты.": ", to keep your results.",
  ", затем повтори отправку.": ", then send it again.",
  "войди заново": "log in again",
  "Casual-результат: цвета подстроены по одной белой грани, без полной калибровки. Для рейтинга нужна полная калибровка по 6 граням.":
    "Casual result: colours were adjusted from a single white face, without a full calibration. A rating would require the full 6-face calibration.",
  "Без проверки камерой: скрамбл/сборка не подтверждены (нажата «Пропустить»).":
    "No camera check: the scramble and the solve are unconfirmed («Skip» was used).",
  "Камера не подтвердит скрамбл — таймер взведётся без проверки.":
    "The camera will not confirm the scramble — the timer arms unchecked.",
  "Камера не подтвердит сборку — результат сохранится с пометкой «без проверки».":
    "The camera will not confirm the solve — the result is saved as unchecked.",

  // инструкция скрамбла
  Нотация: "Notation",
  "Мини-карта ходов": "Move minimap",
  "3D-модель кубика на текущем шаге": "3D cube model at the current step",
  "Ориентация: белый центр вверх, зелёный центр к себе.":
    "Orientation: white centre on top, green centre facing you.",

  // дуэль
  "Подключаюсь к дуэли…": "Connecting to the duel…",
  "Подключаюсь к комнате…": "Connecting to the room…",
  "Переподключаюсь…": "Reconnecting…",
  "Связь потеряна": "Connection lost",
  "Не удалось подключиться к дуэли. Попробуй ещё раз.": "Could not connect to the duel. Try again.",
  "Жду соперника": "Waiting for the opponent",
  "Ожидаю подключения соперника…": "Waiting for the opponent to connect…",
  "Соперник ещё не подключился по приглашению.": "The opponent has not joined via the invite yet.",
  "Отправь эту ссылку тому, с кем хочешь посоревноваться — дуэль начнётся, как только оба будут готовы.":
    "Send this link to whoever you want to race — the duel starts as soon as you are both ready.",
  Скопировано: "Copied",
  "Не удалось скопировать — выдели и скопируй ссылку вручную.":
    "Could not copy — select the link and copy it by hand.",
  "Готов. Жду соперника…": "Ready. Waiting for the opponent…",
  "Приготовься — камера скрыта до старта.": "Get ready — the camera is hidden until the start.",
  "Жду результат соперника…": "Waiting for the opponent's result…",
  "Соперник отключился": "The opponent disconnected",
  Реванш: "Rematch",
  "Готовлю реванш…": "Preparing the rematch…",
  "Не удалось создать реванш. Попробуй ещё раз.": "Could not create the rematch. Try again.",
  "Ссылка на дуэль недействительна или устарела.": "The duel link is invalid or expired.",
  "Такой дуэли не существует — ссылка неверна или комната закрыта.":
    "No such duel — the link is wrong or the room is closed.",
  "У тебя уже есть активная дуэль — одновременно можно участвовать только в одной.":
    "You already have an active duel — only one at a time is possible.",
  "У тебя уже есть активная дуэль — сначала заверши её.":
    "You already have an active duel — finish it first.",
  "Перейти к активной дуэли": "Go to the active duel",
  "Включить звук отсчёта": "Turn the countdown sound on",
  "Выключить звук отсчёта": "Turn the countdown sound off",

  // турнир и скрамбл дня
  "Загружаю состояние недели…": "Loading this week's state…",
  "Загружаю состояние дня…": "Loading today's state…",
  "Загружаю таблицу…": "Loading the board…",
  "Одна попытка на всю неделю": "One attempt for the whole week",
  "Одна попытка на весь день": "One attempt for the whole day",
  "Скрамбл общий для всех участников этой недели. Сборка идёт как в соло, но результат фиксируется сразу и без переигровок. Таблицы результатов пока нет — это личный вызов, не дуэль.":
    "The scramble is shared by everyone this week. The solve runs like solo, but the result is recorded at once with no replays. There is no ranked table yet — it is a personal challenge, not a duel.",
  "Скрамбл общий для всех участников этого дня. Сборка идёт как в соло, но результат фиксируется сразу и без переигровок. Таблицы результатов пока нет — это личный вызов, не дуэль.":
    "The scramble is shared by everyone today. The solve runs like solo, but the result is recorded at once with no replays. There is no ranked table yet — it is a personal challenge, not a duel.",
  "Сделать попытку": "Make an attempt",
  "«Сделать попытку» сразу покажет скрамбл этой недели и потратит единственную попытку. Отменить нельзя.":
    "«Make an attempt» reveals this week's scramble immediately and spends your only attempt. It cannot be undone.",
  "«Сделать попытку» сразу покажет скрамбл этого дня и потратит единственную попытку. Отменить нельзя.":
    "«Make an attempt» reveals today's scramble immediately and spends your only attempt. It cannot be undone.",
  "Точно начать? Скрамбл станет виден сразу, вернуться назад будет нельзя.":
    "Start for real? The scramble becomes visible at once and there is no way back.",
  "Да, начать": "Yes, start",
  "Готовлю попытку…": "Preparing the attempt…",
  "Попытка уже начата": "The attempt has already started",
  "Отправляю результат…": "Sending the result…",
  "Повторить отправку": "Send again",
  "Окно попытки истекло до того, как результат дошёл до сервера — засчитан DNF.":
    "The attempt window expired before the result reached the server — it counts as a DNF.",
  "Кто уже собрал": "Who has finished",
  "Кто уже собрал сегодня": "Who has finished today",
  "Пока никто не закончил": "Nobody has finished yet",
  "Твоё время": "Your time",
  "Твоё место": "Your entry",
  "Время участники засекают сами — дружеский зачёт, не рейтинг.":
    "Participants time themselves — a friendly tally, not a rating.",
  "Серия ежедневных сборок": "Daily solve streak",

  // онбординг
  Знакомство: "Getting started",
  "Шаги онбординга": "Onboarding steps",
  "Как это работает": "How it works",
  "Cubr судит сборку по камере: она видит твои руки и грани кубика. Дальше проверим, что камера работает, и покажем, где будет регистрация кубика.":
    "Cubr judges a solve with your camera: it sees your hands and the cube's faces. Next we check the camera works and show where the cube registration lives.",
  "Проверка камеры": "Camera check",
  "Разреши доступ к камере и покажи обе руки в кадре. Как только руки будут видны — можно продолжать.":
    "Allow camera access and show both hands in frame. Once the hands are visible you can continue.",
  "Камера и руки распознаются — отлично!": "Camera and hands are recognised — great!",
  "Регистрация кубика": "Cube registration",
  "Сними цвет-профиль своего кубика — это первый и основной кубик. Можно пропустить и добавить позже в профиле.":
    "Capture your cube's colour profile — this is your first and primary cube. You can skip it and add one later from the profile.",
  "Пропустить (камера не проверена)": "Skip (camera unchecked)",
  "Пропустить регистрацию": "Skip the registration",
  "Пропустить онбординг": "Skip onboarding",

  // --- проход 3: подсказки камеры и калибровки (vision/guide.ts) ---
  "Нет доступа к камере. Разреши камеру в браузере и нажми «Включить камеру» ещё раз.":
    "No camera access. Allow the camera in your browser and press «Turn the camera on» again.",
  "Не удалось скачать модель рук. Проверь интернет и обнови страницу.":
    "Could not download the hand model. Check your connection and reload the page.",
  "Камера не найдена. Подключи камеру и попробуй снова.":
    "No camera found. Connect one and try again.",
  "Камера занята другим приложением. Закрой его и попробуй снова.":
    "The camera is busy in another application. Close it and try again.",
  "Камера работает только по https (или на localhost). Открой страницу по защищённому адресу.":
    "The camera only works over https (or on localhost). Open the page on a secure address.",
  "Камера работает только по https (или на localhost).":
    "The camera only works over https (or on localhost).",
  "Этот браузер не умеет работать с камерой. Открой в свежем Chrome или Firefox.":
    "This browser cannot use the camera. Open it in a recent Chrome or Firefox.",
  "Свет плохой: красный и оранжевый почти одинаковы (ΔE {de} < {min}). Поменяй свет и откалибруй заново.":
    "Bad light: red and orange are nearly identical (ΔE {de} < {min}). Change the light and calibrate again.",
  "слишком темно": "too dark",
  "слишком светло": "too bright",
  "{dir} (яркость {luma}, нужно {min}–{max}). Поменяй свет и попробуй снова.":
    "{dir} (brightness {luma}, needs {min}–{max}). Change the light and try again.",
  "Грани не совпали: расходится {count} наклеек, первая — на грани {face}. Собери разброс как надо или сделай новый и проверь заново.":
    "The faces do not match: {count} stickers differ, the first on the {face} face. Redo the scramble properly or get a new one and check again.",
  "Кубик ещё не собран: расходится {count} наклеек. Дособерись и покажи 6 граней собранного кубика.":
    "The cube is not solved yet: {count} stickers differ. Finish solving and show all 6 faces.",
  "Не смог однозначно собрать кубик из граней. Покажи 6 граней заново, не спеша.":
    "Could not assemble the cube unambiguously from the faces. Show all 6 faces again, slowly.",
  "Грани не складываются в целый кубик. Покажи каждую грань чётко в рамке и повтори.":
    "The faces do not add up to a whole cube. Show each face clearly inside the frame and repeat.",
  "Грань не прочиталась — повтори. Держи её ровно в жёлтой рамке.":
    "The face could not be read — try again. Hold it squarely inside the yellow frame.",
  "Таймер не пошёл: сначала проверь грани (кнопка проверки), потом ставь руки в зоны.":
    "The timer did not start: check the faces first (the check button), then put your hands in the zones.",
  "Сбор потерян: руки/кубик пропали из кадра. Начни цикл заново.":
    "The solve was lost: hands or cube left the frame. Start the cycle over.",
  "Это не похоже на белую грань этого кубика — возможно, другой кубик или не та грань. Выбери профиль этого кубика или откалибруй заново по 6 граням.":
    "This does not look like the white face of this cube — it may be a different cube or the wrong face. Pick this cube's profile or recalibrate from all 6 faces.",
  "Не получилось уверенно снять белую грань (блики или наклейки читаются вразнобой). Откалибруй по 6 граням.":
    "Could not read the white face confidently (glare, or the stickers read inconsistently). Calibrate from all 6 faces.",
  "Не удалось подготовить эталон скрамбла. Обнови скрамбл.":
    "Could not prepare the expected scramble state. Refresh the scramble.",
  "Держи кубик здесь": "Hold the cube here",
  "Левая рука": "Left hand",
  "Правая рука": "Right hand",

  // грани и цвета
  "белая (верх)": "white (up)",
  "красная (право)": "red (right)",
  "зелёная (перед)": "green (front)",
  "жёлтая (низ)": "yellow (down)",
  "оранжевая (лево)": "orange (left)",
  "синяя (зад)": "blue (back)",
  белый: "white",
  красный: "red",
  зелёный: "green",
  жёлтый: "yellow",
  оранжевый: "orange",
  синий: "blue",
  Верх: "Up",
  Право: "Right",
  Фронт: "Front",
  Низ: "Down",
  Лево: "Left",
  Тыл: "Back",

  // --- проход 3: описания ходов (scramble/moveCopy.ts) ---
  "верхний слой": "upper layer",
  "нижний слой": "bottom layer",
  "правый слой": "right layer",
  "левый слой": "left layer",
  "передний слой": "front layer",
  "задний слой": "back layer",
  "поверни налево (если смотреть сверху)": "turn it left (looking from above)",
  "поверни направо (если смотреть сверху)": "turn it right (looking from above)",
  "поверни направо (если смотреть снизу)": "turn it right (looking from below)",
  "поверни налево (если смотреть снизу)": "turn it left (looking from below)",
  "поверни от себя вверх": "turn it away from you, upwards",
  "поверни на себя вверх": "turn it towards you, upwards",
  "поверни на себя вниз": "turn it towards you, downwards",
  "поверни от себя вниз": "turn it away from you, downwards",
  "поверни по часовой": "turn it clockwise",
  "поверни против часовой": "turn it counter-clockwise",
  "поверни на пол-оборота (×2), сторона неважна": "turn it half a revolution (×2), either way",

  // --- добито по багрепорту: панели ритуала ---
  "Поднеси к жёлтой рамке грань собранного кубика и снимай по очереди — снято {done}/{total}.":
    "Hold a face of the solved cube up to the yellow frame and capture them one by one — {done}/{total} captured.",
  "Снять грань {n}/{total}": "Capture face {n}/{total}",
  "Держи грань в жёлтой рамке и снимай — прочитано {done}/{total}.":
    "Hold the face inside the yellow frame and capture — {done}/{total} read.",
  "Держи собранную грань в жёлтой рамке и снимай — прочитано {done}/{total}.":
    "Hold the solved face inside the yellow frame and capture — {done}/{total} read.",

  // --- автопрокрутка скрамбла ---
  "Крутить за меня": "Play it for me",
  Пауза: "Pause",
  Скорость: "Speed",
  "{sec} с/ход": "{sec}s per move",
  Слоями: "Layers",
};
