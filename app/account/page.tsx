import {env} from 'cloudflare:workers';
import {requireChatGPTUser} from '@/app/chatgpt-auth';
import {realAccountsConfiguration} from '@/lib/real-accounts.mjs';
import Link from 'next/link';
import AccountPortal from './portal';
export const dynamic='force-dynamic';
export default async function AccountPage(){
 const config=realAccountsConfiguration(env);
 if(!config.accountsEnabled)return <main className="account-landing"><p className="eyebrow">ФСП / ТАЛАНТЫ · СТАТУС</p><h1>Личные аккаунты подготовлены.<br/>Реальные данные пока не принимаются.</h1><p>В новой архитектуре роль закреплена за входом ChatGPT. Контакты, результаты тестов и приглашения хранятся раздельно; email обрабатывает транзакционная очередь.</p><div className="method-note">Отправка почты выключена. Перед включением нужны подтверждённый домен, почтовый провайдер, политика обработки данных и сквозная проверка двух аккаунтов. Наличие кода не означает, что эти подключения уже выполнены.</div><Link className="account-link" href="/">Открыть демонстрацию на вымышленных данных →</Link></main>;
 await requireChatGPTUser('/account');return <AccountPortal/>;
}
