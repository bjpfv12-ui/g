/**
 * autocommit.mjs — сторож автокоммита для Sunset District.
 *
 * Следит за рабочей папкой репозитория и после каждого «тихого» периода
 * (10 секунд без изменений) собирает все правки в один коммит и пушит в main.
 * Пуш в main запускает workflow и обновляет сайт на GitHub Pages.
 *
 * Запуск:
 *   node scripts/autocommit.mjs          — работать постоянно (режим службы)
 *   node scripts/autocommit.mjs --once   — один прогон и выход
 *
 * Переменные окружения:
 *   AUTOCOMMIT_QUIET_MS  — тихий период перед коммитом, мс (по умолчанию 10000)
 *   AUTOCOMMIT_PUSH=0    — не пушить, только коммитить
 *
 * Лог пишется в .git/autocommit.log, PID — в .git/autocommit.pid.
 */
import { watch } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, statSync, truncateSync, writeFileSync, unlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const GIT_DIR = join(ROOT, '.git')
const LOG_FILE = join(GIT_DIR, 'autocommit.log')
const PID_FILE = join(GIT_DIR, 'autocommit.pid')
const QUIET_MS = Number(process.env.AUTOCOMMIT_QUIET_MS || 10000)
const PUSH_ENABLED = process.env.AUTOCOMMIT_PUSH !== '0'
const ONCE = process.argv.includes('--once')

/** Каталоги, изменения в которых не считаем за правки проекта. */
const IGNORED_DIRS = ['node_modules', '.git', 'dist', 'verify', '.vite', '.cache', '.idea', '.vscode']

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`
  try {
    if (existsSync(LOG_FILE) && statSync(LOG_FILE).size > 1024 * 1024) truncateSync(LOG_FILE, 0)
    appendFileSync(LOG_FILE, line, 'utf8')
  } catch {
    /* лог не критичен */
  }
}

function git(args, allowFail = false) {
  try {
    return execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
  } catch (err) {
    if (allowFail) return null
    const detail = err.stderr ? String(err.stderr).trim().split('\n').slice(-2).join(' | ') : err.message
    throw new Error(detail)
  }
}

/** Идёт ли сейчас мердж, ребейз или блокировка индекса — тогда не трогаем репозиторий. */
function gitIsBusy() {
  return (
    existsSync(join(GIT_DIR, 'MERGE_HEAD')) ||
    existsSync(join(GIT_DIR, 'CHERRY_PICK_HEAD')) ||
    existsSync(join(GIT_DIR, 'rebase-merge')) ||
    existsSync(join(GIT_DIR, 'rebase-apply')) ||
    existsSync(join(GIT_DIR, 'index.lock'))
  )
}

/** Короткое человеческое описание того, что именно изменилось. */
function describe(files) {
  const names = files.map((f) => f.split('/').pop())
  const area = (prefix, label) =>
    files.every((f) => f.startsWith(prefix)) ? label : null

  const scope =
    area('src/components/', 'компоненты') ||
    area('src/world/', 'мир') ||
    area('src/', 'код') ||
    area('.github/', 'деплой') ||
    area('scripts/', 'скрипты') ||
    'изменения'

  const head = names.slice(0, 3).join(', ')
  const rest = names.length - 3
  const tail = rest > 0 ? ` и ещё ${rest}` : ''
  return `авто: ${scope} — ${head}${tail}`
}

function commitAndPush() {
  if (gitIsBusy()) {
    log('git занят (merge/rebase/lock) — пропускаю этот цикл')
    return
  }

  git(['add', '-A'])
  const staged = git(['diff', '--cached', '--name-only']).trim()
  if (!staged) {
    log('изменений нет')
    return
  }

  const files = staged.split('\n').filter(Boolean)
  const message = describe(files)
  try {
    git(['commit', '-m', message])
  } catch (err) {
    log(`коммит не удался: ${err.message}`)
    return
  }
  log(`коммит создан: ${message} (${files.length} файл(ов))`)

  if (!PUSH_ENABLED) {
    log('push отключён (AUTOCOMMIT_PUSH=0)')
    return
  }

  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim()
  if (branch !== 'main') {
    log(`ветка ${branch} — push пропущен`)
    return
  }

  try {
    git(['push', 'origin', 'main'])
    log('push в origin/main выполнен')
  } catch (err) {
    log(`push не удался (${err.message}) — пробую pull --rebase`)
    try {
      git(['pull', '--rebase', '--autostash', 'origin', 'main'])
      git(['push', 'origin', 'main'])
      log('push после rebase выполнен')
    } catch (err2) {
      log(`push не удался и после rebase: ${err2.message}`)
    }
  }
}

/** Ставим таймер заново при каждом событии — коммит делаем после паузы. */
let timer = null
let running = false

function schedule() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(run, QUIET_MS)
}

async function run() {
  if (running) return
  running = true
  try {
    commitAndPush()
  } catch (err) {
    log(`ошибка цикла: ${err.message}`)
  } finally {
    running = false
  }
}

function isRelevant(filename) {
  if (!filename) return false
  const normalized = filename.replace(/\\/g, '/')
  if (IGNORED_DIRS.some((dir) => normalized === dir || normalized.startsWith(`${dir}/`))) return false
  if (normalized.endsWith('.log') || normalized.endsWith('~')) return false
  return true
}

/** Защита от двух копий: если PID-файл указывает на живой процесс — выходим. */
function claimPid() {
  if (existsSync(PID_FILE)) {
    const pid = Number(readPid())
    if (pid && pid !== process.pid && isAlive(pid)) {
      log(`сторож уже запущен (pid ${pid}) — выхожу`)
      return false
    }
  }
  writeFileSync(PID_FILE, String(process.pid), 'utf8')
  return true
}

function readPid() {
  try {
    return readFileSync(PID_FILE, 'utf8').trim()
  } catch {
    return ''
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function releasePid() {
  try {
    if (existsSync(PID_FILE) && Number(readPid()) === process.pid) unlinkSync(PID_FILE)
  } catch {
    /* не критично */
  }
}

if (!existsSync(GIT_DIR)) {
  log('это не git-репозиторий — выхожу')
  process.exit(1)
}

if (ONCE) {
  commitAndPush()
  process.exit(0)
}

if (!claimPid()) process.exit(0)

log(`сторож запущен (pid ${process.pid}), тихий период ${QUIET_MS} мс, push=${PUSH_ENABLED}`)

watch(ROOT, { recursive: true, persistent: true }, (_event, filename) => {
  if (isRelevant(filename)) schedule()
})

// Периодическая проверка: страховка от потери событий в файловой системе.
setInterval(() => {
  const status = git(['status', '--porcelain'], true)
  if (status && status.trim()) schedule()
}, 60000)

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log('остановлен по сигналу')
    releasePid()
    process.exit(0)
  })
}
