// Player accounts: Supabase Auth with email + password (no emails are sent to sign in), and the
// player's single save in `player_saves` (RLS: each account reads and writes only its own row).

import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../config/supabase';
import { parseSave, type PlayerSaveData } from './playerSave';

export type AuthResult = { ok: true; message?: string } | { ok: false; error: string };

/** Supabase Auth error → a short Traditional Chinese message. */
export function authError(message: string | undefined): string {
  const m = (message ?? '').toLowerCase();
  if (m.includes('invalid login credentials')) return 'Email 或密碼不對';
  if (m.includes('already registered') || m.includes('already been registered'))
    return '這個 email 已經註冊過了，請直接登入';
  if (m.includes('email not confirmed')) return '這個帳號還沒確認 email，請先到信箱點確認連結';
  if (m.includes('password') && (m.includes('6') || m.includes('short') || m.includes('weak')))
    return '密碼太短或太簡單（至少 6 個字）';
  if (m.includes('invalid') && m.includes('email')) return 'Email 格式不對';
  if (m.includes('rate limit') || m.includes('too many')) return '嘗試太多次了，等一下再試';
  if (m.includes('fetch') || m.includes('network')) return '連不上伺服器，檢查一下網路';
  return message ? `登入失敗：${message}` : '登入失敗';
}

export function checkCredentials(email: string, password: string): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return '請輸入正確的 email';
  if (password.length < 6) return '密碼至少 6 個字';
  return null;
}

export class Account {
  private readonly sb: SupabaseClient;
  session: Session | null = null;
  /** Fires after sign in / sign out (and once the stored session is restored). */
  onChange: () => void = () => {};
  readonly ready: Promise<void>;

  constructor() {
    this.sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: 'voxel-auth',
        detectSessionInUrl: false,
      },
    });
    this.ready = this.sb.auth
      .getSession()
      .then(({ data }) => {
        this.session = data.session;
        this.onChange();
      })
      .catch(() => {});
    this.sb.auth.onAuthStateChange((_event, session) => {
      const changed = session?.user.id !== this.session?.user.id;
      this.session = session;
      if (changed) this.onChange();
    });
  }

  get email(): string | null {
    return this.session?.user.email ?? null;
  }

  get userId(): string | null {
    return this.session?.user.id ?? null;
  }

  async signUp(email: string, password: string): Promise<AuthResult> {
    const bad = checkCredentials(email, password);
    if (bad) return { ok: false, error: bad };
    const { data, error } = await this.sb.auth.signUp({ email: email.trim(), password });
    if (error) return { ok: false, error: authError(error.message) };
    // Email confirmation switched on in Supabase: no session until the link is clicked.
    if (!data.session) return { ok: true, message: '已寄出確認信，點信裡的連結之後再回來登入' };
    this.session = data.session;
    this.onChange();
    return { ok: true };
  }

  async signIn(email: string, password: string): Promise<AuthResult> {
    const bad = checkCredentials(email, password);
    if (bad) return { ok: false, error: bad };
    const { data, error } = await this.sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) return { ok: false, error: authError(error.message) };
    this.session = data.session;
    this.onChange();
    return { ok: true };
  }

  async signOut(): Promise<void> {
    await this.sb.auth.signOut().catch(() => {});
    this.session = null;
    this.onChange();
  }

  /** This account's save for the world `seed` (null if none yet). Throws on network errors. */
  async load(seed: number): Promise<PlayerSaveData | null> {
    if (!this.userId) return null;
    const { data, error } = await this.sb
      .from('player_saves')
      .select('data')
      .eq('user_id', this.userId)
      .eq('seed', seed)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? parseSave((data as { data: unknown }).data) : null;
  }

  /** Overwrite this account's save. */
  async save(seed: number, save: PlayerSaveData): Promise<void> {
    if (!this.userId) throw new Error('not signed in');
    const { error } = await this.sb
      .from('player_saves')
      .upsert({ user_id: this.userId, seed, data: save }, { onConflict: 'user_id,seed' });
    if (error) throw new Error(error.message);
  }
}
