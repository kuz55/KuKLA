#include <gtk/gtk.h>
#include <json-glib/json-glib.h>

#include "engine_client.h"

typedef struct {
    EngineClient engine;
    GtkWidget *window;
    GtkWidget *stack;
    GtkWidget *title_entry;
    GtkTextBuffer *searches_buffer;
    GtkWidget *status_label;
    GtkWidget *profile_full_name;
    GtkWidget *profile_birth_date;
    GtkWidget *profile_city;
    GtkWidget *profile_district;
    GtkWidget *profile_extra_phone;
    GtkWidget *profile_skills;
    GtkWidget *profile_emergency_name;
    GtkWidget *profile_emergency_phone;
    GtkWidget *profile_transport;
    GtkWidget *profile_available;
    GtkWidget *profile_consent;
    GtkTextBuffer *roles_buffer;
} AppState;

static GtkWidget *make_page(const char *title, const char *description) {
    GtkWidget *page = gtk_box_new(GTK_ORIENTATION_VERTICAL, 12);
    gtk_widget_set_margin_top(page, 28);
    gtk_widget_set_margin_bottom(page, 28);
    gtk_widget_set_margin_start(page, 32);
    gtk_widget_set_margin_end(page, 32);
    gtk_widget_set_valign(page, GTK_ALIGN_START);

    GtkWidget *heading = gtk_label_new(title);
    gtk_label_set_xalign(GTK_LABEL(heading), 0.0f);
    gtk_widget_add_css_class(heading, "title-1");
    gtk_box_append(GTK_BOX(page), heading);
    GtkWidget *body = gtk_label_new(description);
    gtk_label_set_xalign(GTK_LABEL(body), 0.0f);
    gtk_label_set_yalign(GTK_LABEL(body), 0.0f);
    gtk_label_set_wrap(GTK_LABEL(body), TRUE);
    gtk_box_append(GTK_BOX(page), body);
    return page;
}

static void set_status(AppState *state, const gchar *message, gboolean is_error) {
    gtk_label_set_text(GTK_LABEL(state->status_label), message);
    if (is_error) {
        gtk_widget_add_css_class(state->status_label, "error");
    } else {
        gtk_widget_remove_css_class(state->status_label, "error");
    }
}

static gchar *build_create_json(const gchar *title) {
    JsonBuilder *builder = json_builder_new();
    json_builder_begin_object(builder);
    json_builder_set_member_name(builder, "title");
    json_builder_add_string_value(builder, title);
    json_builder_end_object(builder);
    JsonNode *root = json_builder_get_root(builder);
    JsonGenerator *generator = json_generator_new();
    json_generator_set_root(generator, root);
    gchar *json = json_generator_to_data(generator, NULL);
    json_node_free(root);
    g_object_unref(generator);
    g_object_unref(builder);
    return json;
}

static void refresh_searches(AppState *state) {
    guint status = 0;
    GError *error = NULL;
    gchar *body = engine_client_request(&state->engine, "GET", "/v1/searches", NULL,
                                       &status, &error);
    if (body == NULL || status != 200) {
        set_status(state, error == NULL ? "Не удалось загрузить список операций." : error->message, TRUE);
        g_clear_error(&error);
        g_free(body);
        return;
    }
    JsonParser *parser = json_parser_new();
    if (!json_parser_load_from_data(parser, body, -1, &error)) {
        set_status(state, "Движок вернул некорректный список операций.", TRUE);
        g_clear_error(&error);
        g_object_unref(parser);
        g_free(body);
        return;
    }
    JsonNode *root = json_parser_get_root(parser);
    if (!JSON_NODE_HOLDS_ARRAY(root)) {
        set_status(state, "Формат списка операций не распознан.", TRUE);
        g_object_unref(parser);
        g_free(body);
        return;
    }
    GString *list = g_string_new(NULL);
    JsonArray *array = json_node_get_array(root);
    for (guint i = 0; i < json_array_get_length(array); i++) {
        JsonObject *item = json_array_get_object_element(array, i);
        const gchar *title = json_object_get_string_member(item, "title");
        const gchar *status_text = json_object_get_string_member(item, "status");
        g_string_append_printf(list, "• %s  ·  %s\n", title, status_text);
    }
    if (list->len == 0) {
        g_string_append(list, "Пока нет операций. Создайте первую.");
    }
    gtk_text_buffer_set_text(state->searches_buffer, list->str, (gint)list->len);
    g_string_free(list, TRUE);
    set_status(state, "Локальная база подключена · данные хранятся на этом устройстве.", FALSE);
    g_object_unref(parser);
    g_free(body);
}

