//go:build windows

package platform

import (
	"context"
	"os"
	"os/signal"
)

func ShutdownContext(parent context.Context) (context.Context, context.CancelFunc) {
	return signal.NotifyContext(parent, os.Interrupt)
}
