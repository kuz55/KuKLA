# Развёртывание KuKLA на TrueNAS

## Проверенное состояние сервера

- TrueNAS Community Edition 25.10.7.
- Пул `elverato` — ONLINE, один диск, примерно 840 ГиБ свободно.
- Создан датасет `elverato/kukla`.
- RAM: 5.5 ГиБ, поэтому виртуальная машина Linux сейчас не рекомендуется.
- Apps уже работают; Containers включены, но помечены TrueNAS как experimental.

## Рекомендуемая схема

На первом этапе PostgreSQL и Redis запускаются через Docker Compose, а приложение — отдельным контейнером. Не использовать VM до добавления оперативной памяти.

Данные должны находиться в отдельных дочерних датасетах:

```text
elverato/kukla
├── postgres
├── redis
├── backups
└── app
```

Для PostgreSQL нужен образ `postgres:16-alpine`. Миграции берутся из `server/sql/` и применяются приложением при первом запуске.

## Важные ограничения

Не хранить пароли PostgreSQL и `JWT_SECRET` в Git. Их нужно задать локально в форме Custom App или в секретах TrueNAS. До запуска приложения требуется проверить, что существующие Apps не используют дефицит памяти и что для базы включено резервное копирование.

## Следующий шаг

Создать дочерние датасеты, затем настроить PostgreSQL и выполнить миграции с нуля. Только после успешной проверки `/health`, `/ready` и миграций подключать Go-сервис и клиентов.

Desktop-клиент остаётся Tauri-приложением. Для production-сборки используется `desktop/.env.production` с API-адресом TrueNAS; отдельный веб-интерфейс для пользователей не предполагается.

## Вход VK ID и удалённый доступ

Публичным будет только узкий шлюз для трёх адресов VK ID: запуск, callback и опрос завершения входа. Он слушает внутри Tailscale контейнера на `127.0.0.1:8080`; все прочие пути на публичном порту отвечают 404. Полный API доступен на отдельном HTTPS порту через Tailscale Serve и предназначен только устройствам, подключённым к вашему tailnet.

### Подготовка VK ID

Создайте приложение VK ID с платформой Web и укажите точный Redirect URL:

```text
https://kukla-api.tail0c73da.ts.net:8443/api/v1/auth/vk/callback
```

Идентификатор созданного приложения KuKLA: `54853560`; укажите его в `VK_ID_CLIENT_ID`. Клиентский секрет VK ID для текущего PKCE-потока не используется. Регистрацию новых пользователей включайте через `VK_ID_ALLOW_REGISTRATION=true` только после проверки приложения. Новые учётные записи получают роль `SEARCHER`; VK ID не связывает профиль с существующим пользователем по email или телефону.

### Развёртывание шлюза

1. Убедитесь, что снимок базы сохранён, и сделайте копию локального `infrastructure/.env`. Не заменяйте существующий `.env` шаблоном.
2. Добавьте в `.env` переменные VK ID и `TS_API_AUTHKEY`. Ключ Tailscale создайте как одноразовый для нового устройства `kukla-api`, введите непосредственно в `.env` на NAS и не отправляйте в чат.
3. Из каталога `infrastructure` запустите сервисы с двумя Compose-файлами, сохранив текущий NAS-файл и существующие тома:

```sh
sudo docker compose --env-file .env -f docker-compose.truenas.yml -f docker-compose.public-api.yml --profile public-api up -d --build
```

4. Перед первым запуском новой версии примените миграции базы из каталога проекта. После обновления файлов на NAS выполните из `infrastructure`:

```sh
sudo docker compose --env-file .env -f docker-compose.truenas.yml run --rm server npm run migrate
```

Сначала проверьте успешное завершение миграций и наличие резервной копии базы. Затем пересоздайте сервер:

```sh
sudo docker compose --env-file .env -f docker-compose.truenas.yml -f docker-compose.public-api.yml --profile public-api up -d --build server public-api-proxy tailscale-api
```

Проверьте, что контейнеры `server`, `public-api-proxy` и `tailscale-api` запущены. В оболочке контейнера `tailscale-api` включите приватный API и публичный маршрут авторизации:

```sh
tailscale serve --bg --https=443 http://127.0.0.1:8081
tailscale funnel --bg --https=8443 http://127.0.0.1:8080
tailscale serve status
tailscale funnel status
```

Funnel публикует только Nginx-порт 8080, где разрешены маршруты VK ID. Tailscale Serve на HTTPS 443 ведёт к полному API через tailnet. Настройте ACL tailnet так, чтобы доступ к `kukla-api:443` был только у ваших пользователей и устройств. Не включайте host networking и не публикуйте порты NAS, SSH, PostgreSQL или Redis.

5. После успешного входа sidecar удалите значение `TS_API_AUTHKEY` из `.env`; состояние узла хранится в томе `tailscale_api_state`. Не удаляйте этот том при обновлении. Секрет VK ID не публикуется в Git.

### Desktop-клиент

Для production-сборки скопируйте `desktop/.env.production.example` в локальный `desktop/.env.production`. `VITE_API_URL` указывает на приватный API, а `VITE_PUBLIC_AUTH_URL` — на Funnel-порт 8443. На компьютере и телефоне должен быть включён Tailscale для работы с поисками и пользовательскими данными; вход через VK ID открывается во внешнем браузере. Файл `.env.production` не коммитьте.
