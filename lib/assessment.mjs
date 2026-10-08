// A transparent demonstration bank, not a psychometrically validated assessment.
export const ASSESSMENT_VERSION = 4;
export const SKILL_PASS = 2 / 3;
export const TEST_MINUTES = 30;
export const BLUEPRINT = {
  Backend: ['Python', 'SQL', 'HTTP', 'Algorithms'],
  Frontend: ['TypeScript', 'React', 'CSS', 'Accessibility'],
};
const grades = ['Junior', 'Middle', 'Senior'];
const q = (text, answer, alternatives = []) => {
  const item = { text, answer: /Напишите id/.test(text)?String(answer):String(answer).toLowerCase(), alternatives: alternatives.map(String), format: typeof answer === 'number' ? 'number' : 'text', ...(/Напишите id/.test(text)?{caseSensitive:true}:{}) };
  const pair = text.match(/:\s*([^:]+?)\s+или\s+(.+?)\?/);
  if (/да\/нет$/.test(text)) { item.text = text.replace(/\s*да\/нет$/, ''); item.choices = ['да', 'нет']; }
  else if (pair && [pair[1], pair[2]].some(value => [item.answer,...item.alternatives].some(answer => normalizeAnswer(answer) === normalizeAnswer(value)))) {
    item.text = text.slice(0, pair.index) + '?'; item.choices = [pair[1], pair[2]];
  }
  return item;
};
function random(seed) { let x = Number(seed) >>> 0; return () => { x += 0x6D2B79F5; let t = Math.imul(x ^ x >>> 15, 1 | x); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function shuffle(items, rng) { const a = [...items]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function pool(skill, level, n, m) {
  const size = n + m;
  const banks = {
    Python: [
      [q(`Python: чему равно sum(range(${n}))?`, n * (n - 1) / 2), q(`Python: чему равно len(set([${n}, ${m}, ${n}]))?`, n === m ? 1 : 2), q(`Python: результат ${size} // ${m}?`, Math.floor(size / m)), q(`Python: результат [x * 2 for x in range(${n})][-1]?`, (n - 1) * 2)],
      [q(`Python: генератор g = (x for x in range(${n})); next(g); чему равно sum(g)?`, n * (n - 1) / 2), q(`Python: a = [${n}]; b = a; b.append(${m}); чему равно len(a)?`, 2), q(`Python: d = {'a': ${n}}; результат d.get('b', ${m})?`, m), q('Python: какой контекст гарантирует закрытие файла при исключении: with или if?', 'with')],
      [q('Python: какую очередь стандартной библиотеки используют для безопасного обмена между потоками: queue.Queue или обычный list?', 'queue.queue', ['queue']), q('Python: что позволяет не блокировать event loop при ожидании asyncio-задачи: await или time.sleep?', 'await'), q(`Python: итератор iter(range(${n})) полностью исчерпан. Какое исключение даст next без default?`, 'stopiteration'), q('Python: какой тип для ресурса предпочтительнее в гарантированном cleanup: context manager или глобальная переменная?', 'context manager', ['контекстный менеджер'])],
    ],
    SQL: [
      [q(`SQL: ${n} строк amount=10 и ${m} строк amount=20. Значение SUM(amount)?`, n * 10 + m * 20), q(`SQL: таблица из ${size} строк, ${m} значений NULL в столбце email. Значение COUNT(email)?`, n), q('SQL: каким оператором фильтруют строки до группировки: WHERE или HAVING?', 'where'), q(`SQL: значения id: ${n}, ${m}, ${n}. Сколько строк вернёт SELECT DISTINCT id?`, n === m ? 1 : 2)],
      [q(`SQL: ${n} клиентов, у каждого ${m} заказов. Сколько строк даст INNER JOIN по client_id?`, n * m), q('SQL: каким условием находят NULL: IS NULL или = NULL?', 'is null'), q('SQL: какой тип JOIN сохранит все строки левой таблицы без совпадений справа: LEFT или INNER?', 'left', ['left join']), q(`SQL: значения amount: ${n}, ${m}, NULL. Значение COALESCE(SUM(amount), 0)?`, n + m)],
      [q('SQL: какой уровень изоляции предотвращает write skew: snapshot или serializable?', 'serializable'), q('SQL: составной B-tree индекс (a,b). Какое поле образует ведущий префикс: a или b?', 'a'), q('SQL: что обеспечивает атомарное изменение нескольких строк: транзакция или OFFSET?', 'транзакция', ['transaction']), q(`SQL: ${n} записей имеют одинаковый score. Гарантирует ли ORDER BY score стабильную пагинацию без уникального tie-breaker? да/нет`, 'нет', ['no'])],
    ],
    HTTP: [
      [q('HTTP: код ответа для отсутствующего ресурса?', 404), q('HTTP: код успешного создания ресурса?', 201), q('HTTP: какой метод предназначен для чтения: GET или POST?', 'get'), q('HTTP: какой статус означает, что запрос к защищённому ресурсу не содержит действительных учётных данных?', 401)],
      [q('HTTP: какой метод идемпотентен по семантике: PUT или POST?', 'put'), q('HTTP: какой заголовок сообщает тип тела: Content-Type или Host?', 'content-type'), q('HTTP: какой код обычно означает конфликт версии записи?', 409), q('HTTP: какой код означает превышение лимита запросов?', 429)],
      [q('HTTP: какой заголовок проверяет ETag перед изменением: If-Match или Accept?', 'if-match'), q('HTTP: какой механизм предотвращает повторную оплату при ретрае POST: idempotency key или случайный URL?', 'idempotency key', ['ключ идемпотентности']), q('HTTP: какой заголовок задаёт рекомендованную задержку повтора после 429: Retry-After или Referer?', 'retry-after'), q('HTTP: код успешного условного GET без изменённого тела?', 304)],
    ],
    Algorithms: [
      [q(`В массиве ${size} элементов. Число сравнений полного линейного поиска отсутствующего значения?`, size), q('Средняя сложность поиска по ключу в хеш-таблице: O(1) или O(n)?', 'o(1)'), q(`Два вложенных цикла по ${n} и ${m} итераций. Сколько выполнений тела?`, n * m), q('Какая структура работает по FIFO: очередь или стек?', 'очередь', ['queue'])],
      [q(`Пул имеет ${n} соединений, запрос занимает 100 мс. Теоретический максимум запросов/с без накладных расходов?`, n * 10), q('Сложность бинарного поиска в отсортированном массиве: O(log n) или O(n)?', 'o(log n)', ['o(logn)']), q(`Два последовательных цикла по ${n} и ${m} итераций. Сколько выполнений тела всего?`, size), q('Какая структура подходит для посещённых вершин при обходе графа: set или очередь повторов?', 'set', ['множество'])],
      [q('Какой механизм нужен обработчику повторной доставки: идемпотентность или случайная задержка?', 'идемпотентность'), q(`Сервис принимает ${n * 100} задач/с и завершает ${m * 10} задач/с. Прирост очереди в секунду?`, n * 100 - m * 10), q('Какой подход ограничивает перегрузку потребителя: backpressure или неограниченная очередь?', 'backpressure', ['обратное давление']), q('Какой порядок взятия двух mutex снижает риск deadlock: единый глобальный или случайный?', 'единый глобальный', ['единый'])],
    ],
    TypeScript: [
      [q(`TypeScript: [${n}, ${n + 1}, ${n + 2}, ${n + 3}].filter(x => x > ${n + m % 3}).length?`, 3 - m % 3), q(`TypeScript: [${n}, ${m}].reduce((sum, x) => sum + x, 0)?`, size), q('TypeScript: какое значение означает отсутствие результата функции: void или string?', 'void'), q(`JavaScript/TypeScript: чему равно ${n} % ${m}?`, n % m)],
      [q('TypeScript: какой тип требует проверки перед использованием неизвестного значения: unknown или any?', 'unknown'), q('TypeScript: чем сузить string | number до строки: typeof x === "string" или Number(x)? Напишите typeof или Number.', 'typeof'), q(`TypeScript: const a = [${n}]; const b = [...a, ${m}]; чему равно a.length?`, 1), q('TypeScript: что сохраняет литеральные типы объекта: as const или as any?', 'as const')],
      [q('TypeScript: какой тип используется для проверки исчерпывающего switch: never или object?', 'never'), q('TypeScript: какая конструкция различает ветви union по полю kind: discriminated union или any?', 'discriminated union', ['дискриминированное объединение']), q('TypeScript: что проверяет структуру без замены выведенного типа: satisfies или as any?', 'satisfies'), q('TypeScript: гарантирует ли тип interface проверку JSON во время выполнения? да/нет', 'нет', ['no'])],
    ],
    React: [
      [q('React: какой hook хранит локальное состояние: useState или useRefetch?', 'usestate'), q('React: какое свойство задаёт обработчик клика: onClick или onclicked?', 'onclick'), q('React: можно ли напрямую изменять объект state вместо setter? да/нет', 'нет', ['no']), q('React: что обычно передаёт данные от родителя ребёнку: props или SQL?', 'props')],
      [q('React: какой prop задаёт стабильный идентификатор элемента списка: key или indexOf?', 'key'), q('React: где вернуть функцию очистки подписки: useEffect или render?', 'useeffect'), q(`React: начальный count=${n}; два setCount(c => c + ${m}). Итоговый count?`, n + 2 * m), q('React: какой hook сохраняет mutable-значение без перерисовки: useRef или useState?', 'useref')],
      [q('React: что предотвращает применение устаревшего ответа поиска: проверка request id или увеличение таймаута?', 'проверка request id', ['request id']), q('React: где следует запускать сетевой эффект: useEffect или тело render?', 'useeffect'), q('React: какая техника уменьшает DOM длинного списка: виртуализация или debounce?', 'виртуализация', ['virtualization']), q('React: может ли StrictMode в разработке повторять цикл setup/cleanup эффекта? да/нет', 'да', ['yes'])],
    ],
    CSS: [
      [q(`CSS: контейнер ${n * (m + 10)}px разделён на ${n} равных колонок без gap. Ширина колонки в px?`, m + 10), q('CSS: какое свойство меняет цвет текста: color или background?', 'color'), q(`CSS: content-box, width=${n * 10}px, padding=${m}px с каждой стороны, border=0. Внешняя ширина?`, n * 10 + m * 2), q('CSS: какое значение display включает flex-контейнер: flex или absolute?', 'flex')],
      [q(`CSS grid: контейнер ${n * 100 + (n - 1) * m}px, ${n} равных колонок и gap=${m}px. Ширина колонки?`, 100), q('CSS: что включает padding в заданную width: border-box или content-box?', 'border-box'), q('CSS: какой селектор специфичнее: .card или #card?', '#card'), q('CSS flex: какое значение позволяет элементам переноситься: wrap или nowrap?', 'wrap', ['flex-wrap: wrap'])],
      [q('CSS: чем разрешить grid-колонке с длинным содержимым сжиматься: minmax(0, 1fr) или 1fr с min-width:auto?', 'minmax(0, 1fr)', ['minmax(0,1fr)']), q('CSS: какой пользовательский media query учитывает сниженное движение: prefers-reduced-motion или hover?', 'prefers-reduced-motion'), q('CSS: какое свойство создаёт новый stacking context при значении меньше 1: opacity или margin?', 'opacity'), q('CSS: что изолирует расчёты размера/раскладки компонента: contain или text-align?', 'contain')],
    ],
    Accessibility: [
      [q('HTML: тег для действия кнопкой: button или div?', 'button'), q('HTML: атрибут label, связывающий его с полем по id?', 'for', ['htmlfor']), q('HTML: атрибут текстового описания смыслового изображения?', 'alt'), q('Доступность: должна ли кнопка работать с клавиатуры? да/нет', 'да', ['yes'])],
      [q('Доступность: атрибут названия иконки-кнопки без текста: aria-label или aria-hidden?', 'aria-label'), q('Доступность: какое значение tabindex включает элемент в естественный порядок: 0 или 9?', 0), q('HTML: событие отправки формы: submit или hover?', 'submit'), q('Доступность: можно ли обозначать ошибку только красным цветом? да/нет', 'нет', ['no'])],
      [q('Доступность: куда обычно возвращают фокус после закрытия модального окна: на вызвавший элемент или body?', 'на вызвавший элемент', ['вызвавший элемент']), q('Доступность: чем объявляют асинхронное сообщение без переноса фокуса: aria-live или tabindex=99?', 'aria-live'), q('Доступность: должен ли Escape закрывать обычный модальный диалог? да/нет', 'да', ['yes']), q('Доступность: заменяет ли aria-label правильную семантику и клавиатурную обработку div-кнопки? да/нет', 'нет', ['no'])],
    ],
  };
  return banks[skill][level];
}
// Two applied, parameterized traces per skill are mandatory. A block cannot pass
// from choosing answer positions alone (one knowledge item + at least one trace).
// These remain developer-authored teaching exercises, not calibrated job grades.
function appliedPool(skill, level, n, m) {
  const size = n + m;
  const banks = {
    Python: [
      [q(`Python: a = list(range(${size})); print(sum(a[${n}:])). Ответ числом.`, (size - 1 + n) * m / 2), q(`Python: a = [${n}, ${m}]; b = a[:]; b.append(${size}); print(len(a) * a[0]). Ответ числом.`, n * 2)],
      [q(`Python: g = (x * 2 for x in range(${n})); next(g); next(g); print(sum(g)). Ответ числом.`, n * (n - 1) - 2), q(`Python: a = [[${n}]]; b = a.copy(); b[0].append(${m}); print(sum(a[0])). Ответ числом.`, size)],
      [q(`Python: from collections import deque; d = deque(range(${n})); d.rotate(${m}); print(d[0]). Ответ числом.`, (n - m % n) % n), q(`Python: total=0. Цикл for i in range(${n}): в try при i % 2 == 0 выполняется continue, иначе total += i; в finally всегда total += ${m}. Каков total после цикла? Ответ числом.`, Math.floor(n / 2) ** 2 + n * m)],
    ],
    SQL: [
      [q(`SQL: таблица содержит ${n} строк amount=${m} и ${m} строк amount=NULL. Что вернёт SELECT SUM(amount)? Ответ числом.`, n * m), q(`SQL: есть ${n} различных ненулевых значений tag, каждое повторено ${m} раз; ещё ${m} строк содержат NULL. Что вернёт COUNT(DISTINCT tag)? Ответ числом.`, n)],
      [q(`SQL: ${n} клиентов имеют по ${m} заказов, ещё 2 клиента не имеют заказов. Сколько строк вернёт clients LEFT JOIN orders ON orders.client_id=clients.id? Ответ числом.`, n * m + 2), q(`SQL: таблица t(x) содержит ${n}, ${m}, NULL. Что вернёт SELECT SUM(COALESCE(x, ${size})) FROM t? Ответ числом.`, size * 2)],
      [q(`SQL: таблица t(group_id,x) содержит ${n} строк группы 'a', x=${m} в каждой, и одну строку группы 'b', x=100. Значение SUM(x) OVER (PARTITION BY group_id) в строке группы 'a'? Ответ числом.`, n * m), q(`SQL: в начале транзакции balance=${n}. UPDATE прибавляет ${m}; SAVEPOINT s; UPDATE умножает balance на 2; ROLLBACK TO s; COMMIT. Итоговый balance? Ответ числом.`, size)],
    ],
    HTTP: [
      [q(`HTTP: UTF-8 тело ответа состоит из ${n} латинских символов A и ${m} символов Б (каждый Б занимает 2 байта). Без сжатия. Каков Content-Length в байтах? Ответ числом.`, n + 2 * m), q(`HTTP: сервер отправляет Content-Range: bytes ${n}-${n+m-1}/${size*10}. Сколько байтов содержит диапазон включительно? Ответ числом.`, m)],
      [q(`HTTP: fixed-window лимит ${size} запросов. В текущем окне уже приняты ${n}; клиент сразу отправляет ещё ${m+n}. Без смены окна сколько новых запросов получат 429? Ответ числом.`, n), q(`HTTP: сервер хранит version=${n}. Два последовательных PUT имеют If-Match со старой версией ${n}; первый успешно меняет version на ${n+1}. Какой статус получит второй, если сервер строго применяет If-Match? Ответ числом.`, 412)],
      [q(`HTTP: атомарная дедупликация сохраняет результат по Idempotency-Key. Получены ${size} POST, среди них ${m} различных ключей; тело для каждого ключа одинаково. Ошибок нет. Сколько списаний выполнится? Ответ числом.`, m), q(`HTTP: version=${n}; ${m} параллельных PATCH несут If-Match=${n}. Проверка и увеличение version атомарны; каждый успех прибавляет 1. Какой станет version после обработки всех запросов? Ответ числом.`, n + 1)],
    ],
    Algorithms: [
      [q(`Стек изначально пуст. Добавлены числа от 1 до ${size} по порядку, затем выполнены ${m} pop. Какое число теперь наверху? Ответ числом.`, n), q(`Линейный поиск идёт слева направо в массиве [${m}, ${n}, ${size}]. Ищем ${size}; все значения различны, кроме возможного равенства первых двух. Сколько сравнений? Ответ числом.`, 3)],
      [q(`Алгоритм: x=1, count=0; пока x < ${n*m}: x*=2; count+=1. Итоговый count? Ответ числом.`, Math.ceil(Math.log2(n*m))), q(`BFS стартует из вершины 0 неориентированной цепочки 0—1—...—${size}. Сколько рёбер в кратчайшем пути до ${n}? Ответ числом.`, n)],
      [q(`Очередь содержит ${n} задач. Затем за секунду приходят ${n*100} задач и обрабатываются ${m*10}. Потерь нет, обработчик не простаивает. Сколько задач останется? Ответ числом.`, n + n * 100 - m * 10), q(`Кэш LRU ёмкости 2 пуст. Обращения к ключам: A, B, A, C, B. Каждый промах стоит ${n} мс, попадание 0 мс. Общее время? Ответ числом.`, n * 4)],
    ],
    TypeScript: [
      [q(`TypeScript: [${n}, ${m}, ${size}].map(x => x * 2).reduce((a,b) => a+b, 0). Ответ числом.`, size * 4), q(`TypeScript: const a=Array(${n}).fill(0); const b=[...a, ${m}]; Чему равно a.length + b.length? Ответ числом.`, 2*n+1)],
      [q(`TypeScript: const x=0; const a=x ?? ${n}; const b=x || ${m}; Чему равно a+b? Ответ числом.`, m), q(`TypeScript: const x: string | number = '${n}'; const y = typeof x === 'string' ? x.length : x + ${m}; Чему равно y? Ответ числом.`, String(n).length)],
      [q(`TypeScript: type V={kind:'add',v:number}|{kind:'mul',v:number}; function f(x:V){return x.kind==='add' ? x.v+${m} : x.v*${m}}. Чему равно f({kind:'mul',v:${n}})? Ответ числом.`, n * m), q(`TypeScript: const data={items:[] as number[]}; const a=data.items?.length ?? ${n}; const b=data.items?.length || ${m}; Чему равно a+b? Ответ числом.`, m)],
    ],
    React: [
      [q(`React: count=${n}. В одном обработчике: setCount(count+${m}); setCount(count+${m}). Обновления пакетные. Итоговый count? Ответ числом.`, size), q(`React: count=${n}. В одном обработчике: setCount(c=>c+${m}); setCount(c=>c+${m}). Итоговый count? Ответ числом.`, n + 2 * m)],
      [q(`React: count=${n}. В одном обработчике setCount(count+${m}); затем setCount(c=>c*2). Итоговый count после пакета? Ответ числом.`, size * 2), q(`React: список с ключами по id: [{id:'a',v:${n}},{id:'b',v:${m}}]. У компонента 'a' локальный count=${size}. Список поменяли местами без изменения id и типа компонентов. Какой count сохранится у 'a'? Ответ числом.`, size)],
      [q(`React: запрос A получил id=${n}, затем B получил id=${n+1}. latestRequestId=${n+1}; результат применяется только при совпадении id. B вернул ${m}, затем A вернул ${size}. Какое значение останется в state? Ответ числом.`, m), q(`React production, без StrictMode. useEffect зависит только от userId. После mount было ${n} рендеров с тем же userId и ${m} рендеров, каждый с новым userId. Компонент ещё смонтирован. Сколько раз вызван cleanup эффекта? Ответ числом.`, m)],
    ],
    CSS: [
      [q(`CSS: box-sizing:content-box; width:${n*10}px; padding:${m}px; border:1px solid. Margin 0. Внешняя ширина в px? Ответ числом.`, n * 10 + 2 * m + 2), q(`CSS: font-size корневого элемента ${n}px, width:${m}rem. Какова width в px? Ответ числом.`, n * m)],
      [q(`CSS: box-sizing:border-box; width:${n*10}px; padding:${m}px; border:1px solid. Какова ширина content area в px? Ответ числом.`, n * 10 - 2 * m - 2), q(`CSS grid: ширина ${n*size*10+(n-1)*m}px; repeat(${n},minmax(0,1fr)); gap:${m}px. Какова ширина одной колонки в px? Ответ числом.`, size*10)],
      [q(`CSS: width:clamp(${n*2}px, ${n*m}px, ${n*5}px). Нет других ограничений. Какова итоговая width в px? Ответ числом.`, Math.min(Math.max(n*m,n*2),n*5)), q(`CSS grid: width:${n*20+m}px; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:${m}px. Нет padding/border. Ширина каждой колонки в px? Ответ числом.`, n * 10)],
    ],
    Accessibility: [
      [q(`HTML: <label for="field-${n}">Имя</label><input id="field-${n}"><input id="field-${m+20}">. Напишите id поля, связанного с label.`, `field-${n}`), q(`В DOM ${n} обычных button и ${m} button с disabled, нет других элементов или tabindex. Сколько кнопок достижимы обычным Tab? Ответ числом.`, n)],
      [q(`HTML: <span id="name-${n}">Оплатить ${n}</span><button aria-labelledby="name-${n}" aria-label="Отмена ${m}">OK</button>. Каково доступное имя кнопки?`, `оплатить ${n}`), q(`В DOM ${n} button с tabindex="0", ${m} с tabindex="-1"; других фокусируемых элементов нет. Сколько входят в последовательный Tab-порядок? Ответ числом.`, n)],
      [q(`Модальный диалог открыл button id="open-${n}". Он остаётся в DOM и доступен. После закрытия по Escape нужно восстановить фокус на инициаторе. Напишите id целевого элемента.`, `open-${n}`), q(`Focus trap диалога содержит в DOM-порядке button id="first-${n}", input id="middle-${m}", button id="last-${size}". Все доступны. Фокус на последнем; нажат Tab без Shift. Напишите id следующей цели.`, `first-${n}`)],
    ],
  };
  return banks[skill][level].map(item => ({ ...item, applied: true }));
}
export function makeQuestions(spec, grade, seed) {
  if (!BLUEPRINT[spec] || !grades.includes(grade)) throw new Error('Unknown assessment blueprint');
  const rng = random(seed), level = grades.indexOf(grade), selected = [];
  for (const skill of BLUEPRINT[spec]) {
    const n = 3 + Math.floor(rng() * 17), m = 2 + Math.floor(rng() * 7);
    const knowledge = pool(skill, level, n, m).map((item, index) => ({ ...item, skill, conceptId: `${skill}-${grade}-knowledge-${index}`, version: ASSESSMENT_VERSION }));
    const applied = appliedPool(skill, level, n, m).map((item, index) => ({ ...item, skill, conceptId: `${skill}-${grade}-applied-${index}`, version: ASSESSMENT_VERSION }));
    selected.push(...applied, ...shuffle(knowledge, rng).slice(0, 1));
  }
  return shuffle(selected, rng).map((item, index) => ({ ...item, ...(item.choices ? { choices: shuffle(item.choices,rng) } : {}), id: `q${index}` }));
}
export function normalizeAnswer(answer) { return String(answer ?? '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' '); }
export function answerMatches(question, submitted) {
  const normalized = normalizeAnswer(submitted);
  if (question.format === 'number') {
    if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(normalized)) return false;
    // Compare decimal values exactly: IEEE-754 rounding must not accept a
    // distinct long decimal such as 11.99999999999999999999999 as 12.
    const decimal=value=>{let text=String(value).replace(',','.');const negative=text.startsWith('-');text=text.replace(/^[+-]/,'');const [whole,fraction='']=text.split('.');const integer=whole.replace(/^0+/,'')||'0',tail=fraction.replace(/0+$/,'');return `${negative&&(integer!=='0'||tail)?'-':''}${integer}${tail?'.'+tail:''}`;};
    return decimal(normalized) === decimal(question.answer);
  }
  if(question.caseSensitive)return [question.answer,...(question.alternatives||[])].some(answer=>String(answer).trim()===String(submitted??'').trim());
  return [question.answer,...(question.alternatives||[])].some(answer => normalizeAnswer(answer) === normalized);
}
export function gradeAssessment(test, answers) {
  const competencyResults = BLUEPRINT[test.specialization].map(skill => {
    const questions = test.questions.filter(question => question.skill === skill);
    const correct = questions.filter(question => answerMatches(question,answers[question.id])).length;
    const total = questions.length;
    return { skill, correct, total, score: total ? Math.round(correct / total * 100) : 0, confirmed: total >= 3 && correct / total >= SKILL_PASS };
  });
  const totalCorrect = competencyResults.reduce((sum, result) => sum + result.correct, 0);
  const score = Math.round(totalCorrect / test.questions.length * 100);
  return { score, passed: score >= 75 && competencyResults.every(result => result.confirmed), competencyResults, assessmentVersion: ASSESSMENT_VERSION };
}
