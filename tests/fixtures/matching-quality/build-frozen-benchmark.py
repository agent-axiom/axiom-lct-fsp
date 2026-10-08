"""Author-declared synthetic data/rubric. Does not import or execute FSP matching."""
import json, hashlib, shutil
from pathlib import Path
from datetime import datetime, timezone
ROOT=Path(__file__).parent
SOURCE=Path('/workspace/scratch/e0f6dc00ff6f/fsp-source-recovery')

def achievement(cid,spec,grade,kind='winner',verified=True,provenance='synthetic_seed',points=None):
    a={'id':'DEMO-ACH-'+cid,'title':'DEMO · синтетическое соревнование '+spec,'provenance':provenance,'verified':verified,'specialization':spec,'grade':grade,'resultType':kind,'points':points if points is not None else {'winner':100,'finalist':70,'participant':20}[kind]}
    if verified is None: del a['verified']
    return a

def profile(cid,spec,grade,score,skills,years,ach=None,**flags):
    p={'id':cid,'name':'DEMO · '+cid,'role':'candidate','specialization':spec,'grade':grade,'score':score,'skills':skills.split('|'),'experience':years,'verified':True,'published':True,'consent':True,'categoryConfirmed':True,'evidenceSource':'synthetic_seed','fsp':bool(ach),'fspAchievements':ach or [],'about':'DEMO · Полностью вымышленный профиль. Навыки в skills считаются подтверждёнными только внутри синтетического сценария.','annotation':flags.pop('annotation','Синтетический профиль для авторского benchmark; не реальный человек.')}
    p.update(flags)
    p['competencyResults']=[{'skill':s,'score':score,'correct':None,'total':None,'confirmed':p['categoryConfirmed']} for s in p['skills']]
    return p
