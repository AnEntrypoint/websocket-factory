import logger from '@sequentialos/sequential-logging';

export function createSubscriptionHandler(config) {
  const {
    urlPattern,
    paramExtractor,
    onSubscribe,
    onUnsubscribe,
    getInitialMessage,
    contextLabel
  } = config;

  return {
    matches: (url) => {
      if (typeof urlPattern === 'string') {
        return url.startsWith(urlPattern);
      }
      return urlPattern.test(url);
    },

    handle: (wss, req, socket, head, limiter, getActiveTasks) => {
      let params;
      try {
        params = paramExtractor(req.url);
      } catch (e) {
        const label = typeof contextLabel === 'function' ? contextLabel('?') : contextLabel;
        logger.error(`Parameter extraction failed [${label}]:`, e.message);
        socket.write('HTTP/1.1 400 Bad Request\r\nContent-Type: application/json\r\n\r\n');
        socket.write(JSON.stringify({ error: e.message }));
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        if (!limiter.add(ws)) {
          ws.close(1008, 'Per-IP connection limit exceeded');
          return;
        }

        onSubscribe(params, ws);

        ws.on('error', (error) => {
          const label = typeof contextLabel === 'function' ? contextLabel(params) : contextLabel;
          console.error(`WebSocket error [${label}]:`, error.message);
          onUnsubscribe(params, ws);
          limiter.remove(ws);
          try {
            ws.close(1011, 'Internal server error');
          } catch (e) {
            logger.error(`Failed to close WebSocket [${label}]:`, e.message);
          }
        });

        ws.on('close', () => {
          onUnsubscribe(params, ws);
          limiter.remove(ws);
        });

        try {
          const message = getInitialMessage(params, getActiveTasks);
          ws.send(JSON.stringify(message));
        } catch (e) {
          const label = typeof contextLabel === 'function' ? contextLabel(params) : contextLabel;
          logger.error(`Failed to send initial message [${label}]:`, e.message);
          ws.close(1011, 'Failed to send initial message');
        }
      });
    }
  };
}
