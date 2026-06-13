# Конвертер валют

Сайт с разделами **Калькулятор**, **Статьи** и **Чат**. Калькулятор конвертирует **EUR**, **USD**, **RUB** и **CNY**, умеет прибавлять процент к сумме.

## Запуск

1. Для **чата** и EPUB запустите **`start-server.bat`** и откройте http://localhost:3000 — через двойной клик по `index.html` (`file://`) чат не работает.
2. Калькулятор можно открыть и через `index.html`, но для всех разделов лучше локальный сервер.
3. При первом запуске нужен интернет для курсов, погоды и чата.
4. Курсы кэшируются в браузере на 1 час.

## Разделы

- **Калькулятор** — конвертер валют и расчёт суммы с процентом
- **Статьи** — подразделы с книгами в PDF и EPUB, просмотр внутри сайта
- **Чат** — общий чат с никнеймами в реальном времени (Supabase)

## Настройка чата (Supabase)

Чат работает на статическом хостинге через [Supabase](https://supabase.com) — отдельный backend не нужен.

### 1. Создайте проект Supabase

1. Зарегистрируйтесь на [supabase.com](https://supabase.com) и создайте новый проект.
2. Откройте **SQL Editor** → **New query**.
3. Скопируйте содержимое файла [`supabase-setup.sql`](supabase-setup.sql) **целиком** (без строк ` ```sql ` — это только разметка README, не SQL).
4. Нажмите **Run**.

```sql
create table public.messages (
  id bigint generated always as identity primary key,
  nickname text not null default 'Гость' check (char_length(nickname) between 1 and 24),
  text text not null check (char_length(text) between 1 and 500),
  created_at timestamptz not null default now()
);

alter table public.messages enable row level security;

create policy "Anyone can read messages"
  on public.messages for select using (true);

create policy "Anyone can send messages"
  on public.messages for insert with check (true);

alter publication supabase_realtime add table public.messages;
```

**Если чат уже был настроен раньше**, выполните миграцию из [`supabase-migration-nicknames.sql`](supabase-migration-nicknames.sql):

```sql
alter table public.messages
  add column if not exists nickname text not null default 'Гость'
  check (char_length(nickname) between 1 and 24);
```

5. В **Project Settings → API Keys** скопируйте:
   - **Project URL** → `https://giqruuohmekzzivqoejx.supabase.co` (без `/rest/v1/`)
   - **Publishable key** (`sb_publishable_...`) — для браузера, это и есть `SUPABASE_ANON_KEY`
   - **Secret key** (`sb_secret_...`) — **не используйте** на сайте, только для сервера

### 2. Настройте config.js

Скопируйте `config.example.js` в `config.js` и укажите ключи:

```js
window.SUPABASE_URL = "https://giqruuohmekzzivqoejx.supabase.co";
window.SUPABASE_ANON_KEY = "sb_publishable_...";
```

**Для GitHub Pages:** файл `config.js` нужно **закоммитить и запушить** в репозиторий. Publishable key безопасен для браузера (не используйте Secret key).

```bash
git add config.js
git commit -m "Add Supabase config for chat"
git push
```

### 3. Деплой на статический хостинг

На Netlify, GitHub Pages и т.п. добавьте переменные через `config.js` при сборке или создайте `config.js` вручную на сервере с теми же ключами.

### Проверка

1. Запустите `start-server.bat`.
2. Откройте два окна браузера на http://localhost:3000 → раздел **Чат**.
3. Отправьте сообщение в одном окне — оно должно появиться во втором.

## Книги

Файлы в папке `books/`:

- `tom-1.pdf` … `tom-6.pdf` — «Основы социологии», Величко
- `ethics.pdf` — «ВП СССР. Об этике и её роли в жизни», Величко
- `5-yazikov-lubvi.pdf` — «5 языков любви», Гэри Чепмен
- `deniken-*.epub` (4 книги) — Эрих фон Дэникен

При проблемах с просмотром через `file://` запустите **`start-server.bat`**. Для EPUB нужен локальный сервер.

## Файлы

- `index.html` — разметка сайта
- `styles.css` — тёмная тема, сайдбар, адаптив
- `nav.js` — переключение разделов
- `books.js` — открытие PDF/EPUB во встроенном просмотрщике
- `app.js` — логика конвертации и кэширования
- `weather.js` — виджет погоды
- `chat.js` — логика чата (Supabase Realtime)
- `config.example.js` — шаблон ключей Supabase
- `config.js` — ключи Supabase (нужен на GitHub Pages)
- `books/` — PDF и EPUB книги
