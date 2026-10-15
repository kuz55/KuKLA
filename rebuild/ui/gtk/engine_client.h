#ifndef KUKLA_ENGINE_CLIENT_H
#define KUKLA_ENGINE_CLIENT_H

#include <glib.h>

typedef struct {
    gchar *endpoint;
    GPid process_id;
    gboolean owns_process;
} EngineClient;

gboolean engine_client_start(EngineClient *client, GError **error);
gchar *engine_client_request(EngineClient *client, const gchar *method,
                             const gchar *path, const gchar *body,
                             guint *status_code, GError **error);
void engine_client_stop(EngineClient *client);
void engine_client_clear(EngineClient *client);

#endif
