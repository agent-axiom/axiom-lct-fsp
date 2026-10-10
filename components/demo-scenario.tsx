import {Button} from '@/components/ui/button';

export function DemoScenario({candidate,busy,onCandidateTest,onEmployer,onCandidateInvitations}:{candidate:boolean;busy:boolean;onCandidateTest:()=>void;onEmployer:()=>void;onCandidateInvitations:()=>void}){
 return <details className="demo-scenario" open>
  <summary>Путь демонстрации: от навыков до предложения <span>{candidate?'Сейчас: кандидат':'Сейчас: работодатель'}</span></summary>
  <p>Быстрый показ: откройте подбор, выберите пример запроса и отправьте предложение из карточки. Затем откройте приглашения кандидата и примите его. Тест можно пройти отдельно, без подстановки готовых ответов. Тестовые профили находятся в одном учебном пространстве. Сценарий не подтверждает вход двух реальных пользователей или доставку email.</p>
  <ol className="scenario-steps">
   <li><strong>Профиль и тест</strong><p>Кандидат проходит тест и сохраняет согласие на публикацию. Исходные демо-баллы отдельно помечены как вымышленные.</p><Button variant="outline" disabled={busy} onClick={onCandidateTest}>Открыть тест кандидата</Button></li>
   <li><strong>Подбор и доказательства</strong><p>Готовые примеры запускают настоящий поиск по демо-данным. Работодатель задаёт потребность, раскрывает результаты по навыкам и проверяет недостающие требования.</p><Button variant="outline" disabled={busy} onClick={onEmployer}>Открыть подбор</Button></li>
   <li><strong>Предложение без контакта</strong><p>Из карточки отправьте приглашение с зарплатой. Отправка и просмотр не раскрывают контакт.</p></li>
   <li><strong>Решение кандидата</strong><p>После принятия вернитесь в роль работодателя → «Приглашения», чтобы увидеть открытый контакт. Принятие открывает контакт только этому работодателю при действующем согласии. Отказ или отзыв согласия его не открывает.</p><Button variant="outline" disabled={busy} onClick={onCandidateInvitations}>Открыть приглашения кандидата</Button></li>
  </ol>
 </details>;
}
