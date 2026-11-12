// Player accounts: Supabase Auth with email + password, and the player's single save in
// `player_saves` (RLS: each account reads and writes only its own row).
// New accounts confirm their email: the link in the mail comes back to this site (the page it was
// requested from) with the session in the URL hash, which the client picks up and signs in with.
// The implicit flow is used on purpose so the link also works when the mail is opened on another device.

import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../config/supabase';
import { parseSave, type PlayerSaveData } from './playerSave';

export type AuthResult =
  | { ok: true; message?: string; needsConfirm?: boolean }
  | { ok: false; error: string; needsConfirm?: boolean };

/** What the URL said when the page was opened from a confirmation link. */
export type LinkResult = { kind: 'confirmed' } | { kind: 'error'; message: string } | null;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Read what a confirmation link put in the URL (before the auth client consumes it). */
export function readLink(hash: string, search: string): LinkResult {
  const h = new URLSearchParams(hash.replace(/^#/, ''));
  const q = new URLSearchParams(search);
  const err = h.get('error_code') ?? q.get('error_code') ?? h.get('error') ?? q.get('error');
  if (err) {
    if (err === 'otp_expired')
      return { kind: 'error', message: '確認連結已經過期或用過了，請重寄一封確認信' };
    const d = h.get('error_description') ?? q.get('error_description');
    return {
      kind: 'error',
      message: d ? `確認失敗：${d.replace(/\+/g, ' ')}` : '確認失敗，請重寄一封確認信',
    };
  }
  if (h.get('access_token') && (h.get('type') === 'signup' || h.get('type') === 'email'))
    return { kind: 'confirmed' };
  return null;
}

/** Supabase Auth error → a short Traditional Chinese message. */
export function authError(message: string | undefined): string {
  const m = (message ?? '').toLowerCase();
  if (m.includes('invalid login credentials')) return 'Email 或密碼不對';
  if (m.includes('already registered') || m.includes('already been registered'))
    return '這個 email 已經註冊過了，請直接登入';
  if (m.includes('email not confirmed'))
    return '這個帳號還沒確認 email，請到信箱點確認連結（找不到可以重寄）';
  if (m.includes('email rate limit') || m.includes('over_email_send_rate_limit'))
    return '寄信次數太多了（每小時有上限），請過一陣子再試';
  if (m.includes('for security purposes')) return '剛剛才寄過，等一分鐘再重寄';
  if (m.includes('password') && (m.includes('6') || m.includes('short') || m.includes('weak')))
    return '密碼太短或太簡單（至少 6 個字）';
  if (m.includes('invalid') && m.includes('email')) return 'Email 格式不對';
  if (m.includes('rate limit') || m.includes('too many')) return '嘗試太多次了，等一下再試';
  if (m.includes('fetch') || m.includes('network')) return '連不上伺服器，檢查一下網路';
  return message ? `登入失敗：${message}` : '登入失敗';
}

export function checkCredentials(email: string, password: string): string | null {
  if (!EMAIL_RE.test(email.trim())) return '請輸入正確的 email';
  if (password.length < 6) return '密碼至少 6 個字';
  return null;
}

export class Account {
  private readonly sb: SupabaseClient;
  session: Session | null = null;
  /** Fires after sign in / sign out (and once the stored session is restored). */
  onChange: () => void = () => {};
  readonly ready: Promise<void>;
  /** Set when this page was opened from a confirmation link. */
  readonly link: LinkResult;
  /** Email of the last sign-up / failed sign-in that still needs confirming (for "resend"). */
  pendingEmail: string | null = null;

  constructor() {
    this.link = readLink(location.hash, location.search);
    this.sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: 'voxel-auth',
        detectSessionInUrl: true,
        flowType: 'implicit',
      },
    });
    this.ready = this.sb.auth
      .getSession()
      .then(({ data }) => {
        this.session = data.session;
        // Tidy the address bar (tokens / error codes from the confirmation link).
        if (this.link || location.hash.includes('access_token')) {
          history.replaceState(null, '', location.pathname + location.search);
        }
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

  /** Where the confirmation link brings the player back: this site (production, preview or dev). */
  get redirectUrl(): string {
    return `${location.origin}/`;
  }

  async signUp(email: string, password: string): Promise<AuthResult> {
    const bad = checkCredentials(email, password);
    if (bad) return { ok: false, error: bad };
    const { data, error } = await this.sb.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: this.redirectUrl },
    });
    if (error) return { ok: false, error: authError(error.message) };
    if (!data.session) {
      // Supabase answers an already-registered address with an empty identities list (and sends nothing).
      if (data.user && data.user.identities?.length === 0)
        return { ok: false, error: '這個 email 已經註冊過了，請直接登入' };
      this.pendingEmail = email.trim();
      return {
        ok: true,
        needsConfirm: true,
        message: `已寄確認信到 ${email.trim()}。點信裡的連結就會回到小島並自動登入（也看一下垃圾郵件）。`,
      };
    }
    this.session = data.session;
    this.onChange();
    return { ok: true };
  }

  async signIn(email: string, password: string): Promise<AuthResult> {
    const bad = checkCredentials(email, password);
    if (bad) return { ok: false, error: bad };
    const { data, error } = await this.sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      const needsConfirm = error.message.toLowerCase().includes('email not confirmed');
      if (needsConfirm) this.pendingEmail = email.trim();
      return { ok: false, error: authError(error.message), needsConfirm };
    }
    this.session = data.session;
    this.onChange();
    return { ok: true };
  }

  /** Send the confirmation mail again (Supabase allows one per minute, and a few per hour in total). */
  async resendConfirmation(email: string = this.pendingEmail ?? ''): Promise<AuthResult> {
    if (!EMAIL_RE.test(email.trim())) return { ok: false, error: '請先在上面輸入 email' };
    const { error } = await this.sb.auth.resend({
      type: 'signup',
      email: email.trim(),
      options: { emailRedirectTo: this.redirectUrl },
    });
    if (error) return { ok: false, error: authError(error.message), needsConfirm: true };
    this.pendingEmail = email.trim();
    return { ok: true, needsConfirm: true, message: `已重寄確認信到 ${email.trim()}` };
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
