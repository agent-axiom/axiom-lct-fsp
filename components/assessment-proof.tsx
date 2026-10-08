import type {AssessmentEvidence} from '@/lib/types';

export function AssessmentProof({evidence,requiredSkills=[]}:{evidence?:AssessmentEvidence;requiredSkills?:string[]}){
 const date=evidence?.completedAt?new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(evidence.completedAt):null;
 return <details className="assessment-proof">
  <summary>Доказательства навыков <span>{evidence?.status==='current'?'Результат теста':evidence?.status==='synthetic'?'Демо-данные':evidence?.status==='stale'?'Нужен новый тест':'Нет подтверждения'}</span></summary>
  <div className="proof-content">
   {evidence?.status==='current'?<>
    <div className="proof-heading"><strong>{evidence.totalCorrect} из {evidence.totalQuestions} заданий</strong><span>{evidence.score}/100</span></div>
    <p className="proof-meta">{evidence.specialization} / {evidence.grade} · банк v{evidence.bankVersion}<br/>Завершён {date} UTC</p>
    <ul className="proof-skills">{evidence.skills.map(skill=><li key={skill.skill}>
     <div><strong>{skill.skill}</strong>{requiredSkills.includes(skill.skill)&&<span className="proof-required">В запросе</span>}<span>{skill.correct}/{skill.total} · {skill.score}/100</span></div>
     <p>{skill.applied&&skill.knowledge?`Прикладные: ${skill.applied.correct}/${skill.applied.total} · знания: ${skill.knowledge.correct}/${skill.knowledge.total}`:'Разбивка по типам заданий в этой попытке не сохранялась.'}</p>
     {skill.tasks&&<details className="proof-tasks"><summary>Задания и результаты</summary><ul>{skill.tasks.map(task=><li key={task.number}><span>Задание {task.number} · {task.kind==='applied'?'прикладное':'знания'}</span><strong className={task.score?'positive':'error-text'}>{task.score===1?'Верно':'Неверно'} · {task.score}/{task.maxScore}</strong></li>)}</ul></details>}
    </li>)}</ul>
    <p className="proof-meta">Порог банка: от 75/100 и минимум 2 из 3 в каждом навыке. Стаж и самоописание не подтверждаются этим тестом.</p>
   </>:<p>{evidence?.status==='synthetic'?'Исходный вымышленный профиль. Баллы заданы для демонстрации; даты прохождения и измеренных результатов заданий нет.':evidence?.status==='stale'?'Банк обновлён. Предыдущая история сохранена, но для текущего подтверждения нужен новый тест.':'Нет доступной завершённой попытки, которая подтверждает эти сведения.'}</p>}
   <p className="proof-limit">{evidence?.limitation||'Учебный банк: результат не доказывает профессиональную пригодность.'}</p>
  </div>
 </details>;
}
