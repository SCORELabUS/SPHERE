import { NotificationUrlEvent } from './types/types';

const HARVEY_API_BASE_URL = import.meta.env.VITE_HARVEY_URL ?? 'http://localhost:8086';

export interface UrlTransformEvent {
  connect(onEvent: (event: NotificationUrlEvent) => void): () => void;
}

export const sseUrlTransformEvent: UrlTransformEvent = {
  connect(onEvent) {
    const eventSource = new EventSource(`${HARVEY_API_BASE_URL}/events`);

    eventSource.onopen = () => console.log('Connection established');

    eventSource.addEventListener('url_transform', (e: MessageEvent) => {
      onEvent(JSON.parse(e.data));
    });

    return () => eventSource.close();
  },
};

export const playgroundMockUrlTrnasformEvent: UrlTransformEvent = {
  connect() {
    return () => {};
  },
};