static GtkWidget *profile_field(GtkWidget *box, const gchar *label_text) {
    GtkWidget *label = gtk_label_new(label_text);
    gtk_label_set_xalign(GTK_LABEL(label), 0.0f);
    gtk_box_append(GTK_BOX(box), label);
    GtkWidget *entry = gtk_entry_new();
    gtk_box_append(GTK_BOX(box), entry);
    return entry;
}

static void refresh_profile(AppState *state) {
    guint status = 0;
    GError *error = NULL;
    gchar *body = engine_client_request(&state->engine, "GET", "/v1/me/profile", NULL,
                                       &status, &error);
    if (body == NULL || status != 200) {
        set_status(state, error == NULL ? "Не удалось загрузить анкету." : error->message, TRUE);
        g_clear_error(&error);
        g_free(body);
        return;
    }
    JsonParser *parser = json_parser_new();
    if (!json_parser_load_from_data(parser, body, -1, &error)) {
        set_status(state, "Движок вернул некорректную анкету.", TRUE);
        g_clear_error(&error);
        g_object_unref(parser);
        g_free(body);
        return;
    }
    JsonObject *object = json_node_get_object(json_parser_get_root(parser));
#define PROFILE_STRING(member, widget) \
    gtk_editable_set_text(GTK_EDITABLE(state->widget), \
        json_object_has_member(object, member) ? json_object_get_string_member(object, member) : "")
    PROFILE_STRING("full_name", profile_full_name);
    PROFILE_STRING("birth_date", profile_birth_date);
    PROFILE_STRING("city", profile_city);
    PROFILE_STRING("district", profile_district);
    PROFILE_STRING("extra_phone", profile_extra_phone);
    PROFILE_STRING("emergency_contact_name", profile_emergency_name);
    PROFILE_STRING("emergency_contact_phone", profile_emergency_phone);
#undef PROFILE_STRING
    gtk_check_button_set_active(GTK_CHECK_BUTTON(state->profile_transport),
        json_object_get_boolean_member(object, "has_transport"));
    gtk_check_button_set_active(GTK_CHECK_BUTTON(state->profile_available),
        json_object_get_boolean_member(object, "available_for_searches"));
    gtk_check_button_set_active(GTK_CHECK_BUTTON(state->profile_consent),
        json_object_get_boolean_member(object, "consent_personal_data"));
    if (json_object_has_member(object, "skills")) {
        JsonArray *skills = json_object_get_array_member(object, "skills");
        GString *joined = g_string_new(NULL);
        for (guint i = 0; i < json_array_get_length(skills); i++) {
            if (i > 0) g_string_append(joined, ", ");
            g_string_append(joined, json_array_get_string_element(skills, i));
        }
        gtk_editable_set_text(GTK_EDITABLE(state->profile_skills), joined->str);
        g_string_free(joined, TRUE);
    }
    set_status(state, "Анкета загружена. Изменения сохраняются на этом компьютере.", FALSE);
    g_object_unref(parser);
    g_free(body);
}

static gchar *build_profile_json(AppState *state) {
    JsonBuilder *builder = json_builder_new();
    json_builder_begin_object(builder);
#define ADD_PROFILE_STRING(key, widget) \
    json_builder_set_member_name(builder, key); \
    json_builder_add_string_value(builder, gtk_editable_get_text(GTK_EDITABLE(state->widget)))
    ADD_PROFILE_STRING("full_name", profile_full_name);
    ADD_PROFILE_STRING("birth_date", profile_birth_date);
    ADD_PROFILE_STRING("city", profile_city);
    ADD_PROFILE_STRING("district", profile_district);
    ADD_PROFILE_STRING("extra_phone", profile_extra_phone);
    ADD_PROFILE_STRING("emergency_contact_name", profile_emergency_name);
    ADD_PROFILE_STRING("emergency_contact_phone", profile_emergency_phone);
#undef ADD_PROFILE_STRING
    json_builder_set_member_name(builder, "has_transport");
    json_builder_add_boolean_value(builder,
        gtk_check_button_get_active(GTK_CHECK_BUTTON(state->profile_transport)));
    json_builder_set_member_name(builder, "available_for_searches");
    json_builder_add_boolean_value(builder,
        gtk_check_button_get_active(GTK_CHECK_BUTTON(state->profile_available)));
    json_builder_set_member_name(builder, "consent_personal_data");
    json_builder_add_boolean_value(builder,
        gtk_check_button_get_active(GTK_CHECK_BUTTON(state->profile_consent)));

    json_builder_set_member_name(builder, "skills");
    json_builder_begin_array(builder);
    gchar **skills = g_strsplit(gtk_editable_get_text(GTK_EDITABLE(state->profile_skills)), ",", -1);
    for (guint i = 0; skills[i] != NULL; i++) {
        gchar *skill = g_strstrip(skills[i]);
        if (skill[0] != '\0') json_builder_add_string_value(builder, skill);
    }
    g_strfreev(skills);
    json_builder_end_array(builder);
    json_builder_end_object(builder);
    JsonNode *root = json_builder_get_root(builder);
    JsonGenerator *generator = json_generator_new();
    json_generator_set_root(generator, root);
    gchar *json = json_generator_to_data(generator, NULL);
    json_node_free(root);
    g_object_unref(generator);
    g_object_unref(builder);
    return json;
}

