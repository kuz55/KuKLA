#ifndef UNICODE
#define UNICODE
#endif
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <wchar.h>

/* Keep the GTK runtime in bin/ while providing a double-clickable GUI entry point. */
#define MAX_WIN_PATH 32768

static void show_error(const wchar_t *message) {
    MessageBoxW(NULL, message, L"KuKLA", MB_OK | MB_ICONERROR);
}

static wchar_t *join_path(const wchar_t *directory, const wchar_t *relative) {
    size_t length = wcslen(directory);
    BOOL separator_needed = length > 0 && directory[length - 1] != L'\\';
    size_t total = length + (separator_needed ? 1 : 0) + wcslen(relative) + 1;
    if (total > MAX_WIN_PATH) {
        return NULL;
    }
    wchar_t *result = malloc(total * sizeof(*result));
    if (result != NULL) {
        swprintf(result, total, L"%ls%ls%ls", directory,
                 separator_needed ? L"\\" : L"", relative);
    }
    return result;
}

static BOOL set_bundle_path(const wchar_t *name, const wchar_t *root,
                            const wchar_t *relative) {
    wchar_t *value = join_path(root, relative);
    if (value == NULL) {
        return FALSE;
    }
    BOOL success = SetEnvironmentVariableW(name, value);
    free(value);
    return success;
}

static BOOL prepend_bin_to_path(const wchar_t *root) {
    wchar_t *bin = join_path(root, L"bin");
    if (bin == NULL) {
        return FALSE;
    }
    DWORD old_size = GetEnvironmentVariableW(L"PATH", NULL, 0);
    wchar_t *old_path = calloc(old_size == 0 ? 1 : old_size, sizeof(*old_path));
    if (old_path == NULL) {
        free(bin);
        return FALSE;
    }
    if (old_size > 0 && GetEnvironmentVariableW(L"PATH", old_path, old_size) >= old_size) {
        free(old_path);
        free(bin);
        return FALSE;
    }
    size_t length = wcslen(bin) + (old_path[0] == L'\0' ? 0 : 1 + wcslen(old_path)) + 1;
    if (length > MAX_WIN_PATH) {
        free(old_path);
        free(bin);
        return FALSE;
    }
    wchar_t *new_path = malloc(length * sizeof(*new_path));
    if (new_path == NULL) {
        free(old_path);
        free(bin);
        return FALSE;
    }
    swprintf(new_path, length, L"%ls%ls%ls", bin,
             old_path[0] == L'\0' ? L"" : L";", old_path);
    BOOL success = SetEnvironmentVariableW(L"PATH", new_path);
    free(new_path);
    free(old_path);
    free(bin);
    return success;
}

int WINAPI WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR arguments, int show) {
    (void)instance;
    (void)previous;
    (void)arguments;
    (void)show;

    wchar_t root[MAX_WIN_PATH];
    DWORD length = GetModuleFileNameW(NULL, root, MAX_WIN_PATH);
    if (length == 0 || length >= MAX_WIN_PATH) {
        show_error(L"Не удалось определить расположение KuKLA.");
        return 1;
    }
    wchar_t *separator = wcsrchr(root, L'\\');
    if (separator == NULL) {
        show_error(L"Не удалось определить папку KuKLA.");
        return 1;
    }
    if (separator == root + 2 && root[1] == L':') {
        separator[1] = L'\0'; /* Keep the backslash in a drive root. */
    } else {
        *separator = L'\0';
    }

    if (!prepend_bin_to_path(root) ||
        !SetEnvironmentVariableW(L"GTK_DATA_PREFIX", root) ||
        !SetEnvironmentVariableW(L"GTK_EXE_PREFIX", root) ||
        !set_bundle_path(L"GSETTINGS_SCHEMA_DIR", root, L"share\\glib-2.0\\schemas") ||
        !set_bundle_path(L"GDK_PIXBUF_MODULEDIR", root, L"lib\\gdk-pixbuf-2.0\\2.10.0\\loaders") ||
        !set_bundle_path(L"GDK_PIXBUF_MODULE_FILE", root, L"lib\\gdk-pixbuf-2.0\\2.10.0\\loaders.cache")) {
        show_error(L"Не удалось подготовить окружение KuKLA.");
        return 1;
    }

    wchar_t *ui = join_path(root, L"bin\\kukla-ui.exe");
    if (ui == NULL || GetFileAttributesW(ui) == INVALID_FILE_ATTRIBUTES) {
        free(ui);
        show_error(L"Не найдено приложение KuKLA. Распакуйте архив целиком.");
        return 1;
    }
    size_t command_length = wcslen(ui) + 3;
    wchar_t *command = malloc(command_length * sizeof(*command));
    if (command == NULL) {
        free(ui);
        show_error(L"Не хватает памяти для запуска KuKLA.");
        return 1;
    }
    swprintf(command, command_length, L"\"%ls\"", ui);

    STARTUPINFOW startup = {0};
    PROCESS_INFORMATION process = {0};
    startup.cb = sizeof(startup);
    BOOL started = CreateProcessW(ui, command, NULL, NULL, FALSE, 0, NULL,
                                  root, &startup, &process);
    free(command);
    free(ui);
    if (!started) {
        show_error(L"Не удалось запустить KuKLA. Убедитесь, что архив распакован целиком.");
        return 1;
    }

    CloseHandle(process.hThread);
    DWORD exit_code = 1;
    if (WaitForSingleObject(process.hProcess, INFINITE) == WAIT_OBJECT_0) {
        GetExitCodeProcess(process.hProcess, &exit_code);
    }
    CloseHandle(process.hProcess);
    return (int)exit_code;
}
