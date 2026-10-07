import {PDFDocument,rgb} from 'pdf-lib';
import type { User } from './types';
import fontkit from '@pdf-lib/fontkit';
import {fontBase64} from './profile-font';
export async function makePdf(u:User,{demo=true}:{demo?:boolean}={}){
 const doc=await PDFDocument.create();doc.registerFontkit(fontkit);
 const font=await doc.embedFont(Uint8Array.from(atob(fontBase64),c=>c.charCodeAt(0)),{subset:true});
 let page=doc.addPage([595,842]),y=790;
 const line=(s:string,size=11)=>{if(y<55){page=doc.addPage([595,842]);y=790;}page.drawText(s,{x:45,y,size,font,color:rgb(.08,.08,.15)});y-=size+10;};
 const paragraph=(text:string,size=11)=>{
  const rows:string[]=[];let row='';
  for(const word of text.replace(/[\r\n\t]/g,' ').split(' ')){
   const next=row?row+' '+word:word;if(font.widthOfTextAtSize(next,size)<=500){row=next;continue;}
   if(row)rows.push(row);row='';
   for(const character of word){if(row&&font.widthOfTextAtSize(row+character,size)>500){rows.push(row);row='';}row+=character;}
  }
  if(row)rows.push(row);
  if(rows.length<=3&&y<55+(rows.length-1)*(size+10)){page=doc.addPage([595,842]);y=790;}
  rows.forEach((value,index)=>{if(rows.length-index===2&&y<55+size+10){page=doc.addPage([595,842]);y=790;}line(value,size);});
 };
 line('ФСП / ПРОФИЛЬ КАНДИДАТА',20);line(demo?'Демонстрация. Только синтетические данные.':'Собственный профиль. Экспериментальная оценка навыков.',10);y-=16;
 paragraph(u.name,18);paragraph('Контакт: '+u.contact);line((u.evidence?.status==='synthetic'?'Демо-категория: ':'Учебная категория: ')+(u.categoryConfirmed?u.specialization+' / '+u.grade:'ещё не подтверждена'));
 if(u.evidence?.status==='current'){paragraph('Тест завершён: '+new Date(u.evidence.completedAt!).toLocaleString('ru-RU',{timeZone:'UTC'})+' UTC · банк v'+u.evidence.bankVersion);paragraph('Решено заданий: '+u.evidence.totalCorrect+' из '+u.evidence.totalQuestions);}
 if(u.evidence?.status==='synthetic')paragraph('Исходные демо-баллы заданы вручную. Даты прохождения и измеренных результатов заданий нет.');
 if(u.evidenceSource==='legacy_retest_required')paragraph('Подтверждение устарело после обновления банка. Предыдущий грейд '+u.grade+' сохранён в истории; требуется повторный тест.');
 line(u.evidence?.status==='synthetic'?'Демонстрационный балл: '+u.score+'/100':u.categoryConfirmed?'Результат экспериментального теста: '+u.score+'/100':'Текущий результат: требуется подтверждение тестом');paragraph((u.evidence?.status==='synthetic'?'Демо-стек: ':'Стек по тесту: ')+u.skills.join(', '));for(const item of u.competencyResults||[]){const proof=u.evidence?.status==='current'?u.evidence.skills.find(skill=>skill.skill===item.skill):null;const blockHeight=21+(proof?.applied&&proof.knowledge?20:0)+(proof?.tasks?.length||0)*20;if(y<55+blockHeight){page=doc.addPage([595,842]);y=790;}paragraph(`${item.skill}: ${item.score}/100 · ${item.total?`${item.correct}/${item.total} заданий`:'исходная синтетика'}`);if(proof?.applied&&proof.knowledge)paragraph(`Прикладные: ${proof.applied.correct}/${proof.applied.total}; знания: ${proof.knowledge.correct}/${proof.knowledge.total}`,10);for(const task of proof?.tasks||[])paragraph(`Задание ${task.number} · ${task.kind==='applied'?'прикладное':'знания'} · ${task.score===1?'верно':'неверно'} · ${task.score}/${task.maxScore}`,10);}paragraph('О себе: '+u.about);paragraph('Опыт: '+u.experience+' лет. Навыки общения: '+u.softSkills);
 if(y<180){page=doc.addPage([595,842]);y=790;}paragraph('ФСП: '+(u.fsp?'DEMO-адаптер; не подтверждено официальным реестром':'официальный реестр не подключён'));for(const a of u.fspAchievements||[])paragraph(`${a.title} · ${a.specialization} / ${a.grade} · источник: ${a.provenance}; только синтетическое подтверждение`);paragraph('Демо-достижение влияет только на подбор: до +5 внутри точной категории при совпадении всех требований. Грейд не изменяется.',10);
 line('История тестирования',15);for(const a of u.attempts.slice(0,20))paragraph(`${new Date(a.at).toLocaleDateString('ru-RU')} · ${a.specialization} / ${a.grade} · ${a.invalidated?'без оценки':`${a.score}/100`} · ${a.invalidated?'отменён: банк обновлён':a.passed?'пройден':'не пройден'}${a.stale?' · устаревшая версия банка':''}`);
 if(y<83){page=doc.addPage([595,842]);y=790;}y-=8;paragraph('Результаты учебного банка заданий не доказывают профессиональную пригодность. Реальная интеграция ФСП и экспертная калибровка не подключены.',10);
 return new Uint8Array(await doc.save());
}