static void on_save_profile(GtkButton *button, gpointer user_data) {
    (void)button;
    AppState *state = user_data;
    gchar *body = build_profile_json(state);
    guint status = 0;
    GError *error = NULL;
    gchar *response = engine_client_request(&state->engine, "PUT", "/v1/me/profile", body,
                                           &status, &error);
    g_free(body);
    g_free(response);
    if (error != NULL || status != 200) {
        set_status(state, error == NULL ? "Анкету сохранить не удалось. Проверьте согласие и поля." : error->message, TRUE);
        g_clear_error(&error);
        return;
    }
    refresh_profile(state);
}

static GtkWidget *make_profile_page(AppState *state) {
    GtkWidget *scroll = gtk_scrolled_window_new();
    GtkWidget *page = gtk_box_new(GTK_ORIENTATION_VERTICAL, 10);
    gtk_widget_set_margin_top(page, 28);
    gtk_widget_set_margin_bottom(page, 28);
    gtk_widget_set_margin_start(page, 32);
    gtk_widget_set_margin_end(page, 32);
    GtkWidget *heading = gtk_label_new("Анкета пользователя");
    gtk_label_set_xalign(GTK_LABEL(heading), 0.0f);
    gtk_widget_add_css_class(heading, "title-1");
    gtk_box_append(GTK_BOX(page), heading);
    GtkWidget *notice = gtk_label_new("Заполняйте только необходимые сведения. Медицинские заметки не собираются. Локальная база пока не зашифрована — анкета хранится на этом устройстве, поэтому не указывайте сведения, которые не готовы хранить здесь. Для сохранения требуется явное согласие.");
    gtk_label_set_xalign(GTK_LABEL(notice), 0.0f);
    gtk_label_set_wrap(GTK_LABEL(notice), TRUE);
    gtk_widget_add_css_class(notice, "dim-label");
    gtk_box_append(GTK_BOX(page), notice);

    state->profile_full_name = profile_field(page, "ФИО");
    state->profile_birth_date = profile_field(page, "Дата рождения (ГГГГ-ММ-ДД)");
    state->profile_city = profile_field(page, "Город");
    state->profile_district = profile_field(page, "Район");
    state->profile_extra_phone = profile_field(page, "Дополнительный телефон");
    state->profile_skills = profile_field(page, "Навыки через запятую");
    state->profile_emergency_name = profile_field(page, "Имя экстренного контакта");
    state->profile_emergency_phone = profile_field(page, "Телефон экстренного контакта");
    state->profile_transport = gtk_check_button_new_with_label("Есть транспорт");
    gtk_box_append(GTK_BOX(page), state->profile_transport);
    state->profile_available = gtk_check_button_new_with_label("Готов(а) участвовать в поисках");
    gtk_check_button_set_active(GTK_CHECK_BUTTON(state->profile_available), TRUE);
    gtk_box_append(GTK_BOX(page), state->profile_available);
    state->profile_consent = gtk_check_button_new_with_label("Согласен(на) на хранение указанных персональных данных на этом устройстве");
    gtk_box_append(GTK_BOX(page), state->profile_consent);
    GtkWidget *save = gtk_button_new_with_label("Сохранить анкету");
    g_signal_connect(save, "clicked", G_CALLBACK(on_save_profile), state);
    gtk_widget_set_halign(save, GTK_ALIGN_START);
    gtk_box_append(GTK_BOX(page), save);
    gtk_scrolled_window_set_child(GTK_SCROLLED_WINDOW(scroll), page);
    return scroll;
}

