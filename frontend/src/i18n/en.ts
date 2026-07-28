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
};
