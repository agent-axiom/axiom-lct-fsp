'use client';
import {useEffect, useRef, useState} from 'react';
import Link from 'next/link';
import {Button} from '@/components/ui/button';
type Result = {status: 'not_started'|'sending'|'accepted'|'rejected'|'unknown'; enabled?: boolean; code?: string; error?: string};
const labels: Record<Result['status'], string> = {
  not_started: 'Проверочное письмо ещё не отправлялось.',
  sending: 'Попытка уже началась. Повторная отправка заблокирована.',
  accepted: 'Resend принял проверочное письмо. Проверьте входящие и папку «Спам».',
  rejected: 'Resend отклонил запрос. Новая попытка не запускалась.',
  unknown: 'Результат отправки неизвестен. Проверьте почту; повторная отправка заблокирована.',
};
export default function OwnerDomainEmailTest() {
  const [result, setResult] = useState<Result|null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const lock = useRef(false);
  async function refresh() {
    const response = await fetch('/api/owner/domain-email-test', {cache: 'no-store'});
    const value = await response.json() as Result;
    if (!response.ok) throw new Error(value.error || 'Не удалось проверить статус.');
    setResult(value);
  }
  useEffect(() => {let active = true; fetch('/api/owner/domain-email-test', {cache: 'no-store'}).then(async response => {const value = await response.json() as Result; if (!response.ok) throw new Error(value.error || 'Не удалось проверить статус.'); if (active) setResult(value);}).catch(reason => {if (active) setError(reason instanceof Error ? reason.message : 'Не удалось проверить статус.');}); return () => {active = false;};}, []);
  async function send() {
    if (lock.current || attempted || result?.status !== 'not_started' || !result.enabled) return;
    lock.current = true; setBusy(true); setAttempted(true); setError('');
    try {
      const response = await fetch('/api/owner/domain-email-test', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({action: 'send-owner-domain-test'})});
      const value = await response.json() as Result;
      if (!response.ok) throw new Error(value.error || 'Не удалось получить результат.');
      setResult(value);
    } catch (reason) {setError(reason instanceof Error ? reason.message : 'Не удалось получить результат.');}
    finally {lock.current = false; setBusy(false); try {await refresh();} catch {/* Keep original result and prevent a second send. */}}
  }
  return <main className="account-landing"><Link className="eyebrow" href="/">ФСП / ТАЛАНТЫ</Link><h1>Проверка доменной почты владельца</h1><section className="panel form-grid"><p>Одно проверочное письмо от noreply@notify.kosarevsky.dev на заранее настроенный адрес владельца. Это отдельная проверка домена; прежняя квитанция onboarding@resend.dev сохраняется. Реальные аккаунты и общая отправка почты остаются выключенными.</p><p role="status">{result ? labels[result.status] : 'Проверяем состояние…'}</p>{result?.code && <p className="micro">Код: {result.code}</p>}{error && <p className="error-text" role="alert">{error}</p>}<Button disabled={busy || attempted || result?.status !== 'not_started' || !result?.enabled} onClick={send}>Отправить одно письмо с домена</Button><Button variant="outline" disabled={busy} onClick={() => {setError(''); refresh().catch(reason => setError(reason instanceof Error ? reason.message : 'Статус недоступен.'));}}>Обновить статус</Button><p className="micro">Принятие письма провайдером не доказывает его получение. Обновление страницы и статуса не отправляет писем.</p></section></main>;
}
