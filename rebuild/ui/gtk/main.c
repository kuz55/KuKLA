#include <gtk/gtk.h>

/*
 * First native-shell milestone. This deliberately contains no operational
 * data or mock rescue records. Feature pages are added only when their domain
 * contract and persistence implementation are ready.
 */

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
    gtk_widget_add_css_class(body, "dim-label");
    gtk_box_append(GTK_BOX(page), body);
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

static void activate(GtkApplication *application, gpointer user_data) {
    (void)user_data;

    GtkWidget *window = gtk_application_window_new(application);
    gtk_window_set_title(GTK_WINDOW(window), "KuKLA — координация поисковых операций");
    gtk_window_set_default_size(GTK_WINDOW(window), 1280, 800);

    GtkWidget *root = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
    GtkWidget *header = gtk_header_bar_new();
    GtkWidget *brand = gtk_label_new("KuKLA");
    gtk_widget_add_css_class(brand, "title-2");
    gtk_header_bar_set_title_widget(GTK_HEADER_BAR(header), brand);
    gtk_window_set_titlebar(GTK_WINDOW(window), header);
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

    gtk_stack_add_named(stack, make_page(
        "Оперативная обстановка",
        "Локальное рабочее место KuKLA. Подключение предметных экранов выполняется поэтапно после реализации и проверки их сервисных контрактов."),
        "operations");
    gtk_stack_add_named(stack, make_page(
        "Карта",
        "Офлайн-карта и геометрии будут доступны после установки совместимого локального пакета карт. Внешние тайлы не загружаются автоматически."),
        "map");
    gtk_stack_add_named(stack, make_page(
        "Полевой режим",
        "Позиции, задачи, чек-листы, медиа и сигналы будут разделены на реальные и симулированные источники. Этот экран пока не отправляет реальные сигналы."),
        "field");
    gtk_stack_add_named(stack, make_page(
        "Заявки",
        "Экран заявок появится после утверждения модели заявки и её связи с поисковой операцией. Данные не создаются автоматически."),
        "intake");
    gtk_stack_add_named(stack, make_page(
        "События и отчёты",
        "Хронология, аналитика, печатные формы и экспорты будут подключаться только по утверждённым требованиям и эталонным формам."),
        "reports");
    gtk_stack_add_named(stack, make_page(
        "Пользователи и настройки",
        "Локальные учётные записи, права, резервное копирование и диагностика будут подключены после реализации соответствующих защищённых сервисов."),
        "settings");

    GtkWidget *status = gtk_label_new("Локальный режим · сетевые порты по умолчанию закрыты · данные не загружаются из облака");
    gtk_label_set_xalign(GTK_LABEL(status), 0.0f);
    gtk_widget_set_margin_top(status, 6);
    gtk_widget_set_margin_bottom(status, 6);
    gtk_widget_set_margin_start(status, 14);
    gtk_widget_set_margin_end(status, 14);
    gtk_widget_add_css_class(status, "dim-label");
    gtk_box_append(GTK_BOX(root), status);

    gtk_stack_set_visible_child_name(stack, "operations");
    gtk_window_present(GTK_WINDOW(window));
}

int main(int argc, char **argv) {
    GtkApplication *application = gtk_application_new(
        "ru.kukla.Desktop", G_APPLICATION_DEFAULT_FLAGS);
    g_signal_connect(application, "activate", G_CALLBACK(activate), NULL);
    int status = g_application_run(G_APPLICATION(application), argc, argv);
    g_object_unref(application);
    return status;
}