B='Backend'; F='Frontend'; J='Junior'; M='Middle'; S='Senior'
profiles=[
 profile('bj-py-award',B,J,78,'Python|SQL|HTTP',1,[achievement('bj-py-award',B,J)]),
 profile('bj-py-none',B,J,78,'Python|SQL|HTTP',1,annotation='Контроль к bj-py-award: та же категория, тест, стек и стаж; достижений нет.'),
 profile('bj-go',B,J,91,'Go|SQL|HTTP',2,[achievement('bj-go',B,J)]),
 profile('bj-py-unverified',B,J,78,'Python|SQL|HTTP',1,[achievement('bj-py-unverified',B,J,verified=False)],annotation='Заявленное, но неподтверждённое достижение. Не основание для бонуса.'),
 profile('bj-py-cross',B,J,78,'Python|SQL|HTTP',1,[achievement('bj-py-cross',F,J)],annotation='Достижение другой специализации. Не усиливает категорию Backend Junior.'),
 profile('bj-category-missing',B,J,99,'Python|SQL|HTTP',1,categoryConfirmed=False,annotation='Категория не подтверждена; профиль не допускается к выдаче.'),
 profile('bm-py-award',B,M,84,'Python|SQL|HTTP|Docker',4,[achievement('bm-py-award',B,M,'finalist')]),
 profile('bm-py-none',B,M,84,'Python|SQL|HTTP|Docker',4,annotation='Контроль к bm-py-award: совпадают категория, тест, стек и стаж.'),
 profile('bm-java',B,M,95,'Java|SQL|HTTP',5,[achievement('bm-java',B,M)]),
 profile('bm-postgres',B,M,87,'Python|PostgreSQL|HTTP|Docker',3.5,annotation='PostgreSQL и SQL размечены разными подтверждёнными навыками; обобщение без отдельного подтверждения не предполагается.'),
 profile('bm-about-only',B,M,96,'SQL|HTTP',6,fsp=True,about='DEMO · В самоописании: Python Kubernetes Rust, чемпион ФСП.',annotation='Самоописание не подтверждает Python/Kubernetes/Rust. linked-флаг без записи достижения ничего не доказывает.'),
 profile('bm-email-missing',B,M,97,'Python|SQL|HTTP|Docker',4,verified=False,annotation='Не подтверждён адрес; профиль не допускается к выдаче.'),
 profile('bs-py-award',B,S,92,'Python|SQL|HTTP|Docker|Kubernetes',8,[achievement('bs-py-award',B,S)]),
 profile('bs-py-none',B,S,92,'Python|SQL|HTTP|Docker|Kubernetes',8,annotation='Сильный подтверждённый тест без истории ФСП. Не должен теряться из выдачи.'),
 profile('bs-go',B,S,98,'Go|SQL|HTTP|Kubernetes',9,[achievement('bs-go',B,S)]),
 profile('bs-py-core',B,S,83,'Python|SQL|HTTP',5,[achievement('bs-py-core',B,S,'participant')]),
 profile('bs-java',B,S,90,'Java|Kotlin|SQL|HTTP',6,[achievement('bs-java',B,S,verified=None)],annotation='У записи достижения отсутствует verified; это не verified=true.'),
 profile('bs-no-consent',B,S,100,'Python|SQL|HTTP|Docker|Kubernetes',8,consent=False,annotation='Нет согласия на публикацию; не допускается к выдаче.'),
 profile('fj-react-award',F,J,80,'React|TypeScript|CSS|Accessibility',1,[achievement('fj-react-award',F,J,'finalist')]),
 profile('fj-react-none',F,J,80,'React|TypeScript|CSS|Accessibility',1,annotation='Контроль к fj-react-award: совпадают категория, тест, стек и стаж.'),
 profile('fj-js',F,J,88,'JavaScript|CSS|Accessibility',1,[achievement('fj-js',F,J)]),
 profile('fj-react-cross-grade',F,J,78,'React|TypeScript|CSS',0.5,[achievement('fj-react-cross-grade',F,M)],annotation='Достижение другого грейда не усиливает текущую категорию Junior.'),
 profile('fj-about-only',F,J,96,'CSS|Accessibility',2,[achievement('fj-about-only',F,J,verified=False)],about='DEMO · В самоописании: Senior React TypeScript.',annotation='Самоописание не меняет Junior и не подтверждает React/TypeScript.'),
 profile('fj-hidden',F,J,99,'React|TypeScript|CSS|Accessibility',1,published=False,annotation='Профиль скрыт; не допускается к выдаче.'),
 profile('fm-react-award',F,M,86,'React|TypeScript|CSS|Accessibility',4,[achievement('fm-react-award',F,M)]),
 profile('fm-react-none',F,M,86,'React|TypeScript|CSS|Accessibility',4,annotation='Контроль к fm-react-award: совпадают категория, тест, стек и стаж.'),
 profile('fm-js',F,M,95,'JavaScript|CSS|Accessibility',5,[achievement('fm-js',F,M)]),
 profile('fm-react-short',F,M,90,'React|TypeScript',2.5),
 profile('fm-react-unverified',F,M,86,'React|TypeScript|CSS|Accessibility',4,[achievement('fm-react-unverified',F,M,verified=False)]),
 profile('fm-react-cross',F,M,86,'React|TypeScript|CSS|Accessibility',4,[achievement('fm-react-cross',B,M)],annotation='Достижение другой специализации при том же грейде.'),
 profile('fs-react-award',F,S,93,'React|TypeScript|CSS|Accessibility',8,[achievement('fs-react-award',F,S,'finalist')]),
 profile('fs-react-none',F,S,93,'React|TypeScript|CSS|Accessibility',8),
 profile('fs-js',F,S,97,'JavaScript|CSS|Accessibility',10,[achievement('fs-js',F,S)]),
 profile('fs-react-nocss',F,S,89,'React|TypeScript',5,[achievement('fs-react-nocss',F,S,provenance='self_reported')],annotation='verified=true от самозаявленного источника не считается проверенным DEMO-достижением.'),
 profile('fs-css',F,S,85,'CSS|Accessibility',6,[achievement('fs-css',F,S)]),
 profile('fs-category-missing',F,S,99,'React|TypeScript|CSS|Accessibility',8,categoryConfirmed=False,annotation='Категория не подтверждена; не допускается к выдаче.'),
]

queries=[]
def q(qid,split,need,spec=None,grade=None,skills=(),**kwargs):
    filters=kwargs.pop('filters',{})
    intent={'specialization':spec,'grade':grade,'requiredSkills':list(skills),'minimumExperience':kwargs.pop('minimum',None),'allowedGrades':kwargs.pop('allowedGrades',[]),'anyOfSkills':kwargs.pop('anyOf',[]),'ignoredTerms':kwargs.pop('ignored',[]),'strengthPreference':kwargs.pop('strength',False)}
    queries.append({'id':qid,'split':split,'need':need,**filters,'tags':kwargs.pop('tags',[]),'intent':intent,'labelRationale':kwargs.pop('reason','Приоритет подтверждённой категории и обязательного стека; самоописание не заменяет подтверждение.'),'parserExpectations':kwargs.pop('expect',{}),**kwargs})

