#include "engine_client.h"

#include <json-glib/json-glib.h>
#include <stdio.h>
#include <string.h>

#ifdef G_OS_WIN32
#include <windows.h>
#else
#include <errno.h>
#include <signal.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>
#endif

#define KUKLA_ERROR (g_quark_from_static_string("kukla-engine-client-error"))
#define MAX_RESPONSE_BYTES (4 * 1024 * 1024)

static gchar *engine_binary_path(void) {
#ifdef G_OS_WIN32
    wchar_t module_path[32768];
    DWORD length = GetModuleFileNameW(NULL, module_path, G_N_ELEMENTS(module_path));
    if (length == 0 || length >= G_N_ELEMENTS(module_path)) {
        return NULL;
    }
    gchar *utf8_path = g_utf16_to_utf8((const gunichar2 *)module_path, (glong)length,
                                       NULL, NULL, NULL);
    if (utf8_path == NULL) {
        return NULL;
    }
    gchar *directory = g_path_get_dirname(utf8_path);
    gchar *engine = g_build_filename(directory, "kukla-engine.exe", NULL);
    g_free(directory);
    g_free(utf8_path);
    return engine;
#else
    GError *error = NULL;
    gchar *module_path = g_file_read_link("/proc/self/exe", &error);
    if (module_path == NULL) {
        g_clear_error(&error);
        return NULL;
    }
    gchar *directory = g_path_get_dirname(module_path);
    gchar *engine = g_build_filename(directory, "kukla-engine", NULL);
    g_free(directory);
    g_free(module_path);
    return engine;
#endif
}

static gchar *create_endpoint(void) {
    gchar *id = g_uuid_string_random();
#ifdef G_OS_WIN32
    gchar *endpoint = g_strdup_printf("\\\\.\\pipe\\kukla-engine-%s", id);
#else
    const gchar *runtime_dir = g_getenv("XDG_RUNTIME_DIR");
    gchar *runtime_owned = NULL;
    if (runtime_dir == NULL || runtime_dir[0] != '/') {
        const gchar *state_home = g_getenv("XDG_STATE_HOME");
        if (state_home == NULL || state_home[0] != '/') {
            gchar *state_home_owned = g_build_filename(g_get_home_dir(), ".local", "state", NULL);
            runtime_owned = g_build_filename(state_home_owned, "run", "kukla", NULL);
            g_free(state_home_owned);
        } else {
            runtime_owned = g_build_filename(state_home, "run", "kukla", NULL);
        }
        runtime_dir = runtime_owned;
    } else {
        runtime_owned = g_build_filename(runtime_dir, "kukla", NULL);
        runtime_dir = runtime_owned;
    }
    if (g_mkdir_with_parents(runtime_dir, 0700) != 0) {
        g_free(runtime_owned);
        g_free(id);
        return NULL;
    }
    g_chmod(runtime_dir, 0700);
    gchar *socket_name = g_strdup_printf("engine-%s.sock", id);
    gchar *endpoint = g_build_filename(runtime_dir, socket_name, NULL);
    g_free(socket_name);
    g_free(runtime_owned);
#endif
    g_free(id);
    return endpoint;
}

static void child_exited(GPid pid, gint wait_status, gpointer user_data) {
    (void)wait_status;
    (void)user_data;
    g_spawn_close_pid(pid);
}