static void refresh_roles(AppState *state) {
    guint status = 0;
    GError *error = NULL;
    gchar *body = engine_client_request(&state->engine, "GET", "/v1/roles", NULL,
                                       &status, &error);
    if (body == NULL || status != 200) {
        set_status(state, error == NULL ? "Не удалось загрузить роли." : error->message, TRUE);
        g_clear_error(&error);
        g_free(body);
        return;
    }
    JsonParser *parser = json_parser_new();
    if (!json_parser_load_from_data(parser, body, -1, &error)) {
        set_status(state, "Каталог ролей повреждён.", TRUE);
        g_clear_error(&error);
        g_object_unref(parser);
        g_free(body);
        return;
    }
    GString *description = g_string_new("Роль задаёт доступ в приложении. Назначение ролей появится после подключения подтверждённой учётной записи по телефону.\n\n");
    JsonArray *roles = json_node_get_array(json_parser_get_root(parser));
    for (guint i = 0; i < json_array_get_length(roles); i++) {
        JsonObject *role = json_array_get_object_element(roles, i);
        const gchar *label = json_object_get_string_member(role, "label");
        const gchar *details = json_object_get_string_member(role, "description");
        gboolean manages_searches = json_object_get_boolean_member(role, "can_manage_searches");
        gboolean manages_users = json_object_get_boolean_member(role, "can_manage_users");
        gboolean changes_assigned_task = json_object_get_boolean_member(role, "can_update_assigned_task");
        g_string_append_printf(description, "%s\n%s\nДоступ: %s%s%s%s\n\n", label, details,
            manages_searches ? "управление поисками" : "просмотр поисков",
            manages_users ? ", пользователями" : "",
            changes_assigned_task ? ", назначенными задачами" : "",
            json_object_get_boolean_member(role, "read_only") ? " (только чтение)" : "");
    }
    gtk_text_buffer_set_text(state->roles_buffer, description->str, (gint)description->len);
    g_string_free(description, TRUE);
    set_status(state, "Роли загружены. Назначение доступно после безопасного входа и проверки полномочий.", FALSE);
    g_object_unref(parser);
    g_free(body);
}

static GtkWidget *make_roles_page(AppState *state) {
    GtkWidget *page = make_page("Роли доступа", "Список соответствует существующей серверной модели KuKLA. До подключения SMS-входа и полномочий назначение ролей намеренно недоступно.");
    GtkWidget *view = gtk_text_view_new();
    gtk_text_view_set_editable(GTK_TEXT_VIEW(view), FALSE);
    gtk_text_view_set_cursor_visible(GTK_TEXT_VIEW(view), FALSE);
    state->roles_buffer = gtk_text_view_get_buffer(GTK_TEXT_VIEW(view));
    gtk_box_append(GTK_BOX(page), view);
    return page;
}

static void on_create_search(GtkButton *button, gpointer user_data) {
    (void)button;
    AppState *state = user_data;
    const gchar *title = gtk_editable_get_text(GTK_EDITABLE(state->title_entry));
    if (title == NULL || g_utf8_strlen(title, -1) < 2) {
        set_status(state, "Название должно содержать не менее двух символов.", TRUE);
        return;
    }
    gchar *body = build_create_json(title);
    guint status = 0;
    GError *error = NULL;
    gchar *response = engine_client_request(&state->engine, "POST", "/v1/searches", body,
                                            &status, &error);
    g_free(body);
    g_free(response);
    if (error != NULL || status != 201) {
        set_status(state, error == NULL ? "Операцию создать не удалось." : error->message, TRUE);
        g_clear_error(&error);
        return;
    }
    gtk_editable_set_text(GTK_EDITABLE(state->title_entry), "");
    refresh_searches(state);
}

