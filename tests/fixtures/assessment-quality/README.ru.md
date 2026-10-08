# Assessment quality: воспроизводимые материалы

- `assessment-quality-report.ru.md`: baseline v3, результаты и пределы.
- `after-fix-report.ru.md`: исправления v4 и отдельная проверка.
- `next-assessment-iteration.ru.md`: ограниченный план 4 applied-концепции на блок, выбор 2; не реализован.
- `reference-set.json`: frozen, 144 новых авторских labels; автор AI, не независимая человеческая экспертиза.
- `reference-oracle.mjs`: отдельный семантический вычислитель.
- `build-reference.mjs`: происхождение корпуса; не запускать при обычной проверке.
- `evaluate-quality.mjs`: основной воспроизводимый evaluator.
- `baseline-quality-results.json`, `baseline-run-summary.json`, `baseline-response-cases.json`: исходные неизменные результаты.
- `after-fix-quality-results.json`, `after-fix-run-summary.json`, `after-fix-response-cases.json`: отдельные результаты v4.
- `baseline-source`: сохранённые модули, нужные для повторения исходного измерения; версия assessment 3.
- `original-evaluate-assessment.mjs.txt`: нетронутый прежний evaluator для сравнения; его исходный запускаемый путь также сохранён внутри baseline-source/scripts.
- `minimum-source-change-proposal.ru.md`: предложения владельцу реализации; сами изменения внесены им.

Node.js 22+. Из этого каталога: `node evaluate-quality.mjs` для v3; `node evaluate-quality.mjs ../../fsp-source-recovery --after-fix` для текущего проекта. Можно указать любой относительный/абсолютный путь к совместимому исходнику. Скрипт не меняет исследуемый checkout или исходный evaluator. Временные `quality-results.json`, `response-cases.json` и `run-summary.json` могут быть результатами повторного baseline-запуска; для цитирования используйте frozen `baseline-*`.

144 шаблона, 21 600 семантических сравнений, 24 576 correctness masks и 108 000 повторов прежних recipes не являются количеством независимых кандидатов/валидированных компетенций. Реальные люди и прокторинг отсутствуют.