gboolean engine_client_start(EngineClient *client, GError **error) {
    g_return_val_if_fail(client != NULL, FALSE);
    gchar *binary = engine_binary_path();
    if (binary == NULL || !g_file_test(binary, G_FILE_TEST_IS_EXECUTABLE)) {
        g_set_error(error, KUKLA_ERROR, 1,
                    "Не найден движок KuKLA рядом с приложением.");
        g_free(binary);
        return FALSE;
    }
    client->endpoint = create_endpoint();
    if (client->endpoint == NULL) {
        g_set_error(error, KUKLA_ERROR, 2,
                    "Не удалось создать защищённый локальный IPC-адрес.");
        g_free(binary);
        return FALSE;
    }

    gchar *endpoint_arg = g_strconcat("--ipc-endpoint=", client->endpoint, NULL);
    gchar *argv[] = { binary, endpoint_arg, NULL };
    GError *spawn_error = NULL;
    if (!g_spawn_async(NULL, argv, NULL,
                       G_SPAWN_DO_NOT_REAP_CHILD | G_SPAWN_STDOUT_TO_DEV_NULL |
                           G_SPAWN_STDERR_TO_DEV_NULL,
                       NULL, NULL, &client->process_id, &spawn_error)) {
        g_set_error(error, KUKLA_ERROR, 3, "Не удалось запустить движок: %s",
                    spawn_error->message);
        g_clear_error(&spawn_error);
        g_free(endpoint_arg);
        g_free(binary);
        g_clear_pointer(&client->endpoint, g_free);
        return FALSE;
    }
    client->owns_process = TRUE;
    g_child_watch_add(client->process_id, child_exited, NULL);
    g_free(endpoint_arg);
    g_free(binary);

    for (guint attempt = 0; attempt < 40; attempt++) {
        guint status = 0;
        GError *request_error = NULL;
        gchar *response = engine_client_request(client, "GET", "/v1/health", NULL,
                                                &status, &request_error);
        g_free(response);
        g_clear_error(&request_error);
        if (status == 200) {
            return TRUE;
        }
        g_usleep(100 * 1000);
    }
    engine_client_stop(client);
    g_set_error(error, KUKLA_ERROR, 4,
                "Движок KuKLA не ответил на локальную проверку готовности.");
    return FALSE;
}

static gboolean write_all(int fd, const gchar *data, gsize length, GError **error) {
    gsize written = 0;
    while (written < length) {
#ifdef MSG_NOSIGNAL
        ssize_t result = send(fd, data + written, length - written, MSG_NOSIGNAL);
#else
        ssize_t result = write(fd, data + written, length - written);
#endif
        if (result < 0 && errno == EINTR) {
            continue;
        }
        if (result <= 0) {
            g_set_error(error, KUKLA_ERROR, 5, "Ошибка записи в IPC-сокет: %s",
                        g_strerror(errno));
            return FALSE;
        }
        written += (gsize)result;
    }
    return TRUE;
}