q('t01-junior-backend','train','Нужен Junior Backend разработчик: Python SQL',B,J,['Python','SQL'],tags=['exact-category','wrong-stack'])
q('t02-middle-python-docker','train','Middle Backend: Python SQL Docker',B,M,['Python','SQL','Docker'],tags=['multi-skill','wrong-stack'])
q('t03-senior-go','train','Senior Backend Go Kubernetes',B,S,['Go','Kubernetes'],tags=['sparse-relevance','wrong-stack'])
q('t04-react-typescript','train','Frontend React TypeScript',F,None,['React','TypeScript'],tags=['grade-unspecified'])
q('t05-junior-accessible','train','Junior Frontend CSS Accessibility',F,J,['CSS','Accessibility'],tags=['exact-category'])
q('t06-middle-front-strength','train','Middle Frontend React TypeScript; сначала сильные подтверждённые результаты и достижения ФСП в этой категории',F,M,['React','TypeScript'],strength=True,tags=['same-category-achievement','missing-verification','cross-category'],reason='Авторский strength-срез: точная категория и стек обязательны; сильный тест или подтверждённое scoped-достижение различают 3 и 2.')
q('t07-senior-back-strength','train','Senior Backend Python SQL; сильные результаты теста и подтверждённые достижения ФСП',B,S,['Python','SQL'],strength=True,tags=['strong-without-fsp','same-category-achievement'])
q('t08-explicit-filters','train','Python SQL',B,M,['Python','SQL'],filters={'specialization':B,'grade':M,'skills':'Python, SQL'},tags=['hard-filters','sparse-relevance'])
q('t09-experience-five','train','Frontend от 5 лет',F,None,minimum=5,tags=['experience-boundary'])
q('t10-backend-java','train','Backend Java SQL',B,None,['Java','SQL'],tags=['wrong-stack','sparse-relevance'])
q('t11-optional-docker','train','Middle Backend Python; Docker необязателен',B,M,['Python'],ignored=['Docker'],tags=['optional'],expect={'nonRequiredSkills':['Docker']})
q('t12-negated-sql','train','Junior Backend Python; SQL не требуется',B,J,['Python'],ignored=['SQL'],tags=['negated-skill'],reason='«SQL не требуется» снимает требование, но не запрещает наличие навыка у кандидата.',expect={'nonRequiredSkills':['SQL']})

q('d01-russian-alias','development','Ищем мидла бэкендера на питоне; SQL обязателен',B,M,['Python','SQL'],tags=['russian-alias'])
q('d02-optional-typescript','development','Senior Frontend React; TypeScript желателен',F,S,['React'],ignored=['TypeScript'],tags=['optional'],expect={'nonRequiredSkills':['TypeScript']})
q('d03-alternative-backend','development','Backend; Python или Go; SQL обязателен',B,None,['SQL'],anyOf=[['Python','Go']],tags=['alternative-skill'],reason='«Python или Go» означает достаточно одного; эти навыки нельзя превратить в обязательное И.',expect={'requiresWarning':True,'reason':'Ограниченный parser может не применять OR; это должно быть раскрыто.'})
q('d04-negated-role','development','Не Backend. Нужен Frontend React TypeScript',F,None,['React','TypeScript'],ignored=['Backend'],tags=['negated-role'])
q('d05-filter-precedence','development','Senior Frontend Python',B,M,['Python'],filters={'specialization':B,'grade':M},tags=['conflicting-text-filter'],reason='Явные фильтры Backend/Middle имеют приоритет над специализацией и грейдом в тексте.',expect={'requiresWarning':True,'reason':'Конфликт текста с явными фильтрами.'})
q('d06-decimal-experience','development','Backend Python от 3,5 лет',B,None,['Python'],minimum=3.5,tags=['experience-boundary','decimal'])
q('d07-zero-experience','development','Junior Frontend от 0 лет',F,J,minimum=0,tags=['experience-zero'])
q('d08-unknown-required-stack','development','Middle Backend Rust',B,M,['Rust'],tags=['unknown-stack','no-relevant-items'],reason='Rust указан явно; ни у одного допущенного профиля он не подтверждён. Самоописание не заменяет подтверждение.',expect={'manualReviewTerms':['Rust'],'reason':'Нельзя считать нераспознанное обязательное слово удовлетворённым.'})
q('d09-unneeded-kubernetes','development','Frontend React TypeScript; Kubernetes не нужен',F,None,['React','TypeScript'],ignored=['Kubernetes'],tags=['negated-skill','boundary-stack'],expect={'nonRequiredSkills':['Kubernetes']})
q('d10-middle-back-strength','development','Backend Middle Python SQL; выше подтверждённые достижения ФСП той же категории и сильные тесты',B,M,['Python','SQL'],strength=True,tags=['same-category-achievement','flag-only'])
q('d11-junior-front-strength','development','Frontend Junior React TypeScript; сильный тест и подтверждённые достижения ФСП в категории',F,J,['React','TypeScript'],strength=True,tags=['same-category-achievement','cross-grade','missing-verification'])
q('d12-junior-back-strength','development','Backend Junior Python SQL; приоритет подтверждённых результатов и достижений ФСП этой категории',B,J,['Python','SQL'],strength=True,tags=['same-category-achievement','cross-category','missing-verification'])

