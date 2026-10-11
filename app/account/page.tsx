import {env} from 'cloudflare:workers';
import {publicEmailAuthConfiguration} from '@/lib/public-email-auth.mjs';
import Link from 'next/link';
import AccountPortal from './portal';
import {accountOrigin} from './origin';
export const dynamic='force-dynamic';
export default function AccountPage(){
 const config=publicEmailAuthConfiguration(env);
 if(!config.accountsEnabled||!config.emailAuthEnabled)return <main className="account-landing"><p className="eyebrow">ФСП / ТАЛАНТЫ · СТАТУС</p><h1>Личные аккаунты подготовлены.<br/>Вход по email пока не включён.</h1><p>Демонстрация работает на вымышленных данных и доступна без регистрации. Реальные данные пока не принимаются.</p><Link className="account-link" href="/">Открыть демонстрацию →</Link></main>;
 return <AccountPortal canonicalOrigin={accountOrigin(config.siteOrigin)}/>;
}