gchar *engine_client_request(EngineClient *client, const gchar *method,
                             const gchar *path, const gchar *body,
                             guint *status_code, GError **error) {
    g_return_val_if_fail(client != NULL && client->endpoint != NULL, NULL);
    g_return_val_if_fail(method != NULL && path != NULL, NULL);
    if (status_code != NULL) {
        *status_code = 0;
    }
    const gchar *payload = body == NULL ? "" : body;
    gchar *request = g_strdup_printf(
        "%s %s HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\n"
        "Content-Length: %zu\r\nConnection: close\r\n\r\n%s",
        method, path, strlen(payload), payload);
    GByteArray *response = g_byte_array_new();

#ifdef G_OS_WIN32
    if (!WaitNamedPipeA(client->endpoint, 200)) {
        g_set_error(error, KUKLA_ERROR, 6, "Локальный канал KuKLA пока недоступен.");
        g_byte_array_unref(response);
        g_free(request);
        return NULL;
    }
    HANDLE pipe = CreateFileA(client->endpoint, GENERIC_READ | GENERIC_WRITE,
                              0, NULL, OPEN_EXISTING, 0, NULL);
    if (pipe == INVALID_HANDLE_VALUE) {
        g_set_error(error, KUKLA_ERROR, 7, "Не удалось подключиться к локальному каналу KuKLA.");
        g_byte_array_unref(response);
        g_free(request);
        return NULL;
    }
    DWORD bytes_written = 0;
    if (!WriteFile(pipe, request, (DWORD)strlen(request), &bytes_written, NULL) ||
        bytes_written != strlen(request)) {
        g_set_error(error, KUKLA_ERROR, 8, "Не удалось отправить запрос движку KuKLA.");
        CloseHandle(pipe);
        g_byte_array_unref(response);
        g_free(request);
        return NULL;
    }
    gchar buffer[4096];
    DWORD bytes_read = 0;
    while (ReadFile(pipe, buffer, sizeof(buffer), &bytes_read, NULL) && bytes_read > 0) {
        if (response->len + bytes_read > MAX_RESPONSE_BYTES) {
            g_set_error(error, KUKLA_ERROR, 9, "Ответ движка превышает допустимый размер.");
            CloseHandle(pipe);
            g_byte_array_unref(response);
            g_free(request);
            return NULL;
        }
        g_byte_array_append(response, (guint8 *)buffer, bytes_read);
    }
    CloseHandle(pipe);
#else
    int fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (fd < 0) {
        g_set_error(error, KUKLA_ERROR, 10, "Не удалось открыть локальный IPC-сокет.");
        g_byte_array_unref(response);
        g_free(request);
        return NULL;
    }
    struct sockaddr_un address;
    memset(&address, 0, sizeof(address));
    address.sun_family = AF_UNIX;
    if (strlen(client->endpoint) >= sizeof(address.sun_path)) {
        g_set_error(error, KUKLA_ERROR, 11, "Путь локального IPC-сокета слишком длинный.");
        close(fd);
        g_byte_array_unref(response);
        g_free(request);
        return NULL;
    }
    g_strlcpy(address.sun_path, client->endpoint, sizeof(address.sun_path));
    if (connect(fd, (struct sockaddr *)&address, sizeof(address)) != 0) {
        g_set_error(error, KUKLA_ERROR, 12, "Движок KuKLA недоступен: %s", g_strerror(errno));
        close(fd);
        g_byte_array_unref(response);
        g_free(request);
        return NULL;
    }
    if (!write_all(fd, request, strlen(request), error)) {
        close(fd);
        g_byte_array_unref(response);
        g_free(request);
        return NULL;
    }
    gchar buffer[4096];
    ssize_t bytes_read;
    while ((bytes_read = read(fd, buffer, sizeof(buffer))) > 0) {
        if (response->len + (gsize)bytes_read > MAX_RESPONSE_BYTES) {
            g_set_error(error, KUKLA_ERROR, 13, "Ответ движка превышает допустимый размер.");
            close(fd);
            g_byte_array_unref(response);
            g_free(request);
            return NULL;
        }
        g_byte_array_append(response, (guint8 *)buffer, (guint)bytes_read);
    }
    close(fd);
    if (bytes_read < 0) {
        g_set_error(error, KUKLA_ERROR, 14, "Ошибка чтения ответа движка.");
        g_byte_array_unref(response);
        g_free(request);
        return NULL;
    }
#endif

    g_free(request);
    g_byte_array_append(response, (const guint8 *)"\0", 1);
    gchar *response_text = (gchar *)response->data;
    gchar *body_start = strstr(response_text, "\r\n\r\n");
    if (body_start == NULL) {
        g_set_error(error, KUKLA_ERROR, 15, "Некорректный HTTP-ответ движка.");
        g_byte_array_unref(response);
        return NULL;
    }
    guint code = 0;
    if (sscanf(response_text, "HTTP/%*u.%*u %u", &code) != 1) {
        g_set_error(error, KUKLA_ERROR, 16, "Не удалось прочитать статус ответа движка.");
        g_byte_array_unref(response);
        return NULL;
    }
    if (status_code != NULL) {
        *status_code = code;
    }
    gchar *body_copy = g_strdup(body_start + 4);
    g_byte_array_unref(response);
    return body_copy;
}

void engine_client_stop(EngineClient *client) {
    if (client == NULL || client->endpoint == NULL || !client->owns_process) {
        return;
    }
    guint status = 0;
    GError *error = NULL;
    gchar *response = engine_client_request(client, "POST", "/v1/shutdown", "{}",
                                            &status, &error);
    g_free(response);
    g_clear_error(&error);
    client->owns_process = FALSE;
}

void engine_client_clear(EngineClient *client) {
    if (client == NULL) {
        return;
    }
    engine_client_stop(client);
    g_clear_pointer(&client->endpoint, g_free);
}