q('h01-senior-platform-stack','heldout','Senior Backend Python SQL Docker Kubernetes',B,S,['Python','SQL','Docker','Kubernetes'],tags=['full-stack','wrong-stack'])
q('h02-junior-react-accessibility','heldout','Junior Frontend React CSS Accessibility',F,J,['React','CSS','Accessibility'],tags=['stack-combination','missing-skill'])
q('h03-middle-javascript','heldout','Middle Frontend JavaScript CSS',F,M,['JavaScript','CSS'],tags=['wrong-stack','language-token-boundary'])
q('h04-senior-accessible-strength','heldout','Senior Frontend CSS Accessibility; сильные тесты и подтверждённые достижения ФСП в этой категории',F,S,['CSS','Accessibility'],strength=True,tags=['same-category-achievement','strong-without-fsp'])
q('h05-postgres-not-sql','heldout','Backend Middle Python PostgreSQL HTTP',B,M,['Python','PostgreSQL','HTTP'],tags=['near-stack','token-boundary'],reason='Подтверждённый SQL не доказывает PostgreSQL, и наоборот; требуется конкретный перечисленный стек.')
q('h06-jvm-senior','heldout','Senior Backend Java Kotlin',B,S,['Java','Kotlin'],tags=['wrong-stack','sparse-relevance','missing-verification'])
q('h07-half-year-boundary','heldout','Frontend React TypeScript, не менее 2,5 лет',F,None,['React','TypeScript'],minimum=2.5,tags=['decimal','experience-boundary'])
q('h08-optional-list','heldout','Backend SQL; Python и Docker необязательны',B,None,['SQL'],ignored=['Python','Docker'],tags=['optional-list','negation-scope'],expect={'nonRequiredSkills':['Python','Docker']})
q('h09-negated-role-positive-grade','heldout','Backend Python; Frontend не нужен; грейд Senior',B,S,['Python'],ignored=['Frontend'],tags=['negated-role','clause-boundary'])
q('h10-alternative-grade','heldout','Frontend; Middle или Senior; React TypeScript',F,None,['React','TypeScript'],allowedGrades=[M,S],tags=['alternative-grade','ambiguous'],reason='Разрешены два указанных грейда; Junior не удовлетворяет альтернативе. Нельзя превращать OR в один случайный грейд.',expect={'requiresWarning':True,'reason':'Неподдерживаемый диапазон грейдов должен быть явно отмечен.'})
q('h11-excluded-specialization','heldout','Исключить Backend. Нужен Frontend Middle React',F,M,['React'],ignored=['Backend'],tags=['excluded-role','hard-negative'])
q('h12-conflicting-experience','heldout','Backend Middle Python SQL; опыт от 5 до 3 лет',B,M,['Python','SQL'],tags=['contradictory-range','manual-review'],reason='Противоречивый диапазон стажа требует уточнения. Только эта часть запроса не участвует в автоматической пригодности; категория и стек остаются действующими.',expect={'requiresWarning':True,'expectedMinExperience':None,'reason':'Невозможный диапазон 5..3 лет.'})