static GtkWidget *make_operations_page(AppState *state) {
    GtkWidget *page = gtk_box_new(GTK_ORIENTATION_VERTICAL, 12);
    gtk_widget_set_margin_top(page, 28);
    gtk_widget_set_margin_bottom(page, 28);
    gtk_widget_set_margin_start(page, 32);
    gtk_widget_set_margin_end(page, 32);
    gtk_widget_set_vexpand(page, TRUE);
    GtkWidget *heading = gtk_label_new("Поисковые операции");
    gtk_label_set_xalign(GTK_LABEL(heading), 0.0f);
    gtk_widget_add_css_class(heading, "title-1");
    gtk_box_append(GTK_BOX(page), heading);
    GtkWidget *description = gtk_label_new("Создайте локальную операцию. Запись, участник-создатель и событие аудита сохраняются одной транзакцией.");
    gtk_label_set_xalign(GTK_LABEL(description), 0.0f);
    gtk_label_set_wrap(GTK_LABEL(description), TRUE);
    gtk_box_append(GTK_BOX(page), description);

    GtkWidget *form = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 8);
    state->title_entry = gtk_entry_new();
    gtk_entry_set_placeholder_text(GTK_ENTRY(state->title_entry), "Название операции");
    gtk_widget_set_hexpand(state->title_entry, TRUE);
    gtk_box_append(GTK_BOX(form), state->title_entry);
    GtkWidget *create_button = gtk_button_new_with_label("Создать операцию");
    g_signal_connect(create_button, "clicked", G_CALLBACK(on_create_search), state);
    gtk_box_append(GTK_BOX(form), create_button);
    gtk_box_append(GTK_BOX(page), form);

    GtkWidget *frame = gtk_frame_new("Сохранённые операции");
    gtk_widget_set_vexpand(frame, TRUE);
    GtkWidget *scroll = gtk_scrolled_window_new();
    gtk_widget_set_vexpand(scroll, TRUE);
    GtkWidget *text_view = gtk_text_view_new();
    gtk_text_view_set_editable(GTK_TEXT_VIEW(text_view), FALSE);
    gtk_text_view_set_cursor_visible(GTK_TEXT_VIEW(text_view), FALSE);
    gtk_text_view_set_wrap_mode(GTK_TEXT_VIEW(text_view), GTK_WRAP_WORD_CHAR);
    state->searches_buffer = gtk_text_view_get_buffer(GTK_TEXT_VIEW(text_view));
    gtk_scrolled_window_set_child(GTK_SCROLLED_WINDOW(scroll), text_view);
    gtk_frame_set_child(GTK_FRAME(frame), scroll);
    gtk_box_append(GTK_BOX(page), frame);
    return page;
}

static void on_navigation_clicked(GtkButton *button, gpointer user_data) {
    GtkStack *stack = GTK_STACK(user_data);
    const char *page_name = g_object_get_data(G_OBJECT(button), "kukla-page");
    if (page_name != NULL) {
        gtk_stack_set_visible_child_name(stack, page_name);
    }
}

static void add_navigation_button(GtkWidget *sidebar, GtkStack *stack,
                                  const char *label, const char *page_name) {
    GtkWidget *button = gtk_button_new_with_label(label);
    gtk_widget_set_halign(button, GTK_ALIGN_FILL);
    gtk_widget_add_css_class(button, "flat");
    g_object_set_data(G_OBJECT(button), "kukla-page", (gpointer)page_name);
    g_signal_connect(button, "clicked", G_CALLBACK(on_navigation_clicked), stack);
    gtk_box_append(GTK_BOX(sidebar), button);
}

static gboolean on_window_close(GtkWindow *window, gpointer user_data) {
    (void)window;
    AppState *state = user_data;
    engine_client_stop(&state->engine);
    return FALSE;
}

static void app_state_free(gpointer data) {
    AppState *state = data;
    engine_client_clear(&state->engine);
    g_free(state);
}

