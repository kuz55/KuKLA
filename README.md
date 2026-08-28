# KuKLA 2.1

> **KuKLA** — координационная информационная система для поисково-спасательных отрядов и организации полевых поисковых работ.
>
> **KuKLA** is a coordination and operational information system designed for search-and-rescue teams and field search operations.

---

## 🌍 Open Source Project / Открытый проект

**KuKLA — свободный open-source проект, который развивается совместно с сообществом.**

Проект открыт для разработчиков, инженеров, дизайнеров, тестировщиков, GIS-специалистов, специалистов по информационной безопасности, DevOps, AI, документации и, особенно, для людей с реальным опытом поисковых работ.

### 🇷🇺 Присоединяйтесь к разработке

Мы не пытаемся просто написать ещё одно приложение. Цель KuKLA — создать надёжный инструмент, который действительно помогает поисковым командам работать быстрее, организованнее и безопаснее.

Нам нужны люди, которые готовы:

- 👨‍💻 писать и проверять код;
- 🧪 тестировать систему и искать реальные ошибки;
- 🗺️ улучшать GIS и работу с картами;
- 🔐 находить и устранять проблемы безопасности;
- 🐳 развивать Linux/Docker/DevOps-инфраструктуру;
- 📱 улучшать мобильный клиент и работу GPS;
- 🖥️ развивать Desktop-клиент;
- 🎨 проектировать удобный интерфейс для работы в стрессовых и полевых условиях;
- 🧠 исследовать применение AI и алгоритмов;
- 📡 улучшать realtime, WebSocket и работу при нестабильной связи;
- 📚 писать документацию;
- 🧭 проверять KuKLA в реальных сценариях поисковой работы.

**Необязательно быть профессиональным программистом.** Хорошая идея, подробный bug report, UX-наблюдение, тестирование на реальном устройстве или опыт координатора поиска могут оказаться не менее ценными, чем сотня строк кода.

### 🇬🇧 Join the project

KuKLA is a **free and open-source project developed together with its community**.

We welcome developers, engineers, designers, QA specialists, GIS experts, security researchers, DevOps engineers, AI/algorithm specialists, technical writers and people with practical search-and-rescue experience.

We are looking for people who can:

- 👨‍💻 write, review and improve code;
- 🧪 test the system and find real-world bugs;
- 🗺️ improve GIS and mapping capabilities;
- 🔐 improve security;
- 🐳 work on Linux, Docker and DevOps infrastructure;
- 📱 improve the mobile client and GPS reliability;
- 🖥️ develop the Desktop client;
- 🎨 design interfaces for stressful field environments;
- 🧠 explore AI and algorithmic assistance;
- 📡 improve realtime communication and resilience to unstable connectivity;
- 📚 improve technical documentation;
- 🧭 test KuKLA in realistic search-and-rescue scenarios.

**You do not need to be a professional developer.** A good idea, detailed bug report, UX observation, field test or practical coordination experience can be just as valuable as code.

### Как участвовать / How to contribute

1. Изучите код и документацию / Explore the codebase and documentation.
2. Создайте **Issue** для ошибки, идеи или предложения / Open an **Issue**.
3. Для изменений кода создайте ветку и **Pull Request** / Create a branch and submit a **Pull Request**.
4. Обсуждайте архитектуру и решения открыто / Discuss architecture openly.
5. Тестируйте проект и делитесь результатами / Test and share results.

Подробнее: **[CONTRIBUTING.md](CONTRIBUTING.md)** · **[ROADMAP.md](ROADMAP.md)** · **[SECURITY.md](SECURITY.md)**

### Принципы сообщества

KuKLA развивается по принципу: **безопасность → надёжность → удобство → новые возможности**.

Мы особенно ценим изменения, которые решают реальные проблемы поисковых групп, не создают лишних рисков и остаются понятными для следующих разработчиков.

---

## 🇷🇺 О проекте

**KuKLA** — это программная платформа для организации, координации и сопровождения поисковых операций. Проект создаётся с учётом реальной работы поисковых отрядов, где необходимо быстро распределять задачи, видеть участников и их GPS-позиции, обмениваться оперативной информацией и сохранять историю действий.

KuKLA предназначена прежде всего для **поисково-спасательных отрядов, добровольческих поисковых организаций, координаторов и руководителей поисковых операций**.

Главная идея проекта — объединить в одной системе то, что во время поиска обычно распределено между мессенджерами, таблицами, картами и отдельными приложениями.

### Для чего нужна KuKLA

Система помогает:

- создавать и вести поисковые операции;
- управлять составом поиска и ролями участников;
- распределять задачи между экипажами и поисковиками;
- отслеживать выполнение задач;
- получать и отображать GPS-позиции участников;
- отображать треки на карте;
- работать с оперативной информацией в единой системе;
- сохранять журнал событий и действий пользователей;
- синхронизировать данные между клиентами и сервером;
- поддерживать работу мобильного клиента в условиях нестабильного соединения;
- создавать резервные копии и восстанавливать данные.

### Для кого

KuKLA рассчитана на несколько категорий пользователей:

- **Администраторы** — управление системой и пользователями.
- **Руководители поиска** — управление поисковой операцией.
- **Координаторы** — оперативная работа с задачами, участниками и картой.
- **Поисковики** — получение задач, передача GPS-координат и работа непосредственно в поле.

### Архитектура

KuKLA построена как клиент-серверная система:

- **Desktop** — Tauri + React. Используется администраторами, руководителями и координаторами.
- **Mobile** — Flutter. Предназначен для участников поиска, работающих в поле.
- **Server** — Fastify + PostgreSQL + Redis.
- **Infrastructure** — Docker Compose и Linux.

Обязательного веб-интерфейса нет. Сервер предоставляет API, которым пользуются клиентские приложения.

### Основные возможности текущей версии

- JWT-аутентификация;
- серверный RBAC;
- жизненный цикл поисковой операции;
- оперативная панель поиска;
- управление участниками поиска;
- задачи и статусы задач;
- журнал событий и аудита;
- приём GPS-точек;
- отображение GPS-треков;
- карта на базе OpenStreetMap;
- передача GPS с мобильного устройства;
- локальный SQLite-кэш мобильного клиента;
- офлайн-очередь команд;
- snapshot API для начальной синхронизации;
- Docker Compose для развёртывания на Linux/Xubuntu;
- резервное копирование и восстановление базы данных;
- набор рекомендаций по подготовке системы к production-эксплуатации.

### Важное замечание

KuKLA является функциональным development/MVP-релизом. На текущем этапе проект **не является сертифицированной системой жизнеобеспечения или mission-critical системой спасательных служб**.

Перед использованием в реальных поисковых операциях необходимо завершить production hardening, провести независимый аудит безопасности, проверить фоновую и офлайн-передачу GPS, реализовать и протестировать инфраструктуру уведомлений, провести практические испытания восстановления резервных копий и выполнить полноценное полевое тестирование.

---

## 🇬🇧 About the project

**KuKLA** is a software platform for organizing, coordinating and supporting search operations. It is designed around the practical needs of search-and-rescue teams, where coordinators and field participants need to distribute tasks, monitor team members and GPS positions, exchange operational information and maintain a reliable history of actions.

KuKLA is primarily intended for **search-and-rescue teams, volunteer search organizations, search coordinators and operation leaders**.

The core idea is to bring together information that is often scattered across messengers, spreadsheets, mapping applications and separate mobile tools into a single operational system.

### What KuKLA is for

The system helps teams to:

- create and manage search operations;
- manage search membership and user roles;
- assign tasks to teams and individual searchers;
- track task status and progress;
- receive and display GPS positions;
- display movement tracks on a map;
- keep operational information in one system;
- maintain an audit and event log;
- synchronize data between clients and the server;
- support mobile operation in environments with unstable connectivity;
- create and restore database backups.

### Target users

KuKLA is designed for several user roles:

- **Administrators** — system and user management.
- **Search leaders** — management of search operations.
- **Coordinators** — operational work with tasks, participants and maps.
- **Searchers** — field participants who receive tasks and transmit GPS data.

### Architecture

KuKLA follows a client-server architecture:

- **Desktop** — Tauri + React for administrators, search leaders and coordinators.
- **Mobile** — Flutter for field participants.
- **Server** — Fastify + PostgreSQL + Redis.
- **Infrastructure** — Docker Compose and Linux.

A mandatory web interface is not required. The server exposes an API consumed by the client applications.

### Current feature set

- JWT authentication;
- server-side RBAC;
- search operation lifecycle management;
- operational search dashboard;
- search membership management;
- tasks and task statuses;
- audit and event logging;
- GPS point ingestion;
- GPS track visualization;
- OpenStreetMap-based mapping;
- mobile GPS transmission;
- mobile SQLite cache;
- offline command queue;
- snapshot API for synchronization and bootstrap;
- Docker Compose deployment on Linux/Xubuntu;
- database backup and restore scripts;
- production hardening guidance.

### Important notice

KuKLA is currently a functional development/MVP release. It is **not a certified life-safety or mission-critical rescue system**.

Before operational deployment, the project requires production hardening, an independent security review, validation of background and offline GPS functionality, notification infrastructure, backup restoration drills and comprehensive field acceptance testing.

---

## 🚀 Quick start

See `docs/DEPLOYMENT.md` for deployment instructions.

### Demo credentials

For development only:

- `admin@kukla.local` / `admin12345`
- `leader@kukla.local` / `leader12345`
- `coordinator@kukla.local` / `coord12345`
- `searcher@kukla.local` / `searcher123`

**Do not use demo credentials in a production environment.**

---

## 📌 Project status

KuKLA is under active development. The repository contains the current functional architecture and implementation of the platform, while production readiness and field validation remain ongoing work.

The project is intended to evolve together with the practical requirements of search teams and real-world field operations.

## 📄 License

KuKLA is distributed under the **GNU General Public License v3.0 or later (GPL-3.0-or-later)**. See [LICENSE](LICENSE).

This means the software can be used, studied, modified and redistributed under the terms of the GPL.