levels={J:0,M:1,S:2}
def eligible(c): return all(c.get(k) is True for k in ['verified','published','consent','categoryConfirmed'])
def scoped_achievement(c):
    return c['fsp'] is True and any(a.get('verified') is True and a.get('provenance')=='synthetic_seed' and a.get('specialization')==c['specialization'] and a.get('grade')==c['grade'] and a.get('resultType') in ['winner','finalist','participant'] and type(a.get('points')) in [int,float] and 0<a['points']<=100 for a in c['fspAchievements'])
def label(c,q):
    i=q['intent']; why=[]
    if not eligible(c): return 0,['Не выполнены обязательные условия видимости/подтверждения профиля.']
    for key in ['specialization','grade']:
        if q.get(key) and c[key]!=q[key]: return 0,['Не совпадает явный жёсткий фильтр '+key+'.']
    explicit=[s.strip() for s in q.get('skills','').split(',') if s.strip()]
    if not set(explicit)<=set(c['skills']): return 0,['Не выполнен явный фильтр skills.']
    if i['specialization'] and c['specialization']!=i['specialization']: return 0,['Другая специализация.']
    if i['allowedGrades'] and c['grade'] not in i['allowedGrades']: return 0,['Грейд не входит в явно допустимую альтернативу.']
    required=set(i['requiredSkills']); actual=set(c['skills']); missing=required-actual
    if required and not(required & actual): return 0,['Ни один обязательный подтверждённый навык не совпадает.']
    if any(not (set(group)&actual) for group in i['anyOfSkills']): return 0,['Нет ни одной подтверждённой альтернативы в обязательной OR-группе.']
    penalties=0
    if missing:
        penalties+=1 if len(missing)*2<=len(required) else 2
        why.append('Не подтверждены: '+', '.join(sorted(missing))+'.')
    if i['grade'] and c['grade']!=i['grade']:
        distance=abs(levels[c['grade']]-levels[i['grade']]);penalties+=distance
        why.append('Запрошен '+i['grade']+', подтверждён '+c['grade']+'.')
    minimum=i['minimumExperience']
    if minimum is not None and c['experience']<minimum:
        penalties+=1 if c['experience']>=minimum/2 else 2
        why.append('Самоописанный стаж ниже указанного минимума; требует проверки.')
    if penalties: return max(1,3-penalties),why
    if i['strengthPreference']:
        if c['score']>=90: return 3,['Все условия совпадают; сильный результат теста (>=90) достаточен без ФСП.']
        if c['score']>=75 and scoped_achievement(c): return 3,['Все условия совпадают; достаточный тест (>=75) и scoped verified DEMO-достижение.']
        return 2,['Все условия совпадают; нет основания для высшего авторского уровня силы профиля.']
    return 3,['Все применимые обязательные условия совпадают.']

for query in queries:
    pairs={c['id']:label(c,query) for c in profiles}
    query['relevance']={cid:v[0] for cid,v in pairs.items()}
    query['rationales']={cid:v[1] for cid,v in pairs.items()}
    vals=list(query['relevance'].values())
    query['annotationStats']={'relevantAtThreshold2':sum(v>=2 for v in vals),'nonzeroRelevance':sum(v>0 for v in vals),'precisionAt5Ceiling':min(5,sum(v>=2 for v in vals))/5,'hasPositiveIdealDcg':any(vals)}