static void activate(GtkApplication *application, gpointer user_data) {
    (void)user_data;
    AppState *state = g_object_get_data(G_OBJECT(application), "kukla-state");
    if (state != NULL) {
        gtk_window_present(GTK_WINDOW(state->window));
        return;
    }
    state = g_new0(AppState, 1);
    g_object_set_data_full(G_OBJECT(application), "kukla-state", state, app_state_free);
    GError *startup_error = NULL;
    gboolean engine_ready = engine_client_start(&state->engine, &startup_error);

    GtkWidget *window = gtk_application_window_new(application);
    state->window = window;
    gtk_window_set_title(GTK_WINDOW(window), "KuKLA — координация поисковых операций");
    gtk_window_set_default_size(GTK_WINDOW(window), 1000, 700);
    g_signal_connect(window, "close-request", G_CALLBACK(on_window_close), state);
    GtkWidget *header = gtk_header_bar_new();
    GtkWidget *brand = gtk_label_new("KuKLA");
    gtk_widget_add_css_class(brand, "title-2");
    gtk_header_bar_set_title_widget(GTK_HEADER_BAR(header), brand);
    gtk_window_set_titlebar(GTK_WINDOW(window), header);

    GtkWidget *root = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
    gtk_window_set_child(GTK_WINDOW(window), root);
    GtkWidget *content = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 0);
    gtk_widget_set_vexpand(content, TRUE);
    gtk_box_append(GTK_BOX(root), content);
    GtkWidget *sidebar = gtk_box_new(GTK_ORIENTATION_VERTICAL, 4);
    gtk_widget_set_size_request(sidebar, 220, -1);
    gtk_widget_set_margin_top(sidebar, 12);
    gtk_widget_set_margin_bottom(sidebar, 12);
    gtk_widget_set_margin_start(sidebar, 12);
    gtk_widget_set_margin_end(sidebar, 8);
    gtk_box_append(GTK_BOX(content), sidebar);
    GtkWidget *stack_widget = gtk_stack_new();
    state->stack = stack_widget;
    GtkStack *stack = GTK_STACK(stack_widget);
    gtk_stack_set_transition_type(stack, GTK_STACK_TRANSITION_TYPE_CROSSFADE);
    gtk_widget_set_hexpand(stack_widget, TRUE);
    gtk_widget_set_vexpand(stack_widget, TRUE);
    gtk_box_append(GTK_BOX(content), stack_widget);

    add_navigation_button(sidebar, stack, "Операции", "operations");
    add_navigation_button(sidebar, stack, "Карта", "map");
    add_navigation_button(sidebar, stack, "Задачи и группы", "field");
    add_navigation_button(sidebar, stack, "Заявки", "intake");
    add_navigation_button(sidebar, stack, "События и отчёты", "reports");
    add_navigation_button(sidebar, stack, "Пользователи и настройки", "settings");
    add_navigation_button(sidebar, stack, "Моя анкета", "profile");
    add_navigation_button(sidebar, stack, "Роли доступа", "roles");

    gtk_stack_add_named(stack, make_operations_page(state), "operations");
    gtk_stack_add_named(stack, make_page("Карта", "Офлайн-карта появится после подключения локального пакета данных."), "map");
    gtk_stack_add_named(stack, make_page("Полевой режим", "Задачи, позиции и сигналы будут подключены после реализации их моделей и правил доступа."), "field");
    gtk_stack_add_named(stack, make_page("Заявки", "Экран заявок появится после утверждения модели обращения и её связи с операцией."), "intake");
    gtk_stack_add_named(stack, make_page("События и отчёты", "История записывается; просмотр аудита и генерация отчётов будут добавлены следующим этапом."), "reports");
    gtk_stack_add_named(stack, make_page("Пользователи и настройки", "Персональные учётные записи и роли пока не реализованы. Создание операции помечается как локальная установка."), "settings");
    gtk_stack_add_named(stack, make_profile_page(state), "profile");
    gtk_stack_add_named(stack, make_roles_page(state), "roles");

    state->status_label = gtk_label_new("Запускаю локальный движок…");
    gtk_label_set_xalign(GTK_LABEL(state->status_label), 0.0f);
    gtk_widget_set_margin_top(state->status_label, 6);
    gtk_widget_set_margin_bottom(state->status_label, 6);
    gtk_widget_set_margin_start(state->status_label, 14);
    gtk_widget_set_margin_end(state->status_label, 14);
    gtk_box_append(GTK_BOX(root), state->status_label);
    gtk_stack_set_visible_child_name(stack, "operations");
    gtk_window_present(GTK_WINDOW(window));

    if (engine_ready) {
        refresh_searches(state);
        refresh_profile(state);
        refresh_roles(state);
    } else {
        set_status(state, startup_error == NULL ? "Движок KuKLA не запущен." : startup_error->message, TRUE);
        g_clear_error(&startup_error);
    }
}

int main(int argc, char **argv) {
    GtkApplication *application = gtk_application_new(
        "ru.kukla.Desktop", G_APPLICATION_DEFAULT_FLAGS);
    g_signal_connect(application, "activate", G_CALLBACK(activate), NULL);
    int status = g_application_run(G_APPLICATION(application), argc, argv);
    g_object_unref(application);
    return status;
}
