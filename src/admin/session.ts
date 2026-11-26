import { ApiError } from '@/data/api';

export type Post = <T>(action: string, body: object) => Promise<T>;

export interface Session {
  /** Проверяет PIN действием `login`; запоминает его только если сервер принял. */
  login(pin: string): Promise<void>;
  /** Админ-действие: PIN сессии подставляется в тело, чужой `pin` из `body` его не заменит. */
  call<T = Record<string, unknown>>(action: string, body?: object): Promise<T>;
  logout(): void;
}

/**
 * PIN администратора живёт только в этом замыкании: ни в DOM, ни в хранилище, ни в консоли.
 * Если сервер посреди работы отказал по PIN (сменили, блокировка), PIN забывается и вызывается `onLogout` с этой ошибкой.
 */
export function createSession(post: Post, onLogout: (reason: ApiError) => void, onKey: (screenKey: string) => void = () => {}): Session {
  let pin: string | null = null;

  return {
    async login(candidate) {
      // сервер отдаёт ключ экрана вместе с входом: без него снимок (GET) не читается
      const reply = await post<{ screenKey?: string }>('login', { pin: candidate });
      pin = candidate;
      if (typeof reply?.screenKey === 'string' && reply.screenKey !== '') onKey(reply.screenKey);
    },
    async call<T>(action: string, body: object = {}): Promise<T> {
      if (pin === null) throw new ApiError('invalid_pin', 'invalid_pin');
      try {
        return await post<T>(action, { ...body, pin });
      } catch (e) {
        if (e instanceof ApiError && (e.code === 'invalid_pin' || e.code === 'locked') && pin !== null) {
          pin = null;
          onLogout(e);
        }
        throw e;
      }
    },
    logout() {
      pin = null;
    },
  };
}