now=datetime.now(timezone.utc).isoformat()
fixture={'schemaVersion':'fsp-author-benchmark-1.0','name':'FSP · замороженный авторский синтетический benchmark v1','language':'ru','createdAt':now,'frozenBeforeScoreInspection':True,'disclaimer':'36 синтетических профилей и 36 авторских запросов. Разметка выводится из заранее объявленной авторской рубрики, а не из оценок matcher. Нет независимой экспертной разметки, реальных наймов, психометрической или внешней валидации. heldout означает отложенные запросы, а не неизвестных людей или секретные данные.','authoringMethod':'Автор задал профили, семантические intent и рубрику; helper механически развернул рубрику в полные labels и объяснения. Результаты алгоритма при разметке не запускались.','baselineFixtureSha256':hashlib.sha256((SOURCE/'tests/fixtures/matching-benchmark.json').read_bytes()).hexdigest(),'labelRubric':{'0':'Не допускается к поиску, нарушен явный фильтр/специализация/допустимые грейды, либо не совпал ни один обязательный навык или вся OR-группа.','1':'Маргинальный вариант: минимум два штрафа несовпадения; не считать релевантным кандидатом в основной P@5.','2':'Частично релевантный: один штраф несовпадения; либо полное соответствие, но не высшая сила профиля в strength-срезе.','3':'Полное соответствие; в strength-срезе дополнительно тест >=90 либо тест >=75 и корректное scoped DEMO-достижение.','penalties':'Одна ступень грейда=1, две=2. Отсутствует не более половины навыков=1, больше половины=2 (ноль совпадений=0 label). Стаж ниже минимума, но >=половины=1, ещё ниже=2. Итог max(1,3-сумма). Явный фильтр всегда жёсткий.','scoreInterpretation':'Тестовый балл условный, внутри объявленной категории; Junior 95 не доказывает Senior. Порог силы 90/75 является авторским выбором, не валидированной оценкой найма.'},'splitPolicy':{'train':'12 запросов доступны для настройки.','development':'12 отдельных запросов для выбора варианта; не включать в независимое подтверждение.','heldout':'12 запросов заморожены до изменений и первого просмотра результатов; использовать один раз после фиксации варианта. Если по ним донастраивали, честно переименовать в development и собрать новый holdout.','unit':'Разделяются запросы; пул кандидатов общий. Семантические категории пересекаются, поэтому это не независимый distribution shift.'},'metricDefinitions':{'precisionAt5':'Основная: число labels>=2 в первых пяти позициях /5; незаполненные позиции нерелевантны.','legacyPrecisionAt5':'Дополнительная для совместимости: число labels>0 /5. Не смешивать с основной.','ndcgAt5':'DCG=sum((2^label-1)/log2(rank+1)); IDCG по всем размеченным кандидатам. При IDCG=0 вернуть null и исключить только из среднего NDCG, указав число таких запросов.','precisionCeiling':'min(5, число labels>=2)/5. Низкая P@5 при маленьком релевантном пуле не всегда означает ошибку ранжирования.','aggregation':'Макро-средние отдельно по train/development/heldout и по всем; heldout является основной отложенной оценкой. Не выводить статистическую значимость на этом размере.'},'achievementContract':{'field':'fspAchievements','validSyntheticEntry':{'provenance':'synthetic_seed','verified':True,'specialization':['Backend','Frontend'],'grade':['Junior','Middle','Senior'],'resultType':['winner','finalist','participant'],'points':{'minimum':0,'maximum':100},'titlePrefix':'DEMO ·'},'note':'Некорректные по доверию записи оставлены как явные adversarial fixtures (verified=false, отсутствующий verified, self_reported, чужая категория). Все points числовые в диапазоне 0..100. Никакой реальной проверки ФСП нет.'},'candidates':profiles,'queries':queries}
assert len(profiles)==36 and len(queries)==36
assert len({c['id'] for c in profiles})==36 and len({q['id'] for q in queries})==36
assert all(len(q['relevance'])==36 and set(q['relevance'].values())<=set(range(4)) for q in queries)
assert all(sum(q['split']==s for q in queries)==12 for s in ['train','development','heldout'])
assert all(0<=a['points']<=100 and a['title'].startswith('DEMO ·') for c in profiles for a in c['fspAchievements'])
(ROOT/'matching-benchmark.frozen.json').write_text(json.dumps(fixture,ensure_ascii=False,indent=2)+'\n')
shutil.copyfile(SOURCE/'tests/fixtures/matching-benchmark.json',ROOT/'matching-benchmark.original.json')
# Immutable bytes, simple verifier is generated independently of ranking source.
files=['matching-benchmark.frozen.json','matching-benchmark.original.json','build-frozen-benchmark.py']
manifest={'frozenAt':now,'scoreInspectionBeforeFreeze':False,'sourceMatcherSha256':hashlib.sha256((SOURCE/'lib/matching.mjs').read_bytes()).hexdigest(),'files':{name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in files},'statistics':{'profiles':36,'eligibleProfiles':sum(eligible(c) for c in profiles),'queries':36,'labeledPairs':1296,'splitCounts':{s:12 for s in ['train','development','heldout']},'strengthQueries':sum(q['intent']['strengthPreference'] for q in queries),'zeroIdealQueries':[q['id'] for q in queries if not q['annotationStats']['hasPositiveIdealDcg']],'achievementEntries':sum(len(c['fspAchievements']) for c in profiles),'labelDistribution':{str(v):sum(x==v for q in queries for x in q['relevance'].values()) for v in range(4)}}}
(ROOT/'freeze-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(manifest,ensure_ascii=False,indent=2))
